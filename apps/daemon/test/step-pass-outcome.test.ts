import { join } from 'node:path';
import type { AgentSessionHandle, PreparedWorkspace, WorktreeOps } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import type { ActivityTracker } from '../src/activity.js';
import type { AgentTodoReporter } from '../src/agent-todo.js';
import { TranscriptBuffer } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { consumeStepPassEvent, newStepPassState } from '../src/step-pass-events.js';
import {
  resolveStepPassOutcome,
  rewindAfterStep,
  SILENT_NO_OP_ROUND_ERROR,
  type StepPassOutcomeInput,
  type StepRewindInput,
} from '../src/step-pass-outcome.js';
import type { StepTranscriptStream } from '../src/step-transcript-stream.js';
import type { StreamWatchdog } from '../src/stream-watchdog.js';
import { testTempDir } from './test-temp-dir.js';

function pass(overrides: Partial<StepPassOutcomeInput['pass']> = {}): StepPassOutcomeInput['pass'] {
  return {
    lastError: null,
    lastModelError: null,
    lastErrorWasProcessCrash: false,
    failureCode: null,
    failureDetail: null,
    sawDone: true,
    sawProgress: true,
    retryStorm: false,
    quotaTrip: null,
    ...overrides,
  };
}

function outcome(overrides: Partial<StepPassOutcomeInput>, log: string[] = []) {
  return resolveStepPassOutcome({
    pass: pass(),
    timeoutText: null,
    watchdogTripped: false,
    stopRequest: null,
    provider: null,
    log: (line) => log.push(line),
    ...overrides,
  });
}

describe('resolveStepPassOutcome', () => {
  test('a completed pass has no error, stop or quota block', () => {
    expect(outcome({})).toEqual({
      lastError: null,
      stopped: false,
      quotaBlock: null,
      failureCode: null,
      failureDetail: null,
    });
  });

  test('a stream timeout carries the model error as root cause', () => {
    const result = outcome({
      pass: pass({ sawDone: false, lastModelError: 'overloaded' }),
      timeoutText: 'stream timeout',
      timeoutMs: 30_000,
      watchdogTripped: true,
    });
    expect(result.lastError).toBe('stream timeout；根因: overloaded');
    expect(result.failureCode).toBeNull();
    expect(result.failureDetail).toBeNull();
  });

  test('a pure watchdog timeout reports stream_timeout with timeoutMs', () => {
    const result = outcome({
      pass: pass({ sawDone: false, sawProgress: false }),
      timeoutText: 'stream timeout (arm=first, first=30000ms)',
      timeoutMs: 30_000,
      watchdogTripped: true,
    });
    expect(result.failureCode).toBe('stream_timeout');
    expect(result.failureDetail).toEqual({ timeoutMs: 30_000 });
  });

  test('a prior pass failureCode survives watchdog timeout', () => {
    const result = outcome({
      pass: pass({
        sawDone: false,
        lastError: 'ACP exited (1)',
        failureCode: 'runtime_exited',
        failureDetail: { runtime: 'antigravity', exitCode: 1 },
      }),
      timeoutText: 'stream timeout',
      timeoutMs: 30_000,
      watchdogTripped: true,
    });
    expect(result.failureCode).toBe('runtime_exited');
    expect(result.failureDetail).toEqual({ runtime: 'antigravity', exitCode: 1 });
  });

  test('a retry storm surfaces the last model error', () => {
    const result = outcome({
      pass: pass({ sawDone: false, retryStorm: true, lastModelError: 'bad gateway' }),
    });
    expect(result.lastError).toBe('bad gateway');
  });

  test('a stop after done is ignored and logged', () => {
    const log: string[] = [];
    const result = outcome({ stopRequest: { discard: false } }, log);
    expect(result.stopped).toBe(false);
    expect(log).toEqual(['stop arrived after completion — ignored']);
  });

  test('a stop before done stops the step without a no-op error', () => {
    const result = outcome({
      pass: pass({ sawDone: false, sawProgress: false }),
      stopRequest: { discard: true },
    });
    expect(result).toEqual({
      lastError: null,
      stopped: true,
      quotaBlock: null,
      failureCode: null,
      failureDetail: null,
    });
  });

  test('a quota failure becomes a quota block and the step error', () => {
    const result = outcome({
      pass: pass({ sawDone: false, lastModelError: 'insufficient quota for this key' }),
    });
    expect(result.quotaBlock?.kind).toBe('quota');
    expect(result.lastError).toBe(result.quotaBlock?.reason);
    expect(result.failureCode).toBe('quota');
  });

  test('a capacity quota block maps to rate_limit failureCode', () => {
    const result = outcome({
      pass: pass({ sawDone: false, lastModelError: 'HTTP 429 too many requests' }),
    });
    expect(result.quotaBlock?.kind).toBe('capacity');
    expect(result.failureCode).toBe('rate_limit');
  });

  test('a silent round without progress or done fails as a no-op', () => {
    const log: string[] = [];
    const result = outcome({ pass: pass({ sawDone: false, sawProgress: false }) }, log);
    expect(result.lastError).toBe(SILENT_NO_OP_ROUND_ERROR);
    expect(result.failureCode).toBe('silent_no_op');
    expect(result.failureDetail).toBeNull();
    expect(log).toHaveLength(1);
  });

  test('a tripped watchdog never reports the silent no-op error', () => {
    const result = outcome({
      pass: pass({ sawDone: false, sawProgress: false }),
      timeoutText: 'first event timeout',
      timeoutMs: 15_000,
      watchdogTripped: true,
    });
    expect(result.lastError).toBe('first event timeout');
    expect(result.failureCode).toBe('stream_timeout');
    expect(result.failureDetail).toEqual({ timeoutMs: 15_000 });
  });

  test('consumeStepPassEvent preserves first non-exit failureCode over trailing runtime_exited', async () => {
    const state = newStepPassState();
    const ctx = {
      stepId: 's1',
      client: {} as MachineApi,
      logger: { step: () => {} } as unknown as DaemonLogger,
      modelKey: 'antigravity/gemini-4-hydrogen',
      provider: null,
      handle: { stop: async () => {} } as unknown as AgentSessionHandle,
      promptImages: undefined,
      retryStormMax: 3,
      now: () => 1,
      watchdog: {} as StreamWatchdog,
      activity: {} as ActivityTracker,
      stream: { segments: {} } as unknown as StepTranscriptStream,
      transcript: {} as TranscriptBuffer,
      agentTodo: {} as AgentTodoReporter,
      toolStartedAt: new Map(),
    };
    await consumeStepPassEvent(
      {
        type: 'error',
        error: {
          message: 'OAuth revoked',
          retryable: false,
          failureCode: 'auth',
          failureDetail: { runtime: 'antigravity' },
        },
      },
      ctx,
      state,
    );
    await consumeStepPassEvent(
      {
        type: 'error',
        error: {
          message: 'ACP exited (1)',
          retryable: false,
          processCrash: true,
          failureCode: 'runtime_exited',
          failureDetail: { runtime: 'antigravity', exitCode: 1 },
        },
      },
      ctx,
      state,
    );
    expect(state.failureCode).toBe('auth');
    expect(state.failureDetail).toEqual({ runtime: 'antigravity' });
  });

  test('consumeStepPassEvent keeps earlier unstructured error when trailing runtime_exited arrives', async () => {
    const state = newStepPassState();
    const ctx = {
      stepId: 's1',
      client: {} as MachineApi,
      logger: { step: () => {} } as unknown as DaemonLogger,
      modelKey: 'antigravity/gemini-4-hydrogen',
      provider: null,
      handle: { stop: async () => {} } as unknown as AgentSessionHandle,
      promptImages: undefined,
      retryStormMax: 3,
      now: () => 1,
      watchdog: {} as StreamWatchdog,
      activity: {} as ActivityTracker,
      stream: { segments: {} } as unknown as StepTranscriptStream,
      transcript: {} as TranscriptBuffer,
      agentTodo: {} as AgentTodoReporter,
      toolStartedAt: new Map(),
    };
    await consumeStepPassEvent(
      {
        type: 'error',
        error: { message: 'insufficient credits on account', retryable: false },
      },
      ctx,
      state,
    );
    await consumeStepPassEvent(
      {
        type: 'error',
        error: {
          message: 'ACP exited (1)',
          retryable: false,
          processCrash: true,
          failureCode: 'runtime_exited',
          failureDetail: { runtime: 'antigravity', exitCode: 1 },
        },
      },
      ctx,
      state,
    );
    expect(state.lastError).toBe('insufficient credits on account');
    expect(state.lastErrorWasProcessCrash).toBe(false);
    expect(state.failureCode).toBeNull();
    const settled = resolveStepPassOutcome({
      pass: state,
      timeoutText: null,
      watchdogTripped: false,
      stopRequest: null,
      provider: null,
      log: () => {},
    });
    expect(settled.quotaBlock?.kind).toBe('quota');
    expect(settled.failureCode).toBe('quota');
  });

  test('trailing runtime exit noise with quota text after a real model error does not trip quotaTrip or stop', async () => {
    const state = newStepPassState();
    let stopped = 0;
    const ctx: Parameters<typeof consumeStepPassEvent>[1] = {
      stepId: 's1',
      client: {} as MachineApi,
      logger: { step: () => {} } as unknown as DaemonLogger,
      modelKey: 'antigravity/gemini-4-hydrogen',
      provider: null,
      handle: {
        stop: async () => {
          stopped += 1;
        },
      } as unknown as AgentSessionHandle,
      promptImages: undefined,
      retryStormMax: 3,
      now: () => 1,
      watchdog: {} as StreamWatchdog,
      activity: {} as ActivityTracker,
      stream: { segments: {} } as unknown as StepTranscriptStream,
      transcript: {} as TranscriptBuffer,
      agentTodo: {} as AgentTodoReporter,
      toolStartedAt: new Map(),
    };
    await consumeStepPassEvent(
      {
        type: 'error',
        error: {
          message: 'Model unavailable',
          retryable: false,
          failureCode: 'model_unavailable',
        },
      },
      ctx,
      state,
    );
    expect(stopped).toBe(1);
    await consumeStepPassEvent(
      {
        type: 'error',
        error: {
          message: 'ACP exited (1): 402 insufficient credits in stderr noise',
          retryable: false,
          processCrash: true,
          failureCode: 'runtime_exited',
          failureDetail: { runtime: 'antigravity', exitCode: 1 },
        },
      },
      ctx,
      state,
    );
    expect(state.quotaTrip).toBeNull();
    expect(stopped).toBe(1);
    expect(state.failureCode).toBe('model_unavailable');
  });
});

describe('rewindAfterStep', () => {
  function rewind(overrides: Partial<StepRewindInput>, restore?: () => Promise<void>) {
    const root = testTempDir('step-pass-outcome');
    const restored: string[] = [];
    const workspace = {
      restoreCheckpoint: async (_cwd: string, commit: string) => {
        restored.push(commit);
        await restore?.();
      },
    } as unknown as WorktreeOps;
    const transcript = new TranscriptBuffer(join(root, 'outbox'), 's1');
    const log: string[] = [];
    const input: StepRewindInput = {
      workspace,
      ws: { cwd: root } as PreparedWorkspace,
      headAtStart: 'abc123',
      attachmentVerify: false,
      stopped: false,
      stopRequest: null,
      reviewCheckout: false,
      stepId: 's1',
      transcript,
      now: () => 1,
      log: (line) => log.push(line),
      ...overrides,
    };
    return { input, restored, transcript, log };
  }

  test('a discarding stop rewinds to the step start', async () => {
    const h = rewind({ stopped: true, stopRequest: { discard: true } });
    await rewindAfterStep(h.input);
    expect(h.restored).toEqual(['abc123']);
    expect(h.log).toEqual(['step stopped by user (discard=true)']);
  });

  test('a keeping stop leaves the workspace', async () => {
    const h = rewind({ stopped: true, stopRequest: { discard: false } });
    await rewindAfterStep(h.input);
    expect(h.restored).toEqual([]);
  });

  test('a failed review rewind leaves a transcript note', async () => {
    const h = rewind({ reviewCheckout: true }, async () => {
      throw new Error('locked index');
    });
    await rewindAfterStep(h.input);
    expect(h.log).toEqual(['review rewind failed: locked index']);
    expect(h.transcript.messages().map((m) => m.id)).toEqual(['review-rewind-s1']);
  });

  test('an attachment verify step never rewinds', async () => {
    const h = rewind({ reviewCheckout: true, attachmentVerify: true });
    await rewindAfterStep(h.input);
    expect(h.restored).toEqual([]);
  });
});
