import { describe, expect, test } from 'vitest';
import { planStepPassRetry, type StepPassRetryInput } from '../src/step-pass-retry.js';

const NETWORK = 'dial tcp 203.0.113.7:8783: connection refused';
const MODEL_GONE = '404: /v1/messages not found';
const BAD_SCHEMA = 'invalid tool schema in request';

function plan(
  state: Partial<StepPassRetryInput['state']>,
  overrides: Partial<Omit<StepPassRetryInput, 'state'>> = {},
) {
  return planStepPassRetry({
    pass: 0,
    state: {
      lastError: null,
      lastModelError: null,
      sawProgress: false,
      quotaTrip: null,
      retryStorm: false,
      ...state,
    },
    watchdogTripped: false,
    stopPending: false,
    networkRetries: 0,
    networkRetryDelays: [2_000, 4_000],
    ...overrides,
  });
}

describe('planStepPassRetry', () => {
  test('a clean pass finishes', () => {
    expect(plan({ sawProgress: true })).toEqual({ kind: 'finish' });
  });

  test('a network error retries with the next delay', () => {
    expect(plan({ lastError: NETWORK }, { networkRetries: 1 })).toEqual({
      kind: 'network',
      delayMs: 4_000,
    });
  });

  test('a network error past the last delay falls through to the image retry', () => {
    expect(plan({ lastError: NETWORK, sawProgress: true }, { networkRetries: 2 })).toEqual({
      kind: 'images',
      failureText: NETWORK,
    });
  });

  test('a pending stop never retries the network', () => {
    expect(plan({ lastError: NETWORK }, { stopPending: true }).kind).not.toBe('network');
  });

  test('a network model error without a stream error does not retry the network', () => {
    expect(plan({ lastModelError: NETWORK, sawProgress: true }).kind).toBe('images');
  });

  test('an unavailable model finishes', () => {
    expect(plan({ lastError: MODEL_GONE })).toEqual({ kind: 'finish' });
  });

  test('a first pass error without progress tries the compat fallback', () => {
    expect(plan({ lastError: BAD_SCHEMA })).toEqual({ kind: 'compat', failureText: BAD_SCHEMA });
  });

  test('a model error alone needs a watchdog trip or retry storm for the compat fallback', () => {
    expect(plan({ lastModelError: BAD_SCHEMA }).kind).toBe('images');
    expect(plan({ lastModelError: BAD_SCHEMA }, { watchdogTripped: true }).kind).toBe('compat');
    expect(plan({ lastModelError: BAD_SCHEMA, retryStorm: true }).kind).toBe('compat');
  });

  test('a later pass or a progressed pass skips the compat fallback', () => {
    expect(plan({ lastError: BAD_SCHEMA }, { pass: 1 }).kind).toBe('images');
    expect(plan({ lastError: BAD_SCHEMA, sawProgress: true }).kind).toBe('images');
  });
});
