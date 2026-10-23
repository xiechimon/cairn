// #1404 S4b: services/merge-gate-github.ts binds S4a's transport (lib/github.ts) into the gate's port.
// Failure mode B-44 (docs/verify/1404/s4b-failure-modes.txt): the adapter binds another owner, repo, token or
// timeout than given, or drops a parameter the gate passes (page, per_page, filter, etag). A1 checks each
// method's request; A2 runs the shell end to end over the live captures of S4a
// (apps/server/test/fixtures/github/gate-*.json), so a drift between the port type and the transport is a
// compile or test failure.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { FetchLike } from '../src/lib/github.js';
import { newGateReadCache, readGateGithubFacts } from '../src/services/merge-gate/github-facts.js';
import { githubGatePort } from '../src/services/merge-gate-github.js';

const TOKEN = 'gho_adapterTestToken0123';
const API = 'https://api.github.com/repos/Some-Org/some.repo';
const SHA = 'c'.repeat(40);
const SHA2 = 'd'.repeat(40);

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

describe('githubGatePort (A1)', () => {
  test('each method sends the S4a request for the bound repository, token and the gate parameters', async () => {
    const { fetch, calls } = stub(() => ({ status: 200, body: {} }));
    const p = githubGatePort(fetch, TOKEN, 'Some-Org', 'some.repo', 4_321);
    await p.pull(12, { etag: '"e1"' });
    await p.branch('release/1.0', { etag: null });
    await p.branchRules('main', { page: 3, perPage: 50, etag: '"e2"' });
    await p.compare(SHA, SHA2, { page: 2, perPage: 100 });
    await p.checkRuns(SHA, { filter: 'latest', page: 4, perPage: 100, etag: null });
    await p.combinedStatus(SHA, { page: 5, perPage: 100, etag: '"e3"' });
    await p.contents('docs/verify/1404', SHA);
    await p.createStatus(SHA, { state: 'pending', context: 'pacman/merge-gate', description: 'x' });
    expect(
      calls.map((c) => [c.init.method, c.url, c.init.headers?.['if-none-match'] ?? null]),
    ).toEqual([
      ['GET', `${API}/pulls/12`, '"e1"'],
      ['GET', `${API}/branches/release/1.0`, null],
      ['GET', `${API}/rules/branches/main?per_page=50&page=3`, '"e2"'],
      ['GET', `${API}/compare/${SHA}...${SHA2}?per_page=100&page=2`, null],
      ['GET', `${API}/commits/${SHA}/check-runs?filter=latest&per_page=100&page=4`, null],
      ['GET', `${API}/commits/${SHA}/status?per_page=100&page=5`, '"e3"'],
      ['GET', `${API}/contents/docs/verify/1404?ref=${SHA}`, null],
      ['POST', `${API}/statuses/${SHA}`, null],
    ]);
    for (const c of calls) expect(c.init.headers?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[7]?.init.body ?? 'null')).toEqual({
      state: 'pending',
      context: 'pacman/merge-gate',
      description: 'x',
    });
  });

  test('the bound timeout is the one applied', async () => {
    const hang: FetchLike = (_u, init) =>
      new Promise((_res, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const p = githubGatePort(hang, TOKEN, 'Some-Org', 'some.repo', 20);
    const t0 = Date.now();
    expect(await p.pull(1, { etag: null })).toEqual({
      kind: 'failed',
      failure: { kind: 'timeout' },
    });
    expect(await p.contents('docs', SHA)).toEqual({ kind: 'failed', failure: { kind: 'timeout' } });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});

describe('githubGatePort end to end over the live captures (A2)', () => {
  const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/github', name), 'utf8'));
  const PR_HEAD = '39a108e80bcd5d82e980599abf32d059b2fbad8c';

  test('readGateGithubFacts reads PR #1479, main, its rules, a paged compare, check runs and the combined status', async () => {
    const branch = fixture('gate-branch-main.json') as { commit: { sha: string } };
    const mainTip = branch.commit.sha;
    const { fetch, calls } = stub((url) => {
      const path = url.replace('https://api.github.com/repos/xiechimon/pacman/', '');
      if (path === 'pulls/1479') return { status: 200, body: fixture('gate-pull-1479.json') };
      if (path === 'branches/main') return { status: 200, body: branch };
      if (path.startsWith('rules/branches/main'))
        return { status: 200, body: fixture('gate-rules-main.json') };
      if (path === `compare/${mainTip}...${PR_HEAD}?per_page=100&page=1`)
        return { status: 200, body: fixture('gate-compare-1439-page1.json') };
      if (path === `compare/${mainTip}...${PR_HEAD}?per_page=100&page=2`)
        return { status: 200, body: fixture('gate-compare-1439-page2.json') };
      if (path.startsWith(`commits/${PR_HEAD}/check-runs`))
        return { status: 200, body: fixture('gate-check-runs-39a108e.json') };
      if (path.startsWith(`commits/${PR_HEAD}/status`))
        return { status: 200, body: fixture('gate-status-39a108e.json') };
      return { status: 404, body: fixture('gate-pull-not-found.json') };
    });
    const port = githubGatePort(fetch, TOKEN, 'xiechimon', 'pacman', 10_000);
    const f = await readGateGithubFacts(
      port,
      { owner: 'xiechimon', repo: 'pacman', prNumber: 1479, ticketRef: '1404', now: 0 },
      newGateReadCache(),
    );
    expect(f.pr).toMatchObject({ state: 'open', draft: false, headSha: PR_HEAD, baseRef: 'main' });
    expect(f.defaultBranch).toBe('main');
    expect(f.checks?.required).toEqual(['check', 'pack-smoke', 'e2e-gate', 'pr-evidence']);
    // 14 runs, pr-evidence twice from one app in two suites: 13 after the (app, name) dedupe.
    expect(f.checks?.runs).toHaveLength(13);
    expect(f.checks?.statusSha).toBe(PR_HEAD);
    expect(f.checks?.complete).toBe(true);
    expect(f.compare).toMatchObject({ headSha: PR_HEAD, totalCommits: 3 });
    expect((f.compare as { commits: unknown[] }).commits).toHaveLength(3);
    expect(f.ownStatus).toBeNull();
    expect(f.rateLimited).toBeNull();
    expect(
      calls.map((c) => c.url.replace('https://api.github.com/repos/xiechimon/pacman/', '')),
    ).toEqual([
      'pulls/1479',
      'branches/main',
      'rules/branches/main?per_page=100&page=1',
      `compare/${mainTip}...${PR_HEAD}?per_page=100&page=1`,
      `compare/${mainTip}...${PR_HEAD}?per_page=100&page=2`,
      `commits/${PR_HEAD}/check-runs?filter=latest&per_page=100&page=1`,
      `commits/${PR_HEAD}/status?per_page=100&page=1`,
    ]);
  });
});
