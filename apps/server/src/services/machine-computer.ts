import { createHash } from 'node:crypto';
import {
  COMPUTER_FEED_TOOLS,
  COMPUTER_REPLAY_SAFE_TOOLS,
  type ComputerCall,
  type ComputerCallState,
  type ComputerCommand,
  type ComputerFrame,
  type ComputerRelayResult,
  type ComputerTool,
  isComputerBrowserTool,
  type MachineComputerFramesResponse,
  type MachineComputerRelayBody,
  redactSecrets,
} from '@cairn/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chief, chiefThread, computer, computerCall, machine, step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { NotFoundError } from './builds.js';
import { computerCallOwnerUserId } from './computer-access.js';
import {
  COMPUTER_HANDOFF_POLL_MS,
  COMPUTER_HANDOFF_TIMEOUT_MS,
  clearHandoff,
  HANDOFF_CLEARED,
  handoffRefusal,
  markHandoffIfNone,
  ownerHoldsControl,
  pause,
  TAKEOVER_HANDED_BACK,
  TAKEOVER_NO_COMPUTER,
  TAKEOVER_NOT_DONE,
} from './computer-handoff.js';
import type { TeamStreamHub } from './events.js';
import { isChiefConversation, type MachineDeps, ownedStep } from './machine-deps.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { pushToUserSafely } from './push.js';

export const COMPUTER_OUTPUT_HEAD_CHARS = 16 * 1024;
export const COMPUTER_OUTPUT_TAIL_CHARS = 48 * 1024;

export const COMPUTER_OUTPUT_PENDING_CHARS = 64 * 1024;

const pendingOutput = new Map<string, string>();

export const COMPUTER_SHELL_COMMAND_TIMEOUT_DEFAULT_MS = 5 * 60_000;
export const COMPUTER_SHELL_COMMAND_TIMEOUT_MAX_MS = 60 * 60_000;
export const COMPUTER_SHELL_DEADLINE_SLACK_MS = 30_000;
export const COMPUTER_SCREEN_DEADLINE_MS = 2 * 60_000;
export const COMPUTER_OTHER_DEADLINE_MS = 10 * 60_000;
export const COMPUTER_EXECUTION_LEASE_MS = 5 * 60_000;
export const COMPUTER_FEED_OUTPUT_CHARS = 4 * 1024;
export const COMPUTER_STORED_PARAM_CHARS = 8 * 1024;

export const COMPUTER_NOT_CONNECTED = 'the computer is not connected';
export const COMPUTER_BUSY = 'the computer is busy with another Coordinator turn';
export const COMPUTER_USER_CONTROL = 'ian has control of this computer';
export const COMPUTER_INTERRUPTED = 'interrupted, may have partially run; it was not retried';
export const COMPUTER_CANCELLED = 'cancelled because the Coordinator turn was stopped';
export const COMPUTER_BROWSER_DISABLED =
  'browser tools are off for this computer; enable 浏览器 in the Computers panel';
export const COMPUTER_BROWSER_UNAVAILABLE =
  'this machine no longer reports browser capability; turn off 浏览器 or rebuild the computer image';

const SHELL_TOOLS: ReadonlySet<ComputerTool> = new Set(['shell', 'user_computer_shell']);
const SCREEN_TOOLS: ReadonlySet<ComputerTool> = new Set([
  'computer_observe',
  'computer_act',
  'user_computer_observe',
  'user_computer_act',
  'open_path',
  'launch_app',
]);
const FEED_TOOLS: ReadonlySet<string> = new Set(COMPUTER_FEED_TOOLS);

export function hasPendingComputerOutput(callId: string): boolean {
  return pendingOutput.has(callId);
}

export function pendingComputerOutputRelease(db: Db, machineId: string): () => void {
  const ids = db
    .select({ id: computerCall.id })
    .from(computerCall)
    .where(eq(computerCall.machineId, machineId))
    .all()
    .map(({ id }) => id);
  return () => {
    for (const id of ids) pendingOutput.delete(id);
  };
}

const FINISHED_STATES: ReadonlySet<ComputerCallState> = new Set(['done', 'error', 'interrupted']);

type CallRow = typeof computerCall.$inferSelect;
type CallPatch = Partial<typeof computerCall.$inferInsert>;

function redact(text: string): string {
  return redactSecrets(text).value as string;
}

type Output = Pick<CallRow, 'outputHead' | 'outputTail' | 'outputChars'> & { pending: string };

function appendOutput(out: Output, text: string, flush: boolean): Output {
  const raw = out.pending + text;
  let start = raw.length;
  while (start > 0 && !/\s/.test(raw[start - 1] ?? '')) start--;
  const keep = !flush && raw.length - start <= COMPUTER_OUTPUT_PENDING_CHARS;
  const pending = keep ? raw.slice(start) : '';
  const settled = keep ? raw.slice(0, start) : raw;
  const joined =
    settled === ''
      ? out.outputHead + out.outputTail
      : redact(out.outputHead + out.outputTail + settled);
  return {
    outputHead: joined.slice(0, COMPUTER_OUTPUT_HEAD_CHARS),
    outputTail: joined.slice(COMPUTER_OUTPUT_HEAD_CHARS).slice(-COMPUTER_OUTPUT_TAIL_CHARS),
    outputChars: out.outputChars + text.length,
    pending,
  };
}

function applyFrames(
  row: CallRow,
  frames: readonly ComputerFrame[],
  now: number,
): { patch: CallPatch; pending: string } {
  let expected = row.lastSeq + 1;
  let finished = false;
  let output: Output = {
    outputHead: row.outputHead,
    outputTail: row.outputTail,
    outputChars: row.outputChars,
    pending: pendingOutput.get(row.id) ?? '',
  };
  const patch: CallPatch = {};
  for (const frame of frames) {
    if (frame.seq !== expected) {
      throw new HttpError(409, `computer frame ${frame.seq} arrived before frame ${expected}`);
    }
    if (finished) throw new HttpError(409, 'computer frame after the call finished');
    expected++;
    switch (frame.kind) {
      case 'output':
        output = appendOutput(output, frame.text, false);
        break;
      case 'heartbeat':
        break;
      case 'done':
        finished = true;
        output = appendOutput(output, '', true);
        Object.assign(patch, {
          resultText: redact(frame.text),
          resultImages: frame.images ?? null,
          exitCode: frame.exitCode ?? null,
          finishedAt: now,
          ...(row.state === 'cancelled' ? {} : { state: 'done' as const }),
        });
        break;
      case 'error':
        finished = true;
        output = appendOutput(output, '', true);
        Object.assign(patch, {
          errorMessage: redact(frame.message),
          errorDelivery: frame.delivery,
          finishedAt: now,
          ...(row.state === 'cancelled' ? {} : { state: 'error' as const }),
        });
        break;
    }
  }
  const { pending, ...stored } = output;
  return {
    pending,
    patch: {
      ...stored,
      ...patch,
      lastSeq: expected - 1,
      ...(row.startedAt === null ? { startedAt: now } : {}),
      ...(row.state === 'dispatched' && patch.state === undefined
        ? { state: 'running' as const }
        : {}),
    },
  };
}

export function clearPendingComputerOutput(callId: string): void {
  pendingOutput.delete(callId);
}

export function receiveComputerFrames(
  db: Db,
  hub: TeamStreamHub,
  machineId: string,
  callId: string,
  frames: readonly ComputerFrame[],
): MachineComputerFramesResponse {
  const result = db.transaction((tx) => {
    const row = tx.select().from(computerCall).where(eq(computerCall.id, callId)).get();
    if (!row || row.machineId !== machineId) throw new HttpError(404, 'computer call not found');
    if (row.state === 'dispatched' || row.state === 'running') {
      const owner = tx
        .select({ status: step.status })
        .from(step)
        .where(eq(step.id, row.stepId))
        .get();
      if (owner && owner.status !== 'claimed') {
        tx.update(computerCall)
          .set({ state: 'cancelled' })
          .where(eq(computerCall.id, callId))
          .run();
        row.state = 'cancelled';
      }
    }
    const ordered = [...frames].sort((a, b) => a.seq - b.seq);
    if (new Set(ordered.map((f) => f.seq)).size !== ordered.length) {
      throw new HttpError(400, 'computer frames repeat a sequence number');
    }
    const fresh = ordered.filter((f) => f.seq > row.lastSeq);
    const cancelled = row.state === 'cancelled';
    if (fresh.length === 0) {
      return {
        response: { ok: true as const, cancelled },
        pending: null,
        finished: cancelled,
        publishOutput: false,
      };
    }
    if (FINISHED_STATES.has(row.state) || (cancelled && row.finishedAt !== null)) {
      throw new HttpError(409, `computer call already ${row.state}`);
    }
    const { patch, pending } = applyFrames(row, fresh, nowMs());
    tx.update(computerCall).set(patch).where(eq(computerCall.id, callId)).run();
    if (
      row.computerId !== null &&
      !cancelled &&
      isComputerBrowserTool(row.tool) &&
      fresh.some((frame) => frame.kind === 'done' && frame.loginForm !== undefined)
    ) {
      markHandoffIfNone(tx, row.computerId, 'login', row.stepId, nowMs());
    }
    return {
      response: { ok: true as const, cancelled },
      pending,
      finished: patch.finishedAt !== undefined || cancelled,
      publishOutput: fresh.some((frame) => frame.kind === 'output'),
    };
  });
  if (result.pending === '') pendingOutput.delete(callId);
  else if (result.pending !== null) pendingOutput.set(callId, result.pending);
  const live = pendingCalls.get(callId);
  const publishHub = live?.hub ?? hub;
  const computerId =
    db.select().from(computerCall).where(eq(computerCall.id, callId)).get()?.computerId ?? null;
  if (syncObservedComputerState(db, computerId)) {
    publishObservedComputerState(db, publishHub, computerId);
  }
  if (result.finished) settleComputerCall(db, callId, hub);
  else if (result.publishOutput) {
    const row = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
    if (row) publishFeed(db, publishHub, row);
  }
  return result.response;
}

interface PendingCall {
  result: Promise<ComputerRelayResult>;
  hub: TeamStreamHub;
  resolve: (result: ComputerRelayResult) => void;
  dispose: () => void;
}

const pendingCalls = new Map<string, PendingCall>();

export function dropComputerWaiters(): void {
  for (const call of pendingCalls.values()) call.dispose();
  pendingCalls.clear();
}

export function computerCallId(stepId: string, toolCallId: string, attempt = 1): string {
  const base = `${stepId}\0${toolCallId}`;
  return createHash('sha256')
    .update(attempt <= 1 ? base : `${base}\0${attempt}`)
    .digest('hex');
}

function latestComputerAttempt(
  db: Db,
  stepId: string,
  toolCallId: string,
): { row: CallRow; attempt: number } | null {
  const byId = new Map(
    db
      .select()
      .from(computerCall)
      .where(and(eq(computerCall.stepId, stepId), eq(computerCall.toolCallId, toolCallId)))
      .all()
      .map((row) => [row.id, row]),
  );
  let latest: { row: CallRow; attempt: number } | null = null;
  for (let attempt = 1; ; attempt++) {
    const row = byId.get(computerCallId(stepId, toolCallId, attempt));
    if (!row) return latest;
    latest = { row, attempt };
  }
}

export function computerMachineName(scopeKey: string): string {
  return `cairn-orb-computer-${createHash('sha256').update(scopeKey).digest('hex').slice(0, 40)}`;
}

export function computerDeadlineMs(tool: ComputerTool, params: Record<string, unknown>): number {
  if (SHELL_TOOLS.has(tool)) {
    const asked = params.timeoutMs;
    const timeout =
      typeof asked === 'number' &&
      Number.isInteger(asked) &&
      asked > 0 &&
      asked <= COMPUTER_SHELL_COMMAND_TIMEOUT_MAX_MS
        ? asked
        : COMPUTER_SHELL_COMMAND_TIMEOUT_DEFAULT_MS;
    return timeout + COMPUTER_SHELL_DEADLINE_SLACK_MS;
  }
  return SCREEN_TOOLS.has(tool) ? COMPUTER_SCREEN_DEADLINE_MS : COMPUTER_OTHER_DEADLINE_MS;
}

function isFinalState(state: ComputerCallState): boolean {
  return state !== 'dispatched' && state !== 'running';
}

function storedParams(params: Record<string, unknown>): Record<string, unknown> {
  const clip = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.length > COMPUTER_STORED_PARAM_CHARS
        ? `${value.slice(0, COMPUTER_STORED_PARAM_CHARS)}[truncated ${value.length - COMPUTER_STORED_PARAM_CHARS} chars]`
        : value;
    }
    if (Array.isArray(value)) return value.map(clip);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clip(v)]));
    }
    return value;
  };
  return clip(redactSecrets(params).value) as Record<string, unknown>;
}

function resultOfRow(row: CallRow): ComputerRelayResult {
  switch (row.state) {
    case 'done': {
      const text = row.resultText ?? redact(row.outputHead + row.outputTail);
      const exit =
        row.exitCode !== null && row.exitCode !== 0 ? `\n[exit code ${row.exitCode}]` : '';
      const images = row.resultImages ?? undefined;
      return { text: text + exit, ...(images && images.length > 0 ? { images } : {}) };
    }
    case 'error': {
      const note =
        row.errorDelivery === 'not_delivered'
          ? 'the action did not run'
          : 'the action may have partially run';
      return { text: `computer error: ${row.errorMessage ?? 'unknown error'} (${note})` };
    }
    case 'interrupted':
      return { text: `computer call ${COMPUTER_INTERRUPTED}` };
    case 'cancelled':
      return { text: `computer call ${COMPUTER_CANCELLED}` };
    default:
      return { text: 'computer call is still running' };
  }
}

export function feedOf(row: CallRow): ComputerCommand | null {
  if (!FEED_TOOLS.has(row.tool)) return null;
  const param = (key: string): string => {
    const value = row.params[key];
    return typeof value === 'string' ? value : '';
  };
  const shell = SHELL_TOOLS.has(row.tool);
  const command = shell
    ? param('command')
    : row.tool === 'launch_app'
      ? [param('application'), param('uri')].filter((part) => part !== '').join(' ')
      : param('path');
  const streamed = row.outputHead + row.outputTail;
  const output = shell
    ? streamed || (row.resultText ?? row.errorMessage ?? '')
    : (row.errorMessage ?? '');
  return {
    callId: row.id,
    computerId: row.computerId,
    stepId: row.stepId,
    tool: row.tool as ComputerCommand['tool'],
    command: redact(command),
    cwd: shell ? redact(param('cwd') || '.') : '.',
    status: isFinalState(row.state) ? (row.state as ComputerCommand['status']) : 'running',
    exitCode: row.exitCode,
    output: redact(output).slice(-COMPUTER_FEED_OUTPUT_CHARS),
    at: row.createdAt,
  };
}

function publishFeed(db: Db, hub: TeamStreamHub, row: CallRow): void {
  const command = feedOf(row);
  if (!command) return;
  const userId = computerCallOwnerUserId(db, row);
  if (userId) hub.publishPrivate(row.teamId, userId, () => ({ type: 'computer.command', command }));
}

export function settleComputerCall(db: Db, callId: string, hub?: TeamStreamHub): void {
  const live = pendingCalls.get(callId);
  const row = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  if (!row || !isFinalState(row.state)) return;
  if (live) {
    pendingCalls.delete(callId);
    live.dispose();
  }
  const publishHub = live?.hub ?? hub;
  if (publishHub) {
    if (syncObservedComputerState(db, row.computerId)) {
      publishObservedComputerState(db, publishHub, row.computerId);
    }
    publishFeed(db, publishHub, row);
  } else {
    syncObservedComputerState(db, row.computerId);
  }
  live?.resolve(resultOfRow(row));
}

function expireComputerCall(db: Db, callId: string): void {
  const row = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  if (row && !isFinalState(row.state)) {
    db.update(computerCall)
      .set({
        ...(row.replaySafe
          ? { state: 'error' as const, errorMessage: 'the computer call timed out' }
          : { state: 'interrupted' as const, errorMessage: 'the deadline passed with no result' }),
        errorDelivery: 'unknown',
        finishedAt: nowMs(),
      })
      .where(eq(computerCall.id, callId))
      .run();
  }
  settleComputerCall(db, callId);
}

function openPending(
  deps: MachineDeps,
  call: { callId: string; stepId: string; deadlineAt: number },
): PendingCall {
  let resolve!: (result: ComputerRelayResult) => void;
  const result = new Promise<ComputerRelayResult>((r) => {
    resolve = r;
  });
  const timer = setTimeout(
    () => expireComputerCall(deps.db, call.callId),
    Math.max(0, call.deadlineAt - nowMs()),
  );
  timer.unref();
  const offStop = deps.machineHub.onStop(call.stepId, () => stopStepComputer(deps, call.stepId));
  const pending: PendingCall = {
    result,
    hub: deps.hub,
    resolve,
    dispose: () => {
      clearTimeout(timer);
      offStop();
    },
  };
  pendingCalls.set(call.callId, pending);
  return pending;
}

function syncObservedComputerState(db: Db, computerId: string | null): boolean {
  if (!computerId) return false;
  const current = db
    .select({ state: computer.state })
    .from(computer)
    .where(eq(computer.id, computerId))
    .get();
  if (!current) return false;
  const open = db
    .select({ state: computerCall.state, startedAt: computerCall.startedAt })
    .from(computerCall)
    .where(
      and(
        eq(computerCall.computerId, computerId),
        inArray(computerCall.state, ['dispatched', 'running']),
      ),
    )
    .all();
  const state =
    open.length === 0
      ? 'stopped'
      : open.some((row) => row.state === 'running' || row.startedAt !== null)
        ? 'running'
        : 'starting';
  if (current.state === state) return false;
  db.update(computer).set({ state, updatedAt: nowMs() }).where(eq(computer.id, computerId)).run();
  return true;
}

function publishObservedComputerState(
  db: Db,
  hub: TeamStreamHub | undefined,
  computerId: string | null,
): void {
  if (!hub || !computerId) return;
  const row = db.select().from(computer).where(eq(computer.id, computerId)).get();
  if (!row?.scopeKey.startsWith('chief:')) return;
  const owner = db
    .select({ userId: chief.userId, teamId: chief.teamId })
    .from(chief)
    .where(eq(chief.id, row.scopeKey.slice('chief:'.length)))
    .get();
  if (!owner || owner.teamId !== row.teamId || owner.userId === '') return;
  hub.publishPrivate(row.teamId, owner.userId, () => ({
    type: 'computer.state',
    computerId: row.id,
    state: row.state,
  }));
}

function releaseExecutionLease(db: Db, stepId: string): void {
  db.update(computer)
    .set({ executionStepId: null, executionLeaseExpiresAt: null, updatedAt: nowMs() })
    .where(eq(computer.executionStepId, stepId))
    .run();
  db.update(computer)
    .set({ ...HANDOFF_CLEARED, updatedAt: nowMs() })
    .where(eq(computer.handoffStepId, stepId))
    .run();
}

export function stopStepComputer(
  deps: Pick<MachineDeps, 'db'> & { machineHub?: MachineWakeHub },
  stepId: string,
): void {
  const { db } = deps;
  const open = db
    .select({ id: computerCall.id })
    .from(computerCall)
    .where(
      and(eq(computerCall.stepId, stepId), inArray(computerCall.state, ['dispatched', 'running'])),
    )
    .all();
  if (open.length > 0) {
    db.update(computerCall)
      .set({ state: 'cancelled' })
      .where(
        and(
          eq(computerCall.stepId, stepId),
          inArray(computerCall.state, ['dispatched', 'running']),
          isNull(computerCall.finishedAt),
        ),
      )
      .run();
  }
  for (const { id } of open) settleComputerCall(db, id);
  releaseExecutionLease(db, stepId);
}

function machineAcceptsTool(row: typeof machine.$inferSelect, tool: ComputerTool): boolean {
  if (isComputerBrowserTool(tool)) {
    return row.browserOverride !== false && row.capabilities?.browser === true;
  }
  return row.desktopOverride !== false && row.capabilities?.computer === true;
}

function assertMachineGrant(db: Db, machineId: string, tool: ComputerTool): void {
  const host = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (isComputerBrowserTool(tool)) {
    if (host?.browserOverride === false) throw new HttpError(403, COMPUTER_BROWSER_DISABLED);
    if (host?.capabilities?.browser !== true)
      throw new HttpError(403, COMPUTER_BROWSER_UNAVAILABLE);
  } else if (host?.desktopOverride === false || host?.capabilities?.computer !== true) {
    throw new HttpError(403, 'Orb desktop tools are off or unavailable for this machine');
  }
}

function selectTarget(
  deps: MachineDeps,
  teamId: string,
  chiefId: string,
  tool: ComputerTool,
): { machineId: string; computerId: string | null; scopeKey?: string } {
  const { db, machineHub } = deps;
  const wantsOwn = tool.startsWith('user_computer_');
  const capable = (row: typeof machine.$inferSelect): boolean =>
    wantsOwn ? row.capabilities?.ownComputer === true : row.capabilities?.computer === true;
  const fleet = db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .orderBy(desc(machine.lastSeenAt))
    .all()
    .filter(capable);
  const connected = fleet.filter((row) => machineHub.isConnected(row.id));
  const live = connected.filter((row) => machineAcceptsTool(row, tool));

  if (wantsOwn) {
    const chosen = connected[0];
    if (chosen) return { machineId: chosen.id, computerId: null };
    throw new HttpError(
      409,
      fleet.length === 0
        ? 'no machine in this team offers its own computer'
        : COMPUTER_NOT_CONNECTED,
    );
  }

  const scopeKey = `chief:${chiefId}`;
  const existing = db.select().from(computer).where(eq(computer.scopeKey, scopeKey)).get();
  if (existing) {
    assertMachineGrant(db, existing.machineId, tool);
    if (!machineHub.isConnected(existing.machineId)) {
      throw new HttpError(409, COMPUTER_NOT_CONNECTED);
    }
    return { machineId: existing.machineId, computerId: existing.id, scopeKey };
  }
  const chosen = live[0];
  if (!chosen) {
    if (connected[0]) assertMachineGrant(db, connected[0].id, tool);
    throw new HttpError(
      409,
      fleet.length === 0
        ? 'no machine in this team offers a Coordinator computer'
        : COMPUTER_NOT_CONNECTED,
    );
  }
  assertMachineGrant(db, chosen.id, tool);
  const now = nowMs();
  const id = newRecordId();
  db.insert(computer)
    .values({
      id,
      teamId,
      scopeKey,
      machineId: chosen.id,
      providerRef: computerMachineName(scopeKey),
      state: 'starting',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { machineId: chosen.id, computerId: id, scopeKey };
}

function acquireExecutionLease(
  db: Db,
  computerId: string,
  stepId: string,
  readOnly: boolean,
  deadlineAt: number,
): void {
  const row = db.select().from(computer).where(eq(computer.id, computerId)).get();
  if (!row) return;
  const now = nowMs();
  const userHolds =
    row.controlHolder === 'user' &&
    (row.controlLeaseExpiresAt === null || row.controlLeaseExpiresAt > now);
  if (userHolds) {
    if (readOnly) return;
    throw new HttpError(409, COMPUTER_USER_CONTROL);
  }
  const held =
    row.executionStepId !== null &&
    row.executionLeaseExpiresAt !== null &&
    row.executionLeaseExpiresAt > now;
  if (held && row.executionStepId !== stepId) throw new HttpError(409, COMPUTER_BUSY);
  const renewed = Math.max(now + COMPUTER_EXECUTION_LEASE_MS, deadlineAt);
  db.update(computer)
    .set({
      executionStepId: stepId,
      executionLeaseExpiresAt: held ? Math.max(row.executionLeaseExpiresAt ?? 0, renewed) : renewed,
      executionFence: held ? row.executionFence : row.executionFence + 1,
      updatedAt: now,
    })
    .where(eq(computer.id, computerId))
    .run();
}

async function waitForCall(
  deps: Pick<MachineDeps, 'db'> & { machineHub?: MachineWakeHub },
  pending: PendingCall,
  stepId: string,
  signal: AbortSignal | undefined,
): Promise<ComputerRelayResult> {
  if (!signal) return pending.result;
  const onAbort = () => stopStepComputer(deps, stepId);
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await pending.result;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export const OWN_COMPUTER_UNGATED_MESSAGE =
  "ian's own computer tools stay off until their approval gate ships";

export type OwnComputerGate = (input: { stepId: string; tool: ComputerTool }) => void;

export const refuseOwnComputerUntilGated: OwnComputerGate = () => {
  throw new HttpError(403, OWN_COMPUTER_UNGATED_MESSAGE);
};

type HandoffWait = 'handed_back' | 'not_done';

async function holdTakeover(
  deps: MachineDeps,
  thread: typeof chiefThread.$inferSelect,
  stepId: string,
  body: MachineComputerRelayBody,
  opts: { signal?: AbortSignal; takeover?: { timeoutMs?: number; pollMs?: number } },
): Promise<ComputerRelayResult> {
  const { db } = deps;
  const target = db
    .select()
    .from(computer)
    .where(eq(computer.scopeKey, `chief:${thread.chiefId}`))
    .get();
  if (!target) return { text: TAKEOVER_NO_COMPUTER };
  const timeoutMs = opts.takeover?.timeoutMs ?? COMPUTER_HANDOFF_TIMEOUT_MS;
  const pollMs = opts.takeover?.pollMs ?? COMPUTER_HANDOFF_POLL_MS;
  const now = nowMs();
  const deadlineAt = now + timeoutMs;
  acquireExecutionLease(db, target.id, stepId, true, deadlineAt);
  const callId = computerCallId(stepId, body.toolCallId);
  db.insert(computerCall)
    .values({
      id: callId,
      teamId: thread.teamId,
      stepId,
      toolCallId: body.toolCallId,
      machineId: target.machineId,
      computerId: target.id,
      tool: 'request_takeover',
      replaySafe: false,
      params: storedParams(body.params),
      state: 'running',
      deadlineAt,
      createdAt: now,
      startedAt: now,
    })
    .run();
  markHandoffIfNone(db, target.id, 'model', stepId, now);
  if (syncObservedComputerState(db, target.id))
    publishObservedComputerState(db, deps.hub, target.id);
  const asked = body.params.reason;
  const reason =
    typeof asked === 'string' && asked.trim() !== '' ? redact(asked).slice(0, 200) : '';
  pushToUserSafely(db, deps.vapidKeys ?? null, thread.userId, thread.teamId, {
    title: 'Login needed',
    body: reason || 'The Coordinator needs you to take over its computer.',
    href: `/app?pane=machines&machine=${encodeURIComponent(target.machineId)}&screen=1`,
    tag: `${thread.userId}:${callId}`,
  });
  const atStart = db.select().from(computer).where(eq(computer.id, target.id)).get();
  const fenceAtStart = atStart?.controlFence;
  const fenceSteps = atStart !== undefined && ownerHoldsControl(atStart, now) ? 1 : 2;
  let outcome: HandoffWait = 'not_done';
  try {
    for (;;) {
      const call = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
      const owner = db.select().from(step).where(eq(step.id, stepId)).get();
      const row = db.select().from(computer).where(eq(computer.id, target.id)).get();
      if (call?.state !== 'running' || owner?.status !== 'claimed' || !row) break;
      if (
        row.controlHolder === 'none' &&
        fenceAtStart !== undefined &&
        row.controlFence >= fenceAtStart + fenceSteps
      ) {
        outcome = 'handed_back';
        break;
      }
      if (opts.signal?.aborted || nowMs() >= deadlineAt) break;
      await pause(pollMs, opts.signal);
    }
  } finally {
    const handedBack = outcome === 'handed_back';
    db.update(computerCall)
      .set(
        handedBack
          ? { state: 'done', resultText: TAKEOVER_HANDED_BACK, finishedAt: nowMs() }
          : {
              state: 'error',
              errorMessage: 'the owner did not finish',
              errorDelivery: 'not_delivered',
              finishedAt: nowMs(),
            },
      )
      .where(eq(computerCall.id, callId))
      .run();
    clearHandoff(db, target.id);
    releaseExecutionLease(db, stepId);
    if (syncObservedComputerState(db, target.id)) {
      publishObservedComputerState(db, deps.hub, target.id);
    }
  }
  return { text: outcome === 'handed_back' ? TAKEOVER_HANDED_BACK : TAKEOVER_NOT_DONE };
}

export async function forwardComputerCall(
  deps: MachineDeps,
  machineId: string | null,
  stepId: string,
  body: MachineComputerRelayBody,
  opts: {
    signal?: AbortSignal;
    ownComputerGate?: OwnComputerGate;
    takeover?: { timeoutMs?: number; pollMs?: number };
  } = {},
): Promise<ComputerRelayResult> {
  const { db } = deps;
  const stepRow = ownedStep(deps, machineId, stepId);
  if (stepRow.kind !== 'chief' || !isChiefConversation(stepRow.buildId)) {
    throw new HttpError(400, `step ${stepId} is not a chief step`);
  }
  if (stepRow.status !== 'claimed') {
    throw new HttpError(409, 'Coordinator tools require a currently claimed turn');
  }
  const thread = db.select().from(chiefThread).where(eq(chiefThread.id, stepRow.buildId)).get();
  if (!thread) throw new NotFoundError(`chief thread ${stepRow.buildId}`);

  const tool = body.name;
  if (tool.startsWith('user_computer_')) {
    (opts.ownComputerGate ?? refuseOwnComputerUntilGated)({ stepId, tool });
  }
  const safe = COMPUTER_REPLAY_SAFE_TOOLS.has(tool);
  const latest = latestComputerAttempt(db, stepId, body.toolCallId);
  const existing = latest?.row;
  const previousAttempt = latest?.attempt ?? 0;
  const callId = existing ? existing.id : computerCallId(stepId, body.toolCallId);
  if (existing && existing.tool !== tool) {
    throw new HttpError(409, `tool call ${body.toolCallId} was already used for ${existing.tool}`);
  }
  const live = pendingCalls.get(callId);
  if (live) return waitForCall(deps, live, stepId, opts.signal);

  if (existing && !existing.replaySafe) {
    if (!isFinalState(existing.state)) {
      db.update(computerCall)
        .set({
          state: 'interrupted',
          errorMessage: 'the server lost track of this call',
          errorDelivery: 'unknown',
          finishedAt: nowMs(),
        })
        .where(eq(computerCall.id, callId))
        .run();
      const interrupted = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
      if (interrupted) {
        if (syncObservedComputerState(db, interrupted.computerId)) {
          publishObservedComputerState(db, deps.hub, interrupted.computerId);
        }
        publishFeed(db, deps.hub, interrupted);
      }
      return resultOfRow({ ...existing, state: 'interrupted' });
    }
    return resultOfRow(existing);
  }

  if (tool === 'request_takeover') return holdTakeover(deps, thread, stepId, body, opts);
  const refusal = handoffRefusal(
    db
      .select()
      .from(computer)
      .where(eq(computer.scopeKey, `chief:${thread.chiefId}`))
      .get(),
    tool,
    nowMs(),
  );
  if (refusal !== null) return { text: refusal };

  const target = selectTarget(deps, thread.teamId, thread.chiefId, tool);
  const now = nowMs();
  const deadlineAt = now + computerDeadlineMs(tool, body.params);
  if (target.computerId !== null) {
    acquireExecutionLease(db, target.computerId, stepId, safe, deadlineAt);
  }

  const fresh = {
    machineId: target.machineId,
    computerId: target.computerId,
    tool,
    replaySafe: safe,
    params: storedParams(body.params),
    state: 'dispatched' as const,
    lastSeq: 0,
    outputHead: '',
    outputTail: '',
    outputChars: 0,
    resultText: null,
    resultImages: null,
    exitCode: null,
    errorMessage: null,
    errorDelivery: null,
    deadlineAt,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
  const dispatchId = existing
    ? computerCallId(stepId, body.toolCallId, previousAttempt + 1)
    : callId;
  if (existing) {
    clearPendingComputerOutput(callId);
    if (!isFinalState(existing.state)) {
      db.update(computerCall)
        .set({
          state: 'interrupted',
          errorMessage: 'superseded by a rerun',
          errorDelivery: 'unknown',
          finishedAt: nowMs(),
        })
        .where(eq(computerCall.id, callId))
        .run();
    }
  }
  db.insert(computerCall)
    .values({
      id: dispatchId,
      teamId: thread.teamId,
      stepId,
      toolCallId: body.toolCallId,
      ...fresh,
    })
    .run();

  const call: ComputerCall = {
    callId: dispatchId,
    stepId,
    tool,
    params: body.params,
    deadlineAt,
    ...(target.scopeKey !== undefined ? { scopeKey: target.scopeKey } : {}),
  };
  syncObservedComputerState(db, target.computerId);
  if (!deps.machineHub.pushComputer(target.machineId, call)) {
    db.delete(computerCall).where(eq(computerCall.id, dispatchId)).run();
    if (syncObservedComputerState(db, target.computerId)) {
      publishObservedComputerState(db, deps.hub, target.computerId);
    }
    throw new HttpError(409, COMPUTER_NOT_CONNECTED);
  }
  publishObservedComputerState(db, deps.hub, target.computerId);
  const pending = openPending(deps, call);
  const row = db.select().from(computerCall).where(eq(computerCall.id, dispatchId)).get();
  if (row) publishFeed(db, deps.hub, row);
  return waitForCall(deps, pending, stepId, opts.signal);
}
