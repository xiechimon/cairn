import { describe, expect, test } from 'vitest';
import { readRequiredChecksAt } from '../src/services/merge-gate/github-facts.js';
import type { GateRaw } from '../src/services/merge-gate/github-port.js';
import { type GateAnswers, githubFake } from './fakes/github.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OTHER = '9'.repeat(40);
const APP = 15368;

const ok = (body: unknown, etag: string | null = null): GateRaw => ({
  kind: 'ok',
  status: 200,
  etag,
  link: null,
  body,
});
const fail = (failure: Extract<GateRaw, { kind: 'failed' }>['failure']): GateRaw => ({
  kind: 'failed',
  failure,
});
const NOT_FOUND = fail({ kind: 'status', status: 404, message: 'Not Found' });

function branchBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'main',
    commit: { sha: BASE },
    protected: true,
    protection: {
      enabled: true,
      required_status_checks: {
        enforcement_level: 'non_admins',
        contexts: ['check', 'pr-evidence'],
        checks: [
          { context: 'check', app_id: APP },
          { context: 'pr-evidence', app_id: APP },
        ],
      },
    },
    ...over,
  };
}

const run = (name: string, over: Record<string, unknown> = {}) => ({
  id: 100,
  name,
  head_sha: HEAD,
  status: 'completed',
  conclusion: 'success',
  app: { id: APP, slug: 'github-actions' },
  ...over,
});
const status = (context: string, state: string, over: Record<string, unknown> = {}) => ({
  context,
  state,
  description: `${context} ${state}`,
  updated_at: '2026-10-22T10:00:00Z',
  ...over,
});

const slice = <T>(list: T[], o: { page: number; perPage: number }) =>
  list.slice((o.page - 1) * o.perPage, o.page * o.perPage);

const runPages =
  (runs: unknown[], total = runs.length) =>
  (_s: string, o: { page: number; perPage: number }): GateRaw =>
    ok({ total_count: total, check_runs: slice(runs, o) });
const statusPages =
  (statuses: unknown[], sha = HEAD, total = statuses.length) =>
  (_s: string, o: { page: number; perPage: number }): GateRaw =>
    ok({ sha, state: 'pending', total_count: total, statuses: slice(statuses, o) });

const defaults: GateAnswers = {
  branch: () => ok(branchBody()),
  rules: () => ok([]),
  checkRuns: runPages([run('check', { id: 1 }), run('pr-evidence', { id: 2 })]),
  combinedStatus: statusPages([]),
};

async function read(over: Partial<GateAnswers> = {}) {
  const g = githubFake('xiechimon/cairn', { gate: { ...defaults, ...over } });
  const checks = await readRequiredChecksAt(g.port, 'main', HEAD);
  return { checks, log: g.log };
}

describe('required check discovery', () => {
  test('F11 the required list: branch protection plus rulesets, null when either cannot be read', async () => {
    const required = async (over: Partial<GateAnswers>) => (await read(over)).checks?.required;
    expect(await required({})).toEqual(['check', 'pr-evidence']);
    expect(await required({ branch: () => NOT_FOUND })).toBeNull();
    expect(
      await required({ branch: () => ok(branchBody({ protected: false, protection: undefined })) }),
    ).toEqual([]);
    expect(await required({ branch: () => ok(branchBody({ protection: undefined })) })).toBeNull();
    expect(await required({ branch: () => ok(branchBody({ protected: 'yes' })) })).toBeNull();
    expect(
      await required({ branch: () => ok(branchBody({ protection: { enabled: true } })) }),
    ).toEqual([]);
    expect(
      await required({
        branch: () =>
          ok(
            branchBody({
              protection: {
                required_status_checks: { enforcement_level: 'off', contexts: ['ci'] },
              },
            }),
          ),
      }),
    ).toEqual([]);
    expect(
      await required({
        branch: () =>
          ok(
            branchBody({
              protection: {
                required_status_checks: { enforcement_level: 'everyone', contexts: ['ci'] },
              },
            }),
          ),
      }),
    ).toEqual(['ci']);
    expect(
      await required({
        branch: () =>
          ok(branchBody({ protection: { required_status_checks: { contexts: ['ci'] } } })),
      }),
    ).toEqual(['ci']);
    expect(
      await required({
        branch: () =>
          ok(branchBody({ protection: { required_status_checks: { checks: [{ context: 7 }] } } })),
      }),
    ).toBeNull();
    const rules = [
      { type: 'deletion' },
      { type: 'pull_request', parameters: { required_approving_review_count: 1 } },
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'check' }, { context: 'lint', integration_id: APP }],
        },
      },
    ];
    expect(await required({ rules: () => ok(rules) })).toEqual(['check', 'pr-evidence', 'lint']);
    for (const bad of [
      [null],
      [{ parameters: {} }],
      [{ type: 'required_status_checks' }],
      [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: '' }] },
        },
      ],
      [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'x', integration_id: 'a' }] },
        },
      ],
      { not: 'a list' },
    ]) {
      expect(await required({ rules: () => ok(bad) }), JSON.stringify(bad)).toBeNull();
    }
    expect(await required({ rules: () => NOT_FOUND })).toEqual(['check', 'pr-evidence']);
    expect(
      await required({ rules: () => fail({ kind: 'status', status: 500, message: null }) }),
    ).toBeNull();
    const full = Array.from({ length: 100 }, () => ({ type: 'deletion' }));
    const two = await read({ rules: (_n, o) => ok(o.page === 1 ? full : [rules[2]]) });
    expect(two.checks?.required).toEqual(['check', 'pr-evidence', 'lint']);
    expect(two.log.filter(([n]) => n === 'rules')).toHaveLength(2);
    const many = await read({ rules: (_n, o) => ok(o.page <= 6 ? full : [rules[2]]) });
    expect(many.checks?.required).toEqual(['check', 'pr-evidence', 'lint']);
    expect(many.log.filter(([n]) => n === 'rules')).toHaveLength(7);
  });
});

describe('required checks at the head (F12 to F15)', () => {
  test('F12 runs and the combined status by the head SHA; their SHAs come from the responses', async () => {
    const f = await read({
      checkRuns: runPages([run('check', { id: 1, head_sha: OTHER })]),
      combinedStatus: statusPages([], OTHER),
    });
    expect(f.log.filter(([n]) => n === 'checkRuns' || n === 'combinedStatus')).toEqual([
      ['checkRuns', HEAD, { filter: 'latest', page: 1, perPage: 100, etag: null }],
      ['combinedStatus', HEAD, { page: 1, perPage: 100, etag: null }],
    ]);
    expect(f.checks?.headSha).toBe(HEAD);
    expect(f.checks?.runs[0]?.headSha).toBe(OTHER);
    expect(f.checks?.statusSha).toBe(OTHER);
  });

  test('F13 paging runs and statuses; complete only when every page agrees and the count is reached', async () => {
    const runs = Array.from({ length: 150 }, (_, k) => run(`job ${k}`, { id: k + 1 }));
    const statuses = Array.from({ length: 150 }, (_, k) => status(`ctx/${k}`, 'success'));
    const f = await read({ checkRuns: runPages(runs), combinedStatus: statusPages(statuses) });
    expect(f.checks?.runs).toHaveLength(150);
    expect(f.checks?.statuses).toHaveLength(150);
    expect(f.checks?.complete).toBe(true);
    expect(f.log.filter(([n]) => n === 'checkRuns')).toHaveLength(2);
    expect(f.log.filter(([n]) => n === 'combinedStatus')).toHaveLength(2);
    expect((await read({ checkRuns: runPages(runs.slice(0, 100), 150) })).checks?.complete).toBe(
      false,
    );
    expect(
      (await read({ combinedStatus: statusPages(statuses.slice(0, 100), HEAD, 150) })).checks
        ?.complete,
    ).toBe(false);
    const drift = (_s: string, o: { page: number; perPage: number }) =>
      ok({ total_count: o.page === 1 ? 150 : 151, check_runs: slice(runs, o) });
    expect((await read({ checkRuns: drift })).checks?.complete).toBe(false);
    const lots = Array.from({ length: 1200 }, (_, k) => run(`job ${k}`, { id: k + 1 }));
    const capped = await read({ checkRuns: runPages(lots) });
    expect(capped.checks?.complete).toBe(false);
    expect(capped.log.filter(([n]) => n === 'checkRuns')).toHaveLength(10);
    const lotsS = Array.from({ length: 600 }, (_, k) => status(`ctx/${k}`, 'success'));
    const cappedS = await read({ combinedStatus: statusPages(lotsS) });
    expect(cappedS.checks?.complete).toBe(false);
    expect(cappedS.log.filter(([n]) => n === 'combinedStatus')).toHaveLength(5);
    const shaDrift = (_s: string, o: { page: number; perPage: number }) =>
      ok({
        sha: o.page === 1 ? HEAD : OTHER,
        state: 'pending',
        total_count: 150,
        statuses: slice(statuses, o),
      });
    expect((await read({ combinedStatus: shaDrift })).checks).toBeNull();
  });

  test('F14 runs deduped per (app, name), newest id kept; a required check bound to an app is listed first', async () => {
    const f = await read({
      checkRuns: runPages([
        run('pr-evidence', { id: 9, conclusion: 'success' }),
        run('pr-evidence', { id: 5, conclusion: 'failure' }),
        run('check', { id: 3, app: { id: 1, slug: 'other' }, conclusion: 'success' }),
        run('check', { id: 4, conclusion: 'failure' }),
        run('lint', { id: 6, app: null }),
        run('lint', { id: 7, app: null, conclusion: 'failure' }),
      ]),
    });
    expect(f.checks?.runs.map((r) => [r.name, r.conclusion])).toEqual([
      ['pr-evidence', 'success'],
      ['check', 'failure'],
      ['check', 'success'],
      ['lint', 'failure'],
    ]);
    const g = await read({
      checkRuns: runPages([
        run('pr-evidence', { id: 5, conclusion: 'failure' }),
        run('pr-evidence', { id: 9 }),
      ]),
    });
    expect(g.checks?.runs.map((r) => r.conclusion)).toEqual(['success']);
    const h = await read({
      rules: () =>
        ok([
          {
            type: 'required_status_checks',
            parameters: { required_status_checks: [{ context: 'lint', integration_id: 2 }] },
          },
        ]),
      checkRuns: runPages([
        run('lint', { id: 1, app: { id: 1 } }),
        run('lint', { id: 2, app: { id: 2 }, conclusion: 'failure' }),
      ]),
    });
    expect(h.checks?.runs.map((r) => r.conclusion)).toEqual(['failure', 'success']);
  });

  test('F15 malformed entries and case-insensitive status contexts', async () => {
    for (const bad of [
      run('x', { head_sha: undefined }),
      run('x', { id: 'one' }),
      run('x', { name: 7 }),
      run('x', { status: null }),
      run('x', { conclusion: 7 }),
      run('x', { app: { id: 'a' } }),
      null,
    ]) {
      const f = await read({ checkRuns: runPages([bad]) });
      expect(f.checks, JSON.stringify(bad)).toBeNull();
    }
    expect((await read({ checkRuns: () => ok({ check_runs: [] }) })).checks).toBeNull();
    for (const bad of [
      status('x', 'success', { updated_at: undefined }),
      status('x', 'success', { updated_at: 'yesterday' }),
      status('x', 7 as unknown as string),
      { state: 'success', updated_at: '2026-10-22T10:00:00Z' },
    ]) {
      const f = await read({ combinedStatus: statusPages([bad]) });
      expect(f.checks, JSON.stringify(bad)).toBeNull();
    }
    const f = await read({
      combinedStatus: statusPages([
        status('CI/Build', 'failure', { updated_at: '2026-10-22T09:00:00Z' }),
        status('ci/build', 'success', { updated_at: '2026-10-22T10:00:00Z' }),
        status('tie', 'success'),
        status('TIE', 'pending'),
        status('Cairn/Merge-Gate', 'pending', { description: 'waiting' }),
      ]),
    });
    expect(f.checks?.statuses).toEqual([
      { context: 'ci/build', state: 'success' },
      { context: 'TIE', state: 'pending' },
      { context: 'Cairn/Merge-Gate', state: 'pending' },
    ]);
    const partial = await read({ combinedStatus: statusPages([status('ci', 'success')], HEAD, 2) });
    expect(partial.checks?.complete).toBe(false);
    const unreadable = await read({ combinedStatus: () => NOT_FOUND });
    expect(unreadable.checks).toBeNull();
  });
});

test('stops further reads after a rate limit and fails closed on a thrown request', async () => {
  const limited = await read({
    rules: () => fail({ kind: 'rate-limited', status: 403, resetAt: null, retryAfterSeconds: 60 }),
  });
  expect(limited.checks).toBeNull();
  expect(limited.log.map(([name]) => name)).toEqual(['branch', 'rules']);
  const thrown = await read({
    checkRuns: () => {
      throw new Error('transport failed');
    },
  });
  expect(thrown.checks).toBeNull();
});
