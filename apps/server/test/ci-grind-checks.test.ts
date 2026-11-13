import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/lib/github.js';
import { AnonReadBudget } from '../src/services/ci-anon-budget.js';
import { CI_REQUIRED_CHECKS_TTL_MS, GrindCheckReader } from '../src/services/ci-grind-checks.js';
import { CI_EMPTY_CHECKS_GRACE_MS } from '../src/services/ci-loop-rows.js';

const target = { owner: 'o', repo: 'r', fullName: 'o/r' };
const HEAD = 'a'.repeat(40);

interface Script {
  required: string[];
  runs: Array<{ name: string; status: string; conclusion: string | null }>;
  calls: string[];
}

function github(script: Script): FetchLike {
  return (async (url: string) => {
    script.calls.push(url);
    if (url.includes('/rules/branches/')) return Response.json([]);
    if (url.includes('/branches/')) {
      return Response.json({
        protection: { required_status_checks: { contexts: script.required } },
      });
    }
    if (url.includes('/check-runs')) return Response.json({ check_runs: script.runs });
    return new Response(null, { status: 404 });
  }) as unknown as FetchLike;
}

function reader(script: Script): GrindCheckReader {
  return new GrindCheckReader(github(script), new AnonReadBudget(100, 100));
}

describe('GrindCheckReader', () => {
  it('settles green when every required check succeeded', async () => {
    const script: Script = {
      required: ['ci'],
      runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
      calls: [],
    };
    expect(await reader(script).read(target, 'k', 'main', HEAD, 't', 0)).toEqual({
      kind: 'settled',
      verdict: { state: 'green' },
    });
  });

  it('waits on a missing required check, then blocks it after the grace window', async () => {
    const script: Script = { required: ['ci'], runs: [], calls: [] };
    const checks = reader(script);
    expect(await checks.read(target, 'k', 'main', HEAD, 't', 0)).toEqual({ kind: 'pending' });
    expect(await checks.read(target, 'k', 'main', HEAD, 't', CI_EMPTY_CHECKS_GRACE_MS + 1)).toEqual(
      {
        kind: 'settled',
        verdict: { state: 'blocked', checks: [{ name: 'ci', conclusion: 'missing' }] },
      },
    );
  });

  it('settles empty only after the grace window when nothing is required or reported', async () => {
    const script: Script = { required: [], runs: [], calls: [] };
    const checks = reader(script);
    expect(await checks.read(target, 'k', 'main', HEAD, 't', 0)).toEqual({ kind: 'pending' });
    expect(await checks.read(target, 'k', 'main', HEAD, 't', CI_EMPTY_CHECKS_GRACE_MS + 1)).toEqual(
      { kind: 'settled', verdict: { state: 'empty' } },
    );
  });

  it('reads required checks once per ttl and drops them on retain after it', async () => {
    const script: Script = {
      required: ['ci'],
      runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
      calls: [],
    };
    const checks = reader(script);
    const branchReads = () => script.calls.filter((u) => u.includes('/branches/main')).length;
    await checks.read(target, 'k', 'main', HEAD, 't', 0);
    await checks.read(target, 'k', 'main', HEAD, 't', 1);
    expect(branchReads()).toBe(2);
    checks.retain(new Set(['k']), CI_REQUIRED_CHECKS_TTL_MS);
    await checks.read(target, 'k', 'main', HEAD, 't', CI_REQUIRED_CHECKS_TTL_MS);
    expect(branchReads()).toBe(4);
  });

  it('is unreadable when the required checks cannot be read', async () => {
    const fetch = (async () => new Response(null, { status: 500 })) as unknown as FetchLike;
    const checks = new GrindCheckReader(fetch, new AnonReadBudget(100, 100));
    expect(await checks.read(target, 'k', 'main', HEAD, 't', 0)).toEqual({ kind: 'unreadable' });
  });
});
