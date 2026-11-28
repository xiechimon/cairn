import type { AgentSessionHandle, ClaimedStep, SessionOpts } from '@cairn/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskChannel } from '../src/ask-channel.js';
import type { MachineApi } from '../src/machine-client.js';
import { createStepPassControls } from '../src/step-pass-controls.js';
import { newStepPassState } from '../src/step-pass-events.js';

afterEach(() => {
  vi.useRealTimers();
});

function controls(
  machineId: string | null = 'm1',
  stepKind: ClaimedStep['step']['kind'] = 'build',
) {
  const askChannel = { keepAlive: null, abort: vi.fn() } as unknown as AskChannel;
  const sessionOpts = {} as SessionOpts;
  const passState = newStepPassState();
  const reportClaudeRateLimit = vi.fn(async () => {});
  const transcriptDelta = vi.fn(async () => {});
  const thinkingDelta = vi.fn(async () => {});
  const client = {
    reportClaudeRateLimit,
    transcriptDelta,
    thinkingDelta,
  } as unknown as MachineApi;
  const built = createStepPassControls({
    stepKind,
    machineId,
    streamTimeouts: undefined,
    streamDurationCapMs: undefined,
    askChannel,
    sessionOpts,
    passState,
    stepId: 's1',
    client,
    transcript: { upsert: () => {} },
    agentTodo: { report: () => {} },
    now: () => 0,
    log: () => {},
  });
  const stopSession = vi.fn(async () => {});
  built.session.current = { stop: stopSession } as unknown as AgentSessionHandle;
  return {
    built,
    askChannel,
    sessionOpts,
    passState,
    reportClaudeRateLimit,
    transcriptDelta,
    thinkingDelta,
    stopSession,
  };
}

describe('createStepPassControls', () => {
  it('wires the ask channel keep-alive to the watchdog', () => {
    const { askChannel, built } = controls();
    const keepAlive = vi.spyOn(built.watchdog, 'keepAlive');
    askChannel.keepAlive?.();
    expect(keepAlive).toHaveBeenCalledOnce();
    built.watchdog.stop();
  });

  it('a rejected Claude rate limit trips quota once and stops the session', () => {
    const { sessionOpts, passState, reportClaudeRateLimit, stopSession, built } = controls();
    sessionOpts.onClaudeRateLimit?.({ status: 'rejected', rateLimitType: 'five_hour' });
    sessionOpts.onClaudeRateLimit?.({ status: 'rejected', rateLimitType: 'five_hour' });
    expect(passState.quotaTrip?.kind).toBe('quota');
    expect(stopSession).toHaveBeenCalledOnce();
    expect(reportClaudeRateLimit).toHaveBeenCalledTimes(2);
    expect(reportClaudeRateLimit).toHaveBeenCalledWith({
      machineId: 'm1',
      status: 'rejected',
      rateLimitType: 'five_hour',
      stepId: 's1',
    });
    built.watchdog.stop();
  });

  it('an allowed rate limit notice is forwarded without tripping', () => {
    const { sessionOpts, passState, stopSession, built } = controls();
    sessionOpts.onClaudeRateLimit?.({ status: 'allowed' });
    expect(passState.quotaTrip).toBeNull();
    expect(stopSession).not.toHaveBeenCalled();
    built.watchdog.stop();
  });

  it('enables leading-edge first delta only for chief steps', async () => {
    vi.useFakeTimers();
    const chief = controls('m1', 'chief');
    chief.built.stream.pushThinking('plan');
    chief.built.stream.pushText('hello');
    expect(chief.thinkingDelta).toHaveBeenCalledWith('s1', 'plan');
    expect(chief.transcriptDelta).toHaveBeenCalledWith('s1', 'hello');
    chief.built.stream.pushText(' world');
    expect(chief.transcriptDelta).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(chief.transcriptDelta).toHaveBeenCalledWith('s1', ' world');
    chief.built.watchdog.stop();

    const build = controls('m1', 'build');
    build.built.stream.pushThinking('plan');
    build.built.stream.pushText('hello');
    expect(build.thinkingDelta).not.toHaveBeenCalled();
    expect(build.transcriptDelta).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(build.thinkingDelta).toHaveBeenCalledWith('s1', 'plan');
    expect(build.transcriptDelta).toHaveBeenCalledWith('s1', 'hello');
    build.built.watchdog.stop();
  });
});
