import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/lib/github.js';
import { AnonReadBudget } from '../src/services/ci-anon-budget.js';
import {
  CI_MISSING_COMPARE_RECHECK_MS,
  MergedCompareCache,
  mergedCheckpointHint,
} from '../src/services/ci-merged-compare.js';

const CP = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const target = { owner: 'o', repo: 'r' };

function scripted(responses: Array<{ status: number; body?: unknown }>): {
  fetch: FetchLike;
  calls: () => number;
} {
  let n = 0;
  const fetch = (async () => {
    const r = responses[Math.min(n, responses.length - 1)] ?? { status: 500 };
    n += 1;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
    });
  }) as unknown as FetchLike;
  return { fetch, calls: () => n };
}

describe('MergedCompareCache', () => {
  it('reads once and serves a settled status from the cache', async () => {
    const gh = scripted([{ status: 200, body: { status: 'ahead' } }]);
    const cache = new MergedCompareCache(gh.fetch, new AnonReadBudget(10, 10));
    expect(await cache.read('o/r#1', target, 't', CP, HEAD, 0)).toEqual({
      status: 'ahead',
      failures: 0,
    });
    expect(
      await cache.read('o/r#1', target, 't', CP, HEAD, 10 * CI_MISSING_COMPARE_RECHECK_MS),
    ).toEqual({ status: 'ahead', failures: 0 });
    expect(gh.calls()).toBe(1);
  });

  it('counts unreadable reads and rechecks them only after the recheck window', async () => {
    const gh = scripted([{ status: 500 }]);
    const cache = new MergedCompareCache(gh.fetch, new AnonReadBudget(10, 10));
    expect(await cache.read('k', target, 't', CP, HEAD, 0)).toEqual({
      status: 'unreadable',
      failures: 1,
    });
    expect(await cache.read('k', target, 't', CP, HEAD, 1)).toEqual({
      status: 'unreadable',
      failures: 1,
    });
    expect(await cache.read('k', target, 't', CP, HEAD, CI_MISSING_COMPARE_RECHECK_MS)).toEqual({
      status: 'unreadable',
      failures: 2,
    });
    expect(gh.calls()).toBe(2);
  });

  it('skips an anonymous read when the budget is spent, and forgets dropped keys', async () => {
    const gh = scripted([{ status: 404 }]);
    const cache = new MergedCompareCache(gh.fetch, new AnonReadBudget(1, 1));
    expect(await cache.read('k', target, null, CP, HEAD, 0)).toEqual({
      status: 'missing',
      failures: 0,
    });
    cache.retain(new Set());
    expect(await cache.read('k', target, null, CP, HEAD, 1)).toBe('skipped');
    expect(gh.calls()).toBe(1);
  });

  it('names the short shas in the hint for each status', () => {
    expect(mergedCheckpointHint(7, 'missing', CP, HEAD)).toContain('aaaaaaa');
    expect(mergedCheckpointHint(7, 'diverged', CP, HEAD)).toContain('bbbbbbb');
    expect(mergedCheckpointHint(7, 'invalid', CP, HEAD)).toContain('PR #7');
  });
});
