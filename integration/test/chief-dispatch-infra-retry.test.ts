import { describe, expect, test } from 'vitest';
import { MAX_INFRA_RETRIES } from '../eval/adoption/judge.mts';
import { isHarnessInfraError, retryHarnessInfra } from '../eval/chief-dispatch/infra-retry.mts';

function harnessError(message: string): Error & { failure_class: string } {
  const error = new Error(message) as Error & { failure_class: string };
  error.failure_class = 'harness_error';
  return error;
}

describe('chief-dispatch infra retry', () => {
  test('a failed turn is retried until it scores, and no further', async () => {
    let calls = 0;
    const retry = { count: 0 };
    const value = await retryHarnessInfra(async () => {
      calls += 1;
      if (calls < 2) throw harnessError('step=failed');
      return 'scored';
    }, retry);
    expect(value).toBe('scored');
    expect(calls).toBe(2);
    expect(retry.count).toBe(1);
  });

  test('retries stop at MAX_INFRA_RETRIES and the last failure is kept', async () => {
    let calls = 0;
    const retry = { count: 0 };
    await expect(
      retryHarnessInfra(async () => {
        calls += 1;
        throw harnessError(`step=failed ${calls}`);
      }, retry),
    ).rejects.toThrow('step=failed 3');
    expect(calls).toBe(MAX_INFRA_RETRIES + 1);
    expect(retry.count).toBe(MAX_INFRA_RETRIES);
  });

  test('a non-infra failure is not retried', async () => {
    for (const failure_class of ['timeout', 'serving_substitution', undefined]) {
      let calls = 0;
      const retry = { count: 0 };
      await expect(
        retryHarnessInfra(async () => {
          calls += 1;
          const error = new Error('stop') as Error & { failure_class?: string };
          error.failure_class = failure_class;
          throw error;
        }, retry),
      ).rejects.toThrow('stop');
      expect(calls).toBe(1);
      expect(retry.count).toBe(0);
    }
  });

  test('only a harness_error is an infra turn failure', () => {
    expect(isHarnessInfraError(harnessError('step=failed'))).toBe(true);
    const other = new Error('stop') as Error & { failure_class?: string };
    other.failure_class = 'timeout';
    expect(isHarnessInfraError(other)).toBe(false);
    expect(isHarnessInfraError(new Error('plain'))).toBe(false);
    expect(isHarnessInfraError('step=failed')).toBe(false);
  });
});
