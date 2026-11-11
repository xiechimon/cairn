import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conversationBranch } from '@cairn/shared';
import { eq, ne, sql } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import {
  build as buildTable,
  message,
  project as projectTable,
  routingRule,
  steerPending,
  step as stepTable,
  threadPr as threadPrTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { sweepFailedRetries } from '../src/services/needs-you.js';
import { createPrFeedbackPoller } from '../src/services/pr-feedback.js';
import { createPrWatch } from '../src/services/pr-watch.js';
import { profileForStep } from '../src/services/routing-rules.js';
import { createScheduler } from '../src/services/scheduler.js';
import { getTodo } from '../src/services/todos.js';
import { readWorkerQuestion } from '../src/services/worker-question-store.js';
import { askWorkerQuestion } from '../src/services/worker-questions.js';
import { bootServer, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

interface PullSpec {
  state?: 'open' | 'closed';
  merged?: boolean;
  draft?: boolean;
  head?: string;
  mergeable?: string;
  title?: string;
  additions?: number;
  deletions?: number;
  base?: string;
  labels?: string[];
}

interface RunSpec {
  id?: number;
  summary?: string;
  title?: string;
  completedAt?: string;
  name: string;
  status: string;
  conclusion: string | null;
}

class GithubMock {
  pulls = new Map<string, PullSpec>();
  checks = new Map<string, RunSpec[]>();
  comments: { id: number; user: { login: string }; body: string }[] = [];
  branch = '';
  permission = 'write';
  failing = new Set<string>();
  remaining: number | null = null;
  limit = 5000;
  resetAtSeconds: number | null = null;
  requests: string[] = [];
  authorizations: string[] = [];
  notModified = 0;
  threads: 'none' | 'failing' | null = null;
  fetch = vi.fn((input: string | URL, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    this.requests.push(url);
    this.authorizations.push(init?.headers?.authorization ?? '');
    const send = (status: number, body: unknown) => {
      const etag = `"${createHash('md5').update(JSON.stringify(body)).digest('hex')}"`;
      const headers: Record<string, string> = { etag };
      if (this.remaining !== null) {
        headers['x-ratelimit-remaining'] = String(this.remaining);
        headers['x-ratelimit-limit'] = String(this.limit);
        if (this.resetAtSeconds !== null)
          headers['x-ratelimit-reset'] = String(this.resetAtSeconds);
      }
      const lookup = (name: string) => headers[name.toLowerCase()] ?? null;
      if (status === 200 && init?.headers?.['if-none-match'] === etag) {
        this.notModified += 1;
        return Promise.resolve({
          ok: false,
          status: 304,
          headers: { get: lookup },
          json: () => Promise.resolve(null),
          text: () => Promise.resolve(''),
        });
      }
      return Promise.resolve({
        ok: status < 400,
        status,
        headers: { get: lookup },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      });
    };
    if (url.endsWith('/graphql') && this.threads !== null) {
      if (this.threads === 'failing') return send(502, { message: 'bad gateway' });
      const spec = [...this.pulls.values()][0];
      return send(200, {
        data: {
          repository: {
            label: { id: 'LABEL_node' },
            pullRequest: {
              timelineItems: { nodes: [] },
              id: 'PR_node',
              state: 'OPEN',
              isDraft: spec?.draft ?? false,
              headRefOid: spec?.head ?? HEAD_A,
              labels: {
                nodes: (spec?.labels ?? []).map((name) => ({ name })),
                pageInfo: { hasNextPage: false },
              },
              reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          },
        },
      });
    }
    const pull = /\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(url);
    if (pull) {
      const key = `${(pull[1] ?? '').toLowerCase()}#${pull[2]}`;
      const spec = this.pulls.get(key);
      if (this.failing.has(key) || spec === undefined) return send(500, { message: 'boom' });
      return send(200, {
        state: spec.state ?? 'open',
        merged: spec.merged ?? false,
        draft: spec.draft ?? false,
        title: spec.title ?? 'server(1): a change',
        html_url: `https://github.com/${pull[1]}/pull/${pull[2]}`,
        mergeable_state: spec.mergeable ?? 'clean',
        additions: spec.additions ?? 12,
        deletions: spec.deletions ?? 3,
        labels: (spec.labels ?? []).map((name) => ({ name })),
        head: { sha: spec.head ?? HEAD_A, ref: this.branch, repo: { id: 1 } },
        base: {
          sha: spec.base ?? 'c'.repeat(40),
          ref: 'main',
          repo: { id: 1, default_branch: 'main' },
        },
      });
    }
    const runs = /\/commits\/([0-9a-f]+)\/check-runs/.exec(url);
    if (runs) {
      return send(200, {
        check_runs: (this.checks.get(runs[1] ?? '') ?? []).map((r) => ({
          ...r,
          completed_at: r.completedAt ?? null,
          output: { title: r.title ?? null, summary: r.summary ?? null },
        })),
      });
    }
    if (url.includes('/branches/main')) return send(200, {});
    if (url.includes('/rules/branches/')) return send(200, []);
    if (url.includes('/permission')) return send(200, { permission: this.permission });
    if (url.includes('/issues/')) return send(200, this.comments);
    if (/\/(comments|reviews)\?/.test(url)) return send(200, []);
    return send(404, { message: 'not found' });
  });
  count(fragment: string): number {
    return this.requests.filter((u) => u.includes(fragment)).length;
  }
}

function boot() {
  const s = bootServer();
  servers.push(s);
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: 'gho_team_a', scope: 'repo' },
  );
  return s;
}

let counter = 0;

function seedThread(
  s: TestServer,
  opts: {
    teamId?: string;
    prNumber?: number | null;
    repo?: string;
    archived?: boolean;
    phase?: 'review' | 'done';
  } = {},
) {
  counter += 1;
  const teamId = opts.teamId ?? s.team.id;
  const projectId = `proj-${counter}`;
  const todoId = `todo-${counter}`;
  const buildId = `build-${counter}`;
  const prNumber = opts.prNumber === undefined ? 100 + counter : opts.prNumber;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `demo-${counter}`,
      teamId,
      repoKind: 'github',
      githubRepo: opts.repo ?? 'octo/demo',
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId,
      projectId,
      title: `thread ${counter}`,
      phase: opts.phase ?? 'review',
      phaseAt: 1,
      seqNum: counter,
      latestBuildId: buildId,
      archivedAt: opts.archived === true ? 5 : null,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1,
      prNumber,
      prUrl: prNumber === null ? null : `https://github.com/octo/demo/pull/${prNumber}`,
    })
    .run();
  return { projectId, todoId, buildId, prNumber: prNumber as number };
}

function watchFor(s: TestServer, mock: GithubMock) {
  return createPrWatch(
    { ...s.svc, box: s.secretBox, githubFetch: mock.fetch },
    { githubFetch: mock.fetch },
  );
}

function rows(s: TestServer) {
  return s.db.select().from(threadPrTable).all();
}

function fixture() {
  const s = boot();
  const mock = new GithubMock();
  const t = seedThread(s);
  mock.branch = conversationBranch(t.buildId);
  const pull: PullSpec & { head: string; base: string } = {
    head: HEAD_A,
    base: 'c'.repeat(40),
    mergeable: 'clean',
  };
  mock.pulls.set(`octo/demo#${t.prNumber}`, pull);
  mock.checks.set(pull.base, [{ name: 'unit', status: 'completed', conclusion: 'success' }]);
  const fail = (id: number, summary = 'broken') =>
    mock.checks.set(pull.head, [
      { id, name: 'unit', status: 'completed', conclusion: 'failure', summary },
    ]);
  const steps = () => s.db.select().from(stepTable).where(ne(stepTable.kind, 'chief')).all();
  const settle = () => s.db.update(stepTable).set({ status: 'done' }).run();
  const comment = (id: number, author = 'reviewer', body = `fix ${id}`) => {
    mock.comments.push({ id, user: { login: author }, body });
  };
  return { s, mock, t, pull, fail, steps, settle, comment };
}

describe('parked builds reject PR-driven redispatch', () => {
  test.each(['model_not_found: glm-5.3', 'Task parked: 4 failed builds in one hour (limit 3).'])(
    'managed CI, conflict and review events preserve parking: %s',
    async (reason) => {
      const f = fixture();
      const watch = watchFor(f.s, f.mock);
      await watch.sweep();
      f.s.db.update(buildTable).set({ errorMessage: reason }).run();
      f.s.db.update(todoTable).set({ phase: 'failed' }).run();
      f.fail(1);
      f.comment(1);
      f.pull.mergeable = 'dirty';
      await watch.sweep();
      await watchFor(f.s, f.mock).sweep();
      expect(f.steps()).toHaveLength(0);
      expect(f.s.db.select().from(todoTable).get()?.phase).toBe('failed');
      expect(f.s.db.select().from(buildTable).get()?.errorMessage).toBe(reason);
      expect(rows(f.s)[0]?.wakeRounds).toBe(0);
    },
  );

  test.each(['model_not_found: glm-5.3', 'Task parked: 4 failed builds in one hour (limit 3).'])(
    'legacy collaborator feedback preserves parking: %s',
    async (reason) => {
      const f = fixture();
      const poller = createPrFeedbackPoller(
        { ...f.s.svc, box: f.s.secretBox },
        { githubFetch: f.mock.fetch },
      );
      await poller.sweep();
      f.s.db.update(buildTable).set({ errorMessage: reason }).run();
      f.s.db.update(todoTable).set({ phase: 'failed' }).run();
      f.comment(1);
      await poller.sweep();
      await poller.sweep();
      expect(f.steps()).toHaveLength(0);
      expect(f.s.db.select().from(todoTable).get()?.phase).toBe('failed');
      expect(f.s.db.select().from(buildTable).get()?.errorMessage).toBe(reason);
    },
  );

  test('a model rejection arriving during GitHub intake is checked before clearing the error', async () => {
    const f = fixture();
    const watch = watchFor(f.s, f.mock);
    await watch.sweep();
    f.fail(1);
    const fetch = f.mock.fetch.getMockImplementation()!;
    f.mock.fetch.mockImplementationOnce(async (input, init) => {
      f.s.db.update(buildTable).set({ errorMessage: 'model_not_found: glm-5.3' }).run();
      f.s.db.update(todoTable).set({ phase: 'failed' }).run();
      return fetch(input, init);
    });
    await watch.sweep();
    expect(f.steps()).toHaveLength(0);
    expect(f.s.db.select().from(buildTable).get()?.errorMessage).toContain('glm-5.3');
  });

  test('a deferred PR cap notice cannot overwrite the terminal parking reason', async () => {
    const f = fixture();
    const watch = watchFor(f.s, f.mock);
    await watch.sweep();
    f.s.db
      .update(message)
      .set({
        content: {
          pendingNotice: { buildId: f.t.buildId, content: 'PR Auto-fix needs you: synthetic cap' },
        },
      })
      .where(eq(message.id, `pr-wakes:${f.s.team.id}:octo/demo#${f.t.prNumber}`))
      .run();
    f.s.db.update(buildTable).set({ errorMessage: 'model_not_found: glm-5.3' }).run();
    f.s.db.update(todoTable).set({ phase: 'failed' }).run();
    f.mock.failing.add(`octo/demo#${f.t.prNumber}`);
    await watch.sweep();
    expect(f.s.db.select().from(buildTable).get()?.errorMessage).toBe('model_not_found: glm-5.3');
    expect(f.steps()).toHaveLength(0);
  });
});

describe('D109 S3 F2 bounded, durable PR wakes', () => {
  test('CI wakes three times per head, deduplicates reruns and survives poller restart', async () => {
    const f = fixture();
    for (let id = 1; id <= 4; id += 1) {
      f.fail(id);
      await watchFor(f.s, f.mock).sweep(id * 60_000);
      f.settle();
    }
    expect(f.steps()).toHaveLength(3);
    expect(f.steps().every((s) => s.kind === 'session')).toBe(true);
    expect(rows(f.s)[0]?.wakeRounds).toBe(3);
    await watchFor(f.s, f.mock).sweep(400_000);
    expect(f.steps()).toHaveLength(3);
  });

  test('same failure on consecutive heads stops early', async () => {
    const f = fixture();
    f.fail(1);
    await watchFor(f.s, f.mock).sweep();
    f.settle();
    f.pull.head = HEAD_B;
    f.fail(2);
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toHaveLength(1);
  });

  test('conflict rounds stop at two across heads', async () => {
    const f = fixture();
    f.pull.mergeable = 'dirty';
    for (const head of [HEAD_A, HEAD_B, 'd'.repeat(40)]) {
      f.pull.head = head;
      await watchFor(f.s, f.mock).sweep();
      f.settle();
    }
    expect(f.steps()).toHaveLength(2);
  });

  test('review rounds stop at three, including after restart', async () => {
    const f = fixture();
    for (let id = 1; id <= 4; id += 1) {
      f.comment(id);
      await watchFor(f.s, f.mock).sweep();
      f.settle();
    }
    expect(f.steps()).toHaveLength(3);
  });

  test('ten total wakes turn auto-fix off', async () => {
    const f = fixture();
    for (let id = 1; id <= 11; id += 1) {
      f.pull.head = id.toString(16).padStart(40, '0');
      f.fail(id, `failure ${id}`);
      await watchFor(f.s, f.mock).sweep();
      f.settle();
    }
    expect(f.steps()).toHaveLength(10);
    expect(rows(f.s)[0]).toMatchObject({ wakeRounds: 10, autoFix: false });
  });
});

describe('a quiet sweep leaves the PR row untouched', () => {
  test('polling an unchanged PR with nothing to wake does not move updatedAt', async () => {
    const f = fixture();
    const watch = watchFor(f.s, f.mock);
    await watch.sweep(1_000);
    await watch.sweep(70_000);
    await watch.sweep(140_000);
    expect(rows(f.s)[0]).toMatchObject({ updatedAt: 1_000, wakeRounds: 0 });
  });

  test('a wake that changes the round count does move updatedAt', async () => {
    const f = fixture();
    const watch = watchFor(f.s, f.mock);
    await watch.sweep(1_000);
    f.fail(1);
    await watch.sweep(70_000);
    expect(rows(f.s)[0]?.wakeRounds).toBe(1);
    expect(rows(f.s)[0]?.updatedAt).toBeGreaterThan(1_000);
  });
});

describe('D109 S3 F3 base-red skip', () => {
  test.each(['failure', 'cancelled', null])(
    'base unit conclusion %s never starts a CI fix',
    async (conclusion) => {
      const f = fixture();
      f.fail(1);
      f.mock.checks.set(f.pull.base, [{ name: 'unit', status: 'completed', conclusion }]);
      await watchFor(f.s, f.mock).sweep();
      expect(f.steps()).toEqual([]);
      f.mock.checks.set(f.pull.base, [
        { name: 'unit', status: 'completed', conclusion: 'success' },
      ]);
      await watchFor(f.s, f.mock).sweep();
      expect(f.steps()).toHaveLength(1);
    },
  );

  test.each(['cancelled', 'action_required'])(
    'head conclusion %s is never fixed',
    async (conclusion) => {
      const f = fixture();
      f.mock.checks.set(HEAD_A, [{ name: 'unit', status: 'completed', conclusion }]);
      await watchFor(f.s, f.mock).sweep();
      expect(f.steps()).toEqual([]);
    },
  );
});

describe('D109 S3 F4 self filter and Auto-fix', () => {
  test('own login, app replies and checkpoint pushes do not wake; later CI failure does', async () => {
    const f = fixture();
    f.comment(1, 'octo');
    f.comment(2, 'cairnwright[bot]');
    f.s.db
      .insert(stepTable)
      .values({
        id: 'own-push',
        buildId: f.t.buildId,
        kind: 'session',
        status: 'done',
        checkpointCommit: HEAD_A,
        createdAt: 1,
      })
      .run();
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toHaveLength(1);
    f.fail(1);
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toHaveLength(2);
  });

  test('disabled or dismissed PRs never wake', async () => {
    const f = fixture();
    const watch = watchFor(f.s, f.mock);
    await watch.sweep();
    f.s.db.update(threadPrTable).set({ autoFix: false }).run();
    f.fail(1);
    f.comment(1);
    f.pull.mergeable = 'dirty';
    await watch.sweep();
    expect(f.steps()).toEqual([]);
    f.s.db.update(threadPrTable).set({ autoFix: true, dismissed: true }).run();
    await watch.sweep();
    expect(f.steps()).toEqual([]);
  });

  test('read-only reviewers cannot wake a thread', async () => {
    const f = fixture();
    f.mock.permission = 'read';
    f.comment(1);
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toEqual([]);
  });
});

describe('D109 S3 F5 one session wake per tick', () => {
  test('conflict, CI and comments coalesce in that order and repeated polls are quiet', async () => {
    const f = fixture();
    f.pull.mergeable = 'dirty';
    f.fail(1);
    f.comment(1);
    f.comment(2);
    const watch = watchFor(f.s, f.mock);
    await watch.sweep();
    expect(f.steps()).toHaveLength(1);
    const prompt = f.steps()[0]?.prompt ?? '';
    expect(prompt.indexOf('[merge-conflict]')).toBeLessThan(prompt.indexOf('[ci-fix]'));
    expect(prompt).toContain('reviewer');
    expect(rows(f.s)[0]?.wakeRounds).toBe(1);
    f.settle();
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toHaveLength(1);
  });

  test('a claimed session gets one steer and pending sessions get appended prompts', async () => {
    const f = fixture();
    f.s.db
      .insert(stepTable)
      .values({
        id: 'live',
        buildId: f.t.buildId,
        kind: 'session',
        status: 'claimed',
        createdAt: 1,
      })
      .run();
    f.fail(1);
    f.comment(1);
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toHaveLength(1);
    expect(f.s.db.select().from(steerPending).get()).toMatchObject({
      stepId: 'live',
      content: expect.stringContaining('reviewer'),
    });
    f.s.db.update(stepTable).set({ status: 'pending' }).run();
    f.comment(2);
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toHaveLength(1);
    expect(f.steps()[0]?.prompt).toContain('fix 2');
  });

  test('archive during a GitHub read prevents dispatch', async () => {
    const f = fixture();
    f.fail(1);
    f.mock.fetch.mockImplementationOnce(async () => {
      f.s.db.update(todoTable).set({ archivedAt: 1 }).run();
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          state: 'open',
          merged: false,
          head: { sha: HEAD_A },
          base: { sha: f.pull.base, ref: 'main' },
        }),
        text: async () => '',
      };
    });
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toEqual([]);
  });
});

describe('D109 S3 persistence and poller handoff', () => {
  test('closing and reopening the SQLite file retains counts and deduplication', async () => {
    const f = fixture();
    f.fail(1);
    await watchFor(f.s, f.mock).sweep();
    f.settle();
    const dir = makeTestTempDir('pr-wakes-restart-');
    const path = join(dir, 'server.db');
    try {
      f.s.db.run(sql`VACUUM INTO ${path}`);
      const first = openDbWithHandle(path);
      first.close();
      const restarted = openDbWithHandle(path);
      try {
        const deps = {
          ...f.s.svc,
          db: restarted.db,
          box: f.s.secretBox,
          githubFetch: f.mock.fetch,
        };
        const watch = createPrWatch(deps, { githubFetch: f.mock.fetch });
        await watch.sweep();
        expect(restarted.db.select().from(stepTable).all()).toHaveLength(1);
        f.fail(2);
        await watch.sweep();
        expect(restarted.db.select().from(stepTable).all()).toHaveLength(2);
        expect(restarted.db.select().from(threadPrTable).get()?.wakeRounds).toBe(2);
      } finally {
        restarted.close();
      }
    } finally {
      releaseTestTempDir(dir);
    }
  });

  test('old feedback and CI fix paths leave an auto-fix-disabled managed PR alone', async () => {
    const f = fixture();
    await watchFor(f.s, f.mock).sweep();
    f.s.db.update(threadPrTable).set({ autoFix: false }).run();
    f.s.db.update(todoTable).set({ phase: 'building' }).run();
    f.fail(1);
    f.comment(1);
    f.pull.mergeable = 'dirty';
    const deps = { ...f.s.svc, box: f.s.secretBox, githubFetch: f.mock.fetch };
    await createCiPoller(deps, { githubFetch: f.mock.fetch }).sweep();
    await createPrFeedbackPoller(deps, { githubFetch: f.mock.fetch }).sweep();
    expect(f.steps()).toEqual([]);
  });

  test('an exhausted cap goes to the Coordinator, then to the owner once its turn ends, and the failure sweep never retries it', async () => {
    const f = fixture();
    for (let id = 1; id <= 4; id += 1) {
      f.fail(id);
      await watchFor(f.s, f.mock).sweep();
      f.settle();
    }
    expect(getTodo(f.s.svc, f.t.todoId)?.owner).toBe('owner');
    await sweepFailedRetries(f.s.svc);
    expect(f.steps()).toHaveLength(3);
  });

  test('a new CI event on a new head has a fresh per-head budget', async () => {
    const f = fixture();
    f.fail(1, 'first failure');
    await watchFor(f.s, f.mock).sweep();
    f.settle();
    f.pull.head = HEAD_B;
    f.fail(2, 'different failure');
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toHaveLength(2);
  });

  test('an Auto-fix toggle during feedback intake prevents dispatch', async () => {
    const f = fixture();
    const watch = watchFor(f.s, f.mock);
    await watch.sweep();
    f.fail(1);
    f.mock.fetch.mockImplementationOnce(async () => {
      f.s.db
        .update(threadPrTable)
        .set({ autoFix: false })
        .where(eq(threadPrTable.buildId, f.t.buildId))
        .run();
      return {
        ok: false,
        status: 304,
        headers: { get: () => null },
        json: async () => null,
        text: async () => '',
      };
    });
    await watch.sweep();
    expect(f.steps()).toEqual([]);
  });
});

test('a PR session wake is routed by the session rule', async () => {
  const f = fixture();
  f.s.db
    .insert(routingRule)
    .values({
      id: 'session-rule',
      teamId: f.s.team.id,
      use: 'session',
      provider: 'stub',
      modelId: 'session-model',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  f.fail(1);
  await watchFor(f.s, f.mock).sweep();
  const thread = f.s.db.select().from(todoTable).where(eq(todoTable.id, f.t.todoId)).get();
  expect(f.steps()[0]?.kind).toBe('session');
  expect(profileForStep(f.s.db, thread!, 'session')).toMatchObject({
    id: 'session-rule',
    modelId: 'session-model',
  });
});

test.each(['missing', 'unreadable'])('a %s base cannot authorize a CI fix', async (kind) => {
  const f = fixture();
  f.fail(1);
  if (kind === 'missing') f.mock.checks.set(f.pull.base, []);
  else f.pull.base = '';
  await watchFor(f.s, f.mock).sweep();
  expect(f.steps()).toEqual([]);
});

test('a review edit is fresh feedback without replaying unchanged comments', async () => {
  const f = fixture();
  f.comment(1);
  await watchFor(f.s, f.mock).sweep();
  f.settle();
  f.mock.comments[0]!.body = 'edited requested change';
  await watchFor(f.s, f.mock).sweep();
  expect(f.steps()).toHaveLength(2);
  expect(f.steps()[1]?.prompt).toContain('edited requested change');
});

test('concurrent pollers cannot dispatch the same event twice', async () => {
  const f = fixture();
  f.fail(1);
  await Promise.all([watchFor(f.s, f.mock).sweep(), watchFor(f.s, f.mock).sweep()]);
  expect(f.steps()).toHaveLength(1);
  expect(rows(f.s)[0]?.wakeRounds).toBe(1);
});

test('runtime witness: the PR API exposes one coalesced session wake and its durable count', async () => {
  const f = fixture();
  f.pull.mergeable = 'dirty';
  f.fail(1);
  f.comment(1);
  const before = { steps: f.steps(), prs: rows(f.s) };
  await watchFor(f.s, f.mock).sweep();
  const response = await req(f.s.app, 'GET', `/api/prs?threadId=${f.t.todoId}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { wakeRounds: number }[];
  expect(body[0]?.wakeRounds).toBe(1);
  expect(f.steps()).toHaveLength(1);
  const evidence = {
    requirement: 'D109 S3 F2–F5',
    provider: 'stateful fake GitHub; no LLM',
    before,
    request: `GET /api/prs?threadId=${f.t.todoId}`,
    status: response.status,
    body,
    after: { steps: f.steps(), prs: rows(f.s) },
    githubRequests: f.mock.requests,
  };
  const evidencePath = process.env.CAIRN_PR_WAKE_EVIDENCE;
  if (evidencePath) writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
});

test.each(['review', 'verify', 'merge'] as const)(
  'an active %s gate is left intact and feedback waits for the session',
  async (kind) => {
    const f = fixture();
    f.s.db
      .insert(stepTable)
      .values({
        id: 'gate',
        buildId: f.t.buildId,
        kind,
        status: 'claimed',
        prompt: 'Gate instruction',
        createdAt: 1,
      })
      .run();
    f.fail(1);
    f.comment(1);
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toHaveLength(1);
    expect(f.steps()[0]?.prompt).toBe('Gate instruction');
    expect(f.s.db.select().from(steerPending).get()).toBeUndefined();
    f.settle();
    await watchFor(f.s, f.mock).sweep();
    expect(f.steps()).toHaveLength(2);
    expect(f.steps()[1]).toMatchObject({
      kind: 'session',
      prompt: expect.stringContaining('reviewer'),
    });
  },
);

test('taking over from the legacy feedback cursor does not replay historical comments', async () => {
  const f = fixture();
  f.comment(1);
  await createPrFeedbackPoller(
    { ...f.s.svc, box: f.s.secretBox },
    { githubFetch: f.mock.fetch },
  ).sweep();
  await watchFor(f.s, f.mock).sweep();
  expect(f.steps()).toEqual([]);
  f.comment(2);
  await watchFor(f.s, f.mock).sweep();
  expect(f.steps()).toHaveLength(1);
  expect(f.steps()[0]?.prompt).toContain('fix 2');
  expect(f.steps()[0]?.prompt).not.toContain('fix 1');
});

test('scheduler coalesces concurrent CI and PR deadlines into one PrWatch read', async () => {
  const f = fixture();
  f.fail(1);
  f.comment(1);
  f.pull.mergeable = 'dirty';
  vi.useFakeTimers();
  const scheduler = createScheduler(
    { ...f.s.svc, box: f.s.secretBox, githubFetch: f.mock.fetch },
    { tickMs: 60_000 },
    null,
    {
      githubFetch: f.mock.fetch,
      logger: { info() {} },
    },
  );
  try {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.steps()).toHaveLength(1);
    expect(f.steps()[0]?.kind).toBe('session');
    expect(f.mock.requests.filter((u) => /\/pulls\/\d+$/.test(u))).toHaveLength(1);
  } finally {
    scheduler.stop();
    vi.useRealTimers();
  }
});

test('scheduler cannot fall back to legacy fixes when the first PrWatch read fails', async () => {
  const f = fixture();
  f.fail(1);
  f.pull.mergeable = 'dirty';
  f.s.db.update(todoTable).set({ phase: 'building' }).run();
  f.mock.fetch.mockImplementationOnce(async () => ({
    ok: false,
    status: 500,
    headers: { get: () => null },
    json: async () => null,
    text: async () => '',
  }));
  vi.useFakeTimers();
  const scheduler = createScheduler(
    { ...f.s.svc, box: f.s.secretBox, githubFetch: f.mock.fetch },
    { tickMs: 60_000 },
    null,
    {
      githubFetch: f.mock.fetch,
      logger: { info() {} },
    },
  );
  try {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.steps()).toEqual([]);
  } finally {
    scheduler.stop();
    vi.useRealTimers();
  }
});

test.each(['claimed', 'done'] as const)(
  'a parked question blocks every repair kind with a %s session',
  async (status) => {
    const f = fixture();
    f.s.db.update(todoTable).set({ phase: 'building' }).run();
    f.s.db
      .insert(stepTable)
      .values({
        id: 'parked-session',
        buildId: f.t.buildId,
        kind: 'session',
        status: 'claimed',
        createdAt: 1,
      })
      .run();
    const session = f.steps()[0]!;
    await askWorkerQuestion(
      f.s.svc,
      session,
      {
        requestId: 'parked-question',
        questions: [
          {
            header: 'Choice',
            question: 'Which approach?',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
      { holdMs: 0 },
    );
    f.s.db.update(stepTable).set({ status }).run();
    f.s.db.update(todoTable).set({ phase: 'needs_input' }).run();
    const before = readWorkerQuestion(f.s.db, f.t.buildId, 'parked-question');
    f.fail(1);
    f.comment(1);
    f.pull.mergeable = 'dirty';
    await watchFor(f.s, f.mock).sweep();
    expect(rows(f.s)[0]?.wakeRounds).toBe(0);
    expect(f.steps()).toHaveLength(1);
    expect(f.s.db.select().from(steerPending).get()).toBeUndefined();
    expect(f.s.db.select().from(todoTable).get()).toMatchObject({ phase: 'needs_input' });
    expect(readWorkerQuestion(f.s.db, f.t.buildId, 'parked-question')).toEqual(before);
    expect(
      f.s.db
        .select()
        .from(message)
        .all()
        .filter((m) => m.actor === 'github'),
    ).toEqual([]);
  },
);

test('staggered job failures wait for the whole run and consume one round', async () => {
  const f = fixture();
  f.mock.checks.set(
    f.pull.base,
    ['unit', 'lint'].map((name) => ({ name, status: 'completed', conclusion: 'success' })),
  );
  f.mock.checks.set(HEAD_A, [
    { id: 1, name: 'unit', status: 'completed', conclusion: 'failure' },
    { id: 2, name: 'lint', status: 'in_progress', conclusion: null },
  ]);
  await watchFor(f.s, f.mock).sweep();
  expect(f.steps()).toEqual([]);
  expect(rows(f.s)[0]?.wakeRounds).toBe(0);
  f.mock.checks.get(HEAD_A)![1] = {
    id: 2,
    name: 'lint',
    status: 'completed',
    conclusion: 'failure',
  };
  await watchFor(f.s, f.mock).sweep();
  f.settle();
  await watchFor(f.s, f.mock).sweep();
  expect(f.steps()).toHaveLength(1);
  expect(rows(f.s)[0]?.wakeRounds).toBe(1);
  expect(f.steps()[0]?.prompt).toContain('unit');
  expect(f.steps()[0]?.prompt).toContain('lint');
});

test.each(['done', 'building', 'review', 'failed'] as const)(
  'the tenth wake surfaces its deferred cap after settling to %s even without a GitHub read',
  async (phase) => {
    const f = fixture();
    for (let id = 1; id <= 10; id += 1) {
      f.pull.head = id.toString(16).padStart(40, '0');
      f.fail(id, `failure ${id}`);
      await watchFor(f.s, f.mock).sweep();
      if (id < 10) f.settle();
    }
    expect(rows(f.s)[0]).toMatchObject({ wakeRounds: 10, autoFix: false });
    expect(f.s.db.select().from(todoTable).get()?.phase).toBe('queued');
    f.settle();
    f.s.db.update(todoTable).set({ phase }).run();
    f.s.db.update(buildTable).set({ errorMessage: null }).run();
    f.mock.failing.add(`octo/demo#${f.t.prNumber}`);
    await watchFor(f.s, f.mock).sweep();
    expect(getTodo(f.s.svc, f.t.todoId)?.owner).toBe('coordinator');
    expect(f.s.db.select().from(buildTable).get()?.errorMessage).toContain('Total wake cap (10)');
    await sweepFailedRetries(f.s.svc);
    expect(f.steps()).toHaveLength(10);
  },
);

test('a question opened during GitHub intake prevents dispatch and budget debit', async () => {
  const f = fixture();
  f.s.db
    .insert(stepTable)
    .values({
      id: 'asking-session',
      buildId: f.t.buildId,
      kind: 'session',
      status: 'claimed',
      createdAt: 1,
    })
    .run();
  f.fail(1);
  const fetch = f.mock.fetch.getMockImplementation()!;
  f.mock.fetch.mockImplementationOnce(async (input, init) => {
    await askWorkerQuestion(
      f.s.svc,
      f.steps()[0]!,
      {
        requestId: 'arriving-question',
        questions: [
          {
            header: 'Choice',
            question: 'Which approach?',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
      { holdMs: 0 },
    );
    return fetch(input, init);
  });
  await watchFor(f.s, f.mock).sweep();
  expect(rows(f.s)[0]?.wakeRounds).toBe(0);
  expect(f.s.db.select().from(steerPending).get()).toBeUndefined();
  expect(readWorkerQuestion(f.s.db, f.t.buildId, 'arriving-question')?.status).toBe('pending');
});

test('a per-kind cap observed during a session survives disabling Auto-fix and settling', async () => {
  const f = fixture();
  for (let id = 1; id <= 3; id += 1) {
    f.fail(id);
    await watchFor(f.s, f.mock).sweep();
    f.settle();
  }
  f.s.db
    .insert(stepTable)
    .values({
      id: 'ongoing-session',
      buildId: f.t.buildId,
      kind: 'session',
      status: 'claimed',
      createdAt: 1,
    })
    .run();
  f.fail(4);
  await watchFor(f.s, f.mock).sweep();
  expect(f.s.db.select().from(todoTable).get()?.phase).not.toBe('failed');
  f.s.db.update(threadPrTable).set({ autoFix: false }).run();
  f.settle();
  await watchFor(f.s, f.mock).sweep();
  expect(getTodo(f.s.svc, f.t.todoId)?.owner).toBe('coordinator');
  expect(f.s.db.select().from(buildTable).get()?.errorMessage).toContain('CI fix cap (3 per head)');
});

describe('a green PR waiting for queue conditions wakes its owner with what is unmet', () => {
  const T0 = Date.parse('2026-11-09T02:00:00Z');
  const minutes = (n: number) => T0 + n * 60_000;
  const waiting = (summary: string): RunSpec => ({
    name: 'Mergify Merge Queue',
    status: 'completed',
    conclusion: 'neutral',
    title: 'Waiting for queue conditions to match',
    summary,
  });
  const unmet = [
    '### Queue entry conditions',
    '',
    '- [ ] any of [🔀 queue conditions]:',
    '  - [ ] all of [📌 queue conditions of queue rule `bot`]:',
    '    - [ ] `check-success = pr-size`',
    '    - [X] `-draft`',
    '    - [X] `#files <= 80`',
    '    - [X] any of:',
    '      - [X] `check-success = check`',
    '      - [ ] `check-skipped = check`',
  ].join('\n');
  const green = (f: ReturnType<typeof fixture>, summary = unmet, extra: RunSpec[] = []) => {
    f.mock.threads ??= 'none';
    f.mock.checks.set(f.pull.head, [
      {
        name: 'unit',
        status: 'completed',
        conclusion: 'success',
        completedAt: new Date(T0).toISOString(),
      },
      {
        name: 'e2e',
        status: 'completed',
        conclusion: 'skipped',
        completedAt: new Date(minutes(-5)).toISOString(),
      },
      waiting(summary),
      ...extra,
    ]);
  };
  const prompts = (f: ReturnType<typeof fixture>) => f.steps().map((s) => s.prompt ?? '');

  test('ten minutes after the last check turned green, one wake lists only the unmet conditions', async () => {
    const f = fixture();
    green(f);
    await watchFor(f.s, f.mock).sweep(minutes(9));
    expect(f.steps()).toHaveLength(0);
    await watchFor(f.s, f.mock).sweep(minutes(11));
    expect(f.steps()).toHaveLength(1);
    const [prompt] = prompts(f);
    expect(prompt).toContain('[queue-wait]');
    expect(prompt).toContain('check-success = pr-size');
    expect(prompt).not.toContain('-draft');
    expect(prompt).not.toContain('#files <= 80');
    expect(prompt).not.toContain('check-skipped = check');
    f.settle();
    await watchFor(f.s, f.mock).sweep(minutes(20));
    expect(f.steps()).toHaveLength(1);
  });

  test('a changed list of unmet conditions on the same head wakes again', async () => {
    const f = fixture();
    green(f);
    await watchFor(f.s, f.mock).sweep(minutes(11));
    f.settle();
    green(f, unmet.replace('pr-size', 'merge-route'));
    await watchFor(f.s, f.mock).sweep(minutes(12));
    expect(f.steps()).toHaveLength(2);
    expect(prompts(f)[1]).toContain('check-success = merge-route');
  });

  test('an unreadable review-findings snapshot is unknown, so no queue wake fires', async () => {
    const f = fixture();
    green(f);
    f.mock.threads = 'failing';
    await watchFor(f.s, f.mock).sweep(minutes(30));
    expect(prompts(f).filter((p) => p.includes('[queue-wait]'))).toHaveLength(0);
    f.mock.threads = 'none';
    await watchFor(f.s, f.mock).sweep(minutes(31));
    expect(prompts(f).filter((p) => p.includes('[queue-wait]'))).toHaveLength(1);
  });

  test('a superseded failed attempt of a check does not hide a green rerun', async () => {
    const f = fixture();
    green(f, unmet, [
      {
        id: 1,
        name: 'unit',
        status: 'completed',
        conclusion: 'failure',
        completedAt: new Date(minutes(-20)).toISOString(),
      },
    ]);
    const runs = f.mock.checks.get(f.pull.head) ?? [];
    for (const run of runs) if (run.name === 'unit' && run.conclusion === 'success') run.id = 2;
    await watchFor(f.s, f.mock).sweep(minutes(11));
    expect(prompts(f).filter((p) => p.includes('[queue-wait]'))).toHaveLength(1);
  });

  test('an older success of a check does not hide a newer failure', async () => {
    const f = fixture();
    green(f, unmet, [
      {
        id: 2,
        name: 'unit',
        status: 'completed',
        conclusion: 'failure',
        summary: 'broken',
        completedAt: new Date(T0).toISOString(),
      },
    ]);
    const runs = f.mock.checks.get(f.pull.head) ?? [];
    for (const run of runs) {
      if (run.name === 'unit' && run.conclusion === 'success') {
        run.id = 1;
        run.completedAt = new Date(minutes(-20)).toISOString();
      }
    }
    await watchFor(f.s, f.mock).sweep(minutes(11));
    const fix = prompts(f).filter((p) => p.includes('[ci-fix]'));
    expect(fix).toHaveLength(1);
    expect(fix[0]).toContain('unit');
    expect(fix[0]).toContain('broken');
    expect(prompts(f).filter((p) => p.includes('[queue-wait]'))).toHaveLength(0);
  });

  test.each([
    [
      'a pending check',
      (f: ReturnType<typeof fixture>) =>
        green(f, unmet, [{ name: 'gates', status: 'in_progress', conclusion: null }]),
    ],
    [
      'a draft PR',
      (f: ReturnType<typeof fixture>) => {
        green(f);
        f.pull.draft = true;
      },
    ],
    [
      'coordinator-hold',
      (f: ReturnType<typeof fixture>) => {
        green(f);
        f.pull.labels = ['coordinator-hold'];
      },
    ],
    [
      'a queued PR',
      (f: ReturnType<typeof fixture>) =>
        f.mock.checks.set(f.pull.head, [
          {
            name: 'unit',
            status: 'completed',
            conclusion: 'success',
            completedAt: new Date(T0).toISOString(),
          },
          {
            name: 'Mergify Merge Queue',
            status: 'in_progress',
            conclusion: null,
            title: 'Running merge queue checks',
            summary: unmet,
          },
        ]),
    ],
    [
      'a check without a completion time',
      (f: ReturnType<typeof fixture>) =>
        f.mock.checks.set(f.pull.head, [
          { name: 'unit', status: 'completed', conclusion: 'success' },
          waiting(unmet),
        ]),
    ],
  ])('no queue wake with %s', async (_name, arrange) => {
    const f = fixture();
    arrange(f);
    await watchFor(f.s, f.mock).sweep(minutes(30));
    expect(prompts(f).filter((p) => p.includes('[queue-wait]'))).toHaveLength(0);
  });
});
