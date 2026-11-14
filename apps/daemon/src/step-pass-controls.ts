import type { AgentSessionHandle, ClaimedStep, SessionOpts } from '@cairn/shared';
import { isBuildStepKind } from '@cairn/shared';
import type { AskChannel } from './ask-channel.js';
import { claudeQuotaTrip, forwardClaudeRateLimit } from './claude-quota-trip.js';
import type { StepPassState } from './step-pass-events.js';
import {
  StepTranscriptStream,
  type StepTranscriptStreamOptions,
} from './step-transcript-stream.js';
import { resolveStreamLimits, type StreamTimeouts, StreamWatchdog } from './stream-watchdog.js';

export interface StepPassControlsInput extends StepTranscriptStreamOptions {
  stepKind: ClaimedStep['step']['kind'];
  machineId: string | null;
  streamTimeouts: StreamTimeouts | undefined;
  streamDurationCapMs: number | undefined;
  askChannel: AskChannel;
  sessionOpts: SessionOpts;
  passState: StepPassState;
}

export interface StepPassControls {
  watchdog: StreamWatchdog;
  stream: StepTranscriptStream;
  session: { current: AgentSessionHandle | null };
  toolStartedAt: Map<string, number>;
}

export function createStepPassControls(input: StepPassControlsInput): StepPassControls {
  const { askChannel, passState, log } = input;
  const session: { current: AgentSessionHandle | null } = { current: null };
  const streamLimits = resolveStreamLimits({
    ...(input.streamTimeouts !== undefined ? { timeouts: input.streamTimeouts } : {}),
    ...(input.streamDurationCapMs !== undefined
      ? { durationCapMs: input.streamDurationCapMs }
      : {}),
  });
  const watchdog = new StreamWatchdog({
    timeouts: streamLimits.timeouts,
    durationCapMs: streamLimits.durationCapMs,
    durationCapIsAbsolute: streamLimits.durationCapIsAbsolute,
    progressExtendsDuration: isBuildStepKind(input.stepKind) && !streamLimits.durationCapIsAbsolute,
    onTrip: () => {
      askChannel.abort();
      void session.current?.stop();
    },
  });
  askChannel.keepAlive = () => watchdog.keepAlive();
  const stream = new StepTranscriptStream({
    stepId: input.stepId,
    client: input.client,
    transcript: input.transcript,
    agentTodo: input.agentTodo,
    now: input.now,
    log,
  });
  input.sessionOpts.onClaudeRateLimit = (notice) => {
    forwardClaudeRateLimit(input.client, input.machineId, notice, log);
    if (passState.quotaTrip !== null) return;
    const trip = claudeQuotaTrip(notice, Date.now());
    if (trip === null) return;
    passState.quotaTrip = trip;
    void session.current?.stop();
  };
  return { watchdog, stream, session, toolStartedAt: new Map<string, number>() };
}
