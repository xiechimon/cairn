import { createHash } from 'node:crypto';
import {
  type ComputerCallState,
  type ComputerRelayResult,
  type ComputerTool,
  HOST_SHELL_SANDBOX_BLOCKED_PREFIX,
  redactSecrets,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computerCall } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { computerCallOwnerUserId, ownedPrivateComputer } from './computer-access.js';
import type { TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';

export const COMPUTER_OUTPUT_HEAD_CHARS = 16 * 1024;
export const COMPUTER_OUTPUT_TAIL_CHARS = 48 * 1024;
export const COMPUTER_SHELL_COMMAND_TIMEOUT_DEFAULT_MS = 5 * 60_000;
export const COMPUTER_SHELL_COMMAND_TIMEOUT_MAX_MS = 60 * 60_000;
export const COMPUTER_SHELL_DEADLINE_SLACK_MS = 30_000;
export const COMPUTER_SCREEN_DEADLINE_MS = 2 * 60_000;
export const COMPUTER_START_ALLOWANCE_MS = 5 * 60_000;
export const COMPUTER_OTHER_DEADLINE_MS = 10 * 60_000;
export const COMPUTER_STORED_PARAM_CHARS = 8 * 1024;

export const COMPUTER_NOT_CONNECTED = 'the computer is not connected';
export const COMPUTER_INTERRUPTED = 'interrupted, may have partially run; it was not retried';
export const COMPUTER_CANCELLED = 'cancelled because the Coordinator turn was stopped';

export const SHELL_TOOLS: ReadonlySet<ComputerTool> = new Set(['shell', 'user_computer_shell']);
const SCREEN_TOOLS: ReadonlySet<ComputerTool> = new Set([
  'computer_observe',
  'computer_act',
  'desktop_snapshot',
  'desktop_act',
  'user_computer_observe',
  'user_computer_act',
  'phone_observe',
  'phone_act',
  'open_path',
  'launch_app',
]);

export type ComputerCallRow = typeof computerCall.$inferSelect;

export interface PendingComputerCall {
  result: Promise<ComputerRelayResult>;
  hub: TeamStreamHub;
  resolve: (result: ComputerRelayResult) => void;
  dispose: () => void;
}

export interface PendingComputerDeps {
  db: Db;
  hub: TeamStreamHub;
  machineHub: MachineWakeHub;
}

const pendingCalls = new Map<string, PendingComputerCall>();

export function getPendingComputerCall(callId: string): PendingComputerCall | undefined {
  return pendingCalls.get(callId);
}

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

export function computerDeadlineMs(
  tool: ComputerTool,
  params: Record<string, unknown>,
  computerStarting = false,
): number {
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
  if (!SCREEN_TOOLS.has(tool)) return COMPUTER_OTHER_DEADLINE_MS;
  return computerStarting
    ? COMPUTER_SCREEN_DEADLINE_MS + COMPUTER_START_ALLOWANCE_MS
    : COMPUTER_SCREEN_DEADLINE_MS;
}

export function isFinalComputerCallState(state: ComputerCallState): boolean {
  return state !== 'dispatched' && state !== 'running';
}

export function storedComputerParams(params: Record<string, unknown>): Record<string, unknown> {
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

function redact(text: string): string {
  return redactSecrets(text, []).value as string;
}

function shellOutputText(row: ComputerCallRow): string {
  const head = redact(row.outputHead);
  const tail = redact(row.outputTail);
  const truncated = row.outputChars > COMPUTER_OUTPUT_HEAD_CHARS + COMPUTER_OUTPUT_TAIL_CHARS;
  const omitted = row.outputChars - row.outputHead.length - row.outputTail.length;
  return truncated ? `${head}\n[... ${omitted} characters omitted ...]\n${tail}` : head + tail;
}

export function resultOfComputerCallRow(row: ComputerCallRow): ComputerRelayResult {
  switch (row.state) {
    case 'done': {
      const exit =
        row.exitCode !== null && row.exitCode !== 0 ? `\n[exit code ${row.exitCode}]` : '';
      const sandboxDeniedReason =
        row.tool === 'user_computer_shell' && typeof row.params.sandboxDeniedReason === 'string'
          ? row.params.sandboxDeniedReason.trim()
          : '';
      if (sandboxDeniedReason !== '') {
        const body = row.outputChars > 0 ? shellOutputText(row).trimEnd() : '';
        const detail = body !== '' ? `\n${body}${exit}` : exit;
        return {
          text: `${HOST_SHELL_SANDBOX_BLOCKED_PREFIX} ${sandboxDeniedReason}${detail}\nTry a different approach that works inside the sandbox first; only call user_computer_shell with escalate: true if this exact command must run without the sandbox.`,
        };
      }
      const text =
        SHELL_TOOLS.has(row.tool as ComputerTool) && row.outputChars > 0
          ? shellOutputText(row)
          : (row.resultText ?? redact(row.outputHead + row.outputTail));
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

export function publishComputerCallChanged(db: Db, hub: TeamStreamHub, row: ComputerCallRow): void {
  if (row.computerId === null) return;
  const userId = computerCallOwnerUserId(db, row);
  const owned =
    userId === undefined ? undefined : ownedPrivateComputer(db, row.teamId, userId, row.computerId);
  if (userId === undefined || owned === undefined) return;
  hub.publishPrivate(row.teamId, userId, () => ({
    type: 'computer.state',
    computerId: owned.id,
    state: owned.state,
  }));
}

export function settleComputerCall(db: Db, callId: string, hub?: TeamStreamHub): void {
  const live = pendingCalls.get(callId);
  const row = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  if (!row || !isFinalComputerCallState(row.state)) return;
  if (live) {
    pendingCalls.delete(callId);
    live.dispose();
  }
  const publishHub = live?.hub ?? hub;
  try {
    if (publishHub) publishComputerCallChanged(db, publishHub, row);
  } finally {
    live?.resolve(resultOfComputerCallRow(row));
  }
}

function expireComputerCall(db: Db, callId: string): void {
  const row = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  if (row && !isFinalComputerCallState(row.state)) {
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

export function openPendingComputerCall(
  deps: PendingComputerDeps,
  call: { callId: string; stepId: string; deadlineAt: number },
  onStop?: () => void,
): PendingComputerCall {
  let resolve!: (result: ComputerRelayResult) => void;
  const result = new Promise<ComputerRelayResult>((r) => {
    resolve = r;
  });
  const timer = setTimeout(
    () => expireComputerCall(deps.db, call.callId),
    Math.max(0, call.deadlineAt - nowMs()),
  );
  timer.unref();
  const offStop = onStop ? deps.machineHub.onStop(call.stepId, onStop) : undefined;
  const pending: PendingComputerCall = {
    result,
    hub: deps.hub,
    resolve,
    dispose: () => {
      clearTimeout(timer);
      offStop?.();
    },
  };
  pendingCalls.set(call.callId, pending);
  return pending;
}
