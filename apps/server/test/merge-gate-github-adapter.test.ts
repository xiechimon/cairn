import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { FetchLike } from '../src/lib/github.js';
import { readRequiredChecksAt } from '../src/services/merge-gate/github-facts.js';
import { githubGateReadPort } from '../src/services/merge-gate-github.js';

const TOKEN = 'gho_adapterTestToken0123';
const API = 'https://api.github.com/repos/Some-Org/some.repo';
const SHA = 'c'.repeat(40);

type Init = NonNullable<Parameters<FetchLike>[1]>;

function stub(
  answer: (url: string) => { status: number; body: unknown; headers?: Record<string, string> },
) {
  const calls: Array<{ url: string; init: Init; at: number }> = [];
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {}, at: Date.now() });
    const a = answer(url);
    const text = JSON.stringify(a.body);
    const headers = new Map(Object.entries(a.headers ?? {}));
    return {
      ok: a.status >= 200 && a.status < 300,
      status: a.status,
      headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    };
  };
  return { fetch, calls };
}

describe('githubGateReadPort (A1)', () => {
  test('each method sends the S4a request for the bound repository, token and the gate parameters', async () => {
    const { fetch, calls } = stub(() => ({ status: 200, body: {} }));
    const p = githubGateReadPort(fetch, TOKEN, 'Some-Org', 'some.repo', 4_321);
    await p.branch('release/1.0', { etag: null });
    await p.branchRules('main', { page: 3, perPage: 50, etag: '"e2"' });
    await p.checkRuns(SHA, { filter: 'latest', page: 4, perPage: 100, etag: null });
    await p.combinedStatus(SHA, { page: 5, perPage: 100, etag: '"e3"' });
    expect(
      calls.map((c) => [c.init.method, c.url, c.init.headers?.['if-none-match'] ?? null]),
    ).toEqual([
      ['GET', `${API}/branches/release/1.0`, null],
      ['GET', `${API}/rules/branches/main?per_page=50&page=3`, '"e2"'],
      ['GET', `${API}/commits/${SHA}/check-runs?filter=latest&per_page=100&page=4`, null],
      ['GET', `${API}/commits/${SHA}/status?per_page=100&page=5`, '"e3"'],
    ]);
    for (const c of calls) expect(c.init.headers?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  test('the bound timeout is the one applied', async () => {
    const hang: FetchLike = (_u, init) =>
      new Promise((_res, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const p = githubGateReadPort(hang, TOKEN, 'Some-Org', 'some.repo', 20);
    const t0 = Date.now();
    expect(await p.branch('main', { etag: null })).toEqual({
      kind: 'failed',
      failure: { kind: 'timeout' },
    });
    expect(await p.combinedStatus(SHA, { page: 1, perPage: 100, etag: null })).toEqual({
      kind: 'failed',
      failure: { kind: 'timeout' },
    });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});

describe('githubGateReadPort end to end over the live captures (A2)', () => {
  const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/github', name), 'utf8'));
  const PR_HEAD = '39a108e80bcd5d82e980599abf32d059b2fbad8c';

  test('reads main branch protection, rules, check runs and statuses at the specified head', async () => {
    const branch = fixture('gate-branch-main.json') as { commit: { sha: string } };
    const { fetch, calls } = stub((url) => {
      const path = url.replace('https://api.github.com/repos/xiechimon/pacman/', '');
      if (path === 'branches/main') return { status: 200, body: branch };
      if (path.startsWith('rules/branches/main'))
        return { status: 200, body: fixture('gate-rules-main.json') };
      if (path.startsWith(`commits/${PR_HEAD}/check-runs`))
        return { status: 200, body: fixture('gate-check-runs-39a108e.json') };
      if (path.startsWith(`commits/${PR_HEAD}/status`))
        return { status: 200, body: fixture('gate-status-39a108e.json') };
      return { status: 404, body: fixture('gate-pull-not-found.json') };
    });
    const port = githubGateReadPort(fetch, TOKEN, 'xiechimon', 'pacman', 10_000);
    const checks = await readRequiredChecksAt(port, 'main', PR_HEAD);
    expect(checks?.required).toEqual(['check', 'pack-smoke', 'e2e-gate', 'pr-evidence']);
    expect(checks?.runs).toHaveLength(13);
    expect(checks?.statusSha).toBe(PR_HEAD);
    expect(checks?.complete).toBe(true);
    expect(
      calls.map((c) => c.url.replace('https://api.github.com/repos/xiechimon/pacman/', '')),
    ).toEqual([
      'branches/main',
      'rules/branches/main?per_page=100&page=1',
      `commits/${PR_HEAD}/check-runs?filter=latest&per_page=100&page=1`,
      `commits/${PR_HEAD}/status?per_page=100&page=1`,
    ]);
  });
});
