import type { AntigravityReport, MachineAntigravityVerifyBody } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';

export type AntigravityLiveVerifyOutcome =
  | { ok: true; durationMs?: number }
  | {
      ok: false;
      reason: 'unavailable' | 'timeout' | 'missing_local_login' | 'failed';
      durationMs?: number;
    };

interface PendingAntigravityVerify {
  machineId: string;
  settle(outcome: AntigravityLiveVerifyOutcome): void;
}

interface HubVerifyBook {
  byCheckId: Map<string, PendingAntigravityVerify>;
  inFlightByMachine: Map<string, Promise<AntigravityLiveVerifyOutcome>>;
}

export const ANTIGRAVITY_VERIFY_TIMEOUT_MS = 40_000;
const MAX_PENDING_VERIFIES = 64;
const booksByHub = new WeakMap<MachineWakeHub, HubVerifyBook>();

function bookOf(hub: MachineWakeHub): HubVerifyBook {
  let book = booksByHub.get(hub);
  if (book === undefined) {
    book = { byCheckId: new Map(), inFlightByMachine: new Map() };
    booksByHub.set(hub, book);
  }
  return book;
}

function awaitWithSignal(
  promise: Promise<AntigravityLiveVerifyOutcome>,
  signal: AbortSignal | undefined,
): Promise<AntigravityLiveVerifyOutcome> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.resolve({ ok: false, reason: 'unavailable' });
  return new Promise<AntigravityLiveVerifyOutcome>((resolve) => {
    let done = false;
    const finish = (outcome: AntigravityLiveVerifyOutcome) => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = () => finish({ ok: false, reason: 'unavailable' });
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(finish, () => finish({ ok: false, reason: 'unavailable' }));
  });
}

export function requestAntigravityVerify(
  deps: { machineHub: MachineWakeHub },
  machineId: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AntigravityLiveVerifyOutcome> {
  if (opts.signal?.aborted || !deps.machineHub.isConnected(machineId)) {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  const book = bookOf(deps.machineHub);
  const existing = book.inFlightByMachine.get(machineId);
  if (existing !== undefined) return awaitWithSignal(existing, opts.signal);
  if (book.byCheckId.size >= MAX_PENDING_VERIFIES) {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  const checkId = newRecordId();
  let inFlight: Promise<AntigravityLiveVerifyOutcome> | undefined;
  inFlight = new Promise<AntigravityLiveVerifyOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: AntigravityLiveVerifyOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribeDisconnect();
      book.byCheckId.delete(checkId);
      if (inFlight !== undefined && book.inFlightByMachine.get(machineId) === inFlight) {
        book.inFlightByMachine.delete(machineId);
      }
      resolve(outcome);
    };
    const unsubscribeDisconnect = deps.machineHub.onDisconnect((disconnectedId) => {
      if (disconnectedId === machineId) finish({ ok: false, reason: 'unavailable' });
    });
    const timer = setTimeout(
      () => finish({ ok: false, reason: 'timeout' }),
      opts.timeoutMs ?? ANTIGRAVITY_VERIFY_TIMEOUT_MS,
    );
    book.byCheckId.set(checkId, { machineId, settle: finish });
    if (!deps.machineHub.pushAntigravityVerify(machineId, checkId)) {
      finish({ ok: false, reason: 'unavailable' });
    }
  });
  if (book.byCheckId.has(checkId)) {
    book.inFlightByMachine.set(machineId, inFlight);
  }
  return awaitWithSignal(inFlight, opts.signal);
}

function antigravityReportOf(body: MachineAntigravityVerifyBody): AntigravityReport {
  if (!body.installed) {
    return { installed: false, authenticated: false };
  }
  return {
    installed: true,
    authenticated: body.authenticated,
    ...(body.version !== undefined ? { version: body.version } : {}),
    ...(body.source !== undefined ? { source: body.source } : {}),
    ...(body.models !== undefined ? { models: body.models } : {}),
  };
}

export function receiveAntigravityVerify(
  deps: { db: Db; hub: TeamStreamHub; machineHub: MachineWakeHub },
  machineId: string,
  body: MachineAntigravityVerifyBody,
): void {
  const book = bookOf(deps.machineHub);
  const request = book.byCheckId.get(body.checkId);
  if (request?.machineId !== machineId) {
    throw new HttpError(404, 'no Antigravity verification requested for this check');
  }
  book.byCheckId.delete(body.checkId);
  const duration = body.durationMs !== undefined ? { durationMs: body.durationMs } : {};
  if (body.timedOut === true) {
    request.settle({ ok: false, reason: 'timeout', ...duration });
    return;
  }
  if (body.installed && !body.authenticated && body.error !== undefined) {
    request.settle({ ok: false, reason: 'failed', ...duration });
    return;
  }
  const outcome: AntigravityLiveVerifyOutcome = !body.installed
    ? { ok: false, reason: 'unavailable', ...duration }
    : !body.authenticated
      ? { ok: false, reason: 'missing_local_login', ...duration }
      : { ok: true, ...duration };
  try {
    const row = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
    if (row !== undefined) {
      const nextReport = antigravityReportOf(body);
      const previousReport = row.capabilities?.antigravity;
      const base = row.capabilities ?? { mcpServers: [], skills: [] };
      const nextCapabilities = { ...base, antigravity: nextReport };
      deps.db
        .update(machine)
        .set({ capabilities: nextCapabilities, lastSeenAt: nowMs() })
        .where(eq(machine.id, machineId))
        .run();
      if (JSON.stringify(nextReport) !== JSON.stringify(previousReport)) {
        deps.hub.publish(row.teamId, () => ({
          type: 'machine_presence',
          machineId,
          online: row.online,
        }));
      }
    }
  } finally {
    request.settle(outcome);
  }
}
