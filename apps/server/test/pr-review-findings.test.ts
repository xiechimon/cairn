import { writeFileSync } from 'node:fs';
import {
  buildReviewFindingsPrompt,
  buildWorkBranchNote,
  isReviewBotAuthor,
  reviewFindingBadge,
  stripWorkBranchNote,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import { build, message, project, step, threadPr, todo } from '../src/db/schema.js';
import { type FetchLike, GithubRateLimitedError } from '../src/lib/github.js';
import { githubPrReviewFindings } from '../src/lib/github-review-findings.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { reconcilePrReviewFindings } from '../src/services/pr-review-findings.js';
import { createPrWakes } from '../src/services/pr-wakes.js';
import { createPrWatch } from '../src/services/pr-watch.js';
import { bootServer, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

function fixture() {
  const s = bootServer();
  servers.push(s);
  s.db
    .insert(project)
    .values({ id: 'p', teamId: s.team.id, name: 'p', repoKind: 'github', githubRepo: 'o/r' })
    .run();
  s.db
    .insert(todo)
    .values({
      id: 't',
      teamId: s.team.id,
      projectId: 'p',
      title: 't',
      phase: 'review',
      phaseAt: 1,
      seqNum: 1,
      latestBuildId: 'b',
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'b',
      todoId: 't',
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1,
      prNumber: 3377,
    })
    .run();
  s.db
    .insert(threadPr)
    .values({
      id: 'pr',
      teamId: s.team.id,
      threadId: 't',
      buildId: 'b',
      repo: 'o/r',
      number: 3377,
      title: 'change',
      url: 'https://github.com/o/r/pull/3377',
      state: 'open',
      head: 'abc',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const state = {
    draft: false,
    resolved: false,
    outdated: false,
    login: 'chatgpt-codex-connector[bot]',
    type: 'Bot',
    body: '**<sub><sub>![P2 Badge](badge)</sub></sub>** Fix this',
    labels: [] as string[],
    apply: true,
    error: '',
    page: false,
  };
  const queries: string[] = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    if (!init?.body)
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () =>
          /\/pulls\/3377$/.test(String(url))
            ? {
                state: 'open',
                merged: false,
                draft: state.draft,
                head: { sha: 'abc' },
                title: 'change',
              }
            : String(url).includes('/check-runs')
              ? { check_runs: [] }
              : [],
        text: async () => '',
      };
    const { query } = JSON.parse(init.body) as { query: string };
    queries.push(query);
    if (query.includes('mutation') && state.apply)
      state.draft = query.includes('convertPullRequestToDraft');
    const pull = {
      id: 'PR_node',
      state: 'OPEN',
      isDraft: state.draft,
      headRefOid: 'abc',
      labels: { nodes: state.labels.map((name) => ({ name })), pageInfo: { hasNextPage: false } },
      reviewThreads: {
        nodes: [
          {
            id: 'RT_1',
            isResolved: state.resolved,
            isOutdated: state.outdated,
            path: 'a.ts',
            line: 7,
            comments: {
              nodes: [
                {
                  author: { __typename: state.type, login: state.login },
                  body: state.body,
                  url: 'https://github.com/o/r/pull/3377#discussion_1',
                },
              ],
            },
          },
        ],
        pageInfo: { hasNextPage: state.page, endCursor: null },
      },
    };
    return {
      ok: state.error !== 'http',
      status: state.error === 'http' ? 500 : 200,
      headers: { get: () => null },
      json: async () =>
        state.error === 'graphql'
          ? { errors: [{ message: 'bad' }] }
          : state.error === 'rate'
            ? { errors: [{ type: 'RATE_LIMITED' }] }
            : {
                data: query.includes('mutation')
                  ? {
                      changed: {
                        pullRequest: { isDraft: query.includes('convertPullRequestToDraft') },
                      },
                    }
                  : { repository: { pullRequest: pull }, node: pull },
              },
      text: async () => '',
    };
  });
  const deps = { ...s.svc, box: s.secretBox };
  const row = () => s.db.select().from(threadPr).get()!;
  const input = () => ({ row: row(), fetch, token: 'fake', owner: 'o', repo: 'r', now: 1000 });
  const reconcile = () => reconcilePrReviewFindings(deps, input());
  const wake = () =>
    createPrWakes(deps)({
      ...input(),
      pull: {
        state: 'open',
        merged: false,
        draft: state.draft,
        title: 'change',
        htmlUrl: null,
        headSha: 'abc',
        mergeableState: 'clean',
        additions: 1,
        deletions: 0,
      },
      runs: [],
    });
  const hold = () =>
    s.db
      .select()
      .from(message)
      .all()
      .find((m) => m.id.startsWith('pr-review-findings:'))?.content;
  return { s, state, queries, fetch, row, reconcile, wake, hold };
}

test.each(['P2', 'P3'])(
  'holds and wakes unresolved Codex %s including outdated threads, without collaborator permission',
  async (badge) => {
    const f = fixture();
    f.state.body = f.state.body.replace('P2', badge);
    f.state.outdated = true;
    await f.wake();
    await f.wake();
    expect(f.queries.filter((q) => q.includes('convertPullRequestToDraft'))).toHaveLength(1);
    expect(f.hold()).toMatchObject({ head: 'abc' });
    expect(f.s.db.select().from(step).all()).toHaveLength(1);
    expect(f.s.db.select().from(step).get()?.prompt).toContain('RT_1');
    expect(f.s.db.select().from(step).get()?.prompt).toContain('a.ts:7');
    expect(f.s.db.select().from(step).get()?.prompt).toContain(f.state.body);
  },
);

test.each(['http', 'graphql', 'cursor'])('unreadable threads fail closed: %s', async (error) => {
  const f = fixture();
  f.state.error = error;
  f.state.page = error === 'cursor';
  await expect(f.reconcile()).rejects.toThrow();
  expect(f.queries.some((q) => q.includes('mutation'))).toBe(false);
  expect(f.hold()).toBeUndefined();
});

test('rate limits propagate', async () => {
  const f = fixture();
  f.state.error = 'rate';
  await expect(f.reconcile()).rejects.toBeInstanceOf(GithubRateLimitedError);
});

test('held draft releases only after fresh clean read and verified ready mutation', async () => {
  const f = fixture();
  await f.reconcile();
  f.state.resolved = true;
  await f.reconcile();
  expect(f.queries.some((q) => q.includes('markPullRequestReadyForReview'))).toBe(true);
  expect(f.state.draft).toBe(false);
  expect(f.hold()).toBeUndefined();
});

test.each(['pending', 'claimed', 'waiting_quota'] as const)(
  'active %s work prevents release',
  async (status) => {
    const f = fixture();
    await f.reconcile();
    f.state.resolved = true;
    f.s.db
      .insert(step)
      .values({ id: 'active', buildId: 'b', kind: 'session', status, createdAt: 1 })
      .run();
    await f.reconcile();
    expect(f.state.draft).toBe(true);
  },
);

test('a human draft is never released', async () => {
  const f = fixture();
  f.state.draft = true;
  f.state.resolved = true;
  await f.reconcile();
  expect(f.queries.some((q) => q.includes('mutation'))).toBe(false);
});

test.each(['coordinator-hold', 'needs-decision'])('%s prevents release', async (label) => {
  const f = fixture();
  await f.reconcile();
  f.state.resolved = true;
  f.state.labels = [label];
  await f.reconcile();
  expect(f.state.draft).toBe(true);
});

test.each([true, false])(
  'round cap keeps draft and writes a notice without a wake (autoFix=%s)',
  async (autoFix) => {
    const f = fixture();
    f.s.db.update(threadPr).set({ autoFix }).where(eq(threadPr.id, 'pr')).run();
    const id = `pr-wakes:${f.row().teamId}:o/r#3377`;
    f.s.db
      .insert(message)
      .values({ id, conversationId: id, role: 'system', content: { reviews: 3 }, createdAt: 1 })
      .run();
    await f.wake();
    expect(f.state.draft).toBe(true);
    expect(f.s.db.select().from(step).all()).toEqual([]);
    expect(JSON.stringify(f.s.db.select().from(message).all())).toContain(
      'Review round cap (3) reached; rethink or hand to the owner.',
    );
  },
);

test('autoFix off still holds, notifies and later releases', async () => {
  const f = fixture();
  f.s.db.update(threadPr).set({ autoFix: false }).where(eq(threadPr.id, 'pr')).run();
  await f.wake();
  expect(f.state.draft).toBe(true);
  expect(f.s.db.select().from(step).all()).toEqual([]);
  expect(JSON.stringify(f.s.db.select().from(message).all())).toContain('Auto-fix');
  f.state.resolved = true;
  await f.wake();
  expect(f.state.draft).toBe(false);
});

test('unverified draft mutation does not record a hold and retries', async () => {
  const f = fixture();
  f.state.apply = false;
  await expect(f.reconcile()).rejects.toThrow();
  expect(f.hold()).toBeUndefined();
  await expect(f.reconcile()).rejects.toThrow();
  expect(f.queries.filter((q) => q.includes('convertPullRequestToDraft'))).toHaveLength(2);
});

test('unverified ready mutation retains the hold and retries', async () => {
  const f = fixture();
  await f.reconcile();
  f.state.resolved = true;
  f.state.apply = false;
  await expect(f.reconcile()).rejects.toThrow();
  expect(f.hold()).toMatchObject({ head: 'abc' });
  await expect(f.reconcile()).rejects.toThrow();
  expect(f.queries.filter((q) => q.includes('markPullRequestReadyForReview'))).toHaveLength(2);
});

test.each([
  ['dependabot', 'Bot'],
  ['chatgpt-codex-connector', 'User'],
])('nontrusted author %s/%s is not a finding', async (login, type) => {
  const f = fixture();
  f.state.login = login;
  f.state.type = type;
  const result = await f.reconcile();
  expect(result).toEqual([]);
  expect(f.state.draft).toBe(false);
});

test('reads every page before returning findings', async () => {
  const f = fixture();
  const implementation = f.fetch.getMockImplementation()!;
  let page = 0;
  f.fetch.mockImplementation(async (url, init) => {
    const response = await implementation(url, init);
    const data = (await response.json()) as {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              nodes: unknown[];
            };
          };
        };
      };
    };
    if (++page === 1)
      data.data.repository.pullRequest.reviewThreads.pageInfo = {
        hasNextPage: true,
        endCursor: 'next',
      };
    else data.data.repository.pullRequest.reviewThreads.nodes = [];
    return { ...response, json: async () => data };
  });
  const result = await githubPrReviewFindings(f.fetch, 'fake', 'o', 'r', 3377);
  expect(result.findings).toHaveLength(1);
  expect(page).toBe(2);
});

test('shared matcher, badges and prompts preserve the ready boundary', () => {
  expect(isReviewBotAuthor('chatgpt-codex-connector[bot]', 'Bot')).toBe(true);
  expect(isReviewBotAuthor('chatgpt-codex-connector', 'Bot')).toBe(true);
  expect(isReviewBotAuthor('chatgpt-codex-connector', 'User')).toBe(false);
  expect(isReviewBotAuthor('dependabot', 'Bot')).toBe(false);
  for (const badge of ['P0', 'P1', 'P2', 'P3'])
    expect(reviewFindingBadge(`**<sub><sub>![${badge} Badge](url)`)).toBe(badge);
  expect(reviewFindingBadge('No badge')).toBeNull();
  const note = buildWorkBranchNote('work');
  expect(note).toContain('Codex');
  expect(note).toContain('draft');
  expect(stripWorkBranchNote(`task\n${note}`)).toBe('task');
  const old = note.slice(0, note.indexOf('\n开 PR 后'));
  expect(stripWorkBranchNote(`task\n${old}`)).toBe('task');
  expect(buildReviewFindingsPrompt({ prNumber: 1, round: 1, findings: [] })).toContain(
    'addPullRequestReviewThreadReply',
  );
});

test('poller runtime witness holds PR 3377 and exposes the durable wake through the PR API', async () => {
  const f = fixture();
  upsertGithubConnection(
    { db: f.s.db, box: f.s.secretBox },
    { teamId: f.s.team.id, login: 'owner', accessToken: 'fake', scope: 'repo' },
  );
  const watch = createPrWatch({ ...f.s.svc, box: f.s.secretBox }, { githubFetch: f.fetch });
  const tally = await watch.sweep();
  expect(tally.unreadable).toBe(0);
  const response = await req(f.s.app, 'GET', '/api/prs?threadId=t');
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).toMatchObject([{ wakeRounds: 1 }]);
  expect(f.state.draft).toBe(true);
  expect(f.hold()).toMatchObject({ head: 'abc' });
  const evidence = process.env.CAIRN_REVIEW_FINDINGS_EVIDENCE;
  if (evidence)
    writeFileSync(
      evidence,
      JSON.stringify(
        {
          requirement: 'G14 / PR 3377',
          provider: 'stateful fake GitHub',
          request: 'GET /api/prs?threadId=t',
          status: response.status,
          body,
          githubQueries: f.queries,
          hold: f.hold(),
          steps: f.s.db.select().from(step).all(),
        },
        null,
        2,
      ),
    );
});

test('Codex findings bypass permission while a human without write access is ignored', async () => {
  const f = fixture();
  const implementation = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async (url, init) => {
    const response = await implementation(url, init);
    if (String(url).includes('/issues/3377/comments'))
      return {
        ...response,
        json: async () => [
          { id: 1, user: { login: 'reader', type: 'User' }, body: 'human request denied' },
        ],
      };
    if (String(url).includes('/permission'))
      return { ...response, json: async () => ({ permission: 'read' }) };
    return response;
  });
  await f.wake();
  const prompt = f.s.db.select().from(step).get()?.prompt;
  expect(prompt).toContain('RT_1');
  expect(prompt).not.toContain('human request denied');
  expect(
    f.fetch.mock.calls.some(([url]) => String(url).includes('/collaborators/reader/permission')),
  ).toBe(true);
  expect(
    f.fetch.mock.calls.some(([url]) =>
      String(url).includes('/collaborators/chatgpt-codex-connector'),
    ),
  ).toBe(false);
});
