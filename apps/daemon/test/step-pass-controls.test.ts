import type { AgentSessionHandle, SessionOpts } from '@cairn/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AskChannel } from '../src/ask-channel.js';
import type { MachineApi } from '../src/machine-client.js';
import { createStepPassControls } from '../src/step-pass-controls.js';
import { newStepPassState } from '../src/step-pass-events.js';

function controls(machineId: string | null = 'm1') {
  const askChannel = { keepAlive: null, abort: vi.fn() } as unknown as AskChannel;
  const sessionOpts = {} as SessionOpts;
  const passState = newStepPassState();
  const reportClaudeRateLimit = vi.fn(async () => {});
  const client = { reportClaudeRateLimit } as unknown as MachineApi;
  const built = createStepPassControls({
    stepKind: 'build',
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
  return { built, askChannel, sessionOpts, passState, reportClaudeRateLimit, stopSession };
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
    built.watchdog.stop();
  });

  it('an allowed rate limit notice is forwarded without tripping', () => {
    const { sessionOpts, passState, stopSession, built } = controls();
    sessionOpts.onClaudeRateLimit?.({ status: 'allowed' });
    expect(passState.quotaTrip).toBeNull();
    expect(stopSession).not.toHaveBeenCalled();
    built.watchdog.stop();
  });
});
