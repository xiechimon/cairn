import { writeFileSync } from 'node:fs';
import {
  buildReviewFindingsPrompt,
  buildWorkBranchNote,
  CAIRN_REVIEW_HOLD_LABEL,
  isReviewBotAuthor,
  reviewFindingBadge,
  stripWorkBranchNote,
} from '@cairn/shared';
import { eq, ne } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import { build, message, project, step, threadPr, todo } from '../src/db/schema.js';
import { type FetchLike, GithubRateLimitedError } from '../src/lib/github.js';
import { githubPrReviewFindings } from '../src/lib/github-review-findings.js';
import { type AppToken, type AutonomousToken, registerAppToken } from '../src/lib/github-token.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { desiredAction, reconcilePrReviewFindings } from '../src/services/pr-review-findings.js';
import { createPrWakes } from '../src/services/pr-wakes.js';
import { createPrWatch } from '../src/services/pr-watch.js';
import {
  answerWorkerQuestionsById,
  writeWorkerQuestion,
} from '../src/services/worker-question-store.js';
import { stubGithubApp } from './github-identity-fixture.js';
import { bootServer, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  vi.restoreAllMocks();
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
    head: 'abc',
    labelId: 'LABEL_node' as string | null,
    timeline: [{ __typename: 'PullRequestCommit', commit: { oid: 'abc' } }] as unknown[],
    failure: null as null | { operation: string; kind: string },
    resolved: false,
    resolvedBy: null as string | null,
    findingId: 'RT_1',
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
    if (!String(url).endsWith('/graphql')) {
      queries.push('createLabel');
      const failure = state.failure?.operation === 'createLabel' ? state.failure.kind : null;
      if (failure) state.failure = null;
      if (!failure || failure === 'lost') state.labelId = 'LABEL_node';
      if (failure === 'lost') throw new Error('response lost');
      return {
        ok: !failure,
        status: failure === 'exists' ? 422 : failure ? 500 : 201,
        headers: { get: () => null },
        json: async () => (failure === 'exists' ? { errors: [{ code: 'already_exists' }] } : {}),
        text: async () => '',
      };
    }
    const { query } = JSON.parse(init.body) as { query: string };
    queries.push(query);
    const operation = query.includes('mutation')
      ? query.includes('convertPullRequestToDraft')
        ? 'convert'
        : query.includes('markPullRequestReadyForReview')
          ? 'ready'
          : query.includes('addLabelsToLabelable')
            ? 'addLabel'
            : 'removeLabel'
      : 'snapshot';
    const failure = state.failure?.operation === operation ? state.failure.kind : null;
    if (failure) state.failure = null;
    if (query.includes('mutation') && state.apply && (!failure || failure === 'lost')) {
      if (operation === 'addLabel') {
        state.labels.push(CAIRN_REVIEW_HOLD_LABEL);
        state.timeline.push({
          __typename: 'LabeledEvent',
          actor: { login: 'cairnwright', __typename: 'Bot' },
          label: { name: CAIRN_REVIEW_HOLD_LABEL },
          createdAt: '2026-11-07T01:01:00Z',
        });
      } else if (operation === 'removeLabel') {
        state.labels = state.labels.filter((name) => name !== CAIRN_REVIEW_HOLD_LABEL);
        state.timeline.push({
          __typename: 'UnlabeledEvent',
          actor: { login: 'cairnwright', __typename: 'Bot' },
          createdAt: '2026-11-07T01:02:00Z',
          label: { name: CAIRN_REVIEW_HOLD_LABEL },
        });
      } else state.draft = operation === 'convert';
    }
    if (failure === 'lost') throw new Error('response lost');
    const pull = {
      timelineItems: { nodes: state.timeline },
      id: 'PR_node',
      state: 'OPEN',
      isDraft: state.draft,
      headRefOid: state.head,
      labels: { nodes: state.labels.map((name) => ({ name })), pageInfo: { hasNextPage: false } },
      reviewThreads: {
        nodes: [
          {
            id: state.findingId,
            isResolved: state.resolved,
            resolvedBy: state.resolvedBy ? { login: state.resolvedBy } : null,
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
                        labelable: { id: 'PR_node' },
                      },
                    }
                  : {
                      repository: {
                        label: state.labelId ? { id: state.labelId } : null,
                        pullRequest: pull,
                      },
                    },
              },
      text: async () => '',
    };
  });
  const deps = { ...s.svc, box: s.secretBox };
  const row = () => s.db.select().from(threadPr).get()!;
  const input = () => ({
    row: row(),
    fetch,
    token: 'fake' as AutonomousToken,
    owner: 'o',
    repo: 'r',
    now: 1000,
  });
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
        headRef: 'work',
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
  await f.reconcile();
  f.state.resolved = true;
  await f.reconcile();
  expect(f.queries.some((q) => q.includes('markPullRequestReadyForReview'))).toBe(true);
  expect(f.state.draft).toBe(false);
  expect(f.queries).toHaveLength(6);
  expect(f.queries.every((q) => !q.includes('node(id:'))).toBe(true);
  expect(f.s.db.select().from(message).all()).toEqual([]);
});

test.each(['pending', 'claimed', 'waiting_quota'] as const)(
  'active %s work prevents release',
  async (status) => {
    const f = fixture();
    await f.reconcile();
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
  await f.reconcile();
  f.state.resolved = true;
  f.state.labels.push(label);
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
    await f.wake();
    expect(f.state.draft).toBe(true);
    expect(f.s.db.select().from(step).where(ne(step.kind, 'chief')).all()).toEqual([]);
    expect(JSON.stringify(f.s.db.select().from(message).all())).toContain(
      'Review round cap (3) reached; rethink or hand to the owner.',
    );
  },
);

test('autoFix off still holds, notifies and later releases', async () => {
  const f = fixture();
  f.s.db.update(threadPr).set({ autoFix: false }).where(eq(threadPr.id, 'pr')).run();
  await f.wake();
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
  answerWorkerQuestionsById({ db: f.s.db }, 'b', ['question'], 'Proceed');
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
  const old = note.slice(note.indexOf('工作分支注记'), note.indexOf('\n'));
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
  await watch.sweep();
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
          timeline: f.state.timeline,
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
  labels: [CAIRN_REVIEW_HOLD_LABEL] as string[],
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
const finding = {
  id: 'r',
  path: 'a',
  line: 1,
  badge: null,
  body: 'fix',
  url: 'https://github.com',
};

test('desiredAction covers every ordered rule and release blocker', () => {
  for (const [snapshot, local, expected] of [
    [cleanSnapshot, idleLocal, 'markReady'],
    [{ ...cleanSnapshot, isDraft: false, labels: [], findings: [finding] }, idleLocal, 'addLabel'],
    [{ ...cleanSnapshot, isDraft: false, findings: [finding] }, idleLocal, 'convertToDraft'],
    [{ ...cleanSnapshot, findings: [finding] }, idleLocal, null],
    [{ ...cleanSnapshot, isDraft: false }, idleLocal, 'removeLabel'],
    [{ ...cleanSnapshot, labels: [] }, idleLocal, null],
    [{ ...cleanSnapshot, isDraft: false, labels: [] }, idleLocal, null],
    [{ ...cleanSnapshot, labels: [CAIRN_REVIEW_HOLD_LABEL, 'coordinator-hold'] }, idleLocal, null],
    [{ ...cleanSnapshot, labels: [CAIRN_REVIEW_HOLD_LABEL, 'needs-decision'] }, idleLocal, null],
    [cleanSnapshot, { ...idleLocal, activeStep: true }, null],
    [cleanSnapshot, { ...idleLocal, blockingQuestion: true }, null],
    [cleanSnapshot, { ...idleLocal, dismissed: true }, null],
    [{ ...cleanSnapshot, findings: [finding] }, { ...idleLocal, dismissed: true }, null],
    [{ ...cleanSnapshot, state: 'CLOSED', findings: [finding] }, idleLocal, null],
    [{ ...cleanSnapshot, state: 'MERGED' }, idleLocal, null],
  ] as const)
    expect(desiredAction(snapshot, local)).toBe(expected);
});

test('each failed transition converges in exactly the remaining clean polls', async () => {
  for (const operation of [
    'snapshot',
    'createLabel',
    'addLabel',
    'convert',
    'ready',
    'removeLabel',
  ]) {
    for (const kind of ['http', 'graphql', 'lost']) {
      const f = fixture();
      const poll = async (fails = false) => {
        const before = f.queries.length;
        if (fails && operation === 'snapshot') await expect(f.reconcile()).rejects.toThrow();
        else await expect(f.reconcile()).resolves.toBeInstanceOf(Array);
        expect(
          f.queries.slice(before).filter((q) => q.includes('mutation') || q === 'createLabel'),
        ).toHaveLength(f.queries.length - before - 1);
        expect(f.queries.length - before - 1).toBeLessThanOrEqual(1);
      };
      if (operation === 'createLabel') f.state.labelId = null;
      if (['convert', 'ready', 'removeLabel'].includes(operation))
        f.state.labels = [CAIRN_REVIEW_HOLD_LABEL];
      if (operation === 'ready') f.state.draft = true;
      if (['ready', 'removeLabel'].includes(operation)) f.state.resolved = true;
      f.state.failure = { operation, kind };
      await poll(true);
      expect(f.state.failure).toBeNull();
      const remaining = f.state.resolved
        ? Number(f.state.draft) + Number(f.state.labels.includes(CAIRN_REVIEW_HOLD_LABEL))
        : Number(!f.state.labelId) +
          Number(!f.state.labels.includes(CAIRN_REVIEW_HOLD_LABEL)) +
          Number(!f.state.draft);
      for (let i = 0; i < remaining; i++) await poll();
      expect(f.state.draft).toBe(!f.state.resolved);
      expect(f.state.labels.includes(CAIRN_REVIEW_HOLD_LABEL)).toBe(!f.state.resolved);
      f.s.dispose();
      servers.splice(servers.indexOf(f.s), 1);
    }
  }
});

test('human label removal on a ready PR with findings re-adds the label and converts to draft', async () => {
  const f = fixture();
  await f.reconcile();
  await f.reconcile();
  f.state.labels = [];
  f.state.timeline.push({
    __typename: 'UnlabeledEvent',
    label: { name: CAIRN_REVIEW_HOLD_LABEL },
  });
  f.state.draft = false;
  const before = f.queries.length;
  await f.reconcile();
  expect(f.state.labels).toEqual([CAIRN_REVIEW_HOLD_LABEL]);
  expect(f.state.draft).toBe(false);
  await f.reconcile();
  expect(f.state.draft).toBe(true);
  expect(f.queries.slice(before).filter((q) => q.includes('mutation'))).toEqual([
    expect.stringContaining('addLabelsToLabelable'),
    expect.stringContaining('convertPullRequestToDraft'),
  ]);
});

test('a new finding on the same head re-holds after cairn releases and removes the label', async () => {
  const f = fixture();
  const head = f.state.head;
  await f.reconcile();
  expect(f.state.labels).toEqual([CAIRN_REVIEW_HOLD_LABEL]);
  await f.reconcile();
  expect(f.state.draft).toBe(true);
  f.state.resolved = true;
  await f.reconcile();
  expect(f.state.draft).toBe(false);
  await f.reconcile();
  expect(f.state.labels).toEqual([]);
  f.state.resolved = false;
  f.state.findingId = 'RT_2';
  const before = f.queries.length;
  await f.reconcile();
  expect(f.state.labels).toEqual([CAIRN_REVIEW_HOLD_LABEL]);
  expect(f.state.draft).toBe(false);
  await f.reconcile();
  expect(f.state.draft).toBe(true);
  expect(f.state.head).toBe(head);
  expect(f.queries.slice(before).filter((q) => q.includes('mutation'))).toEqual([
    expect.stringContaining('addLabelsToLabelable'),
    expect.stringContaining('convertPullRequestToDraft'),
  ]);
});

test('a human marking a held PR ready is converted back until findings resolve', async () => {
  const f = fixture();
  await f.reconcile();
  await f.reconcile();
  f.state.draft = false;
  await f.reconcile();
  expect(f.state.draft).toBe(true);
  f.state.resolved = true;
  f.state.draft = false;
  await f.reconcile();
  expect(f.state.labels).toEqual([]);
});

test('review snapshots request actor timeline evidence', async () => {
  const f = fixture();
  const implementation = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async (url, init) => {
    const response = await implementation(url, init);
    const data = (await response.json()) as {
      data: { repository: { pullRequest: { timelineItems?: unknown } } };
    };
    delete data.data.repository.pullRequest.timelineItems;
    return { ...response, json: async () => data };
  });
  const snapshot = await githubPrReviewFindings(f.fetch, 'fake', 'o', 'r', 3377);
  expect(snapshot.findings).toHaveLength(1);
  expect(snapshot).not.toHaveProperty('overridden');
  expect(snapshot).not.toHaveProperty('timeline');
  expect(f.queries[0]).toMatch(
    /timelineItems|UNLABELED_EVENT|PULL_REQUEST_COMMIT|HEAD_REF_FORCE_PUSHED_EVENT/,
  );
});

test('already-existing label creation is a successful one-write poll', async () => {
  const f = fixture();
  f.state.labelId = null;
  f.state.failure = { operation: 'createLabel', kind: 'exists' };
  await expect(f.reconcile()).resolves.toHaveLength(1);
  expect(f.queries).toHaveLength(2);
});

test.each(['http', 'graphql', 'lost', 'unverified'])(
  'failed conversion preserves review wake: %s',
  async (kind) => {
    const f = fixture();
    f.state.labels = [CAIRN_REVIEW_HOLD_LABEL];
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

test.each(['label', 'labels', 'changed', 'repeated', 'later-error'])(
  'incomplete or inconsistent snapshot fails closed: %s',
  async (failure) => {
    const f = fixture();
    const implementation = f.fetch.getMockImplementation()!;
    let page = 0;
    f.fetch.mockImplementation(async (url, init) => {
      const response = await implementation(url, init);
      const result = (await response.json()) as {
        data: {
          repository: {
            label?: unknown;
            pullRequest: {
              isDraft: boolean;
              labels: { pageInfo: { hasNextPage: boolean } };
              reviewThreads: { pageInfo: { hasNextPage: boolean; endCursor: string | null } };
            };
          };
        };
      };
      const pull = result.data.repository.pullRequest;
      page += 1;
      if (failure === 'label') delete result.data.repository.label;
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

test.each(['createLabel', 'addLabel'])('failed %s preserves the review wake', async (operation) => {
  for (const kind of ['http', 'graphql', 'lost']) {
    const f = fixture();
    if (operation === 'createLabel') f.state.labelId = null;
    f.state.failure = { operation, kind };
    await f.wake();
    expect(f.s.db.select().from(step).get()?.prompt).toContain('RT_1');
  }
});

test.each([false, true])(
  'human draft stays untouched with resolved=%s through every failure',
  async (resolved) => {
    const f = fixture();
    f.state.draft = true;
    f.state.resolved = resolved;
    for (const kind of ['http', 'graphql', 'lost']) {
      f.state.failure = { operation: 'snapshot', kind };
      await expect(f.reconcile()).rejects.toThrow();
      await f.reconcile();
      expect(f.state.draft).toBe(true);
      expect(f.state.labels).toEqual([]);
    }
    expect(f.queries.some((q) => q.includes('mutation'))).toBe(false);
  },
);

test.each([429, 403])(
  'label creation propagates HTTP %s rate limits without a JSON body',
  async (status) => {
    const f = fixture();
    f.state.labelId = null;
    const implementation = f.fetch.getMockImplementation()!;
    f.fetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/labels'))
        return {
          ok: false,
          status,
          headers: { get: (name) => (name === 'retry-after' ? '60' : null) },
          json: async () => {
            throw new Error('not json');
          },
          text: async () => 'rate limit',
        };
      return implementation(url, init);
    });
    await expect(f.wake()).rejects.toBeInstanceOf(GithubRateLimitedError);
    expect(f.s.db.select().from(step).all()).toEqual([]);
  },
);

test.each([null, 'app-token-unconfigured', 'repo-not-installed'] as const)(
  'PR watch G14 writes use the trigger identity when App reason is %s',
  async (reason) => {
    const f = fixture();
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = stubGithubApp(reason);
    upsertGithubConnection(
      { db: f.s.db, box: f.s.secretBox },
      {
        teamId: f.s.team.id,
        login: 'human',
        accessToken: 'identity-test-user',
        scope: 'repo',
      },
    );
    const watcher = createPrWatch({ ...f.s.svc, box: f.s.secretBox }, { githubFetch: f.fetch });
    await watcher.sweep();
    await watcher.sweep();
    const writes = f.fetch.mock.calls.filter(([, init]) => init?.body?.includes('mutation'));
    expect(writes.length).toBeGreaterThan(0);
    expect(
      writes.every(
        ([, init]) =>
          init?.headers?.authorization === `Bearer ${reason === null ? app : 'identity-test-user'}`,
      ),
    ).toBe(true);
    if (reason !== null) {
      expect(log).toHaveBeenCalledWith(
        'github write unattributed',
        expect.objectContaining({ reason, owner: 'o', repo: 'r' }),
      );
      expect(JSON.stringify(log.mock.calls).includes('identity-test-user')).toBe(false);
    }
  },
);

test.each(['app-removal', 'human-removal', 'human-ready', 'unattributed', 'new-head'])(
  'actor override convergence: %s',
  async (scenario) => {
    const f = fixture();
    registerAppToken('fake' as AppToken, Date.now() + 3600000, (inner) => inner, 'cairnwright');
    f.state.timeline = [
      {
        __typename: 'PullRequestCommit',
        commit: { oid: 'abc', committedDate: '2026-11-07T01:00:00Z', pushedDate: null },
      },
      {
        __typename: 'LabeledEvent',
        actor: {
          login: scenario === 'unattributed' ? 'human' : 'Cairnwright',
          __typename: scenario === 'unattributed' ? 'User' : 'Bot',
        },
        label: { name: CAIRN_REVIEW_HOLD_LABEL },
        createdAt: '2026-11-07T01:01:00Z',
      },
      {
        __typename: scenario === 'human-ready' ? 'ReadyForReviewEvent' : 'UnlabeledEvent',
        actor: {
          login: scenario === 'app-removal' ? 'cairnwright' : 'human',
          __typename: scenario === 'app-removal' ? 'Bot' : 'User',
        },
        label: { name: CAIRN_REVIEW_HOLD_LABEL },
        createdAt: '2026-11-07T01:02:00Z',
      },
    ];
    if (scenario === 'human-ready') f.state.labels = [CAIRN_REVIEW_HOLD_LABEL];
    if (scenario === 'new-head') {
      f.state.head = 'next';
      f.state.timeline.push({
        __typename: 'PullRequestCommit',
        commit: { oid: 'next', committedDate: '2026-11-07T01:03:00Z', pushedDate: null },
      });
    }
    await f.reconcile();
    const overridden = ['human-removal', 'human-ready'].includes(scenario);
    expect(f.queries.some((q) => q.includes('mutation'))).toBe(!overridden);
  },
);
test.each(['human', 'cairnwright[bot]'])(
  'resolved threads are not findings regardless of resolver: %s',
  async (resolver) => {
    const f = fixture();
    f.state.resolved = true;
    f.state.resolvedBy = resolver;
    expect(await f.reconcile()).toEqual([]);
    f.state.resolved = false;
    expect(await f.reconcile()).toHaveLength(1);
    expect(f.queries.some((query) => query.includes('addLabelsToLabelable'))).toBe(true);
  },
);

test('App release converges and a same-head new finding re-holds', async () => {
  const f = fixture();
  registerAppToken('fake' as AppToken, Date.now() + 3600000, (inner) => inner, 'cairnwright');
  f.state.timeline = [
    {
      __typename: 'PullRequestCommit',
      commit: { oid: 'abc', committedDate: '2026-11-07T01:00:00Z', pushedDate: null },
    },
  ];
  await f.reconcile();
  await f.reconcile();
  expect(f.state.draft).toBe(true);
  f.state.resolved = true;
  await f.reconcile();
  await f.reconcile();
  expect(f.state.draft).toBe(false);
  expect(f.state.labels).toEqual([]);
  f.state.findingId = 'RT_new';
  f.state.resolved = false;
  await f.reconcile();
  await f.reconcile();
  expect(f.state.draft).toBe(true);
  expect(f.state.labels).toContain(CAIRN_REVIEW_HOLD_LABEL);
});
