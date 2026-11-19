import { createHash } from 'node:crypto';
import {
  browserSecretFillActionSchema,
  CLOAK_LICENSE_SECRET,
  COMPUTER_HANDOFF_TIMEOUT_MS,
  COMPUTER_MANAGE_OUTCOMES,
  COMPUTER_MANAGE_TIMEOUT_MS,
  COMPUTER_REPLAY_SAFE_TOOLS,
  type ComputerCall,
  type ComputerCallState,
  type ComputerFrame,
  type ComputerManageAction,
  type ComputerManageOutcome,
  type ComputerRelayResult,
  type ComputerTool,
  chiefIdFormat,
  INSTALL_PACKAGES_TIMEOUT_MS,
  installPackagesParamsSchema,
  isComputerBrowserTool,
  isOwnComputerTool,
  type MachineComputerFramesResponse,
  type MachineComputerRelayBody,
  normalizeBrowserSecretOrigin,
  PACKAGES_DECLINED,
  PACKAGES_NO_VM_COMPUTER,
  PACKAGES_NOT_ANSWERED,
  type PackageInstallDecisionBody,
  redactSecrets,
  type SecretBox,
  TAKEOVER_HANDED_BACK,
} from '@cairn/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  chiefThread,
  computer,
  computerBrowserLease,
  computerCall,
  machine,
  secret,
  step,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  APPROVE_CHOICE,
  proposalCardId,
  proposeAction,
  REFUSE_CHOICE,
} from './action-proposals.js';
import {
  BROWSER_PASSWORD_ACTION,
  browserPasswordIds,
  hasBrowserPasswordGrant,
  requireBrowserPassword,
} from './browser-passwords.js';
import { NotFoundError } from './builds.js';
import { announceQuestion } from './chief-questions.js';
import { computerCallOwnerUserId, ownedPrivateComputer } from './computer-access.js';
import {
  COMPUTER_HANDOFF_POLL_MS,
  clearHandoff,
  HANDOFF_CLEARED,
  handoffRefusal,
  markHandoffIfNone,
  ownerHoldsControl,
  pause,
  TAKEOVER_NO_COMPUTER,
  TAKEOVER_NOT_DONE,
} from './computer-handoff.js';
import {
  browserScopeFor,
  type ComputerThread,
  computerThreadOf,
  NO_CARD_THREAD,
} from './computer-thread.js';
import type { TeamStreamHub } from './events.js';
import { type MachineDeps, ownedStep } from './machine-deps.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { ownComputerTarget } from './own-computer.js';
import { sendMustReachAlert } from './push-alerts.js';
import { refuseRestrictedTurnTool } from './report-turn.js';

export const COMPUTER_OUTPUT_HEAD_CHARS = 16 * 1024;
export const COMPUTER_OUTPUT_TAIL_CHARS = 48 * 1024;

export const COMPUTER_OUTPUT_PENDING_CHARS = 64 * 1024;

const pendingOutput = new Map<string, string>();

export const COMPUTER_SHELL_COMMAND_TIMEOUT_DEFAULT_MS = 5 * 60_000;
export const COMPUTER_SHELL_COMMAND_TIMEOUT_MAX_MS = 60 * 60_000;
export const COMPUTER_SHELL_DEADLINE_SLACK_MS = 30_000;
export const COMPUTER_SCREEN_DEADLINE_MS = 2 * 60_000;
export const COMPUTER_START_ALLOWANCE_MS = 5 * 60_000;
export const COMPUTER_OTHER_DEADLINE_MS = 10 * 60_000;
export const COMPUTER_EXECUTION_LEASE_MS = 5 * 60_000;
export const COMPUTER_STORED_PARAM_CHARS = 8 * 1024;

export const COMPUTER_NOT_CONNECTED = 'the computer is not connected';
export const COMPUTER_BUSY = 'the computer is busy with another Coordinator turn';
export const COMPUTER_USER_CONTROL =
  'the owner is using this computer right now; wait a few seconds and retry the same call';
export const COMPUTER_INTERRUPTED = 'interrupted, may have partially run; it was not retried';
export const COMPUTER_CANCELLED = 'cancelled because the Coordinator turn was stopped';
export const COMPUTER_BROWSER_DISABLED =
  'browser tools are off for this computer; enable 浏览器 in the Computers panel';
export const COMPUTER_NO_CLOAK_LICENSE = `No CloakBrowser license; set team secret ${CLOAK_LICENSE_SECRET}`;
export const COMPUTER_BROWSER_UNAVAILABLE =
  'this machine no longer reports browser capability; turn off 浏览器 or rebuild the computer image';

const SHELL_TOOLS: ReadonlySet<ComputerTool> = new Set(['shell', 'user_computer_shell']);
const SCREEN_TOOLS: ReadonlySet<ComputerTool> = new Set([
  'computer_observe',
  'computer_act',
  'desktop_snapshot',
  'desktop_act',
  'user_computer_observe',
  'user_computer_act',
  'open_path',
  'launch_app',
]);

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

function cloakLicenseCipher(db: Pick<Db, 'select'>, teamId: string): string | null {
  return (
    db
      .select({ cipher: secret.valueCipher })
      .from(secret)
      .where(
        and(
          eq(secret.teamId, teamId),
          eq(secret.name, CLOAK_LICENSE_SECRET),
          isNull(secret.projectId),
        ),
      )
      .get()?.cipher ?? null
  );
}

function redact(text: string, secrets: readonly string[] = []): string {
  return redactSecrets(text, secrets).value as string;
}

type Output = Pick<CallRow, 'outputHead' | 'outputTail' | 'outputChars'> & { pending: string };

function appendOutput(
  out: Output,
  text: string,
  flush: boolean,
  secrets: readonly string[] = [],
): Output {
  const raw = out.pending + text;
  let start = raw.length;
  while (start > 0 && !/\s/.test(raw[start - 1] ?? '')) start--;
  const keep = !flush && raw.length - start <= COMPUTER_OUTPUT_PENDING_CHARS;
  const pending = keep ? raw.slice(start) : '';
  const settled = keep ? raw.slice(0, start) : raw;
  const joined =
    settled === ''
      ? out.outputHead + out.outputTail
      : redact(out.outputHead + out.outputTail + settled, secrets);
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
  secrets: readonly string[] = [],
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
        if (isComputerBrowserTool(row.tool))
          throw new HttpError(400, 'browser calls return complete results, not output fragments');
        output = appendOutput(output, frame.text, false, secrets);
        break;
      case 'heartbeat':
        break;
      case 'done':
        finished = true;
        output = appendOutput(output, '', true, secrets);
        Object.assign(patch, {
          resultText: redact(frame.text, secrets),
          resultImages: frame.images ?? null,
          exitCode: frame.exitCode ?? null,
          finishedAt: now,
          ...(row.state === 'cancelled' ? {} : { state: 'done' as const }),
        });
        break;
      case 'error':
        finished = true;
        output = appendOutput(output, '', true, secrets);
        Object.assign(patch, {
          errorMessage: redact(frame.message, secrets),
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
  box?: SecretBox,
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
    const license = cloakLicenseCipher(tx, row.teamId);
    if (license !== null && box === undefined)
      throw new HttpError(503, 'browser redaction is unavailable');
    const licenseValues = license !== null && box !== undefined ? [box.open(license)] : [];
    const secrets = isComputerBrowserTool(row.tool)
      ? tx
          .select({ cipher: secret.valueCipher, usernameCipher: secret.usernameCipher })
          .from(secret)
          .where(
            and(
              eq(secret.teamId, row.teamId),
              inArray(secret.id, [...browserPasswordIds(tx, row.teamId)]),
            ),
          )
          .all()
          .flatMap(({ cipher, usernameCipher }) =>
            [cipher, usernameCipher].flatMap((fieldCipher) => {
              if (fieldCipher === null) return [];
              if (box === undefined) throw new HttpError(503, 'browser redaction is unavailable');
              const value = box.open(fieldCipher);
              return [
                value,
                encodeURIComponent(value),
                new URLSearchParams({ v: value }).toString().slice(2),
                JSON.stringify(value).slice(1, -1),
              ];
            }),
          )
          .concat(licenseValues)
      : licenseValues;
    const { patch, pending } = applyFrames(row, fresh, nowMs(), secrets);
    tx.update(computerCall).set(patch).where(eq(computerCall.id, callId)).run();
    if (
      row.computerId !== null &&
      !cancelled &&
      isComputerBrowserTool(row.tool) &&
      fresh.some(
        (frame) =>
          frame.kind === 'done' &&
          frame.loginForm?.signals.some(
            (signal) => signal === 'challenge' || signal === 'one-time-code',
          ),
      )
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
  if (result.finished) settleComputerCall(db, callId, hub);
  else if (result.publishOutput) {
    const row = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
    if (row) publishComputerChanged(db, publishHub, row);
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

export function computerVmName(scopeKey: string): string {
  return `cairn-computer-${createHash('sha256').update(scopeKey).digest('hex').slice(0, 24)}`;
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

function shellOutputText(row: CallRow): string {
  const head = redact(row.outputHead);
  const tail = redact(row.outputTail);
  const truncated = row.outputChars > COMPUTER_OUTPUT_HEAD_CHARS + COMPUTER_OUTPUT_TAIL_CHARS;
  const omitted = row.outputChars - row.outputHead.length - row.outputTail.length;
  return truncated ? `${head}\n[... ${omitted} characters omitted ...]\n${tail}` : head + tail;
}

function resultOfRow(row: CallRow): ComputerRelayResult {
  switch (row.state) {
    case 'done': {
      const text =
        SHELL_TOOLS.has(row.tool as ComputerTool) && row.outputChars > 0
          ? shellOutputText(row)
          : (row.resultText ?? redact(row.outputHead + row.outputTail));
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

function publishComputerChanged(db: Db, hub: TeamStreamHub, row: CallRow): void {
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
  if (!row || !isFinalState(row.state)) return;
  if (live) {
    pendingCalls.delete(callId);
    live.dispose();
  }
  const publishHub = live?.hub ?? hub;
  if (publishHub) publishComputerChanged(db, publishHub, row);
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

type PendingDeps = Pick<MachineDeps, 'db' | 'hub' | 'machineHub'>;

function openPending(
  deps: PendingDeps,
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

function releaseExecutionLease(db: Db, stepId: string): void {
  db.update(computer)
    .set({ executionStepId: null, executionLeaseExpiresAt: null, updatedAt: nowMs() })
    .where(eq(computer.executionStepId, stepId))
    .run();
  db.update(computer)
    .set({ ...HANDOFF_CLEARED, updatedAt: nowMs() })
    .where(eq(computer.handoffStepId, stepId))
    .run();
  db.delete(computerBrowserLease).where(eq(computerBrowserLease.stepId, stepId)).run();
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

export function teamOffersDesktop(db: Db, teamId: string): boolean {
  return db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all()
    .some((row) => machineAcceptsTool(row, 'computer_observe'));
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
  const capable = (row: typeof machine.$inferSelect): boolean =>
    row.capabilities?.computer === true;
  const fleet = db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .orderBy(desc(machine.lastSeenAt))
    .all()
    .filter(capable);
  const connected = fleet.filter((row) => machineHub.isConnected(row.id));
  const live = connected.filter((row) => machineAcceptsTool(row, tool));

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

function acquireBrowserLease(
  db: Db,
  computerId: string,
  profileKey: string,
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
  const lease = db
    .select()
    .from(computerBrowserLease)
    .where(
      and(
        eq(computerBrowserLease.computerId, computerId),
        eq(computerBrowserLease.profileKey, profileKey),
      ),
    )
    .get();
  const held = lease !== undefined && lease.expiresAt > now;
  if (held && lease.stepId !== stepId) throw new HttpError(409, COMPUTER_BUSY);
  const renewed = Math.max(now + COMPUTER_EXECUTION_LEASE_MS, deadlineAt);
  if (lease === undefined) {
    db.insert(computerBrowserLease)
      .values({
        id: newRecordId(),
        computerId,
        profileKey,
        stepId,
        expiresAt: renewed,
        fence: 1,
        updatedAt: now,
      })
      .run();
    return;
  }
  db.update(computerBrowserLease)
    .set({
      stepId,
      expiresAt: held ? Math.max(lease.expiresAt, renewed) : renewed,
      fence: held ? lease.fence : lease.fence + 1,
      updatedAt: now,
    })
    .where(eq(computerBrowserLease.id, lease.id))
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

type HandoffWait = 'handed_back' | 'not_done';

async function holdTakeover(
  deps: MachineDeps,
  thread: ComputerThread,
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
  const callId = computerCallId(stepId, body.toolCallId);
  const waiting = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  const resumed = waiting?.state === 'running';
  const deadlineAt = resumed ? waiting.deadlineAt : now + timeoutMs;
  const atInsert = db.select().from(computer).where(eq(computer.id, target.id)).get();
  if (!resumed) {
    acquireExecutionLease(db, target.id, stepId, true, deadlineAt);
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
        params: {
          ...storedParams(body.params),
          controlFence: (atInsert?.controlFence ?? 0) + 1,
          heldAtStart: atInsert !== undefined && ownerHoldsControl(atInsert, now),
        },
        state: 'running',
        deadlineAt,
        createdAt: now,
        startedAt: now,
      })
      .run();
  }
  markHandoffIfNone(db, target.id, 'model', stepId, now);
  const asked = body.params.reason;
  const reason =
    typeof asked === 'string' && asked.trim() !== '' ? redact(asked).slice(0, 200) : '';
  if (!resumed) {
    void sendMustReachAlert(db, deps.vapidKeys ?? null, thread.userId, thread.teamId, {
      title: '需要你登录',
      body: reason || 'Coordinator 需要你接管它的电脑。',
      href: thread.id === NO_CARD_THREAD ? '/app' : `/app?chief=${encodeURIComponent(thread.id)}`,
      tag: `${thread.userId}:${callId}`,
    }).catch(() => {
      process.stderr.write('takeover push failed\n');
    });
  }
  const atStart = db.select().from(computer).where(eq(computer.id, target.id)).get();
  const storedFence = waiting?.params.controlFence;
  const fenceAtStart = typeof storedFence === 'number' ? storedFence : atStart?.controlFence;
  const heldAtStart = resumed
    ? waiting.params.heldAtStart === true
    : atStart !== undefined && ownerHoldsControl(atStart, now);
  const fenceSteps = heldAtStart ? 1 : 2;
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
    const current = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
    if (current?.state === 'running') {
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
    }
  }
  const settled = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  return {
    text: settled?.state === 'done' ? TAKEOVER_HANDED_BACK : TAKEOVER_NOT_DONE,
  };
}

export const COMPUTER_MANAGE_PANEL_ONLY =
  'computer_manage is started only by the owner from the Computers panel';
export const COMPUTER_MANAGE_VM_ONLY =
  'Only the Coordinator VM computer can be stopped, updated, recovered or reset';
export const NO_PENDING_INSTALL = 'No install request is waiting for these packages';

type PackageApproval = 'pending' | 'approved' | 'declined';

function approvalOf(row: CallRow | undefined): PackageApproval | null {
  const value = row?.params.approval;
  return value === 'pending' || value === 'approved' || value === 'declined' ? value : null;
}

function finishInstallWait(db: Db, callId: string, approval: PackageApproval | null): string {
  if (approval === 'declined') {
    db.update(computerCall)
      .set({ state: 'done', resultText: PACKAGES_DECLINED, finishedAt: nowMs() })
      .where(and(eq(computerCall.id, callId), eq(computerCall.state, 'running')))
      .run();
    return PACKAGES_DECLINED;
  }
  db.update(computerCall)
    .set({
      state: 'error',
      errorMessage: 'the owner did not answer',
      errorDelivery: 'not_delivered',
      finishedAt: nowMs(),
    })
    .where(and(eq(computerCall.id, callId), eq(computerCall.state, 'running')))
    .run();
  return PACKAGES_NOT_ANSWERED;
}

async function holdPackageInstall(
  deps: MachineDeps,
  thread: ComputerThread,
  stepId: string,
  body: MachineComputerRelayBody,
  opts: { signal?: AbortSignal; takeover?: { timeoutMs?: number; pollMs?: number } },
): Promise<ComputerRelayResult> {
  const { db } = deps;
  const parsed = installPackagesParamsSchema.safeParse(body.params);
  if (!parsed.success)
    return {
      text: `install_packages refused before anything ran: ${parsed.error.issues[0]?.message ?? 'invalid packages'}`,
    };
  const packages = parsed.data.packages;
  let target: ReturnType<typeof selectTarget>;
  try {
    target = selectTarget(deps, thread.teamId, thread.chiefId, 'install_packages');
  } catch (error) {
    if (error instanceof HttpError) return { text: PACKAGES_NO_VM_COMPUTER };
    throw error;
  }
  const host = db.select().from(machine).where(eq(machine.id, target.machineId)).get();
  if (host?.capabilities?.computerKind !== 'vm' || target.computerId === null)
    return { text: PACKAGES_NO_VM_COMPUTER };
  const callId = computerCallId(stepId, body.toolCallId);
  const existing = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  const now = nowMs();
  const timeoutMs = opts.takeover?.timeoutMs ?? COMPUTER_HANDOFF_TIMEOUT_MS;
  const pollMs = opts.takeover?.pollMs ?? COMPUTER_HANDOFF_POLL_MS;
  if (existing === undefined) {
    db.insert(computerCall)
      .values({
        id: callId,
        teamId: thread.teamId,
        stepId,
        toolCallId: body.toolCallId,
        machineId: target.machineId,
        computerId: target.computerId,
        tool: 'install_packages',
        replaySafe: false,
        params: { packages, approval: 'pending' },
        state: 'running',
        deadlineAt: now + timeoutMs,
        createdAt: now,
        startedAt: now,
      })
      .run();
  }
  let approval: PackageApproval | null = 'pending';
  for (;;) {
    const row = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
    const owner = db.select({ status: step.status }).from(step).where(eq(step.id, stepId)).get();
    approval = approvalOf(row);
    if (row?.state !== 'running' || approval !== 'pending') break;
    if (owner?.status !== 'claimed' || opts.signal?.aborted || nowMs() >= row.deadlineAt) {
      approval = null;
      break;
    }
    await pause(pollMs, opts.signal);
  }
  if (approval !== 'approved') return { text: finishInstallWait(db, callId, approval) };
  const deadlineAt = nowMs() + INSTALL_PACKAGES_TIMEOUT_MS + COMPUTER_SHELL_DEADLINE_SLACK_MS;
  db.update(computerCall)
    .set({ state: 'dispatched', deadlineAt, startedAt: null })
    .where(eq(computerCall.id, callId))
    .run();
  const call: ComputerCall = {
    callId,
    stepId,
    tool: 'install_packages',
    params: { packages },
    deadlineAt,
    computerGrant: 'desktop',
    ...(target.scopeKey !== undefined ? { scopeKey: target.scopeKey } : {}),
  };
  if (!deps.machineHub.pushComputer(target.machineId, call)) {
    db.update(computerCall)
      .set({
        state: 'error',
        errorMessage: COMPUTER_NOT_CONNECTED,
        errorDelivery: 'not_delivered',
        finishedAt: nowMs(),
      })
      .where(eq(computerCall.id, callId))
      .run();
    return { text: `computer error: ${COMPUTER_NOT_CONNECTED} (the action did not run)` };
  }
  return waitForCall(deps, openPending(deps, call), stepId, opts.signal);
}

export function decidePackageInstall(
  db: Db,
  teamId: string,
  userId: string,
  body: PackageInstallDecisionBody,
): void {
  const target = db
    .select({ id: computer.id })
    .from(computer)
    .where(
      and(
        eq(computer.teamId, teamId),
        eq(computer.scopeKey, `chief:${chiefIdFormat(userId, teamId)}`),
      ),
    )
    .get();
  if (target === undefined) throw new HttpError(409, NO_PENDING_INSTALL);
  const asked = [...body.packages].sort().join(' ');
  const waiting = db
    .select()
    .from(computerCall)
    .where(
      and(
        eq(computerCall.computerId, target.id),
        eq(computerCall.tool, 'install_packages'),
        eq(computerCall.state, 'running'),
      ),
    )
    .all()
    .find((row) => {
      const named = row.params.packages;
      return (
        approvalOf(row) === 'pending' &&
        Array.isArray(named) &&
        [...named].sort().join(' ') === asked
      );
    });
  if (waiting === undefined) throw new HttpError(409, NO_PENDING_INSTALL);
  db.update(computerCall)
    .set({
      params: {
        ...waiting.params,
        approval: body.decision === 'approve' ? 'approved' : 'declined',
        decidedAt: nowMs(),
      },
    })
    .where(eq(computerCall.id, waiting.id))
    .run();
}

export async function manageComputer(
  deps: PendingDeps,
  teamId: string,
  userId: string,
  computerId: string,
  action: ComputerManageAction,
): Promise<ComputerManageOutcome> {
  const { db } = deps;
  const owned = ownedPrivateComputer(db, teamId, userId, computerId);
  if (!owned) throw new NotFoundError(`computer ${computerId}`);
  const host = db.select().from(machine).where(eq(machine.id, owned.machineId)).get();
  if (host?.capabilities?.computerKind !== 'vm') throw new HttpError(409, COMPUTER_MANAGE_VM_ONLY);
  if (!deps.machineHub.isConnected(owned.machineId))
    throw new HttpError(409, COMPUTER_NOT_CONNECTED);
  const stepId = newRecordId();
  const toolCallId = `owner-${action}`;
  const callId = computerCallId(stepId, toolCallId);
  const now = nowMs();
  const deadlineAt = now + COMPUTER_MANAGE_TIMEOUT_MS;
  db.insert(computerCall)
    .values({
      id: callId,
      teamId,
      stepId,
      toolCallId,
      machineId: owned.machineId,
      computerId: owned.id,
      tool: 'computer_manage',
      replaySafe: false,
      params: { action },
      state: 'dispatched',
      deadlineAt,
      createdAt: now,
    })
    .run();
  const call: ComputerCall = {
    callId,
    stepId,
    tool: 'computer_manage',
    params: { action },
    deadlineAt,
    scopeKey: owned.scopeKey,
  };
  if (!deps.machineHub.pushComputer(owned.machineId, call)) {
    db.delete(computerCall).where(eq(computerCall.id, callId)).run();
    throw new HttpError(409, COMPUTER_NOT_CONNECTED);
  }
  await openPending(deps, call).result;
  const row = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  const outcome = COMPUTER_MANAGE_OUTCOMES.find((known) => known === row?.resultText);
  if (row?.state === 'done' && outcome !== undefined) return outcome;
  throw new HttpError(409, row?.errorMessage ?? 'The computer action did not finish');
}

const CARD_TAB_CLOSE_TIMEOUT_MS = 15_000;

export function browserTabScope(
  stepRow: Pick<typeof step.$inferSelect, 'kind' | 'buildId'>,
): string {
  return stepRow.kind === 'chief' ? 'coordinator' : `card-${stepRow.buildId}`;
}

export function closeInfoCardTab(
  deps: PendingDeps,
  stepRow: Pick<typeof step.$inferSelect, 'id' | 'kind' | 'buildId'>,
): void {
  if (stepRow.kind === 'chief') return;
  const { db } = deps;
  const thread = computerThreadOf(db, stepRow);
  if (thread === null) return;
  const owned = db
    .select()
    .from(computer)
    .where(eq(computer.scopeKey, `chief:${thread.chiefId}`))
    .get();
  if (owned === undefined || !deps.machineHub.isConnected(owned.machineId)) return;
  const toolCallId = 'tab-close';
  const callId = computerCallId(stepRow.id, toolCallId);
  const now = nowMs();
  const deadlineAt = now + CARD_TAB_CLOSE_TIMEOUT_MS;
  try {
    db.insert(computerCall)
      .values({
        id: callId,
        teamId: thread.teamId,
        stepId: stepRow.id,
        toolCallId,
        machineId: owned.machineId,
        computerId: owned.id,
        tool: 'browser_close_tab',
        replaySafe: true,
        params: {},
        state: 'dispatched',
        deadlineAt,
        createdAt: now,
      })
      .run();
  } catch {
    return;
  }
  const call: ComputerCall = {
    callId,
    stepId: stepRow.id,
    tool: 'browser_close_tab',
    params: {},
    deadlineAt,
    scopeKey: owned.scopeKey,
    tabScope: browserTabScope(stepRow),
    browserScope: browserScopeFor(thread),
  };
  if (!deps.machineHub.pushComputer(owned.machineId, call)) {
    db.delete(computerCall).where(eq(computerCall.id, callId)).run();
    return;
  }
  void openPending(deps, call).result;
}

export async function forwardComputerCall(
  deps: MachineDeps,
  machineId: string | null,
  stepId: string,
  body: MachineComputerRelayBody,
  opts: {
    signal?: AbortSignal;
    takeover?: { timeoutMs?: number; pollMs?: number };
  } = {},
): Promise<ComputerRelayResult> {
  const { db } = deps;
  const stepRow = ownedStep(deps, machineId, stepId);
  const thread = computerThreadOf(db, stepRow);
  if (thread === null) {
    throw new HttpError(400, `step ${stepId} is not a chief step or an info card`);
  }
  if (stepRow.status !== 'claimed') {
    throw new HttpError(409, 'Coordinator tools require a currently claimed turn');
  }

  const tool = body.name;
  if (tool === 'computer_manage') throw new HttpError(400, COMPUTER_MANAGE_PANEL_ONLY);
  if (tool === 'browser_close_tab')
    throw new HttpError(400, 'browser_close_tab is sent by the server when a step ends');
  let own: { machineId: string } | null = null;
  if (isOwnComputerTool(tool)) {
    refuseRestrictedTurnTool(db, stepRow.prompt, tool, body.params, stepRow.ownerMessageIds ?? []);
    const chiefRow =
      stepRow.kind === 'chief'
        ? db.select().from(chiefThread).where(eq(chiefThread.id, stepRow.buildId)).get()
        : undefined;
    if (chiefRow === undefined) throw new NotFoundError(`chief thread ${stepRow.buildId}`);
    const target = ownComputerTarget(deps, chiefRow, tool);
    if (target.kind === 'refused') return { text: target.text };
    own = { machineId: target.machineId };
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

  if (existing && existing.tool === 'request_takeover' && existing.state === 'running') {
    return holdTakeover(deps, thread, stepId, body, opts);
  }
  if (tool === 'install_packages' && (existing === undefined || existing.state === 'running'))
    return holdPackageInstall(deps, thread, stepId, body, opts);

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
      if (interrupted) publishComputerChanged(db, deps.hub, interrupted);
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

  const target =
    own === null
      ? selectTarget(deps, thread.teamId, thread.chiefId, tool)
      : { machineId: own.machineId, computerId: null };
  const secretActions =
    tool === 'browser_act' && Array.isArray(body.params.actions)
      ? body.params.actions
          .filter(
            (action): action is Record<string, unknown> =>
              action !== null && typeof action === 'object' && action.kind === 'fill_secret',
          )
          .map((action) => {
            const parsed = browserSecretFillActionSchema.safeParse(action);
            if (!parsed.success)
              throw new HttpError(
                400,
                'fill_secret needs kind, ref, a saved secret name and the current website origin',
              );
            return parsed.data;
          })
      : [];
  const host = db.select().from(machine).where(eq(machine.id, target.machineId)).get();
  const stealthOnVm =
    isComputerBrowserTool(tool) &&
    body.params.stealth === true &&
    host?.capabilities?.computerKind === 'vm';
  const licenseCipher =
    stealthOnVm || (tool === 'browser_navigate' && host?.capabilities?.computerKind === 'vm')
      ? cloakLicenseCipher(db, thread.teamId)
      : null;
  if (stealthOnVm && licenseCipher === null) return { text: COMPUTER_NO_CLOAK_LICENSE };
  if (secretActions.length > 0 && host?.capabilities?.browserSecretFill !== true)
    throw new HttpError(409, 'Update this machine before filling saved browser passwords.');
  const pendingApprovals: string[] = [];
  const browserRows = secretActions.map((action) => {
    const saved = db
      .select({ id: secret.id })
      .from(secret)
      .where(
        and(
          eq(secret.teamId, thread.teamId),
          eq(secret.name, action.secret),
          isNull(secret.projectId),
        ),
      )
      .get();
    if (saved === undefined)
      throw new HttpError(400, 'Save this workspace secret in Secrets settings first.');
    const row = requireBrowserPassword(db, thread.teamId, saved.id);
    const origin = normalizeBrowserSecretOrigin(action.origin);
    if (origin === null)
      throw new HttpError(400, 'Use an exact HTTPS or loopback website origin, without a path.');
    const binding = {
      secretId: row.id,
      revision: row.policyRevision,
      origin,
      machineId: target.machineId,
    };
    if (!hasBrowserPasswordGrant(db, thread.teamId, binding)) {
      if (thread.id === NO_CARD_THREAD)
        throw new HttpError(
          409,
          'No Coordinator conversation can ask the owner to approve this website.',
        );
      const proposal = proposeAction(db, {
        teamId: thread.teamId,
        actionId: BROWSER_PASSWORD_ACTION,
        targetId: row.id,
        input: binding,
        threadId: thread.id,
        scopeProjectId: stepRow.scopeProjectId,
        card: [
          {
            header: '网站授权',
            question: `允许在 ${origin} 代填机密 ${row.name}？仅限电脑 ${target.machineId}；之后在这台电脑的同一网站自动可用，密码不会交给模型。换网站、电脑或密码后会重新询问。`,
            options: [{ label: APPROVE_CHOICE }, { label: REFUSE_CHOICE }],
          },
        ],
      });
      if (proposal.created) announceQuestion(deps, thread.id, proposalCardId(proposal.proposalId));
      pendingApprovals.push(proposal.proposalId);
    }
    return { ...row, browserOrigin: origin };
  });
  if (pendingApprovals.length > 0)
    return {
      text: `尚未代填。网站授权卡已发给用户（${pendingApprovals.join(', ')}），请等用户在卡片上批准。批准后先 browser_snapshot，再用新的 ref 重试；不要索取密码。`,
    };
  const now = nowMs();
  const computerStarting =
    target.computerId !== null &&
    db.select().from(computer).where(eq(computer.id, target.computerId)).get()?.state !== 'running';
  const deadlineAt = now + computerDeadlineMs(tool, body.params, computerStarting);
  const browserTool = isComputerBrowserTool(tool);
  if (target.computerId !== null) {
    if (browserTool)
      acquireBrowserLease(db, target.computerId, browserScopeFor(thread), stepId, safe, deadlineAt);
    else acquireExecutionLease(db, target.computerId, stepId, safe, deadlineAt);
  }

  const fresh = {
    machineId: target.machineId,
    computerId: target.computerId,
    tool,
    replaySafe: safe,
    params: {
      ...storedParams(body.params),
      ...(browserRows.length > 0
        ? {
            browserPolicies: browserRows.map((row) => ({
              name: row.name,
              origin: row.browserOrigin,
              revision: row.policyRevision,
            })),
          }
        : {}),
    },
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
    ...('scopeKey' in target && target.scopeKey !== undefined ? { scopeKey: target.scopeKey } : {}),
    ...(browserTool
      ? { tabScope: browserTabScope(stepRow), browserScope: browserScopeFor(thread) }
      : {}),
    ...(own === null
      ? { computerGrant: browserTool ? ('browser' as const) : ('desktop' as const) }
      : {}),
  };
  try {
    if (browserRows.length > 0)
      call.browserSecrets = browserRows.map((row) => ({
        name: row.name,
        origin: row.browserOrigin,
        value: deps.box.open(row.valueCipher),
        ...(row.usernameCipher !== null ? { username: deps.box.open(row.usernameCipher) } : {}),
      }));
    if (licenseCipher !== null) call.browserLicense = deps.box.open(licenseCipher);
    if (!deps.machineHub.pushComputer(target.machineId, call))
      throw new HttpError(409, COMPUTER_NOT_CONNECTED);
  } catch {
    db.delete(computerCall).where(eq(computerCall.id, dispatchId)).run();
    releaseExecutionLease(db, stepId);
    throw new HttpError(409, COMPUTER_NOT_CONNECTED);
  }
  const pending = openPending(deps, call);
  const row = db.select().from(computerCall).where(eq(computerCall.id, dispatchId)).get();
  if (row) publishComputerChanged(db, deps.hub, row);
  return waitForCall(deps, pending, stepId, opts.signal);
}
