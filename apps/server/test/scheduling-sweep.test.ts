import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  autonomyState as autonomyStateTable,
  build as buildTable,
  project as projectTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { latestScheduleReport } from '../src/services/scheduling/store.js';
import { createScheduling, inFlightIssues } from '../src/services/scheduling/sweep.js';
import { bootServer, type TestServer } from './helpers.js';

const OWNER = 'xiechimon';
const REPO = `${OWNER}/pacman`;
const TOKEN = 'ghp_p5a2_sweep_token';
const MAIN_SHA = 'b'.repeat(40);
const SECOND_SHA = 'c'.repeat(40);

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

interface GhRoute {
  status?: number;
  body?: unknown;
  raw?: string;
}

export function githubFake(routes: Record<string, GhRoute>) {
  let mainSha = MAIN_SHA;
  const calls: string[] = [];
  const impl = (async (input: string, init?: { method?: string }) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    let route = routes[url.pathname];
    if (url.pathname === `/repos/${REPO}/branches/main`) {
      route = { body: { name: 'main', commit: { sha: mainSha } } };
    }
    if (route === undefined) route = { status: 404, body: { message: 'Not Found' } };
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => route.body,
      text: async () => route.raw ?? JSON.stringify(route.body ?? null),
    };
  }) as FetchLike;
  return {
    impl,
    calls,
    routes,
    advance: (sha: string) => {
      mainSha = sha;
    },
  };
}

function openIssue(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    title: `ticket ${number}`,
    state: 'open',
    labels: [],
    body: '',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-02T00:00:00Z',
    html_url: `https://github.com/${REPO}/issues/${number}`,
    ...over,
  };
}

function world(issues: unknown[], pulls: unknown[] = []) {
  const mock = githubFake({
    [`/repos/${REPO}/issues`]: { body: issues },
    [`/repos/${REPO}/pulls`]: { body: pulls },
    [`/repos/${REPO}/pulls/1500`]: { body: { body: 'Closes #1528' } },
    [`/repos/${REPO}/contents/docs/spec/README.md`]: {
      body: {
        content: Buffer.from('| 28 §8 | done (#1528) |').toString('base64'),
        encoding: 'base64',
      },
    },
  });
  const s = bootServer({ githubFetch: mock.impl });
  servers.push(s);
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: OWNER, accessToken: TOKEN, scope: 'repo' },
  );
  const projectId = `proj-${randomUUID()}`;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: 'sched',
      teamId: s.team.id,
      repoKind: 'github',
      githubRepo: REPO,
    })
    .run();
  return { s, mock, projectId };
}

const logger = { info: () => {} };

describe('inFlightIssues', () => {
  test('counts an issue as being worked on only while its todo is in flight', () => {
    const w = world([openIssue(1)]);
    const ref = `https://github.com/${REPO}/issues/1`;
    const phases = ['building', 'done', 'failed', 'closed'] as const;
    phases.forEach((phase, index) => {
      const todoId = `todo-${index}`;
      w.s.db
        .insert(todoTable)
        .values({
          id: todoId,
          teamId: w.s.team.id,
          projectId: w.projectId,
          title: `ticket ${index}`,
          phase,
          phaseAt: 1,
          seqNum: index + 1,
          sourceKind: 'github-issue',
          sourceRef: index === 0 ? ref : `https://github.com/${REPO}/issues/${index + 10}`,
        })
        .run();
      w.s.db
        .insert(buildTable)
        .values({
          id: `build-${index}`,
          todoId,
          withPlan: false,
          triggerSource: 'user',
          createdAt: 1,
        })
        .run();
    });
    const inFlight = inFlightIssues(w.s.db, w.projectId);
    expect([...inFlight.keys()]).toEqual([1]);
    expect(inFlight.get(1)).toBe(ref);
  });
});

describe('createScheduling sweep', () => {
  test('persists a report with the four groups and closes only with evidence', async () => {
    const w = world(
      [
        openIssue(1, { labels: [{ name: 'ready-for-agent' }] }),
        openIssue(2, { body: '依赖 #1' }),
        openIssue(1528, { body: '- [x] delivered' }),
      ],
      [{ number: 1500, title: 'delivery', state: 'closed', merged_at: '2023-01-01T00:00:00Z' }],
    );
    const scheduling = createScheduling(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: w.mock.impl, logger },
    );
    const outcomes = await scheduling.sweep(1_700_000_000_000);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe('generated');
    const report = latestScheduleReport(w.s.db, w.projectId);
    expect(report).not.toBeNull();
    expect(report?.mainSha).toBe(MAIN_SHA);
    expect(report?.groups.now).toEqual([1]);
    expect(report?.groups.next).toEqual([2]);
    expect(report?.groups.close).toEqual([1528]);
    const closed = report?.items.find((i) => i.issue === 1528);
    expect(closed?.closeReason).toBe('done');
    expect(closed?.evidence[0]?.kind).toBe('merged-pull');
    const nowItem = report?.items.find((i) => i.issue === 1);
    expect(nowItem?.labelChange).toBeNull();
  });

  test('an unchanged week is skipped as dormant and leaves no second report', async () => {
    const w = world([openIssue(1)]);
    const scheduling = createScheduling(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: w.mock.impl, logger },
    );
    const first = await scheduling.sweep(1_700_000_000_000);
    expect(first[0]?.kind).toBe('generated');
    const second = await scheduling.sweep(1_700_000_000_000 + 6_000_000);
    expect(second[0]).toEqual({ kind: 'gated', reason: 'dormant' });
    const state = w.s.db
      .select()
      .from(autonomyStateTable)
      .where(eq(autonomyStateTable.projectId, w.projectId))
      .all()
      .find((r) => r.kind === 'scheduling');
    expect(state?.lastBlockedReason).toBe('dormant');
    expect(state?.baselineSha).toBe(MAIN_SHA);
  });

  test('a new commit on main is not dormant even inside the cooldown', async () => {
    const w = world([openIssue(1)]);
    const scheduling = createScheduling(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: w.mock.impl, logger },
    );
    await scheduling.sweep(1_700_000_000_000);
    w.mock.advance(SECOND_SHA);
    const next = await scheduling.sweep(1_700_000_000_000 + 60 * 60 * 1000);
    expect(next[0]?.kind).toBe('generated');
  });

  test('a disabled project never reads github', async () => {
    const w = world([openIssue(1)]);
    w.s.db
      .update(projectTable)
      .set({ autonomy: { enabled: false, quietMinutes: 0, cooldownMinutes: 0, dailyBudgetUsd: 0 } })
      .where(eq(projectTable.id, w.projectId))
      .run();
    const scheduling = createScheduling(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: w.mock.impl, logger },
    );
    const outcomes = await scheduling.sweep(1_700_000_000_000);
    expect(outcomes[0]).toEqual({ kind: 'gated', reason: 'disabled' });
    expect(w.mock.calls).toEqual([]);
  });

  test('recovers after a failed run that advanced lastEvaluatedAt past an issue update', async () => {
    const t0 = 1_700_000_000_000;
    const updatedAt = new Date(t0 + 10 * 60 * 1000).toISOString();
    const w = world([openIssue(1)]);
    const scheduling = createScheduling(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: w.mock.impl, logger },
    );
    const first = await scheduling.sweep(t0);
    expect(first[0]?.kind).toBe('generated');
    const firstId = latestScheduleReport(w.s.db, w.projectId)?.id;
    w.mock.routes[`/repos/${REPO}/issues`] = {
      body: [openIssue(1, { updated_at: updatedAt })],
    };
    w.mock.routes[`/repos/${REPO}/pulls`] = { status: 500, body: { message: 'boom' } };
    const failed = await scheduling.sweep(t0 + 20 * 60 * 1000);
    expect(failed[0]?.kind).toBe('skipped');
    w.mock.routes[`/repos/${REPO}/pulls`] = { body: [] };
    const recovered = await scheduling.sweep(t0 + 40 * 60 * 1000);
    expect(recovered[0]?.kind).toBe('generated');
    const report = latestScheduleReport(w.s.db, w.projectId);
    expect(report?.id).not.toBe(firstId);
    expect(report?.items.find((item) => item.issue === 1)?.updatedAt).toBe(Date.parse(updatedAt));
  });

  test('closing every open issue is not dormant and writes a fresh report', async () => {
    const w = world([openIssue(1), openIssue(2)]);
    const scheduling = createScheduling(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: w.mock.impl, logger },
    );
    const first = await scheduling.sweep(1_700_000_000_000);
    expect(first[0]?.kind).toBe('generated');
    expect(latestScheduleReport(w.s.db, w.projectId)?.items).toHaveLength(2);
    w.mock.routes[`/repos/${REPO}/issues`] = { body: [] };
    const next = await scheduling.sweep(1_700_000_000_000 + 6_000_000);
    expect(next[0]?.kind).toBe('generated');
    const report = latestScheduleReport(w.s.db, w.projectId);
    expect(report?.items).toEqual([]);
    expect(report?.groups).toEqual({ now: [], next: [], later: [], close: [] });
  });
});
