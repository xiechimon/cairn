import { type SearchResponse, searchResponseSchema } from '@cairn/shared';
import type Database from 'better-sqlite3';
import { describe, expect, test, vi } from 'vitest';
import { build, project, team, todo, tokenUsage, user } from '../src/db/schema.js';
import { bootServer, req, type TestServer } from './helpers.js';

const NOW = Date.now();
const DAY = 86_400_000;

type Phase = typeof todo.$inferInsert.phase;

let seq = 0;

function addProject(s: TestServer, name: string, teamId = s.team.id) {
  const id = `p-${name}-${teamId}`;
  s.db.insert(project).values({ id, teamId, name }).run();
  return id;
}

function addThread(
  s: TestServer,
  projectId: string,
  title: string,
  extra: Partial<typeof todo.$inferInsert> = {},
  teamId = s.team.id,
) {
  seq += 1;
  const id = `t-${seq}`;
  s.db
    .insert(todo)
    .values({
      id,
      teamId,
      projectId,
      title,
      phase: 'todo',
      phaseAt: NOW,
      seqNum: seq,
      ...extra,
    })
    .run();
  return id;
}

function addBuild(
  s: TestServer,
  todoId: string,
  opts: { pr?: number; costs?: (number | null)[] } = {},
) {
  seq += 1;
  const id = `b-${seq}`;
  s.db
    .insert(build)
    .values({
      id,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: NOW,
      prNumber: opts.pr ?? null,
    })
    .run();
  (opts.costs ?? []).forEach((cost, i) => {
    s.db
      .insert(tokenUsage)
      .values({ buildId: id, model: `m${i}`, costTotal: cost })
      .run();
  });
  return id;
}

async function run(s: TestServer, q: string): Promise<SearchResponse> {
  const res = await req(s.app, 'GET', `/api/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return searchResponseSchema.parse(await res.json());
}

const titles = (r: SearchResponse) => r.todos.map((t) => t.title);

function corpus() {
  const s = bootServer();
  const web = addProject(s, 'web');
  const api = addProject(s, 'api');
  const phases: Phase[] = [
    'todo',
    'queued',
    'planning',
    'confirm',
    'building',
    'needs_input',
    'review',
    'done',
    'failed',
    'closed',
  ];
  for (const phase of phases) addThread(s, web, `web ${phase}`, { phase });
  addThread(s, api, 'api failed', { phase: 'failed' });
  return { s, web, api };
}

describe('search filters: is:', () => {
  test('is:failed matches failed only', async () => {
    const { s } = corpus();
    expect(titles(await run(s, 'is:failed'))).toEqual(['web failed', 'api failed']);
  });

  test('is:waiting matches confirm, needs_input and review (the web needs-you phases)', async () => {
    const { s } = corpus();
    expect(titles(await run(s, 'is:waiting'))).toEqual([
      'web confirm',
      'web needs_input',
      'web review',
    ]);
  });

  test('is:review matches review only', async () => {
    const { s } = corpus();
    expect(titles(await run(s, 'is:review'))).toEqual(['web review']);
  });

  test('is:running matches queued, planning and building', async () => {
    const { s } = corpus();
    expect(titles(await run(s, 'is:running'))).toEqual([
      'web queued',
      'web planning',
      'web building',
    ]);
  });

  test('is:done matches done and closed', async () => {
    const { s } = corpus();
    expect(titles(await run(s, 'is:done'))).toEqual(['web done', 'web closed']);
  });

  test('is:snoozed matches threads with a snooze mode, in any phase', async () => {
    const { s, web } = corpus();
    addThread(s, web, 'napping', { phase: 'review', snoozeMode: 'until', snoozedUntil: NOW + DAY });
    expect(titles(await run(s, 'is:snoozed'))).toEqual(['napping']);
  });

  test('multiple positive is: filters are ORed', async () => {
    const { s } = corpus();
    expect(titles(await run(s, 'is:failed is:review'))).toEqual([
      'web review',
      'web failed',
      'api failed',
    ]);
  });

  test('negated filters are ANDed as exclusions', async () => {
    const { s } = corpus();
    const hit = await run(s, 'is:failed -project:api');
    expect(titles(hit)).toEqual(['web failed']);
    expect(titles(await run(s, '-is:failed -is:done -is:running'))).toEqual([
      'web todo',
      'web confirm',
      'web needs_input',
      'web review',
    ]);
  });
});

describe('search filters: project:', () => {
  test('normalizes Unicode project names consistently', async () => {
    const { s } = corpus();
    const unicode = addProject(s, 'Équipe');
    addThread(s, unicode, 'Unicode project');
    expect(titles(await run(s, 'project:Équipe'))).toEqual(['Unicode project']);
    expect(titles(await run(s, 'project:éQUIPE'))).toEqual(['Unicode project']);
  });

  test('matches the project name case-insensitively and exactly', async () => {
    const { s } = corpus();
    expect(titles(await run(s, 'project:API'))).toEqual(['api failed']);
    expect((await run(s, 'project:ap')).filters?.[0]).toMatchObject({
      valid: false,
      reason: 'unknown_project',
    });
  });

  test('quoted names with spaces work', async () => {
    const { s } = corpus();
    const spaced = addProject(s, 'my app');
    addThread(s, spaced, 'in spaced');
    expect(titles(await run(s, 'project:"my app"'))).toEqual(['in spaced']);
  });

  test('an unknown project is flagged invalid and matches no threads', async () => {
    const { s } = corpus();
    const hit = await run(s, 'project:nope');
    expect(hit.todos).toEqual([]);
    expect(hit.filters).toEqual([
      {
        key: 'project',
        raw: 'project:nope',
        value: 'nope',
        negated: false,
        valid: false,
        reason: 'unknown_project',
      },
    ]);
  });

  test('a negated unknown project is flagged but excludes nothing', async () => {
    const { s } = corpus();
    const hit = await run(s, '-project:nope is:failed');
    expect(titles(hit)).toEqual(['web failed', 'api failed']);
    expect(hit.filters?.[0]).toMatchObject({ valid: false, reason: 'unknown_project' });
  });
});

describe('search filters: pr:', () => {
  test('pr:<n> matches threads with any build that opened PR n', async () => {
    const { s, web } = corpus();
    const a = addThread(s, web, 'has pr 7');
    addBuild(s, a, { pr: 3 });
    addBuild(s, a, { pr: 7 });
    const b = addThread(s, web, 'has pr 8');
    addBuild(s, b, { pr: 8 });
    addThread(s, web, 'no pr');
    expect(titles(await run(s, 'pr:7'))).toEqual(['has pr 7']);
  });

  test('pr:any matches every thread with a PR; -pr:any matches the rest', async () => {
    const { s, web } = corpus();
    addBuild(s, addThread(s, web, 'with'), { pr: 1 });
    addBuild(s, addThread(s, web, 'build without pr'));
    expect(titles(await run(s, 'pr:any'))).toEqual(['with']);
    expect(titles(await run(s, '-pr:any project:web without'))).toEqual(['build without pr']);
  });

  test('pr:abc is invalid with reason bad_pr and matches nothing', async () => {
    const { s } = corpus();
    const hit = await run(s, 'pr:abc');
    expect(hit.todos).toEqual([]);
    expect(hit.filters?.[0]).toMatchObject({ valid: false, reason: 'bad_pr' });
  });
});

describe('search filters: after:', () => {
  test('relative and absolute cutoffs compare against the last phase change', async () => {
    const { s, web } = corpus();
    addThread(s, web, 'ancient', { phaseAt: NOW - 30 * DAY });
    addThread(s, web, 'last week', { phaseAt: NOW - 5 * DAY });
    addThread(s, web, 'an hour ago', { phaseAt: NOW - 3_600_000 });
    const old = await run(s, 'after:7d ancient');
    expect(titles(old)).toEqual([]);
    expect(titles(await run(s, 'after:7d last')).sort()).toEqual(['last week']);
    expect(titles(await run(s, 'after:24h hour'))).toEqual(['an hour ago']);
    expect(titles(await run(s, 'after:2020-01-01 ancient'))).toEqual(['ancient']);
    expect(titles(await run(s, '-after:7d ancient'))).toEqual(['ancient']);
  });

  test('a bad date is invalid with reason bad_date', async () => {
    const { s } = corpus();
    const hit = await run(s, 'after:2026-02-30');
    expect(hit.todos).toEqual([]);
    expect(hit.filters?.[0]).toMatchObject({ valid: false, reason: 'bad_date' });
  });
});

describe('search filters: cost:', () => {
  test('cost filtering does not rescan build history for each thread', async () => {
    const { s, web } = corpus();
    addBuild(s, addThread(s, web, 'paid'), { costs: [2] });
    const sqlite = (s.db as unknown as { $client: Database.Database }).$client;
    const spy = vi.spyOn(sqlite, 'prepare');
    expect(titles(await run(s, 'cost:>1'))).toEqual(['paid']);
    const statement = spy.mock.calls.find(([query]) => query.includes('token_usage'))?.[0];
    spy.mockRestore();
    expect(statement).toBeDefined();
    const plan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${statement}`)
      .all(...Array.from(statement?.matchAll(/\?/g) ?? [], () => null)) as { detail: string }[];
    expect(plan.some(({ detail }) => detail.includes('CORRELATED'))).toBe(false);
  });

  test('sums priced token usage across all builds of a thread, in dollars', async () => {
    const { s, web } = corpus();
    const big = addThread(s, web, 'big');
    addBuild(s, big, { costs: [3, 4] });
    addBuild(s, big, { costs: [2] });
    const small = addThread(s, web, 'small');
    addBuild(s, small, { costs: [0.5] });
    expect(titles(await run(s, 'cost:>8 project:web'))).toEqual(['big']);
    expect(titles(await run(s, 'cost:>9 project:web'))).toEqual([]);
    expect(titles(await run(s, 'cost:<1 small'))).toEqual(['small']);
  });

  test('threads with no usage cost zero', async () => {
    const { s, web } = corpus();
    addThread(s, web, 'free');
    expect(titles(await run(s, 'cost:<0.01 free'))).toEqual(['free']);
  });

  test('a thread with unpriced usage matches neither side of a cost filter', async () => {
    const { s, web } = corpus();
    addBuild(s, addThread(s, web, 'mystery'), { costs: [1, null] });
    expect(titles(await run(s, 'cost:<100 mystery'))).toEqual([]);
    expect(titles(await run(s, 'cost:>0 mystery'))).toEqual([]);
  });

  test('cost:lots is invalid with reason bad_cost', async () => {
    const { s } = corpus();
    const hit = await run(s, 'cost:lots');
    expect(hit.todos).toEqual([]);
    expect(hit.filters?.[0]).toMatchObject({ valid: false, reason: 'bad_cost' });
  });
});

describe('search filters: by:', () => {
  test('matches threads started by a person by display name', async () => {
    const { s, web } = corpus();
    s.db.insert(user).values({ id: 'u-ian', displayName: 'Ian' }).run();
    addThread(s, web, 'by person', { createdBy: 'u-ian' });
    addThread(s, web, 'by nobody');
    expect(titles(await run(s, 'by:ian'))).toEqual(['by person']);
    expect(titles(await run(s, '-by:ian project:web by'))).toEqual(['by nobody']);
  });

  test('an unknown name is invalid with reason unknown_person', async () => {
    const { s } = corpus();
    const hit = await run(s, 'by:ghost');
    expect(hit.todos).toEqual([]);
    expect(hit.filters?.[0]).toMatchObject({ valid: false, reason: 'unknown_person' });
  });
});

describe('search syntax: combinations and legacy behaviour', () => {
  test('filters AND across keys and with plain words; words AND each other', async () => {
    const { s, web } = corpus();
    addThread(s, web, 'login bug', { phase: 'failed' });
    addThread(s, web, 'login polish', { phase: 'done' });
    expect(titles(await run(s, 'is:failed project:web login'))).toEqual(['login bug']);
    expect(titles(await run(s, 'project:web login -polish'))).toEqual(['login bug']);
    expect(titles(await run(s, 'project:web bug login'))).toEqual(['login bug']);
    expect(titles(await run(s, '"login bug" project:web'))).toEqual(['login bug']);
  });

  test('every filter is echoed back with its validity, in input order', async () => {
    const { s } = corpus();
    const hit = await run(s, 'is:failed cost:lots project:web -is:bogus');
    expect(hit.filters?.map((f) => [f.key, f.valid, f.reason, f.negated])).toEqual([
      ['is', true, undefined, false],
      ['cost', false, 'bad_cost', false],
      ['project', true, undefined, false],
      ['is', false, 'unknown_state', true],
    ]);
  });

  test('filter queries return no projects', async () => {
    const { s } = corpus();
    const hit = await run(s, 'project:web');
    expect(hit.projects).toEqual([]);
  });

  test('queries with no recognised filter keep the legacy literal substring search and omit filters', async () => {
    const { s } = corpus();
    const plain = await run(s, 'fail web');
    expect(plain.todos).toEqual([]);
    const phrase = await run(s, 'web failed');
    expect(titles(phrase)).toEqual(['web failed']);
    expect(phrase.filters).toBeUndefined();
    expect((await run(s, 'label:bug')).filters).toBeUndefined();
    const projects = await run(s, 'we');
    expect(projects.projects.map((p) => p.name)).toEqual(['web']);
  });

  test('empty query is unchanged', async () => {
    const { s } = corpus();
    expect(await run(s, '')).toEqual({ todos: [], projects: [] });
  });

  test('a filter-only query never crosses teams', async () => {
    const { s } = corpus();
    s.db.insert(team).values({ id: 'other', name: 'Other', createdAt: 0 }).run();
    const foreign = addProject(s, 'web', 'other');
    const foreignThread = addThread(s, foreign, 'foreign failed', { phase: 'failed' }, 'other');
    addBuild(s, foreignThread, { pr: 99, costs: [500] });
    for (const q of ['is:failed', 'project:web is:failed', 'pr:99', 'pr:any', 'cost:>100']) {
      expect(titles(await run(s, q))).not.toContain('foreign failed');
    }
  });

  test('statement count does not grow with the number of threads', async () => {
    const small = corpus();
    const big = corpus();
    for (let i = 0; i < 80; i += 1) {
      const t = addThread(big.s, big.web, `bulk ${i}`, { phase: 'failed' });
      addBuild(big.s, t, { pr: i + 1, costs: [i] });
    }
    const q = 'is:failed pr:any cost:>1 by:x after:7d project:web';
    const count = async (s: TestServer) => {
      const spy = vi.spyOn(
        (s.db as unknown as { $client: { prepare: () => unknown } }).$client,
        'prepare',
      );
      await run(s, q);
      const calls = spy.mock.calls.length;
      spy.mockRestore();
      return calls;
    };
    const baseline = await count(small.s);
    expect(baseline).toBeGreaterThan(0);
    expect(await count(big.s)).toBe(baseline);
  });
});
