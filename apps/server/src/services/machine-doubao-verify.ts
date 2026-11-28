import {
  type DoubaoReport,
  type MachineDoubaoVerifyBody,
  parseStoredCapabilities,
  pickNewerDoubaoReport,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';
import { isDoubaoAccountSwitching } from './machine-doubao-login.js';
import type { MachineWakeHub } from './machine-wake-hub.js';

export type DoubaoLiveVerifyOutcome =
  | { ok: true; durationMs?: number }
  | {
      ok: false;
      reason: 'unavailable' | 'timeout' | 'missing_local_login' | 'failed';
      durationMs?: number;
    };

interface PendingDoubaoVerify {
  machineId: string;
  settle(outcome: DoubaoLiveVerifyOutcome): void;
}

interface HubVerifyBook {
  byCheckId: Map<string, PendingDoubaoVerify>;
  inFlightByMachine: Map<string, Promise<DoubaoLiveVerifyOutcome>>;
}

export const DOUBAO_VERIFY_TIMEOUT_MS = 40_000;
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
  promise: Promise<DoubaoLiveVerifyOutcome>,
  signal: AbortSignal | undefined,
): Promise<DoubaoLiveVerifyOutcome> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.resolve({ ok: false, reason: 'unavailable' });
  return new Promise<DoubaoLiveVerifyOutcome>((resolve) => {
    let done = false;
    const finish = (outcome: DoubaoLiveVerifyOutcome) => {
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

export function requestDoubaoVerify(
  deps: { machineHub: MachineWakeHub },
  machineId: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<DoubaoLiveVerifyOutcome> {
  if (
    opts.signal?.aborted ||
    !deps.machineHub.isConnected(machineId) ||
    isDoubaoAccountSwitching(deps.machineHub, machineId)
  ) {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  const book = bookOf(deps.machineHub);
  const existing = book.inFlightByMachine.get(machineId);
  if (existing !== undefined) return awaitWithSignal(existing, opts.signal);
  if (book.byCheckId.size >= MAX_PENDING_VERIFIES) {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  const checkId = newRecordId();
  let inFlight: Promise<DoubaoLiveVerifyOutcome> | undefined;
  inFlight = new Promise<DoubaoLiveVerifyOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: DoubaoLiveVerifyOutcome) => {
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
      opts.timeoutMs ?? DOUBAO_VERIFY_TIMEOUT_MS,
    );
    book.byCheckId.set(checkId, { machineId, settle: finish });
    if (!deps.machineHub.pushDoubaoVerify(machineId, checkId)) {
      finish({ ok: false, reason: 'unavailable' });
    }
  });
  if (book.byCheckId.has(checkId)) {
    book.inFlightByMachine.set(machineId, inFlight);
  }
  return awaitWithSignal(inFlight, opts.signal);
}

function doubaoReportOf(body: MachineDoubaoVerifyBody): DoubaoReport {
  const probedAt = body.probedAt ?? nowMs();
  if (!body.installed) {
    return {
      installed: false,
      authenticated: false,
      ...(body.platformSupported !== undefined
        ? { platformSupported: body.platformSupported }
        : {}),
      probedAt,
    };
  }
  return {
    installed: true,
    authenticated: body.authenticated,
    ...(body.platformSupported !== undefined ? { platformSupported: body.platformSupported } : {}),
    ...(body.version !== undefined ? { version: body.version } : {}),
    ...(body.models !== undefined ? { models: body.models } : {}),
    probedAt,
  };
}

export function receiveDoubaoVerify(
  deps: { db: Db; hub: TeamStreamHub; machineHub: MachineWakeHub },
  machineId: string,
  body: MachineDoubaoVerifyBody,
): void {
  const book = bookOf(deps.machineHub);
  const request = book.byCheckId.get(body.checkId);
  if (request?.machineId !== machineId) {
    throw new HttpError(404, 'no Doubao verification requested for this check');
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
  const switching = isDoubaoAccountSwitching(deps.machineHub, machineId);
  const effectiveAuthenticated = switching ? false : body.authenticated;
  const outcome: DoubaoLiveVerifyOutcome = !body.installed
    ? { ok: false, reason: 'unavailable', ...duration }
    : !effectiveAuthenticated
      ? { ok: false, reason: 'missing_local_login', ...duration }
      : { ok: true, ...duration };
  try {
    const row = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
    if (row !== undefined) {
      const incoming = doubaoReportOf(switching ? { ...body, authenticated: false } : body);
      const previousCapabilities = parseStoredCapabilities(row.capabilities);
      const previousReport = previousCapabilities?.doubao;
      const nextReport = pickNewerDoubaoReport(previousReport, incoming) ?? incoming;
      const base = previousCapabilities ?? { mcpServers: [], skills: [] };
      const nextCapabilities = { ...base, doubao: nextReport };
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
        deps.machineHub.wake(row.teamId);
      }
    }
  } finally {
    request.settle(outcome);
  }
}
