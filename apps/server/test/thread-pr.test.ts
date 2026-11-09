import { createHash } from 'node:crypto';
import { prPanelListSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  build as buildTable,
  gateVerdict as gateVerdictTable,
  project as projectTable,
  step as stepTable,
  team as teamTable,
  threadPr as threadPrTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { CI_CLOSED_CONFIRM_MS } from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { createPrWatch, PR_WATCH_SLOW_INTERVAL_MS } from '../src/services/pr-watch.js';
import { listThreadPrs } from '../src/services/thread-pr.js';
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
  branch?: string;
  base?: string;
  additions?: number;
  deletions?: number;
  body?: string;
}

interface RunSpec {
  name: string;
  status: string;
  conclusion: string | null;
}

class GithubMock {
  pulls = new Map<string, PullSpec>();
  checks = new Map<string, RunSpec[]>();
  failing = new Set<string>();
  failingChecks = false;
  remaining: number | null = null;
  limit = 5000;
  resetAtSeconds: number | null = null;
  requests: string[] = [];
  authorizations: string[] = [];
  notModified = 0;
  bodyEdits: { key: string; body: string }[] = [];
  fetch = vi.fn(
    (
      input: string | URL,
      init?: { method?: string; headers?: Record<string, string>; body?: string },
    ) => {
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
      const pull = /\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(url);
      if (pull) {
        const key = `${(pull[1] ?? '').toLowerCase()}#${pull[2]}`;
        const spec = this.pulls.get(key);
        if (this.failing.has(key) || spec === undefined) return send(500, { message: 'boom' });
        if (init?.method === 'PATCH') {
          const edited = (JSON.parse(init.body ?? '{}') as { body: string }).body;
          this.bodyEdits.push({ key, body: edited });
          this.pulls.set(key, { ...spec, body: edited });
          return send(200, { number: Number(pull[2]), body: edited });
        }
        return send(200, {
          body: spec.body ?? '## What\n\nA change.',
          state: spec.state ?? 'open',
          merged: spec.merged ?? false,
          draft: spec.draft ?? false,
          title: spec.title ?? 'server(1): a change',
          html_url: `https://github.com/${pull[1]}/pull/${pull[2]}`,
          mergeable_state: spec.mergeable ?? 'clean',
          additions: spec.additions ?? 12,
          deletions: spec.deletions ?? 3,
          head: { sha: spec.head ?? HEAD_A, ref: spec.branch ?? 'cairn/feature' },
          base: { ref: spec.base ?? 'main' },
        });
      }
      const runs = /\/commits\/([0-9a-f]+)\/check-runs/.exec(url);
      if (runs) {
        if (this.failingChecks) return send(500, { message: 'boom' });
        return send(200, {
          check_runs: (this.checks.get(runs[1] ?? '') ?? []).map((r) => ({
            ...r,
            output: { title: null, summary: null },
          })),
        });
      }
      return send(404, { message: 'not found' });
    },
  );
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
    sourceKind?: 'github-issue' | 'github-issue-self' | null;
    sourceRef?: string | null;
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
      sourceKind: opts.sourceKind ?? null,
      sourceRef: opts.sourceRef ?? null,
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

describe('F1 a thread PR is recorded once, with the panel fields', () => {
  test('one row per owned PR, repeated sweeps never add another', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, {
      additions: 40,
      deletions: 7,
      title: 'server(9): x',
    });
    mock.checks.set(HEAD_A, [
      { name: 'unit', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'failure' },
      { name: 'e2e', status: 'in_progress', conclusion: null },
      { name: 'docs', status: 'completed', conclusion: 'skipped' },
    ]);
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    await watch.sweep(70_000);
    await watch.sweep(140_000);
    const all = rows(s);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      teamId: s.team.id,
      threadId: t.todoId,
      buildId: t.buildId,
      repo: 'octo/demo',
      number: t.prNumber,
      title: 'server(9): x',
      url: `https://github.com/octo/demo/pull/${t.prNumber}`,
      state: 'open',
      mergeState: 'clean',
      additions: 40,
      deletions: 7,
      head: HEAD_A,
      checksPassed: 2,
      checksFailed: 1,
      checksRunning: 1,
      checksTotal: 4,
      autoFix: true,
      mergeWhenReady: false,
      autoArchive: true,
      dismissed: false,
      wakeRounds: 0,
    });
  });

  test('the panel row carries the project of its thread, archived or not', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, {});
    await watchFor(s, mock).sweep(1_000);
    const projectId = s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, t.todoId))
      .get()?.projectId;
    expect(projectId).toBeTruthy();
    expect(listThreadPrs(s.db, { teamId: s.team.id })[0]?.projectId).toBe(projectId);
    s.db.update(todoTable).set({ archivedAt: 5 }).where(eq(todoTable.id, t.todoId)).run();
    expect(listThreadPrs(s.db, { teamId: s.team.id })[0]?.projectId).toBe(projectId);
  });

  test('the panel row names the branch, its base and the failing checks', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, { branch: 'cairn/pr-panel', base: 'main' });
    mock.checks.set(HEAD_A, [
      { name: 'unit', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'failure' },
      { name: 'e2e (1)', status: 'completed', conclusion: 'timed_out' },
      { name: 'e2e (1)', status: 'completed', conclusion: 'failure' },
    ]);
    await watchFor(s, mock).sweep(1_000);
    const [row] = listThreadPrs(s.db, { teamId: s.team.id, threadId: t.todoId });
    expect(row).toMatchObject({ branch: 'cairn/pr-panel', base: 'main' });
    expect(row?.checks.failedNames).toEqual(['lint', 'e2e (1)']);
  });

  test('an unchanged PR polled successfully, including on a 304, moves lastReadAt', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, {});
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    await watch.sweep(70_000);
    expect(mock.notModified).toBeGreaterThan(0);
    const [row] = listThreadPrs(s.db, { teamId: s.team.id, threadId: t.todoId });
    expect(row?.lastReadAt).toBe(70_000);
  });

  test('repeated unreadable check runs keep the old counts and leave lastReadAt at the last full read', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, {});
    mock.checks.set(HEAD_A, [{ name: 'unit', status: 'completed', conclusion: 'success' }]);
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    mock.failingChecks = true;
    await watch.sweep(70_000);
    await watch.sweep(140_000);
    const [row] = listThreadPrs(s.db, { teamId: s.team.id, threadId: t.todoId });
    expect(row?.checks).toMatchObject({ passed: 1, total: 1 });
    expect(row?.lastReadAt).toBe(1_000);
    mock.failingChecks = false;
    await watch.sweep(210_000);
    expect(listThreadPrs(s.db, { teamId: s.team.id, threadId: t.todoId })[0]?.lastReadAt).toBe(
      210_000,
    );
  });

  test('a new PR whose check runs cannot be read is recorded as never fully read', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, {});
    mock.failingChecks = true;
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    expect(rows(s)[0]?.lastReadAt).toBe(0);
    mock.failingChecks = false;
    await watch.sweep(70_000);
    expect(rows(s)[0]?.lastReadAt).toBe(70_000);
  });

  test('a changed pull with unreadable check runs still updates its fields but not lastReadAt', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, { title: 'before' });
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    mock.failingChecks = true;
    mock.pulls.set(`octo/demo#${t.prNumber}`, { title: 'after' });
    await watch.sweep(70_000);
    expect(rows(s)[0]).toMatchObject({ title: 'after', lastReadAt: 1_000 });
  });

  test('checksReadFor names the head the checks were read for, and a head change with a failed read keeps the old one', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, { head: HEAD_A });
    mock.checks.set(HEAD_A, [{ name: 'unit', status: 'completed', conclusion: 'success' }]);
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    expect(listThreadPrs(s.db, { teamId: s.team.id, threadId: t.todoId })[0]).toMatchObject({
      head: HEAD_A,
      checksReadFor: HEAD_A,
    });
    mock.pulls.set(`octo/demo#${t.prNumber}`, { head: HEAD_B });
    mock.failingChecks = true;
    await watch.sweep(70_000);
    await watch.sweep(140_000);
    const [row] = listThreadPrs(s.db, { teamId: s.team.id, threadId: t.todoId });
    expect(row).toMatchObject({ head: HEAD_B, checksReadFor: '' });
    expect(row?.checks.total).toBe(0);
    mock.failingChecks = false;
    mock.checks.set(HEAD_B, [{ name: 'unit', status: 'completed', conclusion: 'success' }]);
    await watch.sweep(210_000);
    expect(listThreadPrs(s.db, { teamId: s.team.id, threadId: t.todoId })[0]).toMatchObject({
      head: HEAD_B,
      checksReadFor: HEAD_B,
    });
  });

  test('a force-push back to a head whose tally was discarded does not read as read', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, { head: HEAD_A });
    mock.checks.set(HEAD_A, [{ name: 'unit', status: 'completed', conclusion: 'success' }]);
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    mock.failingChecks = true;
    mock.pulls.set(`octo/demo#${t.prNumber}`, { head: HEAD_B });
    await watch.sweep(70_000);
    mock.pulls.set(`octo/demo#${t.prNumber}`, { head: HEAD_A });
    await watch.sweep(140_000);
    const [row] = listThreadPrs(s.db, { teamId: s.team.id, threadId: t.todoId });
    expect(row).toMatchObject({ head: HEAD_A, checksReadFor: '' });
    expect(row?.checks.total).toBe(0);
  });

  test('a failed poll leaves lastReadAt at the last good read', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, {});
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    mock.failing.add(`octo/demo#${t.prNumber}`);
    await watch.sweep(70_000);
    const [row] = listThreadPrs(s.db, { teamId: s.team.id, threadId: t.todoId });
    expect(row?.lastReadAt).toBe(1_000);
  });

  test('mergeable_state values map onto the panel merge states, a draft shows as draft', async () => {
    const s = boot();
    const mock = new GithubMock();
    const expected: Array<[string, string]> = [
      ['clean', 'clean'],
      ['has_hooks', 'clean'],
      ['behind', 'behind'],
      ['dirty', 'dirty'],
      ['blocked', 'blocked'],
      ['unstable', 'unstable'],
      ['unknown', 'unknown'],
      ['something-new', 'unknown'],
    ];
    const seeded = expected.map(([mergeable]) => {
      const t = seedThread(s);
      mock.pulls.set(`octo/demo#${t.prNumber}`, { mergeable });
      return t;
    });
    const draft = seedThread(s);
    mock.pulls.set(`octo/demo#${draft.prNumber}`, { draft: true, mergeable: 'blocked' });
    await watchFor(s, mock).sweep(1_000);
    for (const [i, [, state]] of expected.entries()) {
      const row = rows(s).find((r) => r.buildId === seeded[i]?.buildId);
      expect(row?.mergeState).toBe(state);
      expect(row?.state).toBe('open');
    }
    expect(rows(s).find((r) => r.buildId === draft.buildId)).toMatchObject({
      state: 'draft',
      mergeState: 'blocked',
    });
  });

  test('toggles the user set survive later polls', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s);
    mock.pulls.set(`octo/demo#${t.prNumber}`, {});
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    s.db
      .update(threadPrTable)
      .set({
        mergeWhenReady: true,
        autoFix: false,
        autoArchive: false,
        dismissed: true,
        wakeRounds: 4,
      })
      .run();
    mock.pulls.set(`octo/demo#${t.prNumber}`, { head: HEAD_B, title: 'renamed' });
    await watch.sweep(70_000);
    expect(rows(s)[0]).toMatchObject({
      mergeWhenReady: true,
      autoFix: false,
      autoArchive: false,
      dismissed: true,
      wakeRounds: 4,
      title: 'renamed',
      head: HEAD_B,
    });
  });
});

describe('F2 duplicate PR rows cannot exist', () => {
  test('two threads pointing at one PR leave one row, owned by the first', async () => {
    const s = boot();
    const mock = new GithubMock();
    const first = seedThread(s, { prNumber: 300 });
    const second = seedThread(s, { prNumber: 300 });
    mock.pulls.set('octo/demo#300', {});
    const tally = await watchFor(s, mock).sweep(1_000);
    expect(rows(s)).toHaveLength(1);
    expect([first.buildId, second.buildId]).toContain(rows(s)[0]?.buildId);
    expect(tally.duplicates).toBe(1);
  });

  test('the repo is compared case-insensitively', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 310, repo: 'Octo/Demo' });
    seedThread(s, { prNumber: 310, repo: 'octo/demo' });
    mock.pulls.set('octo/demo#310', {});
    await watchFor(s, mock).sweep(1_000);
    expect(rows(s)).toHaveLength(1);
    expect(rows(s)[0]?.repo).toBe('octo/demo');
  });

  test('the table itself rejects a second row for the same build or the same PR', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 320 });
    mock.pulls.set('octo/demo#320', {});
    await watchFor(s, mock).sweep(1_000);
    const existing = rows(s)[0];
    expect(existing).toBeDefined();
    const other = seedThread(s, { prNumber: 321 });
    const { id: _id, ...rest } = existing as NonNullable<typeof existing>;
    expect(() =>
      s.db
        .insert(threadPrTable)
        .values({ ...rest, id: 'dup-build' })
        .run(),
    ).toThrow(/UNIQUE/);
    expect(() =>
      s.db
        .insert(threadPrTable)
        .values({ ...rest, id: 'dup-number', buildId: other.buildId, threadId: other.todoId })
        .run(),
    ).toThrow(/UNIQUE/);
    expect(t.prNumber).toBe(320);
  });

  test('a build whose PR number is adopted to another PR updates its row in place', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 330 });
    mock.pulls.set('octo/demo#330', {});
    mock.pulls.set('octo/demo#331', { title: 'adopted' });
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    s.db
      .update(buildTable)
      .set({ prNumber: 331, prUrl: 'https://github.com/octo/demo/pull/331' })
      .where(eq(buildTable.id, t.buildId))
      .run();
    await watch.sweep(70_000);
    expect(rows(s)).toHaveLength(1);
    expect(rows(s)[0]).toMatchObject({ number: 331, title: 'adopted', buildId: t.buildId });
  });

  test('a thread whose latest build moved on drops the superseded build row', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 340 });
    mock.pulls.set('octo/demo#340', {});
    mock.pulls.set('octo/demo#341', {});
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    s.db
      .insert(buildTable)
      .values({
        id: 'build-next',
        todoId: t.todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: 2,
        prNumber: 341,
        prUrl: 'https://github.com/octo/demo/pull/341',
      })
      .run();
    s.db
      .update(todoTable)
      .set({ latestBuildId: 'build-next' })
      .where(eq(todoTable.id, t.todoId))
      .run();
    await watch.sweep(70_000);
    expect(rows(s).map((r) => [r.buildId, r.number])).toEqual([['build-next', 341]]);
  });

  test('a build whose PR association was cleared drops its row and frees the PR', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 350 });
    mock.pulls.set('octo/demo#350', {});
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    expect(rows(s)).toHaveLength(1);
    s.db
      .update(buildTable)
      .set({ prNumber: null, prUrl: null })
      .where(eq(buildTable.id, t.buildId))
      .run();
    const tally = await watch.sweep(70_000);
    expect(tally.pruned).toBe(1);
    expect(rows(s)).toHaveLength(0);
    const other = seedThread(s, { prNumber: 350 });
    await watch.sweep(140_000);
    expect(rows(s).map((r) => [r.buildId, r.number])).toEqual([[other.buildId, 350]]);
  });

  test('a build rebound to another PR moves its row instead of keeping the old number', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 360 });
    mock.pulls.set('octo/demo#360', {});
    mock.pulls.set('octo/demo#361', {});
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    s.db
      .update(buildTable)
      .set({ prNumber: 361, prUrl: 'https://github.com/octo/demo/pull/361' })
      .where(eq(buildTable.id, t.buildId))
      .run();
    await watch.sweep(70_000);
    expect(rows(s).map((r) => [r.buildId, r.number])).toEqual([[t.buildId, 361]]);
  });
});

describe('F3 a PR whose thread was deleted disappears', () => {
  test('deleting the thread removes its row and later sweeps ignore it', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 400 });
    mock.pulls.set('octo/demo#400', {});
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    expect(rows(s)).toHaveLength(1);
    s.db.delete(todoTable).where(eq(todoTable.id, t.todoId)).run();
    expect(rows(s)).toHaveLength(0);
    const before = mock.requests.length;
    await watch.sweep(70_000);
    expect(mock.requests.length).toBe(before);
    expect(listThreadPrs(s.db, { teamId: s.team.id })).toEqual([]);
  });
});

describe('F4 the head SHA changes', () => {
  test('a push re-reads the pull and the checks of the new head, and 304s stay free', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 500 });
    mock.pulls.set('octo/demo#500', { head: HEAD_A, mergeable: 'blocked' });
    mock.checks.set(HEAD_A, [{ name: 'unit', status: 'completed', conclusion: 'failure' }]);
    mock.checks.set(HEAD_B, [{ name: 'unit', status: 'in_progress', conclusion: null }]);
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    expect(rows(s)[0]).toMatchObject({ head: HEAD_A, checksFailed: 1, blockedSince: 1_000 });
    const quiet = await watch.sweep(70_000);
    expect(quiet.notModified).toBeGreaterThanOrEqual(2);
    expect(rows(s)[0]).toMatchObject({ head: HEAD_A, blockedSince: 1_000 });
    mock.pulls.set('octo/demo#500', { head: HEAD_B, mergeable: 'blocked' });
    await watch.sweep(140_000);
    expect(rows(s)[0]).toMatchObject({
      head: HEAD_B,
      checksFailed: 0,
      checksRunning: 1,
      blockedSince: 140_000,
    });
    expect(mock.count(`/commits/${HEAD_B}/check-runs`)).toBe(1);
    expect(t.prNumber).toBe(500);
  });

  test('leaving the blocked state clears blockedSince', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 510 });
    mock.pulls.set('octo/demo#510', { mergeable: 'blocked' });
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    expect(rows(s)[0]?.blockedSince).toBe(1_000);
    mock.pulls.set('octo/demo#510', { mergeable: 'clean' });
    await watch.sweep(70_000);
    expect(rows(s)[0]?.blockedSince).toBeNull();
  });

  test('an unreadable pull leaves the row as it was', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 520 });
    mock.pulls.set('octo/demo#520', { title: 'kept' });
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    mock.failing.add('octo/demo#520');
    const tally = await watch.sweep(70_000);
    expect(rows(s)[0]).toMatchObject({ title: 'kept', state: 'open' });
    expect(tally.unreadable).toBe(1);
  });
});

describe('F5 a merged or closed PR stops being read', () => {
  test('merged is recorded at once and never read again', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 600 });
    mock.pulls.set('octo/demo#600', { state: 'closed', merged: true });
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    expect(rows(s)[0]?.state).toBe('merged');
    const before = mock.requests.length;
    await watch.sweep(70_000);
    expect(mock.requests.length).toBe(before);
  });

  test('closed unmerged needs a second sighting past the confirm window', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 610 });
    mock.pulls.set('octo/demo#610', {});
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    mock.pulls.set('octo/demo#610', { state: 'closed', merged: false });
    await watch.sweep(70_000);
    expect(rows(s)[0]?.state).toBe('open');
    await watch.sweep(70_000 + CI_CLOSED_CONFIRM_MS + 1);
    expect(rows(s)[0]?.state).toBe('closed');
    mock.pulls.set('octo/demo#610', {});
    const before = mock.requests.length;
    await watch.sweep(400_000);
    expect(mock.requests.length).toBe(before);
    expect(rows(s)[0]?.state).toBe('closed');
  });

  test('a closed PR that reopens before the confirm window is not recorded as closed', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 620 });
    mock.pulls.set('octo/demo#620', { state: 'closed', merged: false });
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    expect(rows(s)).toHaveLength(0);
    mock.pulls.set('octo/demo#620', {});
    await watch.sweep(1_000 + CI_CLOSED_CONFIRM_MS + 1);
    expect(rows(s)[0]?.state).toBe('open');
  });

  test('a thread archived with an open PR is not read any more', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 630 });
    mock.pulls.set('octo/demo#630', {});
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    s.db.update(todoTable).set({ archivedAt: 9 }).where(eq(todoTable.id, t.todoId)).run();
    const before = mock.requests.length;
    await watch.sweep(70_000);
    expect(mock.requests.length).toBe(before);
  });

  test('a build without a PR number is skipped', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: null });
    const tally = await watchFor(s, mock).sweep(1_000);
    expect(tally.watched).toBe(0);
    expect(mock.requests).toEqual([]);
  });
});

describe('F6 one team never sees or drives another team', () => {
  function seedOtherTeam(s: TestServer) {
    s.db.insert(teamTable).values({ id: 'team-b', name: 'B', createdAt: 1 }).run();
    return seedThread(s, { teamId: 'team-b', prNumber: 700 });
  }

  test('the other team has no token, so its PR is never read with ours', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedOtherTeam(s);
    mock.pulls.set('octo/demo#700', {});
    await watchFor(s, mock).sweep(1_000);
    expect(mock.requests).toEqual([]);
    expect(rows(s)).toHaveLength(0);
  });

  test('each team reads with its own token and its rows carry its own teamId', async () => {
    const s = boot();
    const mock = new GithubMock();
    const other = seedOtherTeam(s);
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: 'team-b', login: 'bee', accessToken: 'gho_team_b', scope: 'repo' },
    );
    const mine = seedThread(s, { prNumber: 701 });
    mock.pulls.set('octo/demo#700', {});
    mock.pulls.set('octo/demo#701', {});
    await watchFor(s, mock).sweep(1_000);
    const authFor = (n: number) =>
      mock.requests.flatMap((u, i) => (u.endsWith(`/pulls/${n}`) ? [mock.authorizations[i]] : []));
    expect(authFor(700)).toEqual(['Bearer gho_team_b']);
    expect(authFor(701)).toEqual(['Bearer gho_team_a']);
    expect(rows(s).find((r) => r.buildId === other.buildId)?.teamId).toBe('team-b');
    expect(rows(s).find((r) => r.buildId === mine.buildId)?.teamId).toBe(s.team.id);
  });

  test('GET /api/prs returns only the caller team, and a foreign threadId returns nothing', async () => {
    const s = boot();
    const mock = new GithubMock();
    const other = seedOtherTeam(s);
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: 'team-b', login: 'bee', accessToken: 'gho_team_b', scope: 'repo' },
    );
    const mine = seedThread(s, { prNumber: 702 });
    mock.pulls.set('octo/demo#700', {});
    mock.pulls.set('octo/demo#702', {});
    await watchFor(s, mock).sweep(1_000);
    const list = prPanelListSchema.parse(await (await req(s.app, 'GET', '/api/prs')).json());
    expect(list.map((r) => r.buildId)).toEqual([mine.buildId]);
    const foreign = await req(s.app, 'GET', `/api/prs?threadId=${other.todoId}`);
    expect(foreign.status).toBe(200);
    expect(await foreign.json()).toEqual([]);
    const spoof = prPanelListSchema.parse(
      await (await req(s.app, 'GET', '/api/prs?teamId=team-b')).json(),
    );
    expect(spoof.map((r) => r.buildId)).toEqual([mine.buildId]);
  });
});

describe('F7 the poll backs off when the rate limit runs low', () => {
  test('below 20 percent the team is read at most every five minutes', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 800 });
    mock.pulls.set('octo/demo#800', {});
    mock.remaining = 900;
    const watch = watchFor(s, mock);
    const first = await watch.sweep(1_000);
    expect(first.pacing).toBe('normal');
    const before = mock.requests.length;
    const skipped = await watch.sweep(70_000);
    expect(skipped.pacing).toBe('stretched');
    expect(mock.requests.length).toBe(before);
    await watch.sweep(1_000 + PR_WATCH_SLOW_INTERVAL_MS);
    expect(mock.requests.length).toBeGreaterThan(before);
  });

  test('at or above 20 percent every minute is read', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 810 });
    mock.pulls.set('octo/demo#810', {});
    mock.remaining = 1_000;
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    const before = mock.requests.length;
    const again = await watch.sweep(70_000);
    expect(again.pacing).toBe('normal');
    expect(mock.requests.length).toBeGreaterThan(before);
  });

  test('below 5 percent only armed or awake PRs are read', async () => {
    const s = boot();
    const mock = new GithubMock();
    const idle = seedThread(s, { prNumber: 820 });
    const armed = seedThread(s, { prNumber: 821 });
    const awake = seedThread(s, { prNumber: 822 });
    for (const n of [820, 821, 822]) mock.pulls.set(`octo/demo#${n}`, {});
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    s.db
      .update(threadPrTable)
      .set({ mergeWhenReady: true })
      .where(eq(threadPrTable.buildId, armed.buildId))
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 'step-live',
        buildId: awake.buildId,
        kind: 'session',
        status: 'claimed',
        createdAt: 1,
      })
      .run();
    mock.remaining = 100;
    await watch.sweep(70_000);
    mock.requests.length = 0;
    const tally = await watch.sweep(70_000 + PR_WATCH_SLOW_INTERVAL_MS);
    expect(tally.pacing).toBe('armed-only');
    expect(mock.count('/pulls/821')).toBeGreaterThan(0);
    expect(mock.count('/pulls/822')).toBeGreaterThan(0);
    expect(mock.count('/pulls/820')).toBe(0);
    expect(idle.prNumber).toBe(820);
  });

  test('armed-only pacing ends once the rate window has reset', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 830 });
    mock.pulls.set('octo/demo#830', {});
    const watch = watchFor(s, mock);
    mock.remaining = 100;
    mock.resetAtSeconds = 400;
    await watch.sweep(1_000);
    const limited = await watch.sweep(1_000 + PR_WATCH_SLOW_INTERVAL_MS);
    expect(limited.pacing).toBe('armed-only');
    mock.remaining = 5000;
    mock.requests.length = 0;
    const recovered = await watch.sweep(500_000);
    expect(recovered.pacing).toBe('normal');
    expect(mock.count('/pulls/830')).toBeGreaterThan(0);
  });

  test('armed-only pacing without a reset header ends after one hour', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 831 });
    mock.pulls.set('octo/demo#831', {});
    const watch = watchFor(s, mock);
    mock.remaining = 100;
    await watch.sweep(1_000);
    const limited = await watch.sweep(1_000 + PR_WATCH_SLOW_INTERVAL_MS);
    expect(limited.pacing).toBe('armed-only');
    mock.remaining = 5000;
    const recovered = await watch.sweep(1_000 + 3_600_000 + PR_WATCH_SLOW_INTERVAL_MS);
    expect(recovered.pacing).toBe('normal');
  });
});

describe('F8 GET /api/prs', () => {
  test('lists the team rows newest first, filtered by thread, without dismissed ones', async () => {
    const s = boot();
    const mock = new GithubMock();
    const a = seedThread(s, { prNumber: 900 });
    const b = seedThread(s, { prNumber: 901 });
    const c = seedThread(s, { prNumber: 902 });
    for (const n of [900, 901, 902]) mock.pulls.set(`octo/demo#${n}`, {});
    await watchFor(s, mock).sweep(1_000);
    s.db
      .update(threadPrTable)
      .set({ updatedAt: 10 })
      .where(eq(threadPrTable.buildId, a.buildId))
      .run();
    s.db
      .update(threadPrTable)
      .set({ updatedAt: 30 })
      .where(eq(threadPrTable.buildId, b.buildId))
      .run();
    s.db
      .update(threadPrTable)
      .set({ updatedAt: 20, dismissed: true })
      .where(eq(threadPrTable.buildId, c.buildId))
      .run();
    const all = prPanelListSchema.parse(await (await req(s.app, 'GET', '/api/prs')).json());
    expect(all.map((r) => r.buildId)).toEqual([b.buildId, a.buildId]);
    const one = prPanelListSchema.parse(
      await (await req(s.app, 'GET', `/api/prs?threadId=${a.todoId}`)).json(),
    );
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({
      buildId: a.buildId,
      threadId: a.todoId,
      repo: 'octo/demo',
      number: 900,
      state: 'open',
      checks: { passed: 0, failed: 0, running: 0, total: 0 },
      verdict: null,
      autoFix: true,
      mergeWhenReady: false,
    });
  });

  test('home hides finished PRs of archived threads, the thread view keeps them', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 910 });
    mock.pulls.set('octo/demo#910', { state: 'closed', merged: true });
    await watchFor(s, mock).sweep(1_000);
    expect(
      prPanelListSchema.parse(await (await req(s.app, 'GET', '/api/prs')).json()),
    ).toHaveLength(1);
    s.db.update(todoTable).set({ archivedAt: 9 }).where(eq(todoTable.id, t.todoId)).run();
    expect(await (await req(s.app, 'GET', '/api/prs')).json()).toEqual([]);
    const own = prPanelListSchema.parse(
      await (await req(s.app, 'GET', `/api/prs?threadId=${t.todoId}`)).json(),
    );
    expect(own.map((r) => r.state)).toEqual(['merged']);
  });

  test('the review verdict comes from the newest review verdict row of the build', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 920 });
    mock.pulls.set('octo/demo#920', {});
    s.db
      .insert(gateVerdictTable)
      .values([
        {
          stepId: 'v1',
          buildId: t.buildId,
          kind: 'review',
          outcome: 'block',
          headSha: HEAD_A,
          expectedHeadSha: HEAD_A,
          createdAt: 10,
        },
        {
          stepId: 'v2',
          buildId: t.buildId,
          kind: 'review',
          outcome: 'pass',
          headSha: HEAD_B,
          expectedHeadSha: HEAD_B,
          createdAt: 20,
        },
        {
          stepId: 'v3',
          buildId: t.buildId,
          kind: 'verify',
          outcome: 'block',
          headSha: HEAD_A,
          expectedHeadSha: HEAD_A,
          createdAt: 30,
        },
      ])
      .run();
    await watchFor(s, mock).sweep(1_000);
    const [row] = prPanelListSchema.parse(await (await req(s.app, 'GET', '/api/prs')).json());
    expect(row?.verdict).toEqual({ result: 'pass', judgedHead: HEAD_B });
  });

  test('a review that did not produce pass or block shows no verdict', async () => {
    const s = boot();
    const mock = new GithubMock();
    const t = seedThread(s, { prNumber: 930 });
    mock.pulls.set('octo/demo#930', {});
    s.db
      .insert(gateVerdictTable)
      .values({
        stepId: 'v9',
        buildId: t.buildId,
        kind: 'review',
        outcome: 'step_failed',
        headSha: null,
        expectedHeadSha: HEAD_A,
        createdAt: 10,
      })
      .run();
    await watchFor(s, mock).sweep(1_000);
    expect(rows(s)[0]).toMatchObject({ verdictResult: null, verdictHead: null });
  });
});

describe('F8 the PR body carries a closing keyword for the task issue', () => {
  test('a self-issue task PR without the keyword gets one Closes line at the top, once', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, {
      prNumber: 1010,
      sourceKind: 'github-issue-self',
      sourceRef: 'github:octo/demo#77',
    });
    mock.pulls.set('octo/demo#1010', { body: '## What\n\nRefs #7 and #770, fixes #7700.' });
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    await watch.sweep(70_000);
    expect(mock.bodyEdits).toEqual([
      { key: 'octo/demo#1010', body: 'Closes #77\n\n## What\n\nRefs #7 and #770, fixes #7700.' },
    ]);
  });

  test('a worker rewrite that drops the line gets it back on the next sweep', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, {
      prNumber: 1015,
      sourceKind: 'github-issue-self',
      sourceRef: 'github:octo/demo#78',
    });
    mock.pulls.set('octo/demo#1015', { body: 'first' });
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    mock.pulls.set('octo/demo#1015', { body: 'rewritten' });
    await watch.sweep(70_000);
    expect(mock.bodyEdits.map((edit) => edit.body)).toEqual([
      'Closes #78\n\nfirst',
      'Closes #78\n\nrewritten',
    ]);
  });

  test.each([
    'closes #77',
    'Fixes: #77.',
    'RESOLVED octo/demo#77',
    'This pull request fixes #77 for real.',
  ])('a body that already says %s is left alone', async (line) => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, {
      prNumber: 1020,
      sourceKind: 'github-issue-self',
      sourceRef: 'github:octo/demo#77',
    });
    mock.pulls.set('octo/demo#1020', { body: `## What\n\n${line}` });
    await watchFor(s, mock).sweep(1_000);
    expect(mock.bodyEdits).toEqual([]);
  });

  test.each([
    ['a fenced code block', '```\nCloses #77\n```'],
    ['an HTML comment', '<!-- Closes #77 -->'],
    ['an inline code span', 'run `closes #77` later'],
  ])('a keyword only inside %s does not count, so the line is added', async (_name, inert) => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, {
      prNumber: 1025,
      sourceKind: 'github-issue-self',
      sourceRef: 'github:octo/demo#77',
    });
    mock.pulls.set('octo/demo#1025', { body: inert });
    await watchFor(s, mock).sweep(1_000);
    expect(mock.bodyEdits.map((edit) => edit.body)).toEqual([`Closes #77\n\n${inert}`]);
  });

  test('the edit builds on the body as it is now, not on the body the sweep read earlier', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, {
      prNumber: 1027,
      sourceKind: 'github-issue-self',
      sourceRef: 'github:octo/demo#79',
    });
    mock.pulls.set('octo/demo#1027', { body: 'old' });
    let reads = 0;
    const inner = mock.fetch.getMockImplementation();
    mock.fetch.mockImplementation((input, init) => {
      if (init?.method !== 'PATCH' && String(input).endsWith('/pulls/1027')) {
        reads += 1;
        if (reads === 2) mock.pulls.set('octo/demo#1027', { body: 'edited meanwhile' });
      }
      return inner!(input, init);
    });
    await watchFor(s, mock).sweep(1_000);
    expect(mock.bodyEdits.map((edit) => edit.body)).toEqual(['Closes #79\n\nedited meanwhile']);
  });

  test.each([
    ['an unclosed fence', '## What\n\n```text\nlog output'],
    ['an unclosed HTML comment', '## What\n\n<!-- note'],
  ])('a body ending in %s converges after one edit', async (_name, open) => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, {
      prNumber: 1029,
      sourceKind: 'github-issue-self',
      sourceRef: 'github:octo/demo#81',
    });
    mock.pulls.set('octo/demo#1029', { body: open });
    const watch = watchFor(s, mock);
    await watch.sweep(1_000);
    await watch.sweep(70_000);
    await watch.sweep(140_000);
    expect(mock.bodyEdits.map((edit) => edit.body)).toEqual([`Closes #81\n\n${open}`]);
  });

  test('an imported issue from the same repo is closed the same way', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 1030, sourceKind: 'github-issue', sourceRef: 'github:octo/demo#5' });
    mock.pulls.set('octo/demo#1030', { body: 'x' });
    await watchFor(s, mock).sweep(1_000);
    expect(mock.bodyEdits.map((edit) => edit.body)).toEqual(['Closes #5\n\nx']);
  });

  test.each([
    ['no issue', null, null],
    ['an issue still being created', 'github-issue-self', null],
    ['an issue in another repo', 'github-issue', 'github:octo/other#5'],
  ] as const)('a task with %s gets no closing line', async (_name, sourceKind, sourceRef) => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, { prNumber: 1040, sourceKind, sourceRef });
    mock.pulls.set('octo/demo#1040', { body: 'x' });
    await watchFor(s, mock).sweep(1_000);
    expect(mock.bodyEdits).toEqual([]);
  });

  test('a merged or closed PR body is never edited', async () => {
    const s = boot();
    const mock = new GithubMock();
    seedThread(s, {
      prNumber: 1050,
      sourceKind: 'github-issue-self',
      sourceRef: 'github:octo/demo#9',
    });
    seedThread(s, {
      prNumber: 1051,
      sourceKind: 'github-issue-self',
      sourceRef: 'github:octo/demo#10',
    });
    mock.pulls.set('octo/demo#1050', { state: 'closed', merged: true, body: 'x' });
    mock.pulls.set('octo/demo#1051', { state: 'closed', merged: false, body: 'x' });
    await watchFor(s, mock).sweep(1_000);
    expect(mock.bodyEdits).toEqual([]);
  });
});
