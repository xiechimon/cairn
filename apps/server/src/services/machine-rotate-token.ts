import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { RotateMachineTokenResponse } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { dueEvent, machine } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { hashCredential } from '../lib/hash.js';
import { newMachineToken } from '../lib/keys.js';
import { NotFoundError } from './builds.js';
import type { DueEventRecord } from './due-events.js';
import type { MachineDeps } from './machine-deps.js';
import {
  armOverdueTokenRotationOnConnect,
  cancelMachineTokenRotation,
  MACHINE_TOKEN_ROTATION_CONNECT_GRACE_MS,
  MACHINE_TOKEN_ROTATION_EVENT_KIND,
  MACHINE_TOKEN_ROTATION_INTERVAL_MS,
  MACHINE_TOKEN_ROTATION_RETRY_MS,
  machineTokenRotationEventId,
  scheduleMachineTokenRotation,
  setActiveAutoRotation,
  setMachineTokenRotationClockListener,
  syncMachineTokenRotationDueEvents,
} from './machine-token-rotation-schedule.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import {
  findMachineByToken,
  machineRunningCount,
  markOffline,
  toMachineRecord,
} from './machines.js';

export {
  armOverdueTokenRotationOnConnect,
  cancelMachineTokenRotation,
  MACHINE_TOKEN_ROTATION_CONNECT_GRACE_MS,
  MACHINE_TOKEN_ROTATION_EVENT_KIND,
  MACHINE_TOKEN_ROTATION_INTERVAL_MS,
  MACHINE_TOKEN_ROTATION_RETRY_MS,
  machineTokenRotationEventId,
  scheduleMachineTokenRotation,
  setMachineTokenRotationClockListener,
  syncMachineTokenRotationDueEvents,
};

const DEFAULT_TOKEN_ROTATION_TIMEOUT_MS = 5_000;
const MAX_CONCURRENT_AUTO_ROTATIONS = 4;
const EVENT_PREFIX = 'token-rotate:';

interface PendingTokenRotation {
  machineId: string;
  teamId: string;
  connectionId: string;
  rotationId: string;
  oldTokenHash: string;
  newTokenPlain: string | null;
  newTokenHash: string;
  claimed: boolean;
  settled: boolean;
  settle: (outcome: 'pushed' | 'aborted') => void;
}

const pendingByHub = new WeakMap<MachineWakeHub, Map<string, PendingTokenRotation>>();
const activeAutoRotationsByHub = new WeakMap<MachineWakeHub, number>();

function hubMap(hub: MachineWakeHub): Map<string, PendingTokenRotation> {
  let map = pendingByHub.get(hub);
  if (map === undefined) {
    map = new Map();
    pendingByHub.set(hub, map);
  }
  return map;
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

type RotateDeps = Pick<MachineDeps, 'db' | 'hub' | 'machineHub'>;

async function pushAndAwaitTokenRotation(args: {
  deps: RotateDeps;
  machineId: string;
  teamId: string;
  connId: string;
  oldTokenHash: string;
  newTokenPlain: string;
  newTokenHash: string;
  rotationId: string;
  timeoutMs: number;
}): Promise<{ outcome: 'pushed' | 'aborted'; claimed: boolean }> {
  const map = hubMap(args.deps.machineHub);
  let settled = false;
  let resolveOutcome: (outcome: 'pushed' | 'aborted') => void = () => {};
  const outcomePromise = new Promise<'pushed' | 'aborted'>((resolve) => {
    resolveOutcome = resolve;
  });
  const pending: PendingTokenRotation = {
    machineId: args.machineId,
    teamId: args.teamId,
    connectionId: args.connId,
    rotationId: args.rotationId,
    oldTokenHash: args.oldTokenHash,
    newTokenPlain: args.newTokenPlain,
    newTokenHash: args.newTokenHash,
    claimed: false,
    settled: false,
    settle: (outcome) => {
      if (settled) return;
      settled = true;
      pending.settled = true;
      resolveOutcome(outcome);
    },
  };
  map.set(args.machineId, pending);

  const offDisconnect = args.deps.machineHub.onDisconnect((id) => {
    if (id === args.machineId && !pending.settled) {
      pending.settle('aborted');
    }
  });
  const offConnect = args.deps.machineHub.onConnect((id) => {
    if (
      id === args.machineId &&
      args.deps.machineHub.connectionId(args.machineId) !== args.connId &&
      !pending.settled
    ) {
      pending.settle('aborted');
    }
  });
  const timer = setTimeout(() => {
    pending.settle('aborted');
  }, args.timeoutMs);

  try {
    const pushed = args.deps.machineHub.pushTokenRotate(args.machineId, args.rotationId);
    if (!pushed) {
      pending.settle('aborted');
    }
    const outcome = await outcomePromise;
    return { outcome, claimed: pending.claimed };
  } finally {
    clearTimeout(timer);
    offDisconnect();
    offConnect();
    pending.newTokenPlain = null;
    if (map.get(args.machineId) === pending) {
      map.delete(args.machineId);
    }
  }
}

export async function rotateMachineToken(
  deps: RotateDeps,
  machineId: string,
  opts: { timeoutMs?: number } = {},
): Promise<RotateMachineTokenResponse> {
  const row = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!row || row.retiredAt !== null) {
    throw new NotFoundError(`machine ${machineId}`);
  }
  if (row.tokenHash === null) {
    throw new HttpError(409, 'machine is not enrolled');
  }
  const map = hubMap(deps.machineHub);
  if (map.has(machineId)) {
    throw new HttpError(409, 'token rotation already in progress');
  }

  const oldTokenHash = row.tokenHash;
  const next = newMachineToken();
  const rotationId = randomBytes(16).toString('base64url');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TOKEN_ROTATION_TIMEOUT_MS;

  const commitOfflineFallback = (
    claimed: boolean,
    connId: string | undefined,
  ): RotateMachineTokenResponse => {
    const updated = deps.db
      .update(machine)
      .set({
        tokenHash: next.hash,
        pendingTokenHash: null,
        tokenReauthRequired: true,
      })
      .where(
        and(
          eq(machine.id, machineId),
          eq(machine.tokenHash, oldTokenHash),
          isNull(machine.retiredAt),
        ),
      )
      .run();
    if (updated.changes === 0) {
      const current = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
      if (!current || current.retiredAt !== null) {
        throw new NotFoundError(`machine ${machineId}`);
      }
      throw new HttpError(409, 'machine credentials changed during rotation');
    }
    if (!claimed) {
      const wasOnline = row.online;
      markOffline(deps, machineId);
      deps.machineHub.revokeMachine(machineId);
      if (!wasOnline) {
        deps.hub.publish(row.teamId, () => ({
          type: 'machine_presence',
          machineId,
          online: false,
        }));
      }
    } else {
      const handedOff =
        connId !== undefined &&
        deps.machineHub.handoffConnection(machineId, connId, () => markOffline(deps, machineId));
      if (!handedOff) {
        markOffline(deps, machineId);
      }
      const after = deps.db
        .select({ online: machine.online })
        .from(machine)
        .where(eq(machine.id, machineId))
        .get();
      deps.hub.publish(row.teamId, () => ({
        type: 'machine_presence',
        machineId,
        online: after?.online ?? false,
      }));
    }
    deps.machineHub.wake(row.teamId);
    const reloaded = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
    if (!reloaded || reloaded.retiredAt !== null) {
      throw new NotFoundError(`machine ${machineId}`);
    }
    return {
      delivery: 'offline',
      machine: toMachineRecord(reloaded, machineRunningCount(deps.db, machineId)),
    };
  };

  const connId = deps.machineHub.connectionId(machineId);
  if (connId === undefined) {
    return commitOfflineFallback(false, undefined);
  }

  const { outcome, claimed } = await pushAndAwaitTokenRotation({
    deps,
    machineId,
    teamId: row.teamId,
    connId,
    oldTokenHash,
    newTokenPlain: next.plain,
    newTokenHash: next.hash,
    rotationId,
    timeoutMs,
  });
  if (outcome === 'pushed') {
    const reloaded = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
    if (!reloaded || reloaded.retiredAt !== null) {
      throw new NotFoundError(`machine ${machineId}`);
    }
    return {
      delivery: 'pushed',
      machine: toMachineRecord(reloaded, machineRunningCount(deps.db, machineId)),
    };
  }
  return commitOfflineFallback(claimed, connId);
}

export async function rotateMachineTokenAuto(
  deps: RotateDeps,
  machineId: string,
  opts: { timeoutMs?: number } = {},
): Promise<'pushed' | 'offline' | 'deferred' | 'skipped'> {
  const row = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!row || row.retiredAt !== null || row.tokenHash === null) {
    return 'skipped';
  }
  if (hubMap(deps.machineHub).has(machineId)) {
    return 'deferred';
  }
  const connId = deps.machineHub.connectionId(machineId);
  if (connId === undefined) {
    return 'offline';
  }
  const activeCount = activeAutoRotationsByHub.get(deps.machineHub) ?? 0;
  if (activeCount >= MAX_CONCURRENT_AUTO_ROTATIONS) {
    return 'deferred';
  }
  activeAutoRotationsByHub.set(deps.machineHub, activeCount + 1);
  const next = newMachineToken();
  const rotationId = randomBytes(16).toString('base64url');
  try {
    const { outcome } = await pushAndAwaitTokenRotation({
      deps,
      machineId,
      teamId: row.teamId,
      connId,
      oldTokenHash: row.tokenHash,
      newTokenPlain: next.plain,
      newTokenHash: next.hash,
      rotationId,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TOKEN_ROTATION_TIMEOUT_MS,
    });
    return outcome === 'pushed' ? 'pushed' : 'deferred';
  } finally {
    const current = activeAutoRotationsByHub.get(deps.machineHub) ?? 1;
    if (current <= 1) {
      activeAutoRotationsByHub.delete(deps.machineHub);
    } else {
      activeAutoRotationsByHub.set(deps.machineHub, current - 1);
    }
  }
}

export async function processMachineTokenRotationDue(
  deps: RotateDeps & {
    logger?: {
      info?: (obj: object, msg?: string) => void;
      warn?: (obj: object, msg?: string) => void;
    };
  },
  event: DueEventRecord,
  now: number,
  opts: { intervalMs?: number; retryMs?: number; graceMs?: number; timeoutMs?: number } = {},
): Promise<{ rescheduleAt: number | null; intervalMs?: number | null }> {
  const machineId = event.id.startsWith(EVENT_PREFIX) ? event.id.slice(EVENT_PREFIX.length) : '';
  if (machineId === '') {
    return { rescheduleAt: null };
  }
  const intervalMs = opts.intervalMs ?? MACHINE_TOKEN_ROTATION_INTERVAL_MS;
  const retryMs = opts.retryMs ?? MACHINE_TOKEN_ROTATION_RETRY_MS;
  const graceMs = opts.graceMs ?? MACHINE_TOKEN_ROTATION_CONNECT_GRACE_MS;

  const startedAt = now;
  const initialRow = deps.db
    .select({ tokenHash: machine.tokenHash, retiredAt: machine.retiredAt })
    .from(machine)
    .where(eq(machine.id, machineId))
    .get();
  if (!initialRow || initialRow.retiredAt !== null || initialRow.tokenHash === null) {
    return { rescheduleAt: null };
  }

  setActiveAutoRotation(deps.db, machineId, true);
  try {
    const outcome = await rotateMachineTokenAuto(deps, machineId, { timeoutMs: opts.timeoutMs });
    if (outcome !== 'pushed') {
      deps.logger?.info?.({ machineId, outcome }, 'auto runner token rotation deferred');
    }
  } catch (err) {
    deps.logger?.warn?.(
      { machineId, err: err instanceof Error ? err.message : String(err) },
      'auto runner token rotation failed',
    );
  } finally {
    setActiveAutoRotation(deps.db, machineId, false);
  }

  const after = deps.db
    .select({ tokenHash: machine.tokenHash, retiredAt: machine.retiredAt })
    .from(machine)
    .where(eq(machine.id, machineId))
    .get();
  if (!after || after.retiredAt !== null || after.tokenHash === null) {
    return { rescheduleAt: null };
  }
  const existingDue = deps.db.select().from(dueEvent).where(eq(dueEvent.id, event.id)).get();
  const finishNow = Math.max(now, Date.now());
  if (after.tokenHash !== initialRow.tokenHash) {
    return {
      rescheduleAt: Math.max(finishNow + intervalMs, existingDue?.dueAt ?? 0),
      intervalMs: null,
    };
  }
  if (
    existingDue !== undefined &&
    existingDue.intervalMs === retryMs &&
    existingDue.dueAt > startedAt &&
    existingDue.dueAt <= finishNow + graceMs
  ) {
    return { rescheduleAt: existingDue.dueAt, intervalMs: retryMs };
  }
  return { rescheduleAt: finishNow + retryMs, intervalMs: retryMs };
}

export function claimMachineTokenRotation(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  machineId: string,
  rotationId: string,
  connectionId: string,
  hostKey?: string,
  legacyHostKeys?: string[],
): string | null {
  const pending = hubMap(deps.machineHub).get(machineId);
  if (
    pending === undefined ||
    pending.settled ||
    pending.claimed ||
    pending.newTokenPlain === null
  ) {
    return null;
  }
  if (deps.machineHub.connectionId(machineId) !== connectionId) {
    return null;
  }
  if (
    !timingSafeTextEqual(pending.rotationId, rotationId) ||
    !timingSafeTextEqual(pending.connectionId, connectionId)
  ) {
    return null;
  }
  const row = deps.db
    .select({
      hostKey: machine.hostKey,
      tokenHash: machine.tokenHash,
      retiredAt: machine.retiredAt,
    })
    .from(machine)
    .where(eq(machine.id, machineId))
    .get();
  if (!row || row.retiredAt !== null || row.tokenHash !== pending.oldTokenHash) {
    return null;
  }
  if (
    row.hostKey !== null &&
    hostKey !== row.hostKey &&
    !(legacyHostKeys ?? []).includes(row.hostKey)
  ) {
    return null;
  }
  const staged = deps.db
    .update(machine)
    .set({ pendingTokenHash: pending.newTokenHash })
    .where(
      and(
        eq(machine.id, machineId),
        eq(machine.tokenHash, pending.oldTokenHash),
        isNull(machine.retiredAt),
      ),
    )
    .run();
  if (staged.changes === 0) {
    return null;
  }
  pending.claimed = true;
  const token = pending.newTokenPlain;
  pending.newTokenPlain = null;
  return token;
}

export function ackMachineTokenRotation(
  deps: RotateDeps,
  rotationId: string,
  newTokenPlain: string,
): { ok: true } {
  const presentedHash = hashCredential(newTokenPlain);
  const map = hubMap(deps.machineHub);
  let pending: PendingTokenRotation | undefined;
  for (const entry of map.values()) {
    if (timingSafeTextEqual(entry.rotationId, rotationId)) {
      pending = entry;
      break;
    }
  }
  if (pending !== undefined) {
    if (!pending.claimed || !timingSafeTextEqual(presentedHash, pending.newTokenHash)) {
      throw new HttpError(401, 'unauthorized');
    }
    const updated = deps.db
      .update(machine)
      .set({
        tokenHash: pending.newTokenHash,
        pendingTokenHash: null,
        tokenReauthRequired: false,
      })
      .where(
        and(
          eq(machine.id, pending.machineId),
          eq(machine.tokenHash, pending.oldTokenHash),
          isNull(machine.retiredAt),
        ),
      )
      .run();
    pending.newTokenPlain = null;
    if (map.get(pending.machineId) === pending) {
      map.delete(pending.machineId);
    }
    if (updated.changes === 0) {
      pending.settle('aborted');
      throw new HttpError(401, 'unauthorized');
    }
    pending.settle('pushed');
    deps.machineHub.handoffConnection(pending.machineId, pending.connectionId, () =>
      markOffline(deps, pending.machineId),
    );
    deps.machineHub.wake(pending.teamId);
    scheduleMachineTokenRotation(deps.db, pending.machineId);
    return { ok: true };
  }

  const stagedRow = deps.db
    .select()
    .from(machine)
    .where(and(eq(machine.pendingTokenHash, presentedHash), isNull(machine.retiredAt)))
    .get();
  if (stagedRow !== undefined) {
    if (map.has(stagedRow.id)) {
      throw new HttpError(401, 'unauthorized');
    }
    const promoted = deps.db
      .update(machine)
      .set({
        tokenHash: presentedHash,
        pendingTokenHash: null,
        tokenReauthRequired: false,
      })
      .where(
        and(
          eq(machine.id, stagedRow.id),
          eq(machine.pendingTokenHash, presentedHash),
          isNull(machine.retiredAt),
        ),
      )
      .run();
    if (promoted.changes === 0) {
      throw new HttpError(401, 'unauthorized');
    }
    const connId = deps.machineHub.connectionId(stagedRow.id);
    if (connId !== undefined) {
      deps.machineHub.handoffConnection(stagedRow.id, connId, () =>
        markOffline(deps, stagedRow.id),
      );
    }
    deps.machineHub.wake(stagedRow.teamId);
    scheduleMachineTokenRotation(deps.db, stagedRow.id);
    if (stagedRow.tokenReauthRequired) {
      deps.hub.publish(stagedRow.teamId, () => ({
        type: 'machine_presence',
        machineId: stagedRow.id,
        online: stagedRow.online,
      }));
    }
    return { ok: true };
  }

  const committed = findMachineByToken(deps.db, newTokenPlain);
  if (committed !== undefined && committed.retiredAt === null) {
    if (committed.tokenReauthRequired) {
      deps.db
        .update(machine)
        .set({ tokenReauthRequired: false })
        .where(eq(machine.id, committed.id))
        .run();
      deps.hub.publish(committed.teamId, () => ({
        type: 'machine_presence',
        machineId: committed.id,
        online: committed.online,
      }));
    }
    return { ok: true };
  }

  throw new HttpError(401, 'unauthorized');
}
