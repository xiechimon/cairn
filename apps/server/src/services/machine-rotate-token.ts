import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { RotateMachineTokenResponse } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { machine } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { hashCredential } from '../lib/hash.js';
import { newMachineToken } from '../lib/keys.js';
import { NotFoundError } from './builds.js';
import type { MachineDeps } from './machine-deps.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import {
  findMachineByToken,
  machineRunningCount,
  markOffline,
  toMachineRecord,
} from './machines.js';

const DEFAULT_TOKEN_ROTATION_TIMEOUT_MS = 5_000;

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

  let settled = false;
  let resolveOutcome: (outcome: 'pushed' | 'aborted') => void = () => {};
  const outcomePromise = new Promise<'pushed' | 'aborted'>((resolve) => {
    resolveOutcome = resolve;
  });
  const pending: PendingTokenRotation = {
    machineId,
    teamId: row.teamId,
    connectionId: connId,
    rotationId,
    oldTokenHash,
    newTokenPlain: next.plain,
    newTokenHash: next.hash,
    claimed: false,
    settled: false,
    settle: (outcome) => {
      if (settled) return;
      settled = true;
      pending.settled = true;
      resolveOutcome(outcome);
    },
  };
  map.set(machineId, pending);

  const offDisconnect = deps.machineHub.onDisconnect((id) => {
    if (id === machineId && !pending.settled) {
      pending.settle('aborted');
    }
  });
  const offConnect = deps.machineHub.onConnect((id) => {
    if (
      id === machineId &&
      deps.machineHub.connectionId(machineId) !== connId &&
      !pending.settled
    ) {
      pending.settle('aborted');
    }
  });
  const timer = setTimeout(() => {
    pending.settle('aborted');
  }, timeoutMs);

  try {
    const pushed = deps.machineHub.pushTokenRotate(machineId, rotationId);
    if (!pushed) {
      pending.settle('aborted');
    }
    const outcome = await outcomePromise;
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
    return commitOfflineFallback(pending.claimed, connId);
  } finally {
    clearTimeout(timer);
    offDisconnect();
    offConnect();
    pending.newTokenPlain = null;
    if (map.get(machineId) === pending) {
      map.delete(machineId);
    }
  }
}

export function claimMachineTokenRotation(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  machineId: string,
  rotationId: string,
  connectionId: string,
  hostKey?: string,
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
  if (row.hostKey !== null && hostKey !== row.hostKey) {
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
    return { ok: true };
  }

  const stagedRow = deps.db
    .select()
    .from(machine)
    .where(and(eq(machine.pendingTokenHash, presentedHash), isNull(machine.retiredAt)))
    .get();
  if (stagedRow !== undefined) {
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
    if (committed.tokenReauthRequired || committed.pendingTokenHash !== null) {
      deps.db
        .update(machine)
        .set({ pendingTokenHash: null, tokenReauthRequired: false })
        .where(eq(machine.id, committed.id))
        .run();
      if (committed.tokenReauthRequired) {
        deps.hub.publish(committed.teamId, () => ({
          type: 'machine_presence',
          machineId: committed.id,
          online: committed.online,
        }));
      }
    }
    return { ok: true };
  }

  throw new HttpError(401, 'unauthorized');
}
