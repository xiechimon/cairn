import type { PreparedWorkspace, ProviderConfig, QuotaBlock, WorktreeOps } from '@cairn/shared';
import type { TranscriptBuffer } from './journal.js';
import type { StepPassState } from './step-pass-events.js';
import { stepQuotaBlock } from './step-quota-block.js';
import type { StopRequest } from './step-stops.js';

export const SILENT_NO_OP_ROUND_ERROR =
  'agent session ended with zero progress and no terminal outcome (silent no-op round)';

export function combineTimeoutWithRootCause(timeoutText: string, rootCause: string | null): string {
  return rootCause !== null ? `${timeoutText}；根因: ${rootCause}` : timeoutText;
}

export interface StepPassOutcomeInput {
  pass: Readonly<
    Pick<
      StepPassState,
      | 'lastError'
      | 'lastModelError'
      | 'lastErrorWasProcessCrash'
      | 'sawDone'
      | 'sawProgress'
      | 'retryStorm'
      | 'quotaTrip'
    >
  >;
  timeoutText: string | null;
  watchdogTripped: boolean;
  stopRequest: StopRequest | null;
  provider: ProviderConfig | null;
  log: (message: string) => void;
}

export interface StepPassOutcome {
  lastError: string | null;
  stopped: boolean;
  quotaBlock: QuotaBlock | null;
}

export function resolveStepPassOutcome(input: StepPassOutcomeInput): StepPassOutcome {
  const { pass, timeoutText, stopRequest, log } = input;
  let lastError = pass.lastError;
  if (timeoutText !== null) {
    lastError = combineTimeoutWithRootCause(timeoutText, lastError ?? pass.lastModelError);
  } else if (pass.retryStorm && lastError === null && pass.lastModelError !== null) {
    lastError = pass.lastModelError;
  }
  const stopped = stopRequest !== null && !pass.sawDone;
  if (stopRequest !== null && pass.sawDone) log('stop arrived after completion — ignored');
  const quotaBlock = stepQuotaBlock({
    provider: input.provider,
    quotaTrip: pass.quotaTrip,
    stopped,
    processCrash: pass.lastErrorWasProcessCrash,
    failureText: pass.lastModelError ?? lastError,
  });
  if (quotaBlock !== null && lastError === null) lastError = quotaBlock.reason;
  if (
    !input.watchdogTripped &&
    !stopped &&
    !pass.sawProgress &&
    !pass.sawDone &&
    lastError === null
  ) {
    lastError = SILENT_NO_OP_ROUND_ERROR;
    log('zero-event round: session stream exhausted without progress, done, or error');
  }
  return { lastError, stopped, quotaBlock };
}

export interface StepRewindInput {
  workspace: WorktreeOps | undefined;
  ws: PreparedWorkspace | null;
  headAtStart: string | null;
  attachmentVerify: boolean;
  stopped: boolean;
  stopRequest: StopRequest | null;
  reviewCheckout: boolean;
  stepId: string;
  transcript: TranscriptBuffer;
  now: () => number;
  log: (message: string) => void;
}

async function rewindToStepStart(input: StepRewindInput): Promise<string | null> {
  const { workspace, ws, headAtStart } = input;
  if (input.attachmentVerify) return null;
  if (ws?.readonly === true) return null;
  if (ws === null || !workspace || headAtStart === null) return '步起点 commit 不可得';
  try {
    await workspace.restoreCheckpoint(ws.cwd, headAtStart);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export async function rewindAfterStep(input: StepRewindInput): Promise<void> {
  const { log } = input;
  if (input.stopped) {
    const discard = input.stopRequest?.discard === true;
    log(`step stopped by user (discard=${discard})`);
    if (discard) {
      const failed = await rewindToStepStart(input);
      if (failed !== null) log(`discard rewind failed: ${failed}`);
    }
  }
  if (!input.reviewCheckout) return;
  const failed = await rewindToStepStart(input);
  if (failed === null) return;
  log(`review rewind failed: ${failed}`);
  input.transcript.upsert({
    id: `review-rewind-${input.stepId}`,
    role: 'system',
    content: `审核检出未能回退到本轮起点（${failed}）——本轮审核对工作区的写入可能残留，合并前请确认工作区状态`,
    createdAt: input.now(),
  });
}
