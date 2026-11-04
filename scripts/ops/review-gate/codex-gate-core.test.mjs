import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addedLinesOf,
  BLOCK_ROUND_CAP,
  badgeOf,
  blockingThreads,
  blockMarker,
  blockRounds,
  decide,
  markPreExisting,
  parseState,
  REQUEST_AFTER_MS,
  requestMarker,
  retryMarker,
  retryStatus,
  reviewRequested,
  shouldSkip,
  threadTitle,
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

test('usageLimitHit needs a trusted limit comment newer than the state comment', () => {
  const stateEntry = { comment: { updated_at: '2026-01-01T00:00:10Z' } };
  const limit = (over = {}) => ({
    body: LIMIT_BODY,
    user: CODEX,
    created_at: '2026-01-01T00:00:20Z',
    updated_at: '2026-01-01T00:00:20Z',
    ...over,
  });
  assert.equal(usageLimitHit([limit()], stateEntry), true);
  assert.equal(usageLimitHit([limit()], null), true);
  assert.equal(usageLimitHit([limit({ created_at: '2026-01-01T00:00:05Z' })], stateEntry), false);
  assert.equal(
    usageLimitHit([limit({ user: { login: 'mallory', type: 'User' } })], stateEntry),
    false,
  );
  assert.equal(usageLimitHit([limit({ body: 'all good' })], stateEntry), false);
  assert.equal(
    usageLimitHit(
      [limit(), { body: 'newer note', user: CODEX, created_at: '2026-01-01T00:00:30Z' }],
      stateEntry,
    ),
    false,
  );
  assert.equal(usageLimitHit([], stateEntry), false);
});

test('retryStatus counts only github-actions markers for the head', () => {
  const actions = { login: 'github-actions[bot]' };
  const comments = [
    { body: retryMarker(SHA, 1), user: actions, created_at: '2026-01-01T00:00:10Z' },
    { body: retryMarker(OTHER, 1), user: actions, created_at: '2026-01-01T00:00:11Z' },
    { body: retryMarker(SHA, 2), user: { login: 'mallory' }, created_at: '2026-01-01T00:00:12Z' },
  ];
  assert.deepEqual(retryStatus(comments, SHA, '2026-01-01T00:00:05Z'), { count: 1, pending: true });
  assert.deepEqual(retryStatus(comments, SHA, '2026-01-01T00:00:20Z'), {
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

const PATCH = [
  '@@ -10,3 +10,4 @@ ctx',
  ' keep',
  '-old',
  '+new one',
  '+new two',
  ' tail',
  '\\ No newline',
].join('\n');
const located = (level, over = {}) =>
  thread(level, { path: 'src/a.ts', line: 50, startLine: null, diffSide: 'RIGHT', ...over });
const files = [{ filename: 'src/a.ts', patch: PATCH }, { filename: 'src/big.bin' }];
const actionsComment = (body) => ({ user: { login: 'github-actions[bot]' }, body });

test('addedLinesOf numbers added lines on the new side of each hunk', () => {
  assert.deepEqual([...addedLinesOf(PATCH)], [11, 12]);
  assert.deepEqual(
    [...addedLinesOf('@@ -1 +1,2 @@\n+a\n+b\n@@ -20,2 +30,3 @@\n x\n+c\n y')],
    [1, 2, 31],
  );
  assert.deepEqual([...addedLinesOf(undefined)], []);
});

test('markPreExisting flags only open right-side threads wholly outside the added lines', () => {
  const [outside, onAdded, rangeTouchesAdded, outdated, left, noPatch, unknownFile, noLocation] =
    markPreExisting(
      [
        located('P1', { line: 10 }),
        located('P1', { line: 11 }),
        located('P1', { startLine: 9, line: 11 }),
        located('P1', { line: 10, isOutdated: true }),
        located('P1', { line: 10, diffSide: 'LEFT' }),
        located('P1', { path: 'src/big.bin', line: 10 }),
        located('P1', { path: 'src/other.ts', line: 10 }),
        thread('P1'),
      ],
      files,
    );
  assert.equal(outside.preExisting, true);
  for (const kept of [onAdded, rangeTouchesAdded, outdated, left, noPatch, unknownFile, noLocation])
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

test('a pass reports the blocked heads before it', () => {
  const clean = decide(pr, done, [], noRetries, false, null, { others: 2, marked: true });
  assert.equal(clean.conclusion, 'success');
  assert.match(clean.summary, /Cycles to pass: 3 blocked head/);
  assert.doesNotMatch(decide(pr, done, [], noRetries).summary, /Cycles to pass/);
});
