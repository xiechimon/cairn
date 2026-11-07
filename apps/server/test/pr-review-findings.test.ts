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
import { desiredDraft, reconcilePrReviewFindings } from '../src/services/pr-review-findings.js';
import { createPrWakes } from '../src/services/pr-wakes.js';
import { createPrWatch } from '../src/services/pr-watch.js';
import {
  answerPendingWorkerQuestions,
  writeWorkerQuestion,
} from '../src/services/worker-question-store.js';
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
    viewer: 'cairnwright[bot]',
    transition: null as null | { __typename: string; actor?: { login: string } | null },
    failure: null as null | { operation: string; kind: string },
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
    const operation = query.includes('mutation')
      ? query.includes('convertPullRequestToDraft')
        ? 'convert'
        : 'ready'
      : 'snapshot';
    const failure = state.failure?.operation === operation ? state.failure.kind : null;
    if (failure) state.failure = null;
    if (query.includes('mutation') && state.apply && (!failure || failure === 'lost')) {
      state.draft = operation === 'convert';
      state.transition = state.draft
        ? { __typename: 'ConvertToDraftEvent', actor: { login: state.viewer } }
        : { __typename: 'ReadyForReviewEvent' };
    }
    if (failure === 'lost') throw new Error('response lost');
    const pull = {
      timelineItems: { nodes: state.transition ? [state.transition] : [] },
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
      ok: state.error !== 'http' && failure !== 'http',
      status: state.error === 'http' || failure === 'http' ? 500 : 200,
      headers: { get: () => null },
      json: async () =>
        state.error === 'graphql' || failure === 'graphql'
          ? { errors: [{ message: 'bad' }] }
          : state.error === 'rate'
            ? { errors: [{ type: 'RATE_LIMITED' }] }
            : {
                data: query.includes('mutation')
                  ? {
                      changed: {
                        pullRequest: { isDraft: state.draft },
                      },
                    }
                  : { viewer: { login: state.viewer }, repository: { pullRequest: pull } },
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
  return { s, state, queries, fetch, row, reconcile, wake };
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
    expect(f.s.db.select().from(step).all()).toHaveLength(1);
    expect(f.s.db.select().from(step).get()?.prompt).toContain('RT_1');
    expect(f.s.db.select().from(step).get()?.prompt).toContain('a.ts:7');
    expect(f.s.db.select().from(step).get()?.prompt).toContain(f.state.body);
  },
);

test.each([true, false])(
  'dismissed ready PR with findings stays ready without notices or wakes (autoFix=%s)',
  async (autoFix) => {
    const f = fixture();
    f.s.db.update(threadPr).set({ dismissed: true, autoFix }).where(eq(threadPr.id, 'pr')).run();
    await f.wake();
    expect(
      f.queries.some(
        (q) =>
          q.includes('convertPullRequestToDraft') || q.includes('markPullRequestReadyForReview'),
      ),
    ).toBe(false);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.state.draft).toBe(false);
    expect(f.s.db.select().from(message).all()).toEqual([]);
    expect(f.s.db.select().from(step).all()).toEqual([]);
  },
);

test('dismissed cairn-held draft with zero findings stays draft', async () => {
  const f = fixture();
  await f.reconcile();
  f.state.resolved = true;
  f.s.db.update(threadPr).set({ dismissed: true }).where(eq(threadPr.id, 'pr')).run();
  f.fetch.mockClear();
  f.queries.length = 0;
  await f.wake();
  expect(
    f.queries.some(
      (q) => q.includes('convertPullRequestToDraft') || q.includes('markPullRequestReadyForReview'),
    ),
  ).toBe(false);
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.state.draft).toBe(true);
  expect(f.s.db.select().from(message).all()).toHaveLength(0);
  expect(f.s.db.select().from(step).all()).toEqual([]);
});

test.each(['http', 'graphql', 'cursor'])('unreadable threads fail closed: %s', async (error) => {
  const f = fixture();
  f.state.error = error;
  f.state.page = error === 'cursor';
  await expect(f.reconcile()).rejects.toThrow();
  expect(f.queries.some((q) => q.includes('mutation'))).toBe(false);
});

test('rate limits propagate', async () => {
  const f = fixture();
  f.state.error = 'rate';
  await expect(f.reconcile()).rejects.toBeInstanceOf(GithubRateLimitedError);
});

test('cairn draft releases from a fresh clean snapshot without read-back', async () => {
  const f = fixture();
  await f.reconcile();
  f.state.resolved = true;
  await f.reconcile();
  expect(f.queries.some((q) => q.includes('markPullRequestReadyForReview'))).toBe(true);
  expect(f.state.draft).toBe(false);
  expect(f.queries).toHaveLength(4);
  expect(f.queries.every((q) => !q.includes('node(id:'))).toBe(true);
  expect(f.s.db.select().from(message).all()).toEqual([]);
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

test('pending blocking worker question prevents release until answered', async () => {
  const f = fixture();
  await f.reconcile();
  f.state.resolved = true;
  writeWorkerQuestion(
    { db: f.s.db },
    'b',
    'question',
    {
      kind: 'ask_user_question',
      requestId: 'question',
      status: 'pending',
      questions: [{ header: 'Decision', question: 'Proceed?', options: [] }],
      answers: null,
    },
    1,
  );
  expect(f.s.db.select().from(step).all()).toEqual([]);
  await f.reconcile();
  expect(f.state.draft).toBe(true);
  expect(f.queries.some((q) => q.includes('markPullRequestReadyForReview'))).toBe(false);
  expect(answerPendingWorkerQuestions({ db: f.s.db }, 'b', 'Proceed')).toBe(true);
  await f.reconcile();
  expect(f.state.draft).toBe(false);
  expect(f.queries.filter((q) => q.includes('markPullRequestReadyForReview'))).toHaveLength(1);
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
          githubDraft: f.state.draft,
          latestDraftTransition: f.state.transition,
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

const cleanSnapshot = {
  state: 'OPEN',
  isDraft: true,
  cairnHolds: true,
  labels: [] as string[],
  findings: [] as {
    id: string;
    path: string;
    line: number;
    badge: null;
    body: string;
    url: string;
  }[],
};
const idleLocal = { dismissed: false, activeStep: false, blockingQuestion: false };

test('desiredDraft covers conversion, release and every release blocker', () => {
  const finding = {
    id: 'r',
    path: 'a',
    line: 1,
    badge: null,
    body: 'fix',
    url: 'https://github.com',
  };
  for (const [snapshot, local, expected] of [
    [cleanSnapshot, idleLocal, false],
    [{ ...cleanSnapshot, isDraft: false, findings: [finding] }, idleLocal, true],
    [{ ...cleanSnapshot, findings: [finding] }, idleLocal, null],
    [{ ...cleanSnapshot, isDraft: false }, idleLocal, null],
    [{ ...cleanSnapshot, cairnHolds: false }, idleLocal, null],
    [{ ...cleanSnapshot, labels: ['coordinator-hold'] }, idleLocal, null],
    [{ ...cleanSnapshot, labels: ['needs-decision'] }, idleLocal, null],
    [cleanSnapshot, { ...idleLocal, activeStep: true }, null],
    [cleanSnapshot, { ...idleLocal, blockingQuestion: true }, null],
    [cleanSnapshot, { ...idleLocal, dismissed: true }, null],
    [
      { ...cleanSnapshot, isDraft: false, findings: [finding] },
      { ...idleLocal, dismissed: true },
      null,
    ],
    [{ ...cleanSnapshot, state: 'CLOSED' }, idleLocal, null],
    [{ ...cleanSnapshot, state: 'MERGED' }, idleLocal, null],
  ] as const)
    expect(desiredDraft(snapshot, local)).toBe(expected);
});

test.each([
  null,
  { __typename: 'ConvertToDraftEvent', actor: { login: 'human' } },
  { __typename: 'ConvertToDraftEvent', actor: null },
  { __typename: 'ReadyForReviewEvent' },
])('draft ownership requires the latest conversion by the viewer: %j', async (transition) => {
  const f = fixture();
  f.state.draft = true;
  f.state.resolved = true;
  f.state.transition = transition;
  await f.reconcile();
  expect(f.state.draft).toBe(true);
  expect(f.queries.some((q) => q.includes('mutation'))).toBe(false);
});

test.each([
  ['CAIRNWRIGHT', 'cairnwright[bot]'],
  ['Cairnwright[bot]', 'cairnwright'],
])('ownership normalizes viewer %s and actor %s', async (viewer, actor) => {
  const f = fixture();
  f.state.draft = true;
  f.state.resolved = true;
  f.state.viewer = viewer;
  f.state.transition = { __typename: 'ConvertToDraftEvent', actor: { login: actor } };
  await f.reconcile();
  expect(f.state.draft).toBe(false);
});

test('reconciles within two clean polls after each single GitHub failure', async () => {
  for (const operation of ['snapshot', 'convert', 'ready']) {
    for (const kind of ['http', 'graphql', 'lost']) {
      for (const humanDraft of [false, true]) {
        const f = fixture();
        const poll = async (injected = false) => {
          const before = f.queries.length;
          if (injected && operation === 'snapshot') await expect(f.reconcile()).rejects.toThrow();
          else await expect(f.reconcile()).resolves.toBeInstanceOf(Array);
          expect(
            f.queries.slice(before).filter((q) => q.includes('mutation')).length,
          ).toBeLessThanOrEqual(1);
          if (humanDraft) expect(f.state.draft).toBe(true);
        };
        if (humanDraft) {
          f.state.draft = true;
          f.state.transition = { __typename: 'ConvertToDraftEvent', actor: { login: 'human' } };
        }
        if (operation === 'ready') {
          await poll();
          f.state.resolved = true;
        }
        f.state.failure = { operation, kind };
        await poll(true);
        if (!humanDraft || operation === 'snapshot') expect(f.state.failure).toBeNull();
        f.state.failure = null;
        await poll();
        await poll();
        expect(f.state.draft).toBe(humanDraft || !f.state.resolved);
        f.state.resolved = true;
        await poll();
        await poll();
        expect(f.state.draft).toBe(humanDraft);
        expect(f.s.db.select().from(message).all()).toEqual([]);
        f.s.dispose();
        servers.splice(servers.indexOf(f.s), 1);
      }
    }
  }
});

test.each(['http', 'graphql', 'lost', 'unverified'])(
  'failed conversion preserves review wake: %s',
  async (kind) => {
    const f = fixture();
    if (kind === 'unverified') f.state.apply = false;
    else f.state.failure = { operation: 'convert', kind };
    await f.wake();
    expect(f.s.db.select().from(step).get()?.prompt).toContain('RT_1');
  },
);

test('direct reconciliation of a dismissed PR performs no reads or writes', async () => {
  const f = fixture();
  f.s.db.update(threadPr).set({ dismissed: true }).where(eq(threadPr.id, 'pr')).run();
  expect(await f.reconcile()).toEqual([]);
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.s.db.select().from(message).all()).toEqual([]);
});

test('unconfirmed ready response retries from GitHub truth', async () => {
  const f = fixture();
  await f.reconcile();
  f.state.resolved = true;
  f.state.apply = false;
  await f.reconcile();
  expect(f.state.draft).toBe(true);
  f.state.apply = true;
  await f.reconcile();
  expect(f.state.draft).toBe(false);
  expect(f.queries.filter((q) => q.includes('markPullRequestReadyForReview'))).toHaveLength(2);
});

test('mutation rate limits propagate through the wake', async () => {
  const f = fixture();
  const implementation = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async (url, init) => {
    if (init?.body && JSON.parse(init.body).query.includes('mutation')) f.state.error = 'rate';
    return implementation(url, init);
  });
  await expect(f.wake()).rejects.toBeInstanceOf(GithubRateLimitedError);
  expect(f.s.db.select().from(step).all()).toEqual([]);
});

test.each(['viewer', 'timeline', 'labels', 'changed', 'repeated', 'later-error'])(
  'incomplete or inconsistent snapshot fails closed: %s',
  async (failure) => {
    const f = fixture();
    const implementation = f.fetch.getMockImplementation()!;
    let page = 0;
    f.fetch.mockImplementation(async (url, init) => {
      const response = await implementation(url, init);
      const result = (await response.json()) as {
        data: {
          viewer?: { login: string };
          repository: {
            pullRequest: {
              isDraft: boolean;
              timelineItems?: unknown;
              labels: { pageInfo: { hasNextPage: boolean } };
              reviewThreads: { pageInfo: { hasNextPage: boolean; endCursor: string | null } };
            };
          };
        };
      };
      const pull = result.data.repository.pullRequest;
      page += 1;
      if (failure === 'viewer') delete result.data.viewer;
      if (failure === 'timeline') delete pull.timelineItems;
      if (failure === 'labels') pull.labels.pageInfo.hasNextPage = true;
      if (['changed', 'repeated', 'later-error'].includes(failure)) {
        if (page === 1 || failure === 'repeated')
          pull.reviewThreads.pageInfo = { hasNextPage: true, endCursor: 'same' };
        else if (failure === 'changed') pull.isDraft = true;
        else return { ...response, json: async () => ({ errors: [{ message: 'page failed' }] }) };
      }
      return { ...response, json: async () => result };
    });
    await expect(f.reconcile()).rejects.toThrow();
    expect(f.queries.some((q) => q.includes('mutation'))).toBe(false);
  },
);
