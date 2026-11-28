import {
  DOUBAO_QR_MAX_BYTES,
  type DoubaoLoginReason,
  type DoubaoLoginSession,
  type DoubaoLoginStatus,
  type DoubaoReport,
  type MachineDoubaoLoginEventBody,
  parseStoredCapabilities,
  pickNewerDoubaoReport,
} from '@cairn/shared';
import { and, count, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine, step } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const SERVER_DOUBAO_LOGIN_TIMEOUT_MS = 330_000;
const SWITCHING_HOLD_RELEASE_GRACE_MS = 5_000;

interface StoredDoubaoLogin {
  teamId: string;
  logoutFirst: boolean;
  lastAppliedRevision: number;
  session: DoubaoLoginSession;
  timer: ReturnType<typeof setTimeout> | null;
}

interface SwitchingHold {
  loginId: string;
  heldSince: number;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

const ALLOWED_TRANSITIONS: Record<DoubaoLoginStatus, ReadonlySet<DoubaoLoginStatus>> = {
  starting: new Set([
    'installing',
    'starting',
    'qr',
    'scanned',
    'verifying',
    'succeeded',
    'expired',
    'refused',
    'cancelled',
    'failed',
  ]),
  installing: new Set(['installing', 'starting', 'expired', 'refused', 'cancelled', 'failed']),
  qr: new Set([
    'qr',
    'scanned',
    'verifying',
    'succeeded',
    'expired',
    'refused',
    'cancelled',
    'failed',
  ]),
  scanned: new Set([
    'qr',
    'scanned',
    'verifying',
    'succeeded',
    'expired',
    'refused',
    'cancelled',
    'failed',
  ]),
  verifying: new Set(['qr', 'verifying', 'succeeded', 'expired', 'refused', 'cancelled', 'failed']),
  succeeded: new Set(),
  expired: new Set(),
  refused: new Set(),
  cancelled: new Set(),
  failed: new Set(),
};

interface HubLoginBook {
  byMachine: Map<string, StoredDoubaoLogin>;
  switchingHold: Map<string, SwitchingHold>;
  hub: TeamStreamHub | null;
  disconnectSubscribed: boolean;
}

const booksByHub = new WeakMap<MachineWakeHub, HubLoginBook>();

export function isDoubaoAccountSwitching(machineHub: MachineWakeHub, machineId: string): boolean {
  return booksByHub.get(machineHub)?.switchingHold.has(machineId) === true;
}

function clearSwitchingHold(book: HubLoginBook, machineId: string, expectedLoginId?: string): void {
  const hold = book.switchingHold.get(machineId);
  if (hold === undefined) return;
  if (expectedLoginId !== undefined && hold.loginId !== expectedLoginId) return;
  if (hold.releaseTimer !== null) {
    clearTimeout(hold.releaseTimer);
    hold.releaseTimer = null;
  }
  book.switchingHold.delete(machineId);
}

function scheduleHoldRelease(book: HubLoginBook, machineId: string, loginId: string): void {
  const hold = book.switchingHold.get(machineId);
  if (hold === undefined || hold.loginId !== loginId) return;
  if (hold.releaseTimer !== null) return;
  hold.releaseTimer = setTimeout(() => {
    const current = book.switchingHold.get(machineId);
    if (current === hold) {
      current.releaseTimer = null;
      book.switchingHold.delete(machineId);
    }
  }, SWITCHING_HOLD_RELEASE_GRACE_MS);
  hold.releaseTimer.unref();
}

function isActiveStatus(status: DoubaoLoginStatus): boolean {
  return (
    status === 'installing' ||
    status === 'starting' ||
    status === 'qr' ||
    status === 'scanned' ||
    status === 'verifying'
  );
}

function isTerminalStatus(status: DoubaoLoginStatus): boolean {
  return !isActiveStatus(status);
}

function bookOf(machineHub: MachineWakeHub, hub?: TeamStreamHub): HubLoginBook {
  let book = booksByHub.get(machineHub);
  if (book === undefined) {
    book = {
      byMachine: new Map(),
      switchingHold: new Map(),
      hub: hub ?? null,
      disconnectSubscribed: false,
    };
    booksByHub.set(machineHub, book);
  } else if (hub !== undefined) {
    book.hub = hub;
  }
  if (!book.disconnectSubscribed) {
    book.disconnectSubscribed = true;
    machineHub.onDisconnect((machineId) => {
      if (book !== undefined) clearSwitchingHold(book, machineId);
      const current = book?.byMachine.get(machineId);
      if (current === undefined || !isActiveStatus(current.session.status)) return;
      if (current.timer !== null) {
        clearTimeout(current.timer);
        current.timer = null;
      }
      const nextRev = current.session.revision + 1;
      const { qrPngBase64: _stripped, ...rest } = current.session;
      current.session = {
        ...rest,
        status: 'failed',
        reason: 'offline',
        detail: '执行机已离线，请在恢复在线后重试。',
        revision: nextRev,
        updatedAt: nowMs(),
      };
      publishLoginEvent(book?.hub ?? null, current.teamId, current.session);
    });
  }
  return book;
}

function publishLoginEvent(
  hub: TeamStreamHub | null | undefined,
  teamId: string,
  session: DoubaoLoginSession,
): void {
  if (hub == null) return;
  hub.publish(teamId, () => ({
    type: 'doubao.login',
    machineId: session.machineId,
    loginId: session.loginId,
    status: session.status,
    revision: session.revision,
  }));
}

function omitQr(session: DoubaoLoginSession): DoubaoLoginSession {
  const { qrPngBase64: _qr, ...rest } = session;
  return rest;
}

function assertValidQrPngBase64(qrPngBase64: string | undefined): string {
  if (qrPngBase64 === undefined || qrPngBase64 === '') {
    throw new HttpError(400, 'invalid QR PNG');
  }
  const buf = Buffer.from(qrPngBase64, 'base64');
  if (
    buf.byteLength < PNG_MAGIC.byteLength ||
    buf.byteLength > DOUBAO_QR_MAX_BYTES ||
    !buf.subarray(0, 8).equals(PNG_MAGIC)
  ) {
    throw new HttpError(400, 'invalid QR PNG');
  }
  return qrPngBase64;
}

function findTeamMachine(db: Db, teamId: string, machineId: string) {
  const row = db
    .select()
    .from(machine)
    .where(and(eq(machine.id, machineId), eq(machine.teamId, teamId), isNull(machine.retiredAt)))
    .get();
  if (row === undefined) throw notFound('Runner');
  return row;
}

function persistDoubaoMachineUpdate(
  deps: { db: Db; hub: TeamStreamHub; machineHub: MachineWakeHub },
  row: typeof machine.$inferSelect,
  incoming: DoubaoReport,
  now: number,
  options?: { wakeTeam?: boolean },
): void {
  const previousCapabilities = parseStoredCapabilities(row.capabilities);
  const nextReport = pickNewerDoubaoReport(previousCapabilities?.doubao, incoming) ?? incoming;
  const baseCaps = previousCapabilities ?? { mcpServers: [], skills: [] };
  deps.db.transaction((tx) => {
    tx.update(machine)
      .set({ capabilities: { ...baseCaps, doubao: nextReport }, lastSeenAt: now })
      .where(eq(machine.id, row.id))
      .run();
  });
  deps.hub.publish(row.teamId, () => ({
    type: 'machine_presence',
    machineId: row.id,
    online: row.online,
  }));
  if (options?.wakeTeam === true) {
    deps.machineHub.wake(row.teamId);
  }
}

function revokeMachineDoubaoAuth(
  deps: { db: Db; hub: TeamStreamHub; machineHub: MachineWakeHub },
  row: typeof machine.$inferSelect,
): void {
  const previousCapabilities = parseStoredCapabilities(row.capabilities);
  const previousReport = previousCapabilities?.doubao;
  const now = nowMs();
  const nextProbedAt = Math.max(now, (previousReport?.probedAt ?? 0) + 1);
  const nextSwitchedAt = Math.max(now, (previousReport?.switchedAt ?? 0) + 1);
  const nextReport: DoubaoReport = {
    installed: previousReport?.installed ?? true,
    authenticated: false,
    ...(previousReport?.platformSupported !== undefined
      ? { platformSupported: previousReport.platformSupported }
      : {}),
    ...(previousReport?.version !== undefined ? { version: previousReport.version } : {}),
    ...(previousReport?.models !== undefined ? { models: previousReport.models } : {}),
    probedAt: nextProbedAt,
    switchedAt: nextSwitchedAt,
  };
  persistDoubaoMachineUpdate(deps, row, nextReport, now);
}

export function startDoubaoLogin(
  deps: { db: Db; hub: TeamStreamHub; machineHub: MachineWakeHub },
  input: {
    teamId: string;
    machineId: string;
    force?: boolean;
    logoutFirst?: boolean;
    timeoutMs?: number;
  },
): { session: DoubaoLoginSession } {
  const row = findTeamMachine(deps.db, input.teamId, input.machineId);
  if (!row.online || !deps.machineHub.isConnected(input.machineId)) {
    throw new HttpError(409, 'Runner is offline');
  }
  const caps = parseStoredCapabilities(row.capabilities);
  if (caps?.doubao === undefined) {
    throw new HttpError(400, 'Runner does not support Doubao CLI login; update the Runner first');
  }
  if (caps.doubao.platformSupported === false) {
    throw new HttpError(400, 'Runner platform does not support Doubao CLI');
  }
  if (input.logoutFirst === true) {
    const runningDoubaoSteps =
      deps.db
        .select({ n: count() })
        .from(step)
        .where(
          and(
            eq(step.status, 'claimed'),
            eq(step.machineId, input.machineId),
            isNotNull(step.doubaoSubscriptionId),
          ),
        )
        .get()?.n ?? 0;
    if (runningDoubaoSteps > 0) {
      throw new HttpError(409, '该电脑上有正在运行的豆包任务，请等任务结束后再切换账号。');
    }
  }

  const book = bookOf(deps.machineHub, deps.hub);
  const existing = book.byMachine.get(input.machineId);
  const hadPreviousHold = book.switchingHold.has(input.machineId);
  const preservingHold = hadPreviousHold || input.logoutFirst === true;
  if (
    existing !== undefined &&
    isActiveStatus(existing.session.status) &&
    input.force !== true &&
    input.logoutFirst !== true
  ) {
    return { session: existing.session };
  }

  const now = nowMs();
  const loginId = newRecordId();
  const session: DoubaoLoginSession = {
    loginId,
    machineId: input.machineId,
    machineName: row.name,
    status: 'starting',
    revision: 0,
    startedAt: now,
    updatedAt: now,
  };
  const stored: StoredDoubaoLogin = {
    teamId: input.teamId,
    logoutFirst: preservingHold,
    lastAppliedRevision: -1,
    session,
    timer: null,
  };
  stored.timer = setTimeout(() => {
    const current = book.byMachine.get(input.machineId);
    if (current !== stored || !isActiveStatus(current.session.status)) return;
    current.timer = null;
    const { qrPngBase64: _stripped, ...rest } = current.session;
    current.session = {
      ...rest,
      status: 'expired',
      reason: 'expired',
      detail: '登录二维码已过期，请刷新后重新扫码。',
      revision: current.session.revision + 1,
      updatedAt: nowMs(),
    };
    scheduleHoldRelease(book, input.machineId, loginId);
    deps.machineHub.sendToMachine(input.machineId, { type: 'doubao.login.cancel', loginId });
    publishLoginEvent(deps.hub, input.teamId, current.session);
  }, input.timeoutMs ?? SERVER_DOUBAO_LOGIN_TIMEOUT_MS);
  stored.timer.unref();
  book.byMachine.set(input.machineId, stored);

  const sent = deps.machineHub.sendToMachine(input.machineId, {
    type: 'doubao.login.start',
    loginId,
    ...(preservingHold ? { logoutFirst: input.logoutFirst === true } : {}),
  });
  if (!sent) {
    if (stored.timer !== null) clearTimeout(stored.timer);
    if (existing !== undefined) {
      book.byMachine.set(input.machineId, existing);
    } else {
      book.byMachine.delete(input.machineId);
    }
    throw new HttpError(409, 'Runner is offline');
  }

  if (preservingHold) {
    const prevHold = book.switchingHold.get(input.machineId);
    if (prevHold?.releaseTimer != null) clearTimeout(prevHold.releaseTimer);
    book.switchingHold.set(input.machineId, {
      loginId,
      heldSince: prevHold?.heldSince ?? now,
      releaseTimer: null,
    });
  }

  if (existing !== undefined) {
    if (existing.timer !== null) {
      clearTimeout(existing.timer);
      existing.timer = null;
    }
    if (isActiveStatus(existing.session.status)) {
      deps.machineHub.sendToMachine(input.machineId, {
        type: 'doubao.login.cancel',
        loginId: existing.session.loginId,
      });
    }
  }
  if (input.logoutFirst === true) {
    revokeMachineDoubaoAuth(deps, row);
  }
  publishLoginEvent(deps.hub, input.teamId, stored.session);
  return { session: stored.session };
}

export function getDoubaoLogin(
  deps: { db: Db; hub: TeamStreamHub; machineHub: MachineWakeHub },
  input: { teamId: string; machineId: string; includeQr: boolean },
): { session: DoubaoLoginSession | null } {
  findTeamMachine(deps.db, input.teamId, input.machineId);
  const book = bookOf(deps.machineHub, deps.hub);
  const stored = book.byMachine.get(input.machineId);
  if (stored === undefined || stored.teamId !== input.teamId) return { session: null };
  return { session: input.includeQr ? stored.session : omitQr(stored.session) };
}

export function cancelDoubaoLogin(
  deps: { db: Db; hub: TeamStreamHub; machineHub: MachineWakeHub },
  input: { teamId: string; machineId: string; loginId?: string },
): { session: DoubaoLoginSession | null } {
  findTeamMachine(deps.db, input.teamId, input.machineId);
  const book = bookOf(deps.machineHub, deps.hub);
  const stored = book.byMachine.get(input.machineId);
  if (stored === undefined || stored.teamId !== input.teamId) return { session: null };
  if (input.loginId !== undefined && stored.session.loginId !== input.loginId) {
    return { session: omitQr(stored.session) };
  }
  if (isActiveStatus(stored.session.status)) {
    if (stored.timer !== null) {
      clearTimeout(stored.timer);
      stored.timer = null;
    }
    const { qrPngBase64: _stripped, ...rest } = stored.session;
    stored.session = {
      ...rest,
      status: 'cancelled',
      revision: stored.session.revision + 1,
      updatedAt: nowMs(),
    };
    scheduleHoldRelease(book, input.machineId, stored.session.loginId);
    deps.machineHub.sendToMachine(input.machineId, {
      type: 'doubao.login.cancel',
      loginId: stored.session.loginId,
    });
    publishLoginEvent(deps.hub, input.teamId, stored.session);
  }
  return { session: stored.session };
}

export function applyDoubaoLoginEvent(
  deps: { db: Db; hub: TeamStreamHub; machineHub: MachineWakeHub },
  machineId: string,
  body: MachineDoubaoLoginEventBody,
): void {
  const book = bookOf(deps.machineHub, deps.hub);
  const stored = book.byMachine.get(machineId);
  if (stored === undefined || stored.session.loginId !== body.loginId) {
    throw new HttpError(404, 'no Doubao login session found for this check');
  }
  if (isTerminalStatus(stored.session.status)) {
    if (body.status === 'succeeded') {
      const now = nowMs();
      const row = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
      if (row !== undefined && row.teamId === stored.teamId && row.retiredAt === null) {
        const previousReport = parseStoredCapabilities(row.capabilities)?.doubao;
        const nextSwitchedAt = Math.max(now, (previousReport?.switchedAt ?? 0) + 1);
        const incoming: DoubaoReport = {
          installed: body.doubao?.installed ?? true,
          authenticated: body.doubao?.authenticated ?? true,
          ...(body.doubao?.platformSupported !== undefined
            ? { platformSupported: body.doubao.platformSupported }
            : {}),
          ...(body.doubao?.version !== undefined ? { version: body.doubao.version } : {}),
          ...(body.doubao?.models !== undefined ? { models: body.doubao.models } : {}),
          probedAt: Math.max(
            now,
            body.doubao?.probedAt ?? now,
            (previousReport?.probedAt ?? 0) + 1,
          ),
          switchedAt: nextSwitchedAt,
        };
        persistDoubaoMachineUpdate(deps, row, incoming, now, { wakeTeam: true });
      }
    }
    if (isTerminalStatus(body.status)) {
      clearSwitchingHold(book, machineId, body.loginId);
    }
    return;
  }
  if (body.revision <= stored.lastAppliedRevision) {
    return;
  }
  if (!ALLOWED_TRANSITIONS[stored.session.status].has(body.status)) {
    throw new HttpError(
      409,
      `invalid Doubao login transition: ${stored.session.status} -> ${body.status}`,
    );
  }

  const validatedQr = body.status === 'qr' ? assertValidQrPngBase64(body.qrPngBase64) : undefined;
  const now = nowMs();
  const nextRevision = Math.max(stored.session.revision + 1, body.revision);
  const terminal = isTerminalStatus(body.status);

  const reason: DoubaoLoginReason | undefined =
    body.reason ??
    (body.status === 'expired' ? 'expired' : body.status === 'refused' ? 'refused' : undefined);
  const {
    qrPngBase64: prevQr,
    reason: _prevReason,
    detail: _prevDetail,
    ...baseSession
  } = stored.session;
  const nextSession: DoubaoLoginSession = {
    ...baseSession,
    status: body.status,
    revision: nextRevision,
    updatedAt: now,
    ...(!terminal && (validatedQr ?? prevQr) !== undefined
      ? { qrPngBase64: validatedQr ?? prevQr }
      : {}),
    ...(terminal && reason !== undefined ? { reason } : {}),
    ...(terminal && body.detail !== undefined ? { detail: body.detail } : {}),
  };

  if (body.status === 'succeeded') {
    const row = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
    if (row === undefined || row.teamId !== stored.teamId || row.retiredAt !== null) {
      if (stored.timer !== null) {
        clearTimeout(stored.timer);
        stored.timer = null;
      }
      clearSwitchingHold(book, machineId, body.loginId);
      stored.lastAppliedRevision = body.revision;
      stored.session = {
        ...baseSession,
        status: 'failed',
        reason: 'offline',
        detail: '该执行机已停用或已移出当前团队，无法完成登录。',
        revision: nextRevision,
        updatedAt: now,
      };
      publishLoginEvent(deps.hub, stored.teamId, stored.session);
      throw new HttpError(409, 'Runner is no longer active for this team');
    }
    const prevReport = parseStoredCapabilities(row.capabilities)?.doubao;
    const incoming: DoubaoReport = {
      installed: body.doubao?.installed ?? true,
      authenticated: body.doubao?.authenticated ?? true,
      ...(body.doubao?.platformSupported !== undefined
        ? { platformSupported: body.doubao.platformSupported }
        : {}),
      ...(body.doubao?.version !== undefined ? { version: body.doubao.version } : {}),
      ...(body.doubao?.models !== undefined ? { models: body.doubao.models } : {}),
      probedAt: Math.max(now, body.doubao?.probedAt ?? now, (prevReport?.probedAt ?? 0) + 1),
      switchedAt: Math.max(now, (prevReport?.switchedAt ?? 0) + 1),
    };
    persistDoubaoMachineUpdate(deps, row, incoming, now, { wakeTeam: true });
    if (stored.timer !== null) {
      clearTimeout(stored.timer);
      stored.timer = null;
    }
    clearSwitchingHold(book, machineId, body.loginId);
    stored.lastAppliedRevision = body.revision;
    stored.session = nextSession;
    publishLoginEvent(deps.hub, stored.teamId, stored.session);
    return;
  }

  if (terminal) {
    if (stored.timer !== null) {
      clearTimeout(stored.timer);
      stored.timer = null;
    }
    clearSwitchingHold(book, machineId, body.loginId);
  }
  stored.lastAppliedRevision = body.revision;
  stored.session = nextSession;
  publishLoginEvent(deps.hub, stored.teamId, stored.session);
}
