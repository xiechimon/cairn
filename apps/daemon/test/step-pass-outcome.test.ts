import { join } from 'node:path';
import type { PreparedWorkspace, WorktreeOps } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { TranscriptBuffer } from '../src/journal.js';
import {
  resolveStepPassOutcome,
  rewindAfterStep,
  SILENT_NO_OP_ROUND_ERROR,
  type StepPassOutcomeInput,
  type StepRewindInput,
} from '../src/step-pass-outcome.js';
import { testTempDir } from './test-temp-dir.js';

function pass(overrides: Partial<StepPassOutcomeInput['pass']> = {}): StepPassOutcomeInput['pass'] {
  return {
    lastError: null,
    lastModelError: null,
    lastErrorWasProcessCrash: false,
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
    expect(outcome({})).toEqual({ lastError: null, stopped: false, quotaBlock: null });
  });

  test('a stream timeout carries the model error as root cause', () => {
    const result = outcome({
      pass: pass({ sawDone: false, lastModelError: 'overloaded' }),
      timeoutText: 'stream timeout',
      watchdogTripped: true,
    });
    expect(result.lastError).toBe('stream timeout；根因: overloaded');
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
    expect(result).toEqual({ lastError: null, stopped: true, quotaBlock: null });
  });

  test('a quota failure becomes a quota block and the step error', () => {
    const result = outcome({
      pass: pass({ sawDone: false, lastModelError: 'insufficient quota for this key' }),
    });
    expect(result.quotaBlock?.kind).toBe('quota');
    expect(result.lastError).toBe(result.quotaBlock?.reason);
  });

  test('a silent round without progress or done fails as a no-op', () => {
    const log: string[] = [];
    const result = outcome({ pass: pass({ sawDone: false, sawProgress: false }) }, log);
    expect(result.lastError).toBe(SILENT_NO_OP_ROUND_ERROR);
    expect(log).toHaveLength(1);
  });

  test('a tripped watchdog never reports the silent no-op error', () => {
    const result = outcome({
      pass: pass({ sawDone: false, sawProgress: false }),
      timeoutText: 'first event timeout',
      watchdogTripped: true,
    });
    expect(result.lastError).toBe('first event timeout');
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
