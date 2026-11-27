import {
  type AgentBackend,
  type AgentSessionHandle,
  type ClaimedStep,
  failureEndsStepNow,
  type ProviderConfig,
  type SessionOpts,
  type StepFailureCode,
  type StepFailureDetail,
  sleep,
} from '@cairn/shared';
import type { AskChannel } from './ask-channel.js';
import { stepFailureOf } from './backend/errors.js';
import { credentialSafeEvents } from './credential-output.js';
import type { StepJournal } from './journal.js';
import {
  consumeStepPassEvent,
  resetStepPassForRetry,
  type StepPassEventContext,
  type StepPassState,
} from './step-pass-events.js';
import { planStepPassRetry } from './step-pass-retry.js';
import type { StepSessionOpener } from './step-session-opener.js';
import type { RunStop } from './step-stops.js';

export interface StepPassLoopInput
  extends Omit<StepPassEventContext, 'handle' | 'promptImages' | 'provider'> {
  claimed: ClaimedStep;
  convId: string;
  isChief: boolean;
  backend: Pick<AgentBackend, 'modelSupportsImages' | 'adaptProviderCompat'>;
  sessionOpts: SessionOpts;
  provider: ProviderConfig;
  opener: StepSessionOpener;
  passState: StepPassState;
  session: { current: AgentSessionHandle | null };
  stop: RunStop;
  askChannel: AskChannel;
  journal: StepJournal;
  credentialValues: () => readonly (string | undefined)[];
  sessionHandles: Map<string, AgentSessionHandle> | undefined;
  networkRetryDelays: readonly number[];
}

export interface StepPassLoopResult {
  provider: ProviderConfig;
  openError: string | null;
  openFailureCode: StepFailureCode | null;
  openFailureDetail: StepFailureDetail | null;
}

async function drainPass(
  input: StepPassLoopInput,
  handle: AgentSessionHandle,
  pass: number,
): Promise<void> {
  const { passState, watchdog, activity, askChannel, logger, stop } = input;
  const passEvents: StepPassEventContext = {
    stepId: input.stepId,
    client: input.client,
    logger,
    modelKey: input.modelKey,
    provider: input.provider,
    handle,
    promptImages: input.opener.promptImages,
    retryStormMax: input.retryStormMax,
    now: input.now,
    watchdog,
    activity,
    stream: input.stream,
    transcript: input.transcript,
    agentTodo: input.agentTodo,
    toolStartedAt: input.toolStartedAt,
  };
  input.sessionHandles?.set(input.stepId, handle);
  let promptDelivered = false;
  stop.attach(handle).catch((err: unknown) => {
    logger.step(`stop delivery failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  watchdog.startPass(pass === 0);
  try {
    for await (const ev of credentialSafeEvents(handle.events, input.credentialValues)) {
      if (!promptDelivered) {
        promptDelivered = true;
        await askChannel.ackAnswers(input.claimed.answerIds ?? [], 'session-start');
      }
      if (ev.type === 'toolcall_end') {
        watchdog.noteToolCall(ev.call.id, ev.call.result === undefined);
        if (ev.call.result !== undefined) await askChannel.ackPollsReachedBy(ev.call.result);
      }
      watchdog.noteEvent();
      activity.noteEvent();
      await consumeStepPassEvent(ev, passEvents, passState);
      if (failureEndsStepNow(passState.lastModelError ?? '')) break;
    }
  } catch (err) {
    const structured = stepFailureOf(err);
    const isTrailingExit =
      structured?.failureCode === 'runtime_exited' && passState.lastError !== null;
    if (!isTrailingExit) {
      passState.lastError = err instanceof Error ? err.message : String(err);
    }
    if (
      structured !== null &&
      !isTrailingExit &&
      (passState.failureCode === null ||
        (passState.failureCode === 'runtime_exited' && structured.failureCode !== 'runtime_exited'))
    ) {
      passState.failureCode = structured.failureCode;
      passState.failureDetail = structured.failureDetail ?? null;
    }
  }
  stop.detach();
  if (failureEndsStepNow(passState.lastModelError ?? ''))
    passState.lastError = passState.lastModelError;
}

export async function runStepPasses(input: StepPassLoopInput): Promise<StepPassLoopResult> {
  const { passState, opener, watchdog, stream, stop, logger, stepId, backend, sessionOpts } = input;
  let priorPassMadeProgress = false;
  let networkRetries = 0;
  const retryWithoutImages = (failureText: string): Promise<boolean> =>
    opener.retryWithoutImages(
      failureText,
      passState.sawProgress ||
        priorPassMadeProgress ||
        watchdog.trippedArm !== null ||
        stop.request !== null ||
        passState.quotaTrip !== null,
    );
  for (let pass = 0; ; pass++) {
    if (pass > 0) {
      priorPassMadeProgress ||= passState.sawProgress;
      resetStepPassForRetry(passState);
      watchdog.clearTrip();
      stream.discardAttempt();
    }
    if (stop.request !== null) break;
    input.activity.setPhase('starting', pass > 0 ? { resetLive: true } : undefined);
    let handle: AgentSessionHandle;
    try {
      handle = await opener.open();
      input.session.current = handle;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (await retryWithoutImages(message)) continue;
      stream.flushDeltas();
      const structured = stepFailureOf(err);
      return {
        openError: message,
        openFailureCode: structured?.failureCode ?? null,
        openFailureDetail: structured?.failureDetail ?? null,
        provider: input.provider,
      };
    }
    logger.raw(
      opener.continueId !== null
        ? `continue session ${input.convId}`
        : `new session ${input.convId}`,
    );
    if (!input.isChief && opener.imageSupport === null) {
      try {
        opener.setImageSupport(
          (await backend.modelSupportsImages?.(sessionOpts.provider, sessionOpts.modelId)) ?? null,
        );
      } catch (err) {
        logger.step(
          `session image support probe failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    input.journal.update(stepId, { state: 'running', sessionId: handle.sessionId });
    await drainPass(input, handle, pass);
    const retry = planStepPassRetry({
      pass,
      state: passState,
      watchdogTripped: watchdog.trippedArm !== null,
      stopPending: stop.request !== null,
      networkRetries,
      networkRetryDelays: input.networkRetryDelays,
    });
    if (retry.kind === 'finish') break;
    if (retry.kind === 'network') {
      networkRetries += 1;
      logger.step(
        `provider network retry ${networkRetries}: waiting ${retry.delayMs}ms before ${networkRetries === input.networkRetryDelays.length ? 'final' : 'next'} attempt`,
      );
      await sleep(retry.delayMs);
      opener.continueId = handle.sessionId;
      input.sessionHandles?.delete(stepId);
      continue;
    }
    if (retry.kind === 'compat') {
      const amended: ProviderConfig | null =
        backend.adaptProviderCompat?.(input.provider, retry.failureText) ?? null;
      if (amended !== null) {
        input.provider = amended;
        sessionOpts.provider = amended;
        logger.step(
          `protocol fallback: provider ${amended.providerId} compat adapted (${JSON.stringify(
            amended.compat,
          )}), retrying session once`,
        );
        input.sessionHandles?.delete(stepId);
        continue;
      }
    }
    if (await retryWithoutImages(retry.failureText)) continue;
    break;
  }
  return {
    openError: null,
    openFailureCode: null,
    openFailureDetail: null,
    provider: input.provider,
  };
}
