import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const gateScript = fileURLToPath(new URL('./codex-gate.mjs', import.meta.url));
const SHA = 'c'.repeat(40);
const OTHER = 'd'.repeat(40);
const CODEX = { login: 'chatgpt-codex-connector[bot]', type: 'Bot' };
const ACTIONS = { login: 'github-actions[bot]', type: 'Bot' };
const LIMIT_BODY =
  'You have reached your Codex usage limits for code reviews. You can see your limits in the [Codex usage dashboard](https://chatgpt.com/codex/cloud/settings/usage).';

const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const input = args.includes('--input') ? fs.readFileSync(0, 'utf8') : null;
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, input }) + '\\n');
const world = JSON.parse(fs.readFileSync(process.env.FAKE_WORLD, 'utf8'));
const joined = args.join(' ');
const out = (value) => process.stdout.write(JSON.stringify(value));
const issue = /api -i repos\\/o\\/r\\/issues\\/(\\d+)$/.exec(joined);
if (issue) {
  const found = (world.issues ?? {})[issue[1]];
  if (found === 'error') process.exit(2);
  process.stdout.write((found ? 'HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n' : 'HTTP/2.0 404 Not Found\\r\\n\\r\\n') + JSON.stringify(found ?? { message: 'Not Found' }));
  if (!found) process.exit(1);
} else if (/api repos\\/o\\/r\\/pulls\\/7$/.test(joined)) {
  const reads = fs.readFileSync(process.env.FAKE_LOG, 'utf8').split('\\n').filter((line) => line.includes('"repos/o/r/pulls/7"') && !line.includes('--method')).length;
  out(reads > 1 && world.prAfter ? world.prAfter : world.pr);
}
else if (joined.includes('--slurp') && joined.includes('/pulls/7/files')) out(world.filePages ?? [world.files ?? []]);
else if (joined.includes('--slurp') && joined.includes('repos/o/r/pulls?')) out([world.pulls]);
else if (joined.includes('--slurp') && joined.includes('/git/matching-refs/')) out([world.matchingRefs ?? []]);
else if (joined.includes('--slurp') && joined.includes('/pulls/7/commits')) out([world.commits ?? []]);
else if (/api repos\\/o\\/r\\/commits\\/[a-f0-9]+$/.test(joined)) out({sha:world.resolvedSha});
else if (joined.includes('--slurp') && joined.includes('/issues/7/comments')) out([world.comments]);
else if (joined.includes('HEAD_REF_FORCE_PUSHED_EVENT')) {
  out({data:{repository:{pullRequest:{timelineItems:{nodes:world.forcePushes,pageInfo:{hasNextPage:false,endCursor:null}}}}}});
} else if (joined.includes('graphql')) {
  out({ data: { repository: { pullRequest: { reviewThreads: {
    nodes: world.threads, pageInfo: { hasNextPage: false, endCursor: null } } } } } });
} else if (joined.includes('/check-runs?')) out({ check_runs: world.checkRuns });
else if (/api repos\\/o\\/r\\/compare\\/[0-9a-f]+\\.\\.\\.[0-9a-f]+$/.test(joined)) out(world.compare ?? { behind_by: 0, files: [] });
else out({});
`;

const state = (sha, status, securityReview = {}) =>
  `Summary\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: sha, status, has_any_findings: null, has_unresolved_findings: null }, security_review: securityReview })} -->`;
const stateComment = (sha, status, securityReview) => ({
  id: 1,
  body: state(sha, status, securityReview),
  user: CODEX,
  html_url: 'https://github.com/o/r/pull/7#issuecomment-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:01:00Z',
});
const thread = (level, over = {}) => ({
  id: `PRRT_${level}`,
  isResolved: false,
  isOutdated: false,
  path: 'src/a.ts',
  line: 10,
  startLine: null,
  diffSide: 'RIGHT',
  comments: {
    nodes: [
      {
        author: { login: 'chatgpt-codex-connector', __typename: 'Bot' },
        body: `**<sub><sub>![${level} Badge](x)</sub></sub>  Finding ${level}**\n\nbody`,
        url: `https://github.com/o/r/pull/7#discussion_r${level}`,
      },
    ],
  },
  ...over,
});
const basePr = {
  number: 7,
  state: 'open',
  draft: false,
  head: { sha: SHA, ref: 'feature/x' },
  user: { login: 'dev' },
  author_association: 'OWNER',
  labels: [],
  changed_files: 1,
};

function run(world, command = 'evaluate') {
  const dir = makeTestTempDir('codex-gate-host-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  const worldPath = join(dir, 'world.json');
  const log = join(dir, 'calls.log');
  writeFileSync(
    worldPath,
    JSON.stringify({
      pr: basePr,
      pulls: [basePr],
      comments: [],
      threads: [],
      checkRuns: [],
      files: [{ filename: 'src/a.ts' }],
      ...world,
    }),
  );
  writeFileSync(log, '');
  const result = spawnSync(process.execPath, [gateScript, command], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GH_TOKEN: 'fake',
      REPO: 'o/r',
      ...(command === 'evaluate' ? { PR_NUMBER: '7' } : {}),
      FAKE_WORLD: worldPath,
      FAKE_LOG: log,
    },
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const writes = calls.filter((call) => {
    const text = call.args.join(' ');
    return /--method|-X /.test(text) || call.input !== null;
  });
  const checkWrites = writes.filter((call) => /check-runs/.test(call.args.join(' ')));
  releaseTestTempDir(dir);
  return {
    result,
    calls,
    writes,
    checkWrites,
    body: (call) => JSON.parse(call.input),
    commentPosts: writes.filter((call) => /issues\/7\/comments/.test(call.args.join(' '))),
    labelAdds: writes.filter(
      (call) =>
        /issues\/7\/labels/.test(call.args.join(' ')) && !/DELETE/.test(call.args.join(' ')),
    ),
    labelRemoves: writes.filter((call) => /DELETE/.test(call.args.join(' '))),
  };
}

const ownRun = (over = {}) => ({
  id: 55,
  name: 'review-gate',
  app: { slug: 'github-actions' },
  started_at: '2026-01-01T00:00:00Z',
  ...over,
});

test('completed clean review PATCHes the existing github-actions check', () => {
  const out = run({
    comments: [stateComment(SHA, 'completed')],
    checkRuns: [ownRun()],
  });
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(out.checkWrites.length, 1);
  assert.match(out.checkWrites[0].args.join(' '), /PATCH.*check-runs\/55|check-runs\/55.*PATCH/);
  const body = out.body(out.checkWrites[0]);
  assert.equal(body.conclusion, 'success');
  assert.equal(body.status, 'completed');
  assert.equal(body.details_url, 'https://github.com/o/r/pull/7#issuecomment-1');
});

test('POSTs a new check when none exists for the head', () => {
  const out = run({ comments: [stateComment(SHA, 'running')], checkRuns: [] });
  assert.equal(out.checkWrites.length, 1);
  assert.match(out.checkWrites[0].args.join(' '), /POST/);
  assert.match(out.checkWrites[0].args.join(' '), /repos\/o\/r\/check-runs/);
  const body = out.body(out.checkWrites[0]);
  assert.equal(body.name, 'review-gate');
  assert.equal(body.head_sha, SHA);
  assert.equal(body.status, 'in_progress');
  assert.equal(body.conclusion, undefined);
});

test('ignores a review-gate check from another app and keeps one run per head', () => {
  const foreign = ownRun({
    id: 99,
    app: { slug: 'some-other-app' },
    started_at: '2026-02-01T00:00:00Z',
  });
  const out = run({ comments: [stateComment(SHA, 'completed')], checkRuns: [foreign] });
  assert.equal(out.checkWrites.length, 1);
  assert.match(out.checkWrites[0].args.join(' '), /POST/);
  const both = run({
    comments: [stateComment(SHA, 'completed')],
    checkRuns: [
      foreign,
      ownRun({ id: 40 }),
      ownRun({ id: 41, started_at: '2026-01-02T00:00:00Z' }),
    ],
  });
  assert.equal(both.checkWrites.length, 1);
  assert.match(both.checkWrites[0].args.join(' '), /check-runs\/41/);
});

test('an unresolved P1 thread fails the check with its URL', () => {
  const out = run({
    comments: [stateComment(SHA, 'completed')],
    threads: [thread('P1'), thread('P2')],
    checkRuns: [ownRun()],
  });
  const body = out.body(out.checkWrites[0]);
  assert.equal(body.conclusion, 'failure');
  assert.equal(body.output.title, '1 open P0/P1 Codex findings');
  assert.match(body.output.summary, /discussion_rP1/);
});

test('a failing gate on a queued PR posts no Mergify command and leaves removal to the queue conditions', () => {
  const world = {
    comments: [stateComment(SHA, 'completed')],
    threads: [thread('P1')],
    checkRuns: [ownRun()],
  };
  const plain = run(world);
  const queued = run({ ...world, pr: { ...basePr, labels: [{ name: 'queued' }] } });
  assert.equal(queued.body(queued.checkWrites[0]).conclusion, 'failure');
  assert.equal(queued.commentPosts.length, plain.commentPosts.length);
  assert.ok(queued.commentPosts.every((call) => !/@mergifyio/.test(queued.body(call).body)));
});

test('a queued PR whose review inputs cannot be loaded fails the check without commenting', () => {
  const out = run({
    pr: { ...basePr, labels: [{ name: 'queued' }] },
    files: [],
    checkRuns: [ownRun()],
  });
  assert.equal(out.body(out.checkWrites[0]).output.title, 'Cannot determine the review inputs');
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'failure');
  assert.deepEqual(out.commentPosts, []);
});

test('a forged state comment from another author is ignored', () => {
  const forged = { ...stateComment(SHA, 'completed'), user: { login: 'mallory', type: 'User' } };
  const out = run({ comments: [forged], checkRuns: [] });
  const body = out.body(out.checkWrites[0]);
  assert.equal(body.status, 'in_progress');
  assert.equal(body.conclusion, undefined);
});

test('a failed review is retried at most twice per head', () => {
  const retryComment = (k, createdAt) => ({
    id: 10 + k,
    body: `<!-- review-gate-retry:${SHA}:${k} -->\n@codex review`,
    user: ACTIONS,
    created_at: createdAt,
    updated_at: createdAt,
  });
  const zero = run({ comments: [stateComment(SHA, 'failed')], checkRuns: [] });
  assert.equal(zero.commentPosts.length, 1);
  assert.match(zero.body(zero.commentPosts[0]).body, new RegExp(`review-gate-retry:${SHA}:1 -->`));
  assert.match(zero.body(zero.commentPosts[0]).body, /@codex review/);
  assert.equal(zero.body(zero.checkWrites[0]).output.title, 'Codex review failed; retry 1 of 2');

  const one = run({
    comments: [stateComment(SHA, 'failed'), retryComment(1, '2026-01-01T00:00:30Z')],
    checkRuns: [],
  });
  assert.equal(one.commentPosts.length, 1);
  assert.match(one.body(one.commentPosts[0]).body, new RegExp(`review-gate-retry:${SHA}:2 -->`));

  const two = run({
    comments: [
      stateComment(SHA, 'failed'),
      retryComment(1, '2026-01-01T00:00:30Z'),
      retryComment(2, '2026-01-01T00:00:40Z'),
    ],
    checkRuns: [ownRun()],
  });
  assert.equal(two.commentPosts.length, 0);
  const body = two.body(two.checkWrites[0]);
  assert.equal(body.conclusion, 'failure');
  assert.equal(body.output.title, 'Codex review failed twice; comment `@codex review`');
  assert.equal(two.labelAdds.length, 1);
  assert.match(two.labelAdds[0].input, /review-stalled/);

  const otherHead = run({
    comments: [
      stateComment(SHA, 'failed'),
      {
        id: 90,
        body: `<!-- review-gate-retry:${OTHER}:1 -->`,
        user: ACTIONS,
        created_at: '2026-01-01T00:00:30Z',
      },
    ],
    checkRuns: [],
  });
  assert.match(otherHead.body(otherHead.commentPosts[0]).body, new RegExp(`${SHA}:1 -->`));
});

test('a retry comment posted after the failed state is not repeated', () => {
  const out = run({
    comments: [
      { ...stateComment(SHA, 'failed'), created_at: minutesAgo(10), updated_at: minutesAgo(10) },
      {
        id: 11,
        body: `<!-- review-gate-retry:${SHA}:1 -->`,
        user: ACTIONS,
        created_at: minutesAgo(5),
      },
    ],
    checkRuns: [],
  });
  assert.equal(out.commentPosts.length, 0);
  assert.equal(out.body(out.checkWrites[0]).status, 'in_progress');
});

const requestComment = (sha, createdAt, marker = `<!-- review-gate-request:${sha} -->`) => ({
  id: 3,
  body: `${marker}\n@codex review`,
  user: ACTIONS,
  created_at: createdAt,
});
const limitNotice = (createdAt) => ({
  id: 2,
  body: LIMIT_BODY,
  user: CODEX,
  created_at: createdAt,
  updated_at: createdAt,
});

test('an exhausted allowance fails the check, labels the PR and posts no retry', () => {
  const limit = limitNotice(minutesAgo(5));
  const out = run({
    comments: [stateComment(OTHER, 'completed'), requestComment(SHA, minutesAgo(10)), limit],
    checkRuns: [ownRun()],
  });
  assert.equal(out.commentPosts.length, 0);
  const body = out.body(out.checkWrites[0]);
  assert.equal(body.conclusion, 'failure');
  assert.equal(body.output.title, 'Codex allowance exhausted');
  assert.match(body.output.summary, /chatgpt\.com\/codex\/cloud\/settings\/usage/);
  assert.equal(out.labelAdds.length, 1);
  assert.match(out.labelAdds[0].input, /review-stalled/);

  const forged = run({
    comments: [
      stateComment(OTHER, 'completed'),
      requestComment(SHA, minutesAgo(10)),
      { ...limit, user: { login: 'mallory', type: 'User' } },
    ],
    checkRuns: [],
  });
  assert.equal(forged.body(forged.checkWrites[0]).status, 'in_progress');
});

test('an old limit notice does not block a new head and its review is requested', () => {
  const out = run({
    comments: [stateComment(OTHER, 'completed'), limitNotice(minutesAgo(300))],
    checkRuns: [ownRun({ started_at: minutesAgo(11) })],
  });
  const body = out.body(out.checkWrites[0]);
  assert.equal(body.status, 'in_progress');
  assert.match(body.output.title, /^Asked Codex to review/);
  assert.equal(out.commentPosts.length, 1);
  assert.match(out.body(out.commentPosts[0]).body, new RegExp(`review-gate-request:${SHA}`));
  assert.equal(out.labelAdds.length, 0);
});

test('a limit notice newer than this head request blocks the head', () => {
  const out = run({
    comments: [
      stateComment(OTHER, 'completed'),
      requestComment(SHA, minutesAgo(30)),
      limitNotice(minutesAgo(29)),
    ],
    checkRuns: [ownRun({ started_at: minutesAgo(40) })],
  });
  assert.equal(out.body(out.checkWrites[0]).output.title, 'Codex allowance exhausted');
  assert.equal(out.commentPosts.length, 0);
});

test('a limited head is retried once two hours after the last request', () => {
  const comments = [
    stateComment(OTHER, 'completed'),
    requestComment(SHA, minutesAgo(130)),
    limitNotice(minutesAgo(129)),
  ];
  const out = run({ comments, checkRuns: [ownRun({ started_at: minutesAgo(140) })] });
  assert.equal(out.commentPosts.length, 1);
  assert.match(out.body(out.commentPosts[0]).body, new RegExp(`review-gate-retry:${SHA}:1`));
  assert.equal(out.body(out.checkWrites[0]).status, 'in_progress');

  const retried = run({
    comments: [
      ...comments,
      requestComment(SHA, minutesAgo(1), `<!-- review-gate-retry:${SHA}:1 -->`),
    ],
    checkRuns: [ownRun({ started_at: minutesAgo(140) })],
  });
  assert.equal(retried.commentPosts.length, 0);
  assert.equal(retried.body(retried.checkWrites[0]).status, 'in_progress');
});

test('review-stalled is removed once a limited head passes', () => {
  const out = run({
    pr: { ...basePr, labels: [{ name: 'review-stalled' }] },
    comments: [
      requestComment(SHA, minutesAgo(200)),
      limitNotice(minutesAgo(199)),
      stateComment(SHA, 'completed'),
    ],
    checkRuns: [ownRun()],
  });
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'success');
  assert.equal(out.labelRemoves.length, 1);
  assert.match(out.labelRemoves[0].args.join(' '), /labels\/review-stalled/);
});

test('review-stalled is not added twice and is removed on success', () => {
  const stalled = { ...basePr, labels: [{ name: 'review-stalled' }] };
  const failedTwice = run({
    pr: stalled,
    comments: [
      stateComment(SHA, 'failed'),
      {
        id: 11,
        body: `<!-- review-gate-retry:${SHA}:1 -->`,
        user: ACTIONS,
        created_at: '2026-01-01T00:00:30Z',
      },
      {
        id: 12,
        body: `<!-- review-gate-retry:${SHA}:2 -->`,
        user: ACTIONS,
        created_at: '2026-01-01T00:00:40Z',
      },
    ],
    checkRuns: [],
  });
  assert.equal(failedTwice.labelAdds.length, 0);
  const ok = run({ pr: stalled, comments: [stateComment(SHA, 'completed')], checkRuns: [] });
  assert.equal(ok.labelRemoves.length, 1);
  assert.match(ok.labelRemoves[0].args.join(' '), /labels\/review-stalled/);
  const fresh = run({ comments: [stateComment(SHA, 'completed')], checkRuns: [] });
  assert.equal(fresh.labelRemoves.length, 0);
});

test('skips closed, draft, merge-queue and non-write PRs without writing', () => {
  const cases = [
    { ...basePr, state: 'closed' },
    { ...basePr, draft: true },
    { ...basePr, head: { sha: SHA, ref: 'mergify/merge-queue/abc' } },
    { ...basePr, author_association: 'NONE' },
    { ...basePr, author_association: 'CONTRIBUTOR', user: { login: 'stranger' } },
  ];
  for (const pr of cases) {
    const out = run({ pr, comments: [stateComment(SHA, 'completed')] });
    assert.equal(out.result.status, 0, out.result.stderr);
    assert.equal(out.writes.length, 0);
    assert.match(out.result.stdout + out.result.stderr, /skip/i);
  }
  const bot = run({
    pr: { ...basePr, author_association: 'NONE', user: { login: 'cairnwright[bot]' } },
    comments: [stateComment(SHA, 'completed')],
  });
  assert.equal(bot.checkWrites.length, 1);
});

test('rejects an unknown command', () => {
  const dir = makeTestTempDir('codex-gate-cmd-');
  const result = spawnSync(process.execPath, [gateScript, 'nope'], {
    encoding: 'utf8',
    cwd: dir,
    env: { PATH: process.env.PATH },
  });
  releaseTestTempDir(dir);
  assert.notEqual(result.status, 0);
});

test('a head with no Codex review after ten minutes gets one @codex review comment', () => {
  const out = run({ comments: [stateComment(OTHER, 'completed')], checkRuns: [ownRun()] });
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(out.commentPosts.length, 1);
  assert.equal(
    out.body(out.commentPosts[0]).body,
    `<!-- review-gate-request:${SHA} -->\n@codex review`,
  );
  assert.equal(out.body(out.checkWrites[0]).output.title, 'Asked Codex to review ccccccc');
  assert.equal(out.body(out.checkWrites[0]).status, 'in_progress');
});

test('no request before ten minutes, without a check run, or after one was made', () => {
  const fresh = run({ checkRuns: [ownRun({ started_at: new Date().toISOString() })] });
  const noCheck = run({ checkRuns: [] });
  const asked = run({
    checkRuns: [ownRun({ started_at: minutesAgo(15) })],
    comments: [
      {
        id: 9,
        body: `<!-- review-gate-request:${SHA} -->\n@codex review`,
        user: ACTIONS,
        created_at: minutesAgo(5),
        updated_at: minutesAgo(5),
      },
    ],
  });
  for (const out of [fresh, noCheck, asked]) {
    assert.equal(out.result.status, 0, out.result.stderr);
    assert.equal(out.commentPosts.length, 0);
    assert.equal(
      out.body(out.checkWrites[0]).output.title,
      'Waiting for the Codex review of ccccccc',
    );
  }
});

test('sweep dispatches one per-PR evaluation for each open non-draft PR that has not passed', () => {
  const out = run(
    {
      pulls: [basePr, { ...basePr, number: 8, draft: true }],
      comments: [stateComment(SHA, 'completed')],
      checkRuns: [ownRun()],
    },
    'sweep',
  );
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(out.checkWrites.length, 0);
  assert.equal(out.commentPosts.length, 0);
  const dispatches = out.writes.filter((call) =>
    /actions\/workflows\/review-gate\.yml\/dispatches/.test(call.args.join(' ')),
  );
  assert.equal(dispatches.length, 1);
  assert.deepEqual(out.body(dispatches[0]), { ref: 'main', inputs: { pr: '7' } });
});

test('sweep skips a head whose gate check already passed', () => {
  const out = run(
    {
      comments: [stateComment(SHA, 'completed')],
      checkRuns: [ownRun({ status: 'completed', conclusion: 'success' })],
    },
    'sweep',
  );
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(out.writes.length, 0);
  assert.equal(out.calls.filter((call) => /pulls\/7$/.test(call.args.join(' '))).length, 0);
});

const actionsComment = (body, createdAt = '2026-01-01T00:02:00Z') => ({
  id: 9,
  body,
  user: ACTIONS,
  created_at: createdAt,
  updated_at: createdAt,
});

test('a finding on a line the PR did not change is listed but passes the check', () => {
  const out = run({
    comments: [stateComment(SHA, 'completed')],
    threads: [thread('P1')],
    files: [{ filename: 'src/a.ts', patch: '@@ -40,1 +40,2 @@\n ctx\n+added' }],
    checkRuns: [ownRun()],
  });
  const body = out.body(out.checkWrites[0]);
  assert.equal(body.conclusion, 'success');
  assert.match(body.output.summary, /predate this PR/);
  assert.equal(out.commentPosts.length, 0);
});

test('the same finding on an added line blocks and records the block once', () => {
  const world = {
    comments: [stateComment(SHA, 'completed')],
    threads: [thread('P1')],
    files: [{ filename: 'src/a.ts', patch: '@@ -9,1 +9,3 @@\n ctx\n+added\n+added2' }],
    checkRuns: [ownRun()],
  };
  const out = run(world);
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'failure');
  assert.equal(out.commentPosts.length, 1);
  assert.match(out.body(out.commentPosts[0]).body, new RegExp(`review-gate-block:${SHA}`));
  const repeat = run({
    ...world,
    comments: [...world.comments, actionsComment(`<!-- review-gate-block:${SHA} -->\nx`)],
  });
  assert.equal(repeat.commentPosts.length, 0);
});

const priorBlocks = ['1', '2'].map((digit, index) =>
  actionsComment(
    `<!-- review-gate-block:${digit.repeat(40)} -->\nx`,
    `2026-01-01T00:0${index + 2}:00Z`,
  ),
);
const round3 = (threads, compare) =>
  run({
    comments: [stateComment(SHA, 'completed'), ...priorBlocks],
    threads,
    files: [{ filename: 'src/a.ts', patch: '@@ -9,1 +9,3 @@\n ctx\n+added\n+added2' }],
    compare,
    checkRuns: [ownRun()],
  });
const quietCompare = {
  behind_by: 0,
  files: [{ filename: 'src/a.ts', patch: '@@ -1,1 +1,2 @@\n ctx\n+other' }],
};
const touchedCompare = {
  behind_by: 0,
  files: [{ filename: 'src/a.ts', patch: '@@ -9,1 +9,3 @@\n ctx\n+added\n+added2' }],
};

test('round 2 does not consult the compare and still blocks', () => {
  const out = run({
    comments: [stateComment(SHA, 'completed'), priorBlocks[0]],
    threads: [thread('P1')],
    files: [{ filename: 'src/a.ts', patch: '@@ -9,1 +9,3 @@\n ctx\n+added\n+added2' }],
    compare: quietCompare,
    checkRuns: [ownRun()],
  });
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'failure');
  assert.ok(!out.calls.some((call) => call.args.join(' ').includes('/compare/')));
});

test('from round 3 a P1 on lines unchanged since the last blocked head does not block', () => {
  const out = round3([thread('P1')], quietCompare);
  assert.equal(out.result.status, 0, out.result.stderr);
  const body = out.body(out.checkWrites[0]);
  assert.equal(body.conclusion, 'success');
  assert.match(body.output.summary, /bug class/);
  assert.match(body.output.summary, /reconsider the approach/);
  assert.equal(out.labelAdds.length, 1);
  assert.deepEqual(out.body(out.labelAdds[0]).labels, ['review-gate-human']);
  assert.equal(out.commentPosts.length, 1);
  assert.match(
    out.body(out.commentPosts[0]).body,
    /review-gate recorded them in Carried review findings/,
  );
  assert.match(
    out.calls.map((call) => call.args.join(' ')).join('\n'),
    new RegExp(`compare/${'2'.repeat(40)}\\.\\.\\.${SHA}`),
  );
  const repeat = run({
    comments: [
      stateComment(SHA, 'completed'),
      ...priorBlocks,
      actionsComment(out.body(out.commentPosts[0]).body, '2026-01-01T00:04:00Z'),
    ],
    threads: [thread('P1')],
    files: [{ filename: 'src/a.ts', patch: '@@ -9,1 +9,3 @@\n ctx\n+added\n+added2' }],
    compare: quietCompare,
    checkRuns: [ownRun()],
    pr: { ...basePr, labels: [{ name: 'review-gate-human' }] },
  });
  assert.equal(repeat.commentPosts.length, 0);
  assert.equal(repeat.labelAdds.length, 0);
});

test('from round 3 a P1 on a newly changed line still blocks', () => {
  const out = round3([thread('P1')], touchedCompare);
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'failure');
  assert.match(out.body(out.checkWrites[0]).output.title, /reconsider the approach/);
  assert.match(out.body(out.commentPosts[0]).body, new RegExp(`review-gate-block:${SHA}`));
});

test('from round 3 a P0 on an old line still blocks', () => {
  const out = round3([thread('P0')], quietCompare);
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'failure');
  assert.match(out.body(out.checkWrites[0]).output.summary, /discussion_rP0/);
});

test('from round 3 an unanchored thread on an unchanged file does not block', () => {
  const out = round3([thread('P1', { path: 'src/untouched.ts', line: null })], quietCompare);
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'success');
  assert.match(
    out.body(out.commentPosts[0]).body,
    /review-gate recorded them in Carried review findings/,
  );
});

test('a diverged compare does not narrow a round-3 P1', () => {
  const out = round3([thread('P1')], { ...quietCompare, behind_by: 1 });
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'failure');
});

test('incomplete PR file pagination cannot preserve a previous successful check', () => {
  const out = run({
    pr: { ...basePr, changed_files: 2 },
    files: [{ filename: 'apps/web/src/main.ts' }],
    comments: [stateComment(SHA, 'completed')],
    checkRuns: [ownRun({ status: 'completed', conclusion: 'success' })],
  });
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'failure');
  assert.match(out.body(out.checkWrites[0]).output.summary, /file list/i);
});

const reply = (
  body,
  author = { login: 'dev', __typename: 'User' },
  authorAssociation = 'OWNER',
) => ({
  author,
  authorAssociation,
  body,
});
const withReplies = (level, replies, over = {}) => {
  const root = thread(level);
  return {
    ...root,
    isResolved: true,
    comments: {
      totalCount: replies.length + 1,
      nodes: [...root.comments.nodes, ...replies],
    },
    ...over,
  };
};
const deferred = (level, issue, over = {}) =>
  withReplies(
    level,
    [
      reply('Looking at this now.'),
      reply(`Valid, out of scope for this PR, tracked in #${issue}.`),
    ],
    over,
  );
const realIssue = { number: 12, state: 'open', title: 'follow-up' };
const deferralWorld = (threads, issues = { 12: realIssue }) => ({
  comments: [stateComment(SHA, 'completed')],
  threads,
  issues,
  files: [{ filename: 'src/a.ts', patch: '@@ -9,1 +9,3 @@\n ctx\n+added\n+added2' }],
  checkRuns: [ownRun()],
});

test('a P2 or P3 finding answered as out of scope with a real issue passes', () => {
  for (const level of ['P2', 'P3']) {
    const body = (out) => out.body(out.checkWrites[0]);
    const out = run(deferralWorld([deferred(level, 12)]));
    assert.equal(body(out).conclusion, 'success', level);
  }
});

test('a P0 or P1 finding on a changed line cannot be deferred; it must be fixed', () => {
  for (const level of ['P0', 'P1']) {
    const out = run(deferralWorld([deferred(level, 12)]));
    const body = out.body(out.checkWrites[0]);
    assert.equal(body.conclusion, 'failure', level);
    assert.match(body.output.summary, /must be fixed/, level);
    assert.match(body.output.summary, new RegExp(`discussion_r${level}`), level);
  }
});

test('a deferral to a number that is not an issue in this repository blocks', () => {
  const missing = run(deferralWorld([deferred('P2', 99)]));
  const pull = run(
    deferralWorld([deferred('P2', 13)], {
      13: { number: 13, pull_request: { url: 'https://api.github.com/repos/o/r/pulls/13' } },
    }),
  );
  for (const out of [missing, pull]) {
    const body = out.body(out.checkWrites[0]);
    assert.equal(body.conclusion, 'failure');
    assert.match(body.output.summary, /not an issue/);
  }
});

test('an issue lookup that fails for another reason cannot pass the gate', () => {
  const out = run(deferralWorld([deferred('P2', 12)], { 12: 'error' }));
  const body = out.body(out.checkWrites[0]);
  assert.equal(body.conclusion, 'failure');
  assert.equal(body.output.title, 'Cannot determine the review inputs');
});

test('a deferred P1 on lines that predate the PR passes, and threads without a deferral read no issue', () => {
  const carried = run({
    ...deferralWorld([deferred('P1', 12)]),
    files: [{ filename: 'src/a.ts', patch: '@@ -40,1 +40,2 @@\n ctx\n+added' }],
  });
  assert.equal(carried.body(carried.checkWrites[0]).conclusion, 'success');
  const plain = run(deferralWorld([thread('P2', { isResolved: true })]));
  assert.equal(plain.body(plain.checkWrites[0]).conclusion, 'success');
  assert.ok(!plain.calls.some((call) => call.args.join(' ').includes('/issues/12')));
});

test('only replies from writers or the cairn App count as deferrals; the Codex finding itself never does', () => {
  const stranger = run(
    deferralWorld([
      withReplies('P2', [
        reply(
          'valid, out of scope for this PR, tracked in #99',
          { login: 'drive-by', __typename: 'User' },
          'NONE',
        ),
      ]),
    ]),
  );
  assert.equal(stranger.body(stranger.checkWrites[0]).conclusion, 'success');
  const quoting = thread('P2', { isResolved: true });
  quoting.comments.nodes[0].body +=
    '\n\nReply valid, out of scope for this PR, tracked in #99 to defer.';
  const self = run(deferralWorld([quoting]));
  assert.equal(self.body(self.checkWrites[0]).conclusion, 'success');
  const app = run(
    deferralWorld([
      withReplies('P2', [
        reply(
          'valid, out of scope for this PR, tracked in #99',
          { login: 'cairnwright', __typename: 'Bot' },
          'NONE',
        ),
      ]),
    ]),
  );
  assert.match(app.body(app.checkWrites[0]).output.summary, /not an issue/);
});

test('a thread with more comments than one page cannot be judged and fails as unreadable input', () => {
  const long = withReplies('P1', [reply('ok')], {
    comments: { totalCount: 150, nodes: thread('P1').comments.nodes },
  });
  const out = run(deferralWorld([long]));
  assert.equal(out.body(out.checkWrites[0]).output.title, 'Cannot determine the review inputs');
});

const carriedReplyText =
  "Recorded as pre-existing in this PR's Risk by review-gate at ccccccc; not blocking.";
const finding = (level, id, line, slug, author) => {
  const node = thread(level, { id, line });
  node.comments.nodes[0].url = `https://github.com/o/r/pull/7#discussion_r${slug}`;
  if (author) node.comments.nodes[0].author = author;
  return node;
};
const namedCalls = (out, mutation) =>
  out.calls.filter((call) => call.args.some((arg) => String(arg).includes(mutation)));
const pullPatches = (out) =>
  out.writes.filter((call) => /--method PATCH repos\/o\/r\/pulls\/7\b/.test(call.args.join(' ')));
const round3World = (threads, extra = {}) => ({
  comments: [stateComment(SHA, 'completed'), ...priorBlocks],
  threads,
  files: [{ filename: 'src/a.ts', patch: '@@ -9,1 +9,3 @@\n ctx\n+added\n+added2' }],
  compare: quietCompare,
  checkRuns: [ownRun()],
  ...extra,
});

test('the review-gate job token has pull-requests write for thread reply and resolve', () => {
  const workflow = readFileSync(
    fileURLToPath(new URL('../../../.github/workflows/review-gate.yml', import.meta.url)),
    'utf8',
  );
  const job = workflow.slice(workflow.indexOf('jobs:'), workflow.indexOf('concurrency:'));
  assert.match(job, /pull-requests: write/);
});

test('from round 3 a carried Codex P1 is replied and resolved once; blocking P1, P0 and human threads are not', () => {
  const splitCompare = {
    behind_by: 0,
    files: [{ filename: 'src/a.ts', patch: '@@ -9,1 +9,2 @@\n ctx\n+added' }],
  };
  const carried = finding('P1', 'PRRT_carried', 11, '50');
  const blocking = finding('P1', 'PRRT_blocking', 10, '2');
  const p0 = finding('P0', 'PRRT_p0', 11, '80');
  const human = finding('P1', 'PRRT_human', 11, '70', { login: 'dev', __typename: 'User' });
  const out = run(round3World([carried, blocking, p0, human], { compare: splitCompare }));
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'failure');
  const replies = namedCalls(out, 'addPullRequestReviewThreadReply');
  const resolves = namedCalls(out, 'resolveReviewThread');
  assert.equal(replies.length, 1);
  assert.equal(resolves.length, 1);
  assert.equal(replies[0].args.find((arg) => arg.startsWith('body=')).slice(5), carriedReplyText);
  assert.equal(replies[0].args.find((arg) => arg.startsWith('id=')).slice(3), 'PRRT_carried');
  assert.equal(resolves[0].args.find((arg) => arg.startsWith('id=')).slice(3), 'PRRT_carried');
  const touched = out.calls.map((call) => call.args.join(' ')).join('\n');
  for (const id of ['PRRT_blocking', 'PRRT_p0', 'PRRT_human'])
    assert.equal(touched.includes(id), false);
  const patches = pullPatches(out);
  assert.equal(patches.length, 1);
  const body = out.body(patches[0]).body;
  assert.match(body, /<details>\n<summary>Carried review findings<\/summary>/);
  assert.equal(body.split('discussion_r50').length - 1, 1);
  assert.doesNotMatch(body, /discussion_r2|discussion_r80|discussion_r70/);
});

test('a rerun does not duplicate the carried reply, resolve or PR body line', () => {
  const listed =
    '<details>\n<summary>Carried review findings</summary>\n\n- https://github.com/o/r/pull/7#discussion_r50\n</details>\n';
  const openThread = finding('P1', 'PRRT_carried', 11, '50');
  openThread.comments.nodes.push({
    author: { login: 'github-actions[bot]', __typename: 'Bot' },
    body: carriedReplyText,
  });
  const open = run(round3World([openThread], { pr: { ...basePr, body: listed } }));
  assert.equal(open.result.status, 0, open.result.stderr);
  assert.equal(namedCalls(open, 'addPullRequestReviewThreadReply').length, 0);
  assert.equal(namedCalls(open, 'resolveReviewThread').length, 1);
  assert.equal(pullPatches(open).length, 0);
  const resolved = finding('P1', 'PRRT_carried', 11, '50');
  resolved.isResolved = true;
  resolved.comments.nodes.push({
    author: { login: 'github-actions[bot]', __typename: 'Bot' },
    body: carriedReplyText,
  });
  const again = run(round3World([resolved], { pr: { ...basePr, body: listed } }));
  assert.equal(again.result.status, 0, again.result.stderr);
  assert.equal(namedCalls(again, 'addPullRequestReviewThreadReply').length, 0);
  assert.equal(namedCalls(again, 'resolveReviewThread').length, 0);
  assert.equal(pullPatches(again).length, 0);
});

test('a moved head is not resolved from the stale carried classification', () => {
  const carried = finding('P1', 'PRRT_carried', 11, '50');
  const out = run(
    round3World([carried], {
      prAfter: { ...basePr, head: { sha: 'e'.repeat(40), ref: 'feature/x' } },
    }),
  );
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(namedCalls(out, 'resolveReviewThread').length, 0);
  assert.equal(namedCalls(out, 'addPullRequestReviewThreadReply').length, 0);
  assert.equal(pullPatches(out).length, 0);
});

test('a carried finding is appended to the PR body read just before the update', () => {
  const carried = finding('P1', 'PRRT_carried', 11, '50');
  const out = run(
    round3World([carried], {
      pr: { ...basePr, body: 'stale description' },
      prAfter: { ...basePr, body: 'kept edit' },
    }),
  );
  assert.equal(out.result.status, 0, out.result.stderr);
  const patches = pullPatches(out);
  assert.equal(patches.length, 1);
  const body = out.body(patches[0]).body;
  assert.match(body, /kept edit/);
  assert.doesNotMatch(body, /stale description/);
  assert.match(body, /discussion_r50/);
});

test('a pre-existing P1 before round 3 is not resolved by the gate', () => {
  const out = run({
    comments: [stateComment(SHA, 'completed')],
    threads: [thread('P1', { id: 'PRRT_old', line: 50 })],
    files: [{ filename: 'src/a.ts', patch: '@@ -40,1 +40,2 @@\n ctx\n+added' }],
    checkRuns: [ownRun()],
  });
  assert.equal(out.body(out.checkWrites[0]).conclusion, 'success');
  assert.equal(namedCalls(out, 'resolveReviewThread').length, 0);
});
