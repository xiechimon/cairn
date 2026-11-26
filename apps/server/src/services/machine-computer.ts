import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BrowserSecretFillAction,
  browserSecretFillActionSchema,
  CLOAK_LICENSE_SECRET,
  COMPUTER_HANDOFF_TIMEOUT_MS,
  COMPUTER_REPLAY_SAFE_TOOLS,
  type ComputerCall,
  type ComputerCallState,
  type ComputerFrame,
  type ComputerRelayResult,
  type ComputerTool,
  isComputerBrowserTool,
  isOwnComputerTool,
  isPhoneTool,
  type MachineComputerFramesResponse,
  type MachineComputerRelayBody,
  normalizeBrowserSecretOrigin,
  OWNER_CHROME_UNAVAILABLE_PREFIX,
  PHONE_HANDED_BACK,
  PHONE_MANAGE_PANEL_ONLY,
  PHONE_MANAGE_TIMEOUT_MS,
  PHONE_NOT_OWNER,
  PHONE_TAKEOVER_NO_PHONE,
  type PhoneManageAction,
  phoneManageResultSchema,
  redactSecrets,
  type SecretBox,
  STAGE_ATTACHMENT_TIMEOUT_MS,
  TAKEOVER_HANDED_BACK,
} from '@cairn/shared';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { runAfterCommit } from '../db/commit-effects.js';
import {
  chiefThread,
  computer,
  computerBrowserLease,
  computerCall,
  machine,
  phone,
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
import { attachCoordinatorFile } from './agent-attachments.js';
import { requireAttachmentRow } from './attachments.js';
import {
  BROWSER_PASSWORD_ACTION,
  browserPasswordIds,
  hasBrowserPasswordGrant,
  requireBrowserPassword,
} from './browser-passwords.js';
import { NotFoundError } from './builds.js';
import { parseChiefTrigger } from './chief.js';
import { announceQuestion } from './chief-questions.js';
import {
  COMPUTER_CANCELLED,
  COMPUTER_INTERRUPTED,
  COMPUTER_NOT_CONNECTED,
  COMPUTER_OTHER_DEADLINE_MS,
  COMPUTER_OUTPUT_HEAD_CHARS,
  COMPUTER_OUTPUT_TAIL_CHARS,
  COMPUTER_SCREEN_DEADLINE_MS,
  COMPUTER_SHELL_COMMAND_TIMEOUT_DEFAULT_MS,
  COMPUTER_SHELL_COMMAND_TIMEOUT_MAX_MS,
  COMPUTER_SHELL_DEADLINE_SLACK_MS,
  COMPUTER_START_ALLOWANCE_MS,
  COMPUTER_STORED_PARAM_CHARS,
  computerCallId,
  computerDeadlineMs,
  dropComputerWaiters,
  getPendingComputerCall,
  isFinalComputerCallState,
  openPendingComputerCall,
  type PendingComputerCall,
  publishComputerCallChanged,
  resultOfComputerCallRow,
  settleComputerCall,
  storedComputerParams,
} from './computer-call-store.js';
import {
  COMPUTER_HANDOFF_POLL_MS,
  clearHandoff,
  HANDOFF_CLEARED,
  handoffRefusal,
  markHandoffIfNone,
  ownerHoldsControl,
  pause,
  TAKEOVER_NO_COMPUTER,
  TAKEOVER_NO_SCREEN,
  TAKEOVER_NOT_DONE,
} from './computer-handoff.js';
import {
  browserScopeFor,
  type ComputerThread,
  computerThreadOf,
  NO_CARD_THREAD,
} from './computer-thread.js';
import { ownerChromeCandidates, teamMachines } from './coordinator-browser.js';
import type { TeamStreamHub } from './events.js';
import {
  HOST_SHELL_ESCALATION_ACTION,
  hostShellEscalationCard,
  hostShellEscalationTargetId,
  validateHostShellEscalationParams,
} from './host-shell-escalation.js';
import { isOwner } from './instance-owner.js';
import { type MachineDeps, ownedStepRow } from './machine-deps.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { memoryEditIdOfPrompt } from './memory-edit-turns.js';
import { ownComputerTarget } from './own-computer.js';
import {
  acquirePhoneLease,
  cancelPhoneCalls,
  markPhoneHandoffIfNone,
  type PhoneComputerTarget,
  phoneComputerTarget,
  resolveConsentedPhone,
  sanitizePhoneName,
} from './phone-computer.js';
import { sendMustReachAlert } from './push-alerts.js';
import { refuseRestrictedTurnTool, turnForcesOutboundApproval } from './report-turn.js';

export {
  COMPUTER_CANCELLED,
  COMPUTER_INTERRUPTED,
  COMPUTER_NOT_CONNECTED,
  COMPUTER_OTHER_DEADLINE_MS,
  COMPUTER_OUTPUT_HEAD_CHARS,
  COMPUTER_OUTPUT_TAIL_CHARS,
  COMPUTER_SCREEN_DEADLINE_MS,
  COMPUTER_SHELL_COMMAND_TIMEOUT_DEFAULT_MS,
  COMPUTER_SHELL_COMMAND_TIMEOUT_MAX_MS,
  COMPUTER_SHELL_DEADLINE_SLACK_MS,
  COMPUTER_START_ALLOWANCE_MS,
  COMPUTER_STORED_PARAM_CHARS,
  computerCallId,
  computerDeadlineMs,
  dropComputerWaiters,
  settleComputerCall,
};

export const COMPUTER_OUTPUT_PENDING_CHARS = 64 * 1024;

const pendingOutput = new Map<string, string>();

export const COMPUTER_EXECUTION_LEASE_MS = 5 * 60_000;

export const COMPUTER_BUSY = 'the computer is busy with another Coordinator turn';
export const COMPUTER_USER_CONTROL =
  'the owner is using this computer right now; wait a few seconds and retry the same call';
export const COMPUTER_BROWSER_UNAVAILABLE =
  '没有可用的浏览器：请在一台 Mac 上把 Cairn 更新到最新版并保持打开，或在“设置 → 应用”里开启 Browser MCP。';
const COMPUTER_DESKTOP_UNAVAILABLE = 'Computer tools are unavailable for this machine';

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
          ...(frame.sandboxDenied !== undefined
            ? {
                params: {
                  ...row.params,
                  sandboxDeniedReason: redact(frame.sandboxDenied.reason, secrets),
                },
              }
            : {}),
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
      canHandOverScreen(tx, row.machineId) &&
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
  const live = getPendingComputerCall(callId);
  const publishHub = live?.hub ?? hub;
  if (result.finished) settleComputerCall(db, callId, hub);
  else if (result.publishOutput) {
    const row = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
    if (row) publishComputerCallChanged(db, publishHub, row);
  }
  return result.response;
}

function canHandOverScreen(db: Pick<Db, 'select'>, machineId: string): boolean {
  return (
    db.select().from(machine).where(eq(machine.id, machineId)).get()?.capabilities
      ?.screenHandoff === true
  );
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

const isFinalState = isFinalComputerCallState;
const storedParams = storedComputerParams;
const resultOfRow = resultOfComputerCallRow;
const publishComputerChanged = publishComputerCallChanged;

type PendingDeps = Pick<MachineDeps, 'commitEffects' | 'db' | 'hub' | 'machineHub'>;
type PendingCall = PendingComputerCall;

function openPending(
  deps: PendingDeps,
  call: { callId: string; stepId: string; deadlineAt: number },
): PendingCall {
  return openPendingComputerCall(deps, call, () => stopStepComputer(deps, call.stepId));
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
  db.update(phone)
    .set({ executionStepId: null, executionLeaseExpiresAt: null, updatedAt: nowMs() })
    .where(eq(phone.executionStepId, stepId))
    .run();
  db.update(phone)
    .set({ ...HANDOFF_CLEARED, updatedAt: nowMs() })
    .where(eq(phone.handoffStepId, stepId))
    .run();
  db.delete(computerBrowserLease).where(eq(computerBrowserLease.stepId, stepId)).run();
}

export function stopStepComputer(
  deps: Pick<MachineDeps, 'commitEffects' | 'db'> & { machineHub?: MachineWakeHub },
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
  releaseExecutionLease(db, stepId);
  for (const { id } of open) {
    runAfterCommit(deps, 'settleComputerCall', () => settleComputerCall(db, id));
  }
}

function machineAcceptsTool(row: typeof machine.$inferSelect, tool: ComputerTool): boolean {
  if (isComputerBrowserTool(tool)) {
    return row.capabilities?.browser === true;
  }
  return row.capabilities?.computer === true;
}

export function teamOffersDesktop(db: Db, teamId: string): boolean {
  return teamMachines(db, teamId).some((row) => machineAcceptsTool(row, 'computer_observe'));
}

function unreportedState(row: typeof machine.$inferSelect): 'starting' | 'stopped' {
  return row?.capabilities?.computer === true ? 'starting' : 'stopped';
}

function movePin(
  db: Db,
  row: typeof computer.$inferSelect,
  target: typeof machine.$inferSelect,
): void {
  const now = nowMs();
  db.update(computer)
    .set({
      machineId: target.id,
      state: unreportedState(target),
      runningSince: null,
      executionStepId: null,
      executionLeaseExpiresAt: null,
      executionFence: row.executionFence + 1,
      controlHolder: 'none',
      controlLeaseId: null,
      controlLeaseExpiresAt: null,
      controlFence: row.controlFence + 1,
      screenGeneration: row.screenGeneration + 1,
      ...HANDOFF_CLEARED,
      updatedAt: now,
    })
    .where(eq(computer.id, row.id))
    .run();
  db.delete(computerBrowserLease).where(eq(computerBrowserLease.computerId, row.id)).run();
}

function selectTarget(
  deps: MachineDeps,
  teamId: string,
  chiefId: string,
  tool: ComputerTool,
): { machineId: string; computerId: string; scopeKey: string } {
  const { db, machineHub } = deps;
  const accepting = teamMachines(db, teamId).filter((row) => machineAcceptsTool(row, tool));
  const live = accepting.find((row) => machineHub.isConnected(row.id));

  const scopeKey = `chief:${chiefId}`;
  const existing = db.select().from(computer).where(eq(computer.scopeKey, scopeKey)).get();
  const pinned = existing && accepting.find((row) => row.id === existing.machineId);
  if (existing && pinned) {
    if (!machineHub.isConnected(existing.machineId)) {
      throw new HttpError(409, COMPUTER_NOT_CONNECTED);
    }
    if (unreportedState(pinned) === 'stopped' && existing.state !== 'stopped') {
      db.update(computer)
        .set({ state: 'stopped', runningSince: null, updatedAt: nowMs() })
        .where(eq(computer.id, existing.id))
        .run();
    }
    return { machineId: existing.machineId, computerId: existing.id, scopeKey };
  }
  if (live === undefined) {
    if (accepting.length > 0) throw new HttpError(409, COMPUTER_NOT_CONNECTED);
    if (isComputerBrowserTool(tool)) throw new HttpError(403, COMPUTER_BROWSER_UNAVAILABLE);
    if (existing) throw new HttpError(403, COMPUTER_DESKTOP_UNAVAILABLE);
    throw new HttpError(409, 'no machine in this team offers a Coordinator computer');
  }
  if (existing) {
    movePin(db, existing, live);
    return { machineId: live.id, computerId: existing.id, scopeKey };
  }
  const now = nowMs();
  const id = newRecordId();
  db.insert(computer)
    .values({
      id,
      teamId,
      scopeKey,
      machineId: live.id,
      providerRef: computerMachineName(scopeKey),
      state: unreportedState(live),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { machineId: live.id, computerId: id, scopeKey };
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
  if (!resumed && !canHandOverScreen(db, target.machineId)) return { text: TAKEOVER_NO_SCREEN };
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

function clearPhoneHandoff(db: Db, phoneId: string): void {
  db.update(phone).set(HANDOFF_CLEARED).where(eq(phone.id, phoneId)).run();
}

async function holdPhoneTakeover(
  deps: MachineDeps,
  thread: ComputerThread,
  stepId: string,
  body: MachineComputerRelayBody,
  opts: { signal?: AbortSignal; takeover?: { timeoutMs?: number; pollMs?: number } },
): Promise<ComputerRelayResult> {
  const { db } = deps;
  if (!isOwner(db, thread.userId)) return { text: PHONE_NOT_OWNER };
  const asked = typeof body.params.phone === 'string' ? body.params.phone.trim() : '';
  const resolved = resolveConsentedPhone(deps, thread.teamId, asked === '' ? null : asked);
  if (resolved.kind === 'refused') return { text: PHONE_TAKEOVER_NO_PHONE };
  const target = resolved.joined.row;
  const timeoutMs = opts.takeover?.timeoutMs ?? COMPUTER_HANDOFF_TIMEOUT_MS;
  const pollMs = opts.takeover?.pollMs ?? COMPUTER_HANDOFF_POLL_MS;
  const now = nowMs();
  const callId = computerCallId(stepId, body.toolCallId);
  const waiting = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  const resumed = waiting?.state === 'running';
  const deadlineAt = resumed ? waiting.deadlineAt : now + timeoutMs;
  if (!resumed) {
    acquirePhoneLease(db, target.id, stepId, deadlineAt);
    db.insert(computerCall)
      .values({
        id: callId,
        teamId: thread.teamId,
        stepId,
        toolCallId: body.toolCallId,
        machineId: target.machineId,
        computerId: null,
        phoneId: target.id,
        tool: 'request_takeover',
        replaySafe: false,
        params: storedParams(body.params),
        state: 'running',
        deadlineAt,
        createdAt: now,
        startedAt: now,
      })
      .run();
  }
  markPhoneHandoffIfNone(db, target.id, 'model', stepId, now);
  const askedReason = body.params.reason;
  const reason =
    typeof askedReason === 'string' && askedReason.trim() !== ''
      ? redact(askedReason).slice(0, 200)
      : '';
  if (!resumed) {
    void sendMustReachAlert(db, deps.vapidKeys ?? null, thread.userId, thread.teamId, {
      title: '需要你接管手机',
      body: reason || `Coordinator 需要你在 ${target.name} 上操作。`,
      href: thread.id === NO_CARD_THREAD ? '/app' : `/app?chief=${encodeURIComponent(thread.id)}`,
      tag: `${thread.userId}:${callId}`,
    }).catch(() => {
      process.stderr.write('takeover push failed\n');
    });
  }
  let outcome: HandoffWait = 'not_done';
  try {
    for (;;) {
      const call = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
      const owner = db.select().from(step).where(eq(step.id, stepId)).get();
      const row = db.select().from(phone).where(eq(phone.id, target.id)).get();
      if (call?.state !== 'running' || owner?.status !== 'claimed' || !row) break;
      if (row.handoffReason === null) {
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
            ? { state: 'done', resultText: PHONE_HANDED_BACK, finishedAt: nowMs() }
            : {
                state: 'error',
                errorMessage: 'the owner did not finish',
                errorDelivery: 'not_delivered',
                finishedAt: nowMs(),
              },
        )
        .where(eq(computerCall.id, callId))
        .run();
      clearPhoneHandoff(db, target.id);
      releaseExecutionLease(db, stepId);
    }
  }
  const settled = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  return {
    text: settled?.state === 'done' ? PHONE_HANDED_BACK : TAKEOVER_NOT_DONE,
  };
}

export type ManagePhoneResult = { outcome: 'paired' | 'forgotten' | 'failed'; error?: string };

export async function managePhone(
  deps: PendingDeps,
  teamId: string,
  machineId: string,
  phoneId: string,
  params: { action: PhoneManageAction; code?: string; endpoint?: string },
): Promise<ManagePhoneResult> {
  const { db } = deps;
  const row = db
    .select()
    .from(phone)
    .where(and(eq(phone.id, phoneId), eq(phone.machineId, machineId), eq(phone.teamId, teamId)))
    .get();
  if (row === undefined) throw new NotFoundError(`phone ${phoneId}`);
  if (params.action === 'forget') {
    cancelPhoneCalls(db, row.id);
    if (!deps.machineHub.isConnected(machineId)) {
      db.delete(phone).where(eq(phone.id, row.id)).run();
      return { outcome: 'forgotten' };
    }
  } else if (!deps.machineHub.isConnected(machineId)) {
    throw new HttpError(409, COMPUTER_NOT_CONNECTED);
  }
  const stepId = newRecordId();
  const toolCallId = `owner-phone-${params.action}`;
  const callId = computerCallId(stepId, toolCallId);
  const now = nowMs();
  const deadlineAt = now + PHONE_MANAGE_TIMEOUT_MS;
  const stored = {
    action: params.action,
    ...(params.endpoint ? { endpoint: params.endpoint } : {}),
  };
  db.insert(computerCall)
    .values({
      id: callId,
      teamId,
      stepId,
      toolCallId,
      machineId,
      computerId: null,
      phoneId: row.id,
      tool: 'phone_manage',
      replaySafe: false,
      params: stored,
      state: 'dispatched',
      deadlineAt,
      createdAt: now,
    })
    .run();
  const call: ComputerCall = {
    callId,
    stepId,
    tool: 'phone_manage',
    params: { ...stored, ...(params.code !== undefined ? { code: params.code } : {}) },
    deadlineAt,
    phone: { phoneId: row.id, deviceId: row.deviceId },
  };
  if (!deps.machineHub.pushComputer(machineId, call)) {
    db.delete(computerCall).where(eq(computerCall.id, callId)).run();
    if (params.action === 'forget') {
      db.delete(phone).where(eq(phone.id, row.id)).run();
      return { outcome: 'forgotten' };
    }
    throw new HttpError(409, COMPUTER_NOT_CONNECTED);
  }
  await openPending(deps, call).result;
  const finished = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  if (params.action === 'forget') {
    db.delete(phone).where(eq(phone.id, row.id)).run();
    return { outcome: 'forgotten' };
  }
  let parsed: ReturnType<typeof phoneManageResultSchema.safeParse> | null = null;
  if (finished?.resultText !== null && finished?.resultText !== undefined) {
    try {
      parsed = phoneManageResultSchema.safeParse(JSON.parse(finished.resultText));
    } catch {
      parsed = null;
    }
  }
  if (finished?.state === 'done' && parsed?.success === true && parsed.data.outcome === 'paired') {
    const nextDeviceId = parsed.data.deviceId ?? row.deviceId;
    if (nextDeviceId !== row.deviceId) {
      db.delete(phone)
        .where(
          and(
            eq(phone.machineId, row.machineId),
            eq(phone.deviceId, nextDeviceId),
            ne(phone.id, row.id),
          ),
        )
        .run();
    }
    db.update(phone)
      .set({
        deviceId: nextDeviceId,
        name:
          parsed.data.name === undefined
            ? row.name
            : sanitizePhoneName(parsed.data.name) || row.name,
        lastError: null,
        updatedAt: nowMs(),
      })
      .where(eq(phone.id, row.id))
      .run();
    return { outcome: 'paired' };
  }
  const error = finished?.errorMessage ?? 'the pairing did not finish';
  db.update(phone).set({ lastError: error, updatedAt: nowMs() }).where(eq(phone.id, row.id)).run();
  return { outcome: 'failed', error };
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
  const hubs = deps.commitEffects?.hubs;
  const machineHub = hubs?.machineHub ?? deps.machineHub;
  runAfterCommit(deps, 'browser_close_tab', () => {
    if (!machineHub.pushComputer(owned.machineId, call)) {
      db.delete(computerCall).where(eq(computerCall.id, callId)).run();
      return;
    }
    void openPending({ db, hub: hubs?.hub ?? deps.hub, machineHub }, call).result;
  });
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
  const stepRow = ownedStepRow(deps, machineId, stepId);
  const thread = computerThreadOf(db, stepRow);
  if (thread === null) {
    throw new HttpError(400, `step ${stepId} is not a chief step or an info card`);
  }
  if (stepRow.status !== 'claimed') {
    throw new HttpError(409, 'Coordinator tools require a currently claimed turn');
  }

  const tool = body.name;
  if (tool === 'phone_manage') throw new HttpError(400, PHONE_MANAGE_PANEL_ONLY);
  if (tool === 'browser_close_tab')
    throw new HttpError(400, 'browser_close_tab is sent by the server when a step ends');
  if (tool === 'stage_attachment')
    throw new HttpError(400, 'stage_attachment is sent by the server before a turn starts');
  if (stepRow.kind === 'chief') {
    refuseRestrictedTurnTool(db, stepRow.prompt, tool, body.params, stepRow.ownerMessageIds ?? []);
    if (
      tool === 'shell' ||
      tool === 'list_files' ||
      tool === 'read_file' ||
      tool === 'write_file'
    ) {
      throw new HttpError(
        400,
        'the Coordinator has no shell or file tool of this name; use user_computer_shell instead',
      );
    }
  }
  let own: { machineId: string } | null = null;
  let phoneTarget: Extract<PhoneComputerTarget, { kind: 'ready' }> | null = null;
  if (isOwnComputerTool(tool) || tool === 'attach_file' || isPhoneTool(tool)) {
    const chiefRow =
      stepRow.kind === 'chief'
        ? db.select().from(chiefThread).where(eq(chiefThread.id, stepRow.buildId)).get()
        : undefined;
    if (chiefRow === undefined) throw new NotFoundError(`chief thread ${stepRow.buildId}`);
    if (isOwnComputerTool(tool) || tool === 'attach_file') {
      const target = ownComputerTarget(
        deps,
        chiefRow,
        tool === 'attach_file' ? 'user_computer_shell' : tool,
      );
      if (target.kind === 'refused') return { text: target.text };
      if (tool === 'attach_file') {
        const filePath = body.params.path;
        if (
          typeof filePath !== 'string' ||
          filePath.trim() === '' ||
          filePath.includes('\0') ||
          filePath.length > 4096
        ) {
          throw new HttpError(400, 'attach_file requires a non-empty path string');
        }
        if (
          body.params.caption !== undefined &&
          (typeof body.params.caption !== 'string' || body.params.caption.length > 500)
        ) {
          throw new HttpError(
            400,
            'attach_file caption must be a string of at most 500 characters',
          );
        }
      }
      own = { machineId: target.machineId };
      if (tool === 'user_computer_shell' && body.params.escalate === true) {
        if (turnForcesOutboundApproval(db, stepRow.prompt)) {
          throw new HttpError(403, 'untrusted turn cannot escalate host shell commands');
        }
        if (thread.id === NO_CARD_THREAD) {
          throw new HttpError(
            409,
            'No Coordinator conversation can ask the owner to approve this command.',
          );
        }
        const validated = validateHostShellEscalationParams(body.params);
        if (validated.kind === 'refused') return { text: validated.text };
        const hostRow = db
          .select({ name: machine.name })
          .from(machine)
          .where(eq(machine.id, target.machineId))
          .get();
        const binding = {
          machineId: target.machineId,
          command: validated.command,
          ...(validated.cwd !== undefined ? { cwd: validated.cwd } : {}),
          ...(validated.timeoutMs !== undefined ? { timeoutMs: validated.timeoutMs } : {}),
        };
        const proposal = proposeAction(db, {
          teamId: thread.teamId,
          actionId: HOST_SHELL_ESCALATION_ACTION,
          targetId: hostShellEscalationTargetId(thread.id, binding),
          input: binding,
          threadId: thread.id,
          scopeProjectId: stepRow.scopeProjectId,
          card: hostShellEscalationCard(
            hostRow?.name ?? 'Mac',
            binding.command,
            APPROVE_CHOICE,
            REFUSE_CHOICE,
            binding.cwd,
          ),
        });
        if (proposal.created)
          announceQuestion(deps, thread.id, proposalCardId(proposal.proposalId));
        return {
          text: `Waiting for owner approval (proposal ${proposal.proposalId}) to run this command without the sandbox. Nothing has run yet. Tell the owner this step needs their approval on the card and end your turn.`,
        };
      }
    } else {
      const target = phoneComputerTarget(deps, thread, stepId, tool, body.params);
      if (target.kind === 'refused') return { text: target.text };
      phoneTarget = target;
    }
  }
  const safe = COMPUTER_REPLAY_SAFE_TOOLS.has(tool);
  const baseId = computerCallId(stepId, body.toolCallId);
  const chained = ownerChromeChains.get(baseId);
  if (chained !== undefined) return chained;
  const existing = latestComputerAttempt(db, stepId, body.toolCallId)?.row;
  const callId = existing ? existing.id : baseId;
  if (existing && existing.tool !== tool) {
    throw new HttpError(409, `tool call ${body.toolCallId} was already used for ${existing.tool}`);
  }
  const live = getPendingComputerCall(callId);
  if (live) return waitForCall(deps, live, stepId, opts.signal);

  if (existing && existing.tool === 'request_takeover' && existing.state === 'running') {
    if (typeof body.params.phone === 'string' && body.params.phone.trim() !== '')
      return holdPhoneTakeover(deps, thread, stepId, body, opts);
    return holdTakeover(deps, thread, stepId, body, opts);
  }

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

  if (tool === 'request_takeover') {
    if (typeof body.params.phone === 'string' && body.params.phone.trim() !== '')
      return holdPhoneTakeover(deps, thread, stepId, body, opts);
    return holdTakeover(deps, thread, stepId, body, opts);
  }
  const pinned = db
    .select()
    .from(computer)
    .where(eq(computer.scopeKey, `chief:${thread.chiefId}`))
    .get();
  const refusal = handoffRefusal(
    pinned && !canHandOverScreen(db, pinned.machineId)
      ? { ...pinned, handoffReason: null }
      : pinned,
    tool,
    nowMs(),
  );
  if (refusal !== null) return { text: refusal };

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
  const request: DispatchRequest = {
    thread,
    stepRow,
    toolCallId: body.toolCallId,
    tool,
    params: body.params,
    replaySafe: safe,
    signal: opts.signal,
  };
  const onTarget = () => {
    if (phoneTarget !== null)
      return dispatchComputerCall(deps, request, {
        machineId: phoneTarget.machineId,
        computerId: null,
        phone: phoneTarget,
      }).then((sent) => sent.result);
    if (own !== null)
      return dispatchComputerCall(deps, request, {
        machineId: own.machineId,
        computerId: null,
        hostTool: true,
      }).then((sent) => sent.result);
    const target = selectTarget(deps, thread.teamId, thread.chiefId, tool);
    const authorized = authorizeSecretFills(deps, request, target.machineId, secretActions);
    if (authorized.kind === 'pending') return Promise.resolve({ text: authorized.text });
    return dispatchComputerCall(deps, request, {
      ...target,
      browserRows: authorized.rows,
    }).then((sent) => namingBrowser(db, tool, target.machineId, false, sent.result));
  };
  const mayUseOwnerChrome =
    own === null &&
    phoneTarget === null &&
    isComputerBrowserTool(tool) &&
    body.params.stealth !== true &&
    secretActions.length === 0;
  const candidates = mayUseOwnerChrome
    ? ownerChromeCandidates(db, thread).filter((row) => deps.machineHub.isConnected(row.id))
    : [];
  if (candidates.length === 0) return onTarget();
  const chain = throughOwnerChrome(deps, request, candidates, onTarget);
  ownerChromeChains.set(baseId, chain);
  try {
    return await chain;
  } finally {
    ownerChromeChains.delete(baseId);
  }
}

interface DispatchRequest {
  thread: ComputerThread;
  stepRow: typeof step.$inferSelect;
  toolCallId: string;
  tool: ComputerTool;
  params: Record<string, unknown>;
  replaySafe: boolean;
  signal: AbortSignal | undefined;
}

type BrowserSecretRow = ReturnType<typeof requireBrowserPassword> & { browserOrigin: string };

interface DispatchRoute {
  machineId: string;
  computerId: string | null;
  scopeKey?: string;
  phone?: Extract<PhoneComputerTarget, { kind: 'ready' }>;
  hostTool?: true;
  ownerChrome?: true;
  browserRows?: BrowserSecretRow[];
}

const ownerChromeChains = new Map<string, Promise<ComputerRelayResult>>();

function namingBrowser(
  db: Db,
  tool: ComputerTool,
  machineId: string,
  ownerChrome: boolean,
  result: ComputerRelayResult,
): ComputerRelayResult {
  if (tool !== 'browser_navigate') return result;
  const host = db.select().from(machine).where(eq(machine.id, machineId)).get();
  const name = host?.capabilities?.computerName ?? host?.name ?? machineId;
  const browser = ownerChrome
    ? `the owner's own Chrome on ${name}, through Browser MCP`
    : `Cairn's own browser on ${name}, separate from the owner's Chrome and its sign-ins`;
  return { ...result, text: `[Browser: ${browser}.]\n${result.text}` };
}

async function throughOwnerChrome(
  deps: MachineDeps,
  request: DispatchRequest,
  candidates: readonly (typeof machine.$inferSelect)[],
  onTarget: () => Promise<ComputerRelayResult>,
): Promise<ComputerRelayResult> {
  const unused: string[] = [];
  for (const candidate of candidates) {
    let sent: { callId: string; result: ComputerRelayResult };
    try {
      sent = await dispatchComputerCall(deps, request, {
        machineId: candidate.id,
        computerId: null,
        scopeKey: `chief:${request.thread.chiefId}`,
        ownerChrome: true,
      });
    } catch (error) {
      if (!(error instanceof HttpError) || error.message !== COMPUTER_NOT_CONNECTED) throw error;
      unused.push(`${candidate.name}: ${COMPUTER_NOT_CONNECTED}`);
      continue;
    }
    const row = deps.db.select().from(computerCall).where(eq(computerCall.id, sent.callId)).get();
    const reason =
      row?.state === 'error' &&
      row.errorDelivery === 'not_delivered' &&
      row.errorMessage?.startsWith(OWNER_CHROME_UNAVAILABLE_PREFIX)
        ? row.errorMessage.slice(OWNER_CHROME_UNAVAILABLE_PREFIX.length)
        : null;
    if (reason === null)
      return row?.state === 'done'
        ? namingBrowser(deps.db, request.tool, candidate.id, true, sent.result)
        : sent.result;
    unused.push(`${candidate.name}: ${reason}`);
  }
  const reasons = unused.join(' ');
  try {
    const result = await onTarget();
    return {
      ...result,
      text: `[Ran in Cairn's browser instead of your own Chrome. ${reasons}]\n${result.text}`,
    };
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    throw new HttpError(
      error.status,
      `[Your own Chrome was not used. ${reasons}] ${error.message}`,
    );
  }
}

function authorizeSecretFills(
  deps: MachineDeps,
  request: DispatchRequest,
  machineId: string,
  secretActions: readonly BrowserSecretFillAction[],
): { kind: 'ready'; rows: BrowserSecretRow[] } | { kind: 'pending'; text: string } {
  const { db } = deps;
  const { thread } = request;
  const host = db.select().from(machine).where(eq(machine.id, machineId)).get();
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
      machineId,
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
        scopeProjectId: request.stepRow.scopeProjectId,
        card: [
          {
            header: '网站授权',
            question: `允许在 ${origin} 代填机密 ${row.name}？仅限电脑 ${machineId}；之后在这台电脑的同一网站自动可用，密码不会交给模型。换网站、电脑或密码后会重新询问。`,
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
      kind: 'pending',
      text: `尚未代填。网站授权卡已发给用户（${pendingApprovals.join(', ')}），请等用户在卡片上批准。批准后先 browser_snapshot，再用新的 ref 重试；不要索取密码。`,
    };
  return { kind: 'ready', rows: browserRows };
}

async function dispatchComputerCall(
  deps: MachineDeps,
  request: DispatchRequest,
  target: DispatchRoute,
): Promise<{ callId: string; result: ComputerRelayResult }> {
  const { db } = deps;
  const { thread, stepRow, toolCallId, tool, params, replaySafe } = request;
  const stepId = stepRow.id;
  const browserRows = target.browserRows ?? [];
  const now = nowMs();
  const computerStarting =
    target.computerId !== null &&
    db.select().from(computer).where(eq(computer.id, target.computerId)).get()?.state !== 'running';
  const deadlineAt = now + computerDeadlineMs(tool, params, computerStarting);
  const browserTool = isComputerBrowserTool(tool);
  if (target.computerId !== null) {
    if (browserTool)
      acquireBrowserLease(
        db,
        target.computerId,
        browserScopeFor(thread),
        stepId,
        replaySafe,
        deadlineAt,
      );
    else acquireExecutionLease(db, target.computerId, stepId, replaySafe, deadlineAt);
  } else if (target.phone !== undefined) {
    acquirePhoneLease(db, target.phone.phoneId, stepId, deadlineAt);
  }

  const sanitizedParams =
    tool === 'user_computer_shell'
      ? (({ escalate: _escalate, sandboxDeniedReason: _denied, ...rest }) => rest)(params)
      : params;
  const fresh = {
    machineId: target.machineId,
    computerId: target.computerId,
    phoneId: target.phone?.phoneId ?? null,
    tool,
    replaySafe,
    params: {
      ...storedParams(sanitizedParams),
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
  const latest = latestComputerAttempt(db, stepId, toolCallId);
  const existing = latest?.row;
  const dispatchId = computerCallId(stepId, toolCallId, (latest?.attempt ?? 0) + 1);
  if (existing) {
    clearPendingComputerOutput(existing.id);
    if (!isFinalState(existing.state)) {
      db.update(computerCall)
        .set({
          state: 'interrupted',
          errorMessage: 'superseded by a rerun',
          errorDelivery: 'unknown',
          finishedAt: nowMs(),
        })
        .where(eq(computerCall.id, existing.id))
        .run();
    }
  }
  db.insert(computerCall)
    .values({
      id: dispatchId,
      teamId: thread.teamId,
      stepId,
      toolCallId,
      ...fresh,
    })
    .run();

  const call: ComputerCall = {
    callId: dispatchId,
    stepId,
    tool,
    params: sanitizedParams,
    deadlineAt,
    ...(target.scopeKey !== undefined ? { scopeKey: target.scopeKey } : {}),
    ...(browserTool
      ? { tabScope: browserTabScope(stepRow), browserScope: browserScopeFor(thread) }
      : {}),
    ...(target.ownerChrome === true ? { ownerChrome: 'browsermcp' as const } : {}),
    ...(target.hostTool !== true && target.phone === undefined
      ? { computerGrant: browserTool ? ('browser' as const) : ('desktop' as const) }
      : {}),
    ...(target.phone !== undefined
      ? { phone: { phoneId: target.phone.phoneId, deviceId: target.phone.deviceId } }
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
  return { callId: dispatchId, result: await waitForCall(deps, pending, stepId, request.signal) };
}

const PROMPT_ATTACHMENT_REF =
  /!?\[[^\]]*\]\(attachment:([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.([a-z0-9]{1,8})\)/g;
const MAX_STAGED_ATTACHMENTS_PER_TURN = 16;

function sanitizePromptInline(text: string, maxChars: number): string {
  return text.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function activeMachineComputerCall(
  db: Db,
  machineId: string,
  callId: string,
  expectedTool: 'stage_attachment' | 'attach_file',
): { callRow: CallRow; stepRow: typeof step.$inferSelect } {
  const row = db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  if (!row || row.machineId !== machineId || row.tool !== expectedTool) {
    throw new HttpError(404, 'computer call not found');
  }
  if (row.state !== 'dispatched' && row.state !== 'running') {
    throw new HttpError(409, `computer call already ${row.state}`);
  }
  if (row.deadlineAt <= nowMs()) {
    throw new HttpError(409, 'computer call deadline expired');
  }
  const stepRow = db.select().from(step).where(eq(step.id, row.stepId)).get();
  if (stepRow?.kind !== 'chief' || stepRow.status !== 'claimed') {
    throw new HttpError(409, `${expectedTool} requires a claimed Coordinator turn`);
  }
  return { callRow: row, stepRow };
}

export function computerCallDownloadAttachment(
  deps: Pick<MachineDeps, 'db' | 'attachmentsDir'>,
  machineId: string,
  callId: string,
): { fileName: string; mimeType: string; bytes: Buffer } {
  const { callRow } = activeMachineComputerCall(deps.db, machineId, callId, 'stage_attachment');
  const attachmentId = callRow.params.attachmentId;
  if (typeof attachmentId !== 'string' || attachmentId === '') {
    throw new HttpError(400, 'stage_attachment call has no attachmentId');
  }
  const att = requireAttachmentRow(deps.db, callRow.teamId, attachmentId);
  const bytes = readFileSync(join(deps.attachmentsDir, att.storageKey));
  return { fileName: att.fileName, mimeType: att.mimeType, bytes };
}

export function computerCallUploadAttachment(
  deps: MachineDeps,
  machineId: string,
  callId: string,
  input: { fileName: string; caption?: string | undefined; bytes: Buffer },
): { id: string; key: string; token: string; sha256: string } {
  const { callRow, stepRow } = activeMachineComputerCall(deps.db, machineId, callId, 'attach_file');
  const threadRow = deps.db
    .select()
    .from(chiefThread)
    .where(eq(chiefThread.id, stepRow.buildId))
    .get();
  if (!threadRow || threadRow.teamId !== callRow.teamId) {
    throw new NotFoundError(`chief thread ${stepRow.buildId}`);
  }
  const claimed = deps.db
    .update(computerCall)
    .set({ resultText: 'uploading' })
    .where(
      and(
        eq(computerCall.id, callId),
        inArray(computerCall.state, ['dispatched', 'running']),
        isNull(computerCall.resultText),
      ),
    )
    .run();
  if (claimed.changes === 0) {
    throw new HttpError(409, 'attach_file already uploaded for this call');
  }
  try {
    return attachCoordinatorFile(deps, stepRow, threadRow, input);
  } catch (error) {
    deps.db
      .update(computerCall)
      .set({ resultText: null })
      .where(and(eq(computerCall.id, callId), eq(computerCall.resultText, 'uploading')))
      .run();
    throw error;
  }
}

export async function stageTurnAttachments(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  threadRow: typeof chiefThread.$inferSelect,
  prompt: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!isOwner(deps.db, threadRow.userId)) return null;
  if (parseChiefTrigger(prompt) !== 'user') return null;
  if (turnForcesOutboundApproval(deps.db, prompt)) return null;
  if (memoryEditIdOfPrompt(prompt) !== null) return null;
  const seen = new Set<string>();
  const refs: { teamId: string; attachmentId: string }[] = [];
  for (const match of prompt.matchAll(PROMPT_ATTACHMENT_REF)) {
    const teamId = match[1] ?? '';
    const attachmentId = match[2] ?? '';
    if (teamId !== threadRow.teamId || attachmentId === '' || seen.has(attachmentId)) continue;
    seen.add(attachmentId);
    refs.push({ teamId, attachmentId });
    if (refs.length >= MAX_STAGED_ATTACHMENTS_PER_TURN) break;
  }
  if (refs.length === 0) return null;
  const rows = refs.flatMap((ref) => {
    try {
      return [requireAttachmentRow(deps.db, threadRow.teamId, ref.attachmentId)];
    } catch {
      return [];
    }
  });
  if (rows.length === 0) return null;
  const target = ownComputerTarget(deps, threadRow, 'user_computer_shell');
  if (target.kind === 'refused') {
    const names = rows.map((row) => sanitizePromptInline(row.fileName, 120)).join(', ');
    return [
      '<staged_uploads>',
      `Uploaded file(s) (${names}) could not be staged on the user's computer: ${target.text}`,
      '</staged_uploads>',
    ].join('\n');
  }
  const lines: string[] = [];
  for (const row of rows) {
    const safeName = sanitizePromptInline(row.fileName, 120);
    const toolCallId = `stage-${row.id}`;
    const latest = latestComputerAttempt(deps.db, stepRow.id, toolCallId);
    const existing = latest?.row;
    const now = nowMs();
    const deadlineAt = now + STAGE_ATTACHMENT_TIMEOUT_MS;
    const params = {
      threadId: threadRow.id,
      attachmentId: row.id,
      fileName: row.fileName,
    };
    if (existing?.state === 'done' && existing.resultText !== null) {
      try {
        const parsed = JSON.parse(existing.resultText) as { path?: unknown };
        if (typeof parsed.path === 'string' && parsed.path !== '') {
          lines.push(
            `- ${safeName} (${row.mimeType}, ${row.sizeBytes} bytes): ${sanitizePromptInline(parsed.path, 512)}`,
          );
          continue;
        }
      } catch {}
    }
    const attempt = (latest?.attempt ?? 0) + 1;
    const dispatchId = computerCallId(stepRow.id, toolCallId, attempt);
    deps.db
      .insert(computerCall)
      .values({
        id: dispatchId,
        teamId: threadRow.teamId,
        stepId: stepRow.id,
        toolCallId,
        machineId: target.machineId,
        computerId: null,
        tool: 'stage_attachment',
        replaySafe: true,
        params,
        state: 'dispatched',
        deadlineAt,
        createdAt: now,
      })
      .run();
    const call: ComputerCall = {
      callId: dispatchId,
      stepId: stepRow.id,
      tool: 'stage_attachment',
      params,
      deadlineAt,
    };
    if (!deps.machineHub.pushComputer(target.machineId, call)) {
      deps.db.delete(computerCall).where(eq(computerCall.id, dispatchId)).run();
      lines.push(`- ${safeName}: could not be staged (${COMPUTER_NOT_CONNECTED})`);
      continue;
    }
    const settled = await waitForCall(deps, openPending(deps, call), stepRow.id, signal);
    let stagedPath: string | null = null;
    try {
      const parsed = JSON.parse(settled.text) as { path?: unknown };
      if (typeof parsed.path === 'string' && parsed.path !== '') stagedPath = parsed.path;
    } catch {}
    if (stagedPath !== null) {
      lines.push(
        `- ${safeName} (${row.mimeType}, ${row.sizeBytes} bytes): ${sanitizePromptInline(stagedPath, 512)}`,
      );
    } else {
      lines.push(`- ${safeName}: could not be staged (${sanitizePromptInline(settled.text, 200)})`);
    }
  }
  return [
    '<staged_uploads>',
    "Uploaded chat files staged on the user's computer (ready for user_computer_shell; return output files with attach_file):",
    ...lines,
    '</staged_uploads>',
  ].join('\n');
}
