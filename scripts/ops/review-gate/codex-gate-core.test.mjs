import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  attemptStart,
  BLOCK_ROUND_CAP,
  badgeOf,
  blockingThreads,
  blockMarker,
  blockRounds,
  decide,
  deferredIssue,
  LIMIT_RETRY_AFTER_MS,
  lastBlockedSha,
  markDeferrals,
  markPreExisting,
  parseState,
  REQUEST_AFTER_MS,
  requestMarker,
  requiresSecurityReview,
  retryMarker,
  retryStatus,
  reviewRequested,
  shouldSkip,
  threadTitle,
  touchedLinesOf,
  trustedStateComment,
  usageLimitHit,
} from './codex-gate-core.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const CODEX = { login: 'chatgpt-codex-connector[bot]', type: 'Bot' };
const LIMIT_BODY =
  'You have reached your Codex usage limits for code reviews. You can see your limits in the [Codex usage dashboard](https://chatgpt.com/codex/cloud/settings/usage).';
const stateBody = (codeReview) =>
  `Codex summary\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: codeReview, security_review: {} })} -->`;
const badge = (level, title) =>
  `**<sub><sub>![${level} Badge](https://img.shields.io/badge/${level}-orange?style=flat)</sub></sub>  ${title}**\n\nDetails here.`;
const thread = (level, over = {}) => ({
  isResolved: false,
  isOutdated: false,
  authorLogin: 'chatgpt-codex-connector',
  authorType: 'Bot',
  body: badge(level, `Problem ${level}`),
  url: `https://github.com/o/r/pull/1#discussion_r${level}`,
  ...over,
});
const pr = { head: { sha: SHA } };
const done = { commitSha: SHA, status: 'completed' };
const noRetries = { count: 0, pending: false };

test('parseState reads the code_review block', () => {
  assert.deepEqual(parseState(stateBody({ commit_sha: SHA, status: 'completed' })), {
    commitSha: SHA,
    status: 'completed',
  });
  assert.deepEqual(parseState(stateBody({ commit_sha: null, status: null })), {
    commitSha: null,
    status: null,
  });
});

test('parseState rejects malformed or missing state', () => {
  assert.equal(parseState('no marker here'), null);
  assert.equal(parseState('<!-- codex-review-state:v1 {not json} -->'), null);
  assert.equal(parseState('<!-- codex-review-state:v1 {"security_review":{}} -->'), null);
  assert.equal(parseState(''), null);
  assert.equal(parseState(undefined), null);
});

test('trustedStateComment ignores every author but the Codex bot', () => {
  const body = stateBody({ commit_sha: SHA, status: 'completed' });
  const forged = [
    { id: 1, body, user: { login: 'someone', type: 'User' }, updated_at: '2026-01-01T00:00:01Z' },
    { id: 2, body, user: { login: CODEX.login, type: 'User' }, updated_at: '2026-01-01T00:00:02Z' },
    { id: 3, body, user: { login: 'other[bot]', type: 'Bot' }, updated_at: '2026-01-01T00:00:03Z' },
  ];
  assert.equal(trustedStateComment(forged), null);
});

test('trustedStateComment picks the most recently updated trusted comment', () => {
  const comments = [
    {
      id: 1,
      body: stateBody({ commit_sha: OTHER, status: 'completed' }),
      user: CODEX,
      updated_at: '2026-01-01T00:00:01Z',
    },
    {
      id: 2,
      body: stateBody({ commit_sha: SHA, status: 'running' }),
      user: CODEX,
      updated_at: '2026-01-01T00:00:09Z',
    },
    { id: 3, body: 'plain bot note', user: CODEX, updated_at: '2026-01-01T00:00:20Z' },
  ];
  assert.equal(trustedStateComment(comments).comment.id, 2);
  assert.equal(trustedStateComment(comments).state.status, 'running');
});

test('badgeOf and threadTitle parse the Codex badge line', () => {
  for (const level of ['P0', 'P1', 'P2', 'P3']) assert.equal(badgeOf(badge(level, 't')), level);
  assert.equal(badgeOf('plain comment'), null);
  assert.equal(badgeOf('**<sub><sub>![P4 Badge](x)</sub></sub> t**'), null);
  assert.equal(threadTitle(badge('P1', 'Guard the null path')), 'Guard the null path');
  assert.equal(
    threadTitle('**<sub><sub>![P1 Badge](x)</sub></sub>**\n\nSecond line title'),
    'Second line title',
  );
});

test('blockingThreads keeps unresolved Codex P0 and P1 threads, outdated or not', () => {
  const threads = [
    thread('P0'),
    thread('P1', { isOutdated: true }),
    thread('P1', { isResolved: true }),
    thread('P2'),
    thread('P3'),
    thread('P1', { authorLogin: 'someone', authorType: 'User' }),
    thread('P1', { body: 'no badge' }),
    thread('P1', { authorLogin: 'chatgpt-codex-connector[bot]' }),
  ];
  assert.equal(blockingThreads(threads).length, 3);
});

test('decide waits when the state is for another head, running or missing', () => {
  for (const state of [
    { commitSha: OTHER, status: 'completed' },
    { commitSha: SHA, status: 'running' },
    { commitSha: SHA, status: null },
    { commitSha: null, status: null },
    null,
  ]) {
    const result = decide(pr, state, [], noRetries);
    assert.equal(result.status, 'in_progress');
    assert.equal(result.title, `Waiting for the Codex review of ${SHA.slice(0, 7)}`);
    assert.equal(result.retry, undefined);
  }
});

test('decide retries a failed review up to twice, then stalls', () => {
  const failed = { commitSha: SHA, status: 'failed' };
  const first = decide(pr, failed, [], { count: 0, pending: false });
  assert.equal(first.status, 'in_progress');
  assert.equal(first.title, 'Codex review failed; retry 1 of 2');
  assert.equal(first.retry, retryMarker(SHA, 1));
  const second = decide(pr, failed, [], { count: 1, pending: false });
  assert.equal(second.title, 'Codex review failed; retry 2 of 2');
  assert.equal(second.retry, retryMarker(SHA, 2));
  const third = decide(pr, failed, [], { count: 2, pending: false });
  assert.equal(third.status, 'completed');
  assert.equal(third.conclusion, 'failure');
  assert.equal(third.title, 'Codex review failed twice; comment `@codex review`');
  assert.equal(third.addStall, true);
  assert.equal(third.retry, undefined);
});

test('decide does not repeat a retry whose comment is still pending', () => {
  const result = decide(pr, { commitSha: SHA, status: 'failed' }, [], { count: 1, pending: true });
  assert.equal(result.status, 'in_progress');
  assert.equal(result.retry, undefined);
  assert.equal(result.title, 'Codex review failed; retry 1 of 2');
});

test('decide passes a completed review with no or only P2/P3 threads', () => {
  const clean = decide(pr, done, [], noRetries);
  assert.equal(clean.status, 'completed');
  assert.equal(clean.conclusion, 'success');
  assert.equal(clean.title, `No open P0/P1 Codex findings for ${SHA.slice(0, 7)}`);
  assert.equal(clean.removeStall, true);
  const minor = decide(pr, done, [thread('P2'), thread('P3')], noRetries);
  assert.equal(minor.conclusion, 'success');
});

test('decide blocks on unresolved P0/P1 including outdated ones and lists them', () => {
  const result = decide(
    pr,
    done,
    [thread('P1'), thread('P0', { isOutdated: true }), thread('P2')],
    noRetries,
  );
  assert.equal(result.conclusion, 'failure');
  assert.equal(result.title, '2 open P0/P1 Codex findings');
  assert.match(result.summary, /discussion_rP1/);
  assert.match(result.summary, /discussion_rP0/);
  assert.match(result.summary, /Problem P1/);
  assert.doesNotMatch(result.summary, /discussion_rP2/);
  assert.equal(
    decide(pr, done, [thread('P1', { isResolved: true })], noRetries).conclusion,
    'success',
  );
  assert.equal(
    decide(pr, done, [thread('P1', { isOutdated: true })], noRetries).conclusion,
    'failure',
  );
});

test('decide reports an exhausted allowance without retrying', () => {
  for (const state of [
    { commitSha: OTHER, status: 'completed' },
    { commitSha: SHA, status: 'running' },
    { commitSha: OTHER, status: 'failed' },
    { commitSha: SHA, status: 'failed' },
    null,
  ]) {
    for (const retries of [noRetries, { count: 1, pending: true }]) {
      const result = decide(pr, state, [], retries, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.conclusion, 'failure');
      assert.equal(result.title, 'Codex allowance exhausted');
      assert.match(result.summary, /chatgpt\.com\/codex\/cloud\/settings\/usage/);
      assert.equal(result.addStall, true);
      assert.equal(result.retry, undefined);
    }
  }
});

test('decide ignores the limit flag once the current head has a completed review', () => {
  assert.equal(decide(pr, done, [], noRetries, true).conclusion, 'success');
});

test('usageLimitHit blocks only the head whose request the notice answered', () => {
  const stateEntry = {
    state: { commitSha: SHA },
    comment: { created_at: '2026-01-01T00:00:10Z', updated_at: '2026-01-01T00:00:10Z' },
  };
  const actions = { login: 'github-actions[bot]', type: 'Bot' };
  const request = (over = {}) => ({
    body: requestMarker(SHA),
    user: actions,
    created_at: '2026-01-01T00:00:15Z',
    ...over,
  });
  const limit = (over = {}) => ({
    body: LIMIT_BODY,
    user: CODEX,
    created_at: '2026-01-01T00:00:20Z',
    updated_at: '2026-01-01T00:00:20Z',
    ...over,
  });
  assert.equal(usageLimitHit([request(), limit()], stateEntry, SHA), true);
  assert.equal(usageLimitHit([request(), limit()], null, SHA), true);
  assert.equal(usageLimitHit([limit()], stateEntry, SHA), true);
  assert.equal(usageLimitHit([limit()], null, SHA), false);
  assert.equal(usageLimitHit([request({ body: requestMarker(OTHER) }), limit()], null, SHA), false);
  assert.equal(
    usageLimitHit([request({ created_at: '2026-01-01T00:00:30Z' }), limit()], null, SHA),
    false,
  );
  assert.equal(
    usageLimitHit(
      [request({ body: retryMarker(SHA, 1), created_at: '2026-01-01T00:00:25Z' }), limit()],
      null,
      SHA,
    ),
    false,
  );
  assert.equal(
    usageLimitHit([request(), limit({ created_at: '2026-01-01T00:00:05Z' })], stateEntry, SHA),
    false,
  );
  assert.equal(
    usageLimitHit(
      [request(), limit({ user: { login: 'mallory', type: 'User' } })],
      stateEntry,
      SHA,
    ),
    false,
  );
  assert.equal(usageLimitHit([request(), limit({ body: 'all good' })], stateEntry, SHA), false);
  assert.equal(
    usageLimitHit(
      [request(), limit(), { body: 'newer note', user: CODEX, created_at: '2026-01-01T00:00:30Z' }],
      stateEntry,
      SHA,
    ),
    false,
  );
  assert.equal(usageLimitHit([], stateEntry, SHA), false);
});

test('usageLimitHit orders same-second comments by id', () => {
  const actions = { login: 'github-actions[bot]', type: 'Bot' };
  const at = '2026-01-01T00:00:20Z';
  const request = (body, id) => ({ id, body, user: actions, created_at: at });
  const limit = (id) => ({ id, body: LIMIT_BODY, user: CODEX, created_at: at });
  assert.equal(usageLimitHit([request(requestMarker(SHA), 5), limit(6)], null, SHA), true);
  assert.equal(usageLimitHit([request(requestMarker(SHA), 7), limit(6)], null, SHA), false);
  assert.equal(usageLimitHit([request(retryMarker(SHA, 1), 5), limit(6)], null, SHA), true);
  assert.equal(
    usageLimitHit(
      [request(requestMarker(SHA), 1), request(retryMarker(SHA, 1), 8), limit(6)],
      null,
      SHA,
    ),
    false,
  );
  const stateEntry = {
    state: { commitSha: SHA },
    comment: { id: 9, created_at: at, updated_at: at },
  };
  assert.equal(usageLimitHit([request(requestMarker(SHA), 5), limit(10)], stateEntry, SHA), true);
  assert.equal(usageLimitHit([request(requestMarker(SHA), 5), limit(8)], stateEntry, SHA), false);
});

test('a limit notice newer than the current head state applies without a request marker', () => {
  const stateEntry = (commitSha) => ({
    state: { commitSha },
    comment: { id: 1, created_at: '2026-01-01T00:00:10Z', updated_at: '2026-01-01T00:00:10Z' },
  });
  const notice = { id: 2, body: LIMIT_BODY, user: CODEX, created_at: '2026-01-01T00:00:20Z' };
  assert.equal(usageLimitHit([notice], stateEntry(SHA), SHA), true);
  assert.equal(usageLimitHit([notice], stateEntry(OTHER), SHA), false);
  assert.equal(usageLimitHit([notice], null, SHA), false);
  assert.equal(
    usageLimitHit([{ ...notice, id: 0, created_at: '2026-01-01T00:00:05Z' }], stateEntry(SHA), SHA),
    false,
  );
});

test('every incomplete-state path past its deadline ends in a decision', () => {
  const now = Date.parse('2026-01-02T00:00:00Z');
  const actions = { login: 'github-actions[bot]', type: 'Bot' };
  const iso = (agoMs) => new Date(now - agoMs).toISOString();
  const minute = 60_000;
  const ages = { fresh: minute, mid: 60 * minute, stale: 180 * minute };
  const states = {
    none: null,
    otherCompleted: { commitSha: OTHER, status: 'completed' },
    running: { commitSha: SHA, status: 'running' },
    statusless: { commitSha: SHA, status: null },
    failed: { commitSha: SHA, status: 'failed' },
    completed: { commitSha: SHA, status: 'completed' },
  };
  const markers = { none: 0, request: 1, retry1: 2, retry2: 3 };
  const outcomes = [];
  for (const [stateName, state] of Object.entries(states))
    for (const [markerName, markerCount] of Object.entries(markers))
      for (const notice of ['none', 'before', 'after'])
        for (const [ageName, age] of Object.entries(ages)) {
          const comments = [];
          let id = 10;
          if (notice === 'before')
            comments.push({ id: id++, body: LIMIT_BODY, user: CODEX, created_at: iso(age * 2) });
          if (state)
            comments.push({
              id: id++,
              body: stateBody({ commit_sha: state.commitSha, status: state.status }),
              user: CODEX,
              created_at: iso(age),
              updated_at: iso(age),
            });
          const bodies = [requestMarker(SHA), retryMarker(SHA, 1), retryMarker(SHA, 2)];
          for (const body of bodies.slice(0, markerCount))
            comments.push({ id: id++, body, user: actions, created_at: iso(age) });
          if (notice === 'after')
            comments.push({ id: id++, body: LIMIT_BODY, user: CODEX, created_at: iso(age) });
          const stateEntry = trustedStateComment(comments);
          const retries = retryStatus(comments, SHA, stateEntry?.comment ?? null);
          const limit = usageLimitHit(comments, stateEntry, SHA);
          const start = attemptStart(comments, stateEntry, SHA);
          const result = decide(pr, state, [], retries, limit, {
            waitedMs: age * 2,
            requested: reviewRequested(comments, SHA),
            sinceRequestMs: start ? now - start.time : 0,
            idleMs: Math.max(age, start ? now - start.time : 0),
          });
          const outcome = result.request
            ? 'request'
            : result.retry
              ? 'retry'
              : result.conclusion === 'failure'
                ? 'failed'
                : result.conclusion === 'success'
                  ? 'passed'
                  : 'waiting';
          outcomes.push(`${stateName}/${markerName}/${notice}/${ageName}: ${outcome}`);
          if (ageName !== 'fresh' || (stateName === 'completed' && notice === 'none'))
            assert.notEqual(outcome, 'waiting', `${stateName}/${markerName}/${notice}/${ageName}`);
        }
  assert.equal(outcomes.length, 6 * 4 * 3 * 3);
});

test('a reused summary comment updated for this head after an old notice is no limit and waits', () => {
  const now = Date.parse('2026-01-02T00:00:00Z');
  const iso = (agoMs) => new Date(now - agoMs).toISOString();
  const minute = 60_000;
  const comments = [
    {
      id: 1,
      body: stateBody({ commit_sha: SHA, status: 'running' }),
      user: CODEX,
      created_at: iso(300 * minute),
      updated_at: iso(2 * minute),
    },
    { id: 2, body: LIMIT_BODY, user: CODEX, created_at: iso(60 * minute) },
  ];
  const stateEntry = trustedStateComment(comments);
  const start = attemptStart(comments, stateEntry, SHA);
  assert.equal(start.time, now - 2 * minute);
  assert.equal(usageLimitHit(comments, stateEntry, SHA), false);
  const result = decide(
    pr,
    stateEntry.state,
    [],
    retryStatus(comments, SHA, stateEntry.comment),
    false,
    { waitedMs: 5 * minute, requested: false, sinceRequestMs: 2 * minute, idleMs: 2 * minute },
  );
  assert.equal(result.status, 'in_progress');
  assert.equal(result.retry, undefined);
  assert.equal(result.request, undefined);
  const otherHead = trustedStateComment([
    { ...comments[0], body: stateBody({ commit_sha: OTHER, status: 'running' }) },
    comments[1],
  ]);
  assert.equal(attemptStart(comments, otherHead, SHA), null);
});

test('decide retries a limited head once the last request is two hours old', () => {
  const retries = { count: 1, pending: false };
  const early = decide(pr, null, [], retries, true, {
    waitedMs: 0,
    requested: true,
    sinceRequestMs: LIMIT_RETRY_AFTER_MS - 1,
  });
  assert.equal(early.title, 'Codex allowance exhausted');
  assert.equal(early.retry, undefined);
  const due = decide(pr, null, [], retries, true, {
    waitedMs: 0,
    requested: true,
    sinceRequestMs: LIMIT_RETRY_AFTER_MS,
  });
  assert.equal(due.status, 'in_progress');
  assert.equal(due.retry, retryMarker(SHA, 2));
  assert.equal(due.addStall, true);
});

test('retryStatus counts only github-actions markers for the head', () => {
  const actions = { login: 'github-actions[bot]' };
  const comments = [
    { body: retryMarker(SHA, 1), user: actions, created_at: '2026-01-01T00:00:10Z' },
    { body: retryMarker(OTHER, 1), user: actions, created_at: '2026-01-01T00:00:11Z' },
    { body: retryMarker(SHA, 2), user: { login: 'mallory' }, created_at: '2026-01-01T00:00:12Z' },
  ];
  assert.deepEqual(retryStatus(comments, SHA, { updated_at: '2026-01-01T00:00:05Z' }), {
    count: 1,
    pending: true,
  });
  assert.deepEqual(retryStatus(comments, SHA, { updated_at: '2026-01-01T00:00:20Z' }), {
    count: 1,
    pending: false,
  });
  assert.deepEqual(retryStatus([], SHA, null), { count: 0, pending: false });
});

test('shouldSkip names why a PR is not gated', () => {
  const base = {
    state: 'open',
    draft: false,
    head: { ref: 'feature/x', sha: SHA },
    user: { login: 'dev' },
    author_association: 'MEMBER',
  };
  assert.equal(shouldSkip(base), null);
  assert.equal(shouldSkip({ ...base, author_association: 'OWNER' }), null);
  assert.equal(shouldSkip({ ...base, author_association: 'COLLABORATOR' }), null);
  assert.equal(
    shouldSkip({ ...base, author_association: 'NONE', user: { login: 'cairnwright[bot]' } }),
    null,
  );
  assert.match(shouldSkip({ ...base, state: 'closed' }), /closed/);
  assert.match(shouldSkip({ ...base, draft: true }), /draft/);
  assert.match(
    shouldSkip({ ...base, head: { ref: 'mergify/merge-queue/abc', sha: SHA } }),
    /merge queue/,
  );
  assert.match(shouldSkip({ ...base, author_association: 'CONTRIBUTOR' }), /write access/);
});

test('decide asks Codex once when a head has waited ten minutes without a review', () => {
  const late = { waitedMs: REQUEST_AFTER_MS, requested: false };
  for (const state of [null, { commitSha: OTHER, status: 'completed' }]) {
    const result = decide(pr, state, [], noRetries, false, late);
    assert.equal(result.status, 'in_progress');
    assert.equal(result.request, requestMarker(SHA));
    assert.equal(result.title, 'Asked Codex to review aaaaaaa');
  }
});

test('decide does not ask Codex early, twice, while it runs, or without a wait', () => {
  const cases = [
    [null, { waitedMs: REQUEST_AFTER_MS - 1, requested: false }],
    [null, { waitedMs: REQUEST_AFTER_MS * 3, requested: true }],
    [
      { commitSha: SHA, status: 'running' },
      { waitedMs: REQUEST_AFTER_MS * 3, requested: false },
    ],
    [
      { commitSha: SHA, status: null },
      { waitedMs: REQUEST_AFTER_MS * 3, requested: false },
    ],
    [null, null],
  ];
  for (const [state, wait] of cases) {
    const result = decide(pr, state, [], noRetries, false, wait);
    assert.equal(result.request, undefined, JSON.stringify({ state, wait }));
    assert.equal(result.title, 'Waiting for the Codex review of aaaaaaa');
  }
  assert.equal(
    decide(pr, null, [], noRetries, true, { waitedMs: REQUEST_AFTER_MS, requested: false }).title,
    'Codex allowance exhausted',
  );
});

test('reviewRequested counts only the marker the gate posted for this head', () => {
  const comment = (body, user) => ({ body, user });
  const actions = { login: 'github-actions[bot]', type: 'Bot' };
  const marker = `${requestMarker(SHA)}\n@codex review`;
  assert.equal(reviewRequested([comment(marker, actions)], SHA), true);
  assert.equal(reviewRequested([comment(marker, { login: 'mallory', type: 'User' })], SHA), false);
  assert.equal(
    reviewRequested([comment(`${requestMarker(OTHER)}\n@codex review`, actions)], SHA),
    false,
  );
  assert.equal(reviewRequested([], SHA), false);
});

const DELETION_PATCH = ['@@ -40,3 +40,2 @@', ' before', '-guard', ' after'].join('\n');
const PATCH = [
  '@@ -10,2 +10,4 @@ ctx',
  ' keep',
  '+new one',
  '+new two',
  ' tail',
  '\\ No newline',
].join('\n');
const located = (level, over = {}) =>
  thread(level, { path: 'src/a.ts', line: 50, startLine: null, diffSide: 'RIGHT', ...over });
const files = [
  { filename: 'src/a.ts', patch: PATCH },
  { filename: 'src/del.ts', patch: DELETION_PATCH },
  { filename: 'src/big.bin' },
];
const actionsComment = (body) => ({ user: { login: 'github-actions[bot]' }, body });

test('touchedLinesOf numbers added lines, and every new-side line of a hunk with a removal', () => {
  assert.deepEqual([...touchedLinesOf(PATCH)], [11, 12]);
  assert.deepEqual(
    [...touchedLinesOf('@@ -1 +1,2 @@\n+a\n+b\n@@ -20,2 +30,3 @@\n x\n+c\n y')],
    [1, 2, 31],
  );
  assert.deepEqual([...touchedLinesOf(DELETION_PATCH)], [40, 41]);
  assert.deepEqual([...touchedLinesOf(undefined)], []);
});

test('markPreExisting flags only open right-side threads wholly outside the added lines', () => {
  const [
    outside,
    onAdded,
    rangeTouchesAdded,
    outdated,
    left,
    noPatch,
    unknownFile,
    noLocation,
    afterDeletion,
  ] = markPreExisting(
    [
      located('P1', { line: 10 }),
      located('P1', { line: 11 }),
      located('P1', { startLine: 9, line: 11 }),
      located('P1', { line: 10, isOutdated: true }),
      located('P1', { line: 10, diffSide: 'LEFT' }),
      located('P1', { path: 'src/big.bin', line: 10 }),
      located('P1', { path: 'src/other.ts', line: 10 }),
      thread('P1'),
      located('P1', { path: 'src/del.ts', line: 41 }),
    ],
    files,
  );
  assert.equal(outside.preExisting, true);
  for (const kept of [
    onAdded,
    rangeTouchesAdded,
    outdated,
    left,
    noPatch,
    unknownFile,
    noLocation,
    afterDeletion,
  ])
    assert.equal(kept.preExisting, undefined);
});

test('a pre-existing finding does not block and is listed; the same finding on a changed line blocks', () => {
  const [old] = markPreExisting([located('P1', { line: 10 })], files);
  const [fresh] = markPreExisting([located('P1', { line: 11 })], files);
  assert.equal(blockingThreads([old]).length, 0);
  assert.equal(blockingThreads([fresh]).length, 1);
  const passed = decide(pr, done, [old], noRetries);
  assert.equal(passed.conclusion, 'success');
  assert.match(passed.summary, /predate this PR/);
  assert.match(passed.summary, /discussion_rP1/);
  assert.equal(decide(pr, done, [fresh], noRetries).conclusion, 'failure');
});

test('blockRounds counts distinct blocked heads from github-actions markers only', () => {
  const comments = [
    actionsComment(`${blockMarker(OTHER)}\ntext`),
    actionsComment(`${blockMarker(OTHER)}\nagain`),
    actionsComment(`${blockMarker('e'.repeat(40))}\ntext`),
    { user: { login: 'mallory' }, body: blockMarker('f'.repeat(40)) },
  ];
  assert.deepEqual(blockRounds(comments, SHA), { others: 2, marked: false });
  assert.deepEqual(blockRounds([...comments, actionsComment(blockMarker(SHA))], SHA), {
    others: 2,
    marked: true,
  });
});

test('decide marks the first block of a head once and never turns a block into a pass', () => {
  const blocked = [thread('P1')];
  const first = decide(pr, done, blocked, noRetries, false, null, { others: 0, marked: false });
  assert.equal(first.block, blockMarker(SHA));
  assert.equal(first.addHuman, undefined);
  assert.equal(first.title, '1 open P0/P1 Codex findings');
  const again = decide(pr, done, blocked, noRetries, false, null, { others: 0, marked: true });
  assert.equal(again.block, undefined);
  for (const others of [0, 1, 2, 3, 10]) {
    const result = decide(pr, done, blocked, noRetries, false, null, { others, marked: true });
    assert.equal(result.conclusion, 'failure');
  }
});

test('the third blocked head asks to reconsider the approach and labels the PR once', () => {
  const blocked = [thread('P1')];
  const second = decide(pr, done, blocked, noRetries, false, null, {
    others: BLOCK_ROUND_CAP - 2,
    marked: false,
  });
  assert.equal(second.addHuman, undefined);
  const third = decide(pr, done, blocked, noRetries, false, null, {
    others: BLOCK_ROUND_CAP - 1,
    marked: false,
  });
  assert.equal(third.addHuman, true);
  assert.equal(third.block, blockMarker(SHA));
  assert.match(third.title, /round 3, reconsider the approach/);
  assert.match(third.summary, /bug class/);
  const repeat = decide(pr, done, blocked, noRetries, false, null, {
    others: BLOCK_ROUND_CAP - 1,
    marked: true,
  });
  assert.equal(repeat.addHuman, undefined);
  assert.match(repeat.title, /reconsider the approach/);
});

const sinceQuiet = [{ filename: 'src/a.ts', patch: '@@ -1,1 +1,2 @@\n ctx\n+added' }];
const sinceTouch = [{ filename: 'src/a.ts', patch: PATCH }];
const atRound = (others, sinceFiles) => ({ others, marked: false, sinceFiles });

test('lastBlockedSha is the newest actions marker other than the current head', () => {
  const marker = (sha, id, at) => ({
    id,
    user: { login: 'github-actions[bot]' },
    body: `${blockMarker(sha)}\n`,
    created_at: at,
  });
  const comments = [
    marker(OTHER, 1, '2026-01-01T00:00:01Z'),
    marker('e'.repeat(40), 2, '2026-01-01T00:00:03Z'),
    marker(SHA, 3, '2026-01-01T00:00:04Z'),
    {
      id: 4,
      user: { login: 'mallory' },
      body: blockMarker('f'.repeat(40)),
      created_at: '2026-01-01T00:00:05Z',
    },
  ];
  assert.equal(lastBlockedSha(comments, SHA), 'e'.repeat(40));
  assert.equal(lastBlockedSha(comments, 'e'.repeat(40)), SHA);
});

test('rounds 1 and 2 still block a P1 outside the since-block diff', () => {
  const old = located('P1', { line: 50 });
  for (const others of [0, 1]) {
    const result = decide(pr, done, [old], noRetries, false, null, atRound(others, sinceQuiet));
    assert.equal(result.conclusion, 'failure');
    assert.equal(result.addHuman, undefined);
    assert.equal(result.carried, undefined);
  }
});

test('from round 3 a P1 on lines unchanged since the last blocked head does not block', () => {
  const result = decide(
    pr,
    done,
    [located('P1', { line: 50 })],
    noRetries,
    false,
    null,
    atRound(BLOCK_ROUND_CAP - 1, sinceQuiet),
  );
  assert.equal(result.conclusion, 'success');
  assert.equal(result.addHuman, true);
  assert.match(result.summary, /bug class/);
  assert.match(result.summary, /reconsider the approach/);
  assert.match(result.carried, /review-gate recorded them in Carried review findings/);
  assert.match(result.carried, /discussion_rP1/);
});

test('from round 3 a P1 on a line changed since the last blocked head still blocks', () => {
  const result = decide(
    pr,
    done,
    [located('P1', { line: 11 })],
    noRetries,
    false,
    null,
    atRound(BLOCK_ROUND_CAP - 1, sinceTouch),
  );
  assert.equal(result.conclusion, 'failure');
  assert.match(result.title, /reconsider the approach/);
  assert.match(result.summary, /bug class/);
  assert.equal(result.carried, undefined);
});

test('a P0 on lines unchanged since the last blocked head still blocks', () => {
  const result = decide(
    pr,
    done,
    [located('P0', { line: 50 })],
    noRetries,
    false,
    null,
    atRound(BLOCK_ROUND_CAP - 1, sinceQuiet),
  );
  assert.equal(result.conclusion, 'failure');
  assert.match(result.summary, /discussion_rP0/);
  assert.equal(result.carried, undefined);
});

test('a carried P1 still fails when its deferral does not name an issue', () => {
  const missing = located('P1', {
    id: 'PRRT_missing',
    line: 50,
    url: 'https://github.com/o/r/pull/1#discussion_r90',
    deferral: 'deferred to #9, which is not an issue in this repository',
  });
  const waived = located('P1', {
    line: 50,
    deferral: 'deferred to #9, but a P0/P1 finding must be fixed',
  });
  const failed = decide(
    pr,
    done,
    [missing],
    noRetries,
    false,
    null,
    atRound(BLOCK_ROUND_CAP - 1, sinceQuiet),
  );
  assert.equal(failed.conclusion, 'failure');
  assert.equal(failed.recordThreads, undefined);
  assert.equal(
    decide(pr, done, [waived], noRetries, false, null, atRound(BLOCK_ROUND_CAP - 1, sinceQuiet))
      .conclusion,
    'success',
  );
});

test('from round 3 an unanchored thread on an unchanged file does not block', () => {
  const quiet = decide(
    pr,
    done,
    [thread('P1', { path: 'src/untouched.ts' })],
    noRetries,
    false,
    null,
    atRound(BLOCK_ROUND_CAP - 1, sinceQuiet),
  );
  assert.equal(quiet.conclusion, 'success');
  assert.match(quiet.carried, /review-gate recorded them in Carried review findings/);
  const moved = decide(
    pr,
    done,
    [thread('P1', { path: 'src/a.ts' })],
    noRetries,
    false,
    null,
    atRound(BLOCK_ROUND_CAP - 1, sinceQuiet),
  );
  assert.equal(moved.conclusion, 'failure');
});

test('a pass reports the blocked heads before it', () => {
  const clean = decide(pr, done, [], noRetries, false, null, { others: 2, marked: true });
  assert.equal(clean.conclusion, 'success');
  assert.match(clean.summary, /Cycles to pass: 3 blocked head/);
  assert.doesNotMatch(decide(pr, done, [], noRetries).summary, /Cycles to pass/);
});

const securityDone = { commitSha: SHA, status: 'completed', hasUnresolvedFindings: false };
const securityDecision = (state) =>
  decide(pr, done, [], noRetries, false, null, undefined, { state });

test('security review passes only the exact completed head with explicitly no unresolved findings', () => {
  assert.equal(securityDecision(securityDone).conclusion, 'success');
  assert.equal(
    decide(pr, done, [thread('P1')], noRetries, false, null, undefined, { state: securityDone })
      .conclusion,
    'failure',
  );
  assert.equal(decide(pr, done, [], noRetries, false, null, undefined, null).conclusion, 'success');
  assert.equal(
    decide(pr, null, [], noRetries, false, null, undefined, { state: securityDone }).status,
    'in_progress',
  );
});

test('trusted security state ignores forged authors and keeps the latest incomplete summary', () => {
  const summary = (security, user = CODEX, updated_at = '2026-01-01T00:00:01Z') => ({
    body: `<!-- codex-review-state:v1 ${JSON.stringify({
      code_review: { commit_sha: SHA, status: 'completed' },
      security_review: security,
    })} -->`,
    user,
    updated_at,
  });
  const clean = { commit_sha: SHA, status: 'completed', has_unresolved_findings: false };
  const valid = summary(clean);
  assert.deepEqual(trustedStateComment([valid], 'security_review').state, securityDone);
  for (const user of [
    { login: 'mallory', type: 'User' },
    { login: CODEX.login, type: 'User' },
    { login: 'other[bot]', type: 'Bot' },
  ])
    assert.equal(trustedStateComment([summary(clean, user)], 'security_review'), null);
  const latest = summary(null, CODEX, '2026-01-01T00:00:02Z');
  assert.equal(trustedStateComment([valid, latest], 'security_review').state, null);
  latest.body = '<!-- codex-review-state:v1 {invalid} -->';
  assert.equal(trustedStateComment([valid, latest], 'security_review').state, null);
});

test('every canonical security pattern is covered without expanding to other human queue categories', () => {
  const cases = [
    'apps/server/src/lib/secret-box.ts',
    'apps/server/src/lib/keys.ts',
    'apps/server/src/lib/token-auth.ts',
    'apps/server/src/lib/attachments-token.ts',
    'apps/server/src/services/secrets.ts',
    'apps/server/src/services/credentials.ts',
    'apps/server/src/services/api-keys.ts',
    'apps/server/src/services/oauth.ts',
    'apps/daemon/src/credentials.ts',
    'apps/daemon/src/secret-channel.ts',
    'apps/daemon/src/machine-client.ts',
    'apps/server/src/routes-machine.ts',
    'apps/server/src/services/machine.ts',
    'apps/server/src/services/machine-claim.ts',
    'apps/daemon/src/backend/command-gate.ts',
    'apps/server/src/services/mcp-face.ts',
    'apps/server/src/services/mcp-servers.ts',
  ];
  for (const filename of cases)
    assert.equal(requiresSecurityReview([{ filename }]), true, filename);
  for (const filename of [
    'apps/server/src/services/nested/machine-claim.ts',
    'apps/server/src/services/machine-claim.test.ts.backup',
    'apps/server/src/services/machine-claim.tsx',
    'apps/server/drizzle/0102.sql',
    'scripts/ops/deploy-self.sh',
    '.github/workflows/release.yml',
  ])
    assert.equal(requiresSecurityReview([{ filename }]), false, filename);
});

const receiptFixture = JSON.parse(
  readFileSync(new URL('../../../docs/verify/D88/receipt-fixture.json', import.meta.url), 'utf8'),
);
function receiptDecision(fixture, threads = []) {
  const state = parseState(fixture.evidence.comments[0].body, 'security_review');
  return decide(
    fixture.pr,
    { commitSha: fixture.pr.head.sha, status: 'completed' },
    threads,
    noRetries,
    false,
    null,
    undefined,
    { state, receiptEvidence: fixture.evidence },
  );
}

test('D88 accepts the live exact-head null verdict only with a fresh clean unambiguous SECURITY receipt and no open security threads', () => {
  assert.equal(receiptDecision(receiptFixture).conclusion, 'success');
});

test('the newest deferral reply names the issue, in any letter case', () => {
  assert.equal(deferredIssue({ replies: [] }), null);
  assert.equal(deferredIssue({ replies: ['fixed in abc123'] }), null);
  assert.equal(
    deferredIssue({
      replies: [
        'Valid, out of scope for this PR, tracked in #3.',
        'valid, OUT OF SCOPE for this PR, tracked in #41',
      ],
    }),
    41,
  );
  assert.equal(deferredIssue({ replies: ['out of scope for this PR, tracked in #12a'] }), null);
  assert.equal(
    deferredIssue({ replies: ['Do not use `out of scope for this PR, tracked in #999` here'] }),
    null,
  );
  assert.equal(
    deferredIssue({ replies: ['Do not reply `valid, out of scope for this PR, tracked in #999`'] }),
    null,
  );
  assert.equal(
    deferredIssue({ replies: ['Class: retry.\nvalid, out of scope for this PR, tracked in #7'] }),
    7,
  );
});

test('a deferral is judged on any Codex thread as soon as it is written, never on a human thread', () => {
  const reply = { replies: ['valid, out of scope for this PR, tracked in #9'] };
  const kinds = new Map([[9, 'missing']]);
  const [open, human, resolved] = markDeferrals(
    [
      thread('P2', reply),
      thread('P2', { ...reply, isResolved: true, authorLogin: 'someone', authorType: 'User' }),
      thread('P2', { ...reply, isResolved: true }),
    ],
    kinds,
  );
  assert.match(open.deferral, /#9, which is not an issue/);
  assert.equal(human.deferral, undefined);
  assert.match(resolved.deferral, /#9, which is not an issue/);
});

test('from round 3 recordThreads lists only the non-blocking Codex P1', () => {
  const carried = located('P1', {
    id: 'PRRT_kwDOAb+/=1',
    line: 50,
    url: 'https://github.com/o/r/pull/1#discussion_r50',
  });
  const blocking = located('P1', {
    id: 'PRRT_blocking',
    line: 2,
    url: 'https://github.com/o/r/pull/1#discussion_r2',
  });
  const p0 = located('P0', {
    id: 'PRRT_p0',
    line: 50,
    url: 'https://github.com/o/r/pull/1#discussion_r80',
  });
  const human = located('P1', {
    id: 'PRRT_human',
    line: 50,
    url: 'https://github.com/o/r/pull/1#discussion_r70',
    authorLogin: 'dev',
    authorType: 'User',
  });
  const result = decide(
    pr,
    done,
    [carried, blocking, p0, human],
    noRetries,
    false,
    null,
    atRound(BLOCK_ROUND_CAP - 1, sinceQuiet),
  );
  assert.deepEqual(result.recordThreads, [
    { id: 'PRRT_kwDOAb+/=1', url: 'https://github.com/o/r/pull/1#discussion_r50' },
  ]);
});

test('carried findings stay in one details block and do not repeat a URL', async () => {
  const core = await import('./codex-gate-core.mjs');
  assert.equal(typeof core.withCarriedFindings, 'function');
  assert.equal(
    core.carriedReply('a'.repeat(40)),
    "Recorded as pre-existing in this PR's Risk by review-gate at aaaaaaa; not blocking.",
  );
  const url = 'https://github.com/o/r/pull/1#discussion_r9';
  const once = core.withCarriedFindings('Proof.\n', [url, url]);
  assert.match(once, /<details>\n<summary>Carried review findings<\/summary>[\s\S]*<\/details>/);
  assert.equal(once.split(url).length - 1, 1);
  assert.equal(core.withCarriedFindings(once, [url]), once);
  assert.equal(
    core.withCarriedFindings('keep', ['https://github.com/o/r/pull/1#discussion_r9</details>']),
    'keep',
  );
});

test('an open P1 that also carries a deferral reply is counted once, as an open finding', () => {
  const [marked] = markDeferrals(
    [thread('P1', { replies: ['valid, out of scope for this PR, tracked in #9'] })],
    new Map([[9, 'issue']]),
  );
  const result = decide(pr, done, [marked], noRetries);
  assert.equal(result.title, '1 open P0/P1 Codex findings');
  assert.equal(result.summary.match(/must be fixed\)/g)?.length, 1);
});
