import { describe, expect, test } from 'vitest';
import type { HarnessEvalDispatchRequest } from '../src/services/harness-eval-coordinator.js';
import {
  createProductionHarnessEvalDispatch,
  type HarnessEvalWorkerLaunch,
  productionHarnessEvalConfig,
} from '../src/services/harness-eval-production.js';

describe('production harness eval dispatch (#1979)', () => {
  test('launch receives ticket, expectedHead, and digest — empty async is not enough', async () => {
    const launched: Parameters<HarnessEvalWorkerLaunch>[0][] = [];
    const dispatch = createProductionHarnessEvalDispatch(async (input) => {
      launched.push(input);
    });
    const request: HarnessEvalDispatchRequest = {
      repo: 'xiechimon/cairn',
      pr: 1979,
      patchDigest: `pd2:${'a'.repeat(64)}`,
      workerId: 'w1',
      attemptId: 'a1',
      ticket: '1979',
      expectedHead: 'b'.repeat(40),
    };
    await dispatch(request);
    expect(launched).toEqual([
      {
        repo: 'xiechimon/cairn',
        pr: 1979,
        ticket: '1979',
        expectedHead: 'b'.repeat(40),
        patchDigest: request.patchDigest,
        workerId: 'w1',
        attemptId: 'a1',
      },
    ]);
  });

  test('refuses to launch when ticket or expectedHead is missing', async () => {
    const launched: unknown[] = [];
    const dispatch = createProductionHarnessEvalDispatch(async (input) => {
      launched.push(input);
    });
    await expect(
      dispatch({
        repo: 'xiechimon/cairn',
        pr: 1979,
        patchDigest: `pd2:${'a'.repeat(64)}`,
        workerId: 'w1',
        attemptId: 'a1',
      }),
    ).rejects.toThrow(/ticket|expectedHead/i);
    expect(launched).toEqual([]);
  });

  test('productionHarnessEvalConfig defaults to a launching dispatcher', async () => {
    const cfg = productionHarnessEvalConfig();
    expect(cfg.dispatchAuthorized).toBe(true);
    expect(typeof cfg.dispatch).toBe('function');
    await expect(
      cfg.dispatch({
        repo: 'xiechimon/cairn',
        pr: 1979,
        patchDigest: `pd2:${'a'.repeat(64)}`,
        workerId: 'w1',
        attemptId: 'a1',
      }),
    ).rejects.toThrow(/ticket|expectedHead/i);
  });
});
