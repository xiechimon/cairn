import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
if (/api repos\\/o\\/r\\/pulls\\/7$/.test(joined)) out(world.pr);
else if (joined.includes('--slurp') && joined.includes('repos/o/r/pulls?')) out([world.pulls]);
else if (joined.includes('--slurp') && joined.includes('/issues/7/comments')) out([world.comments]);
else if (joined.includes('graphql')) {
  out({ data: { repository: { pullRequest: { reviewThreads: {
    nodes: world.threads, pageInfo: { hasNextPage: false, endCursor: null } } } } } });
} else if (joined.includes('/check-runs?')) out({ check_runs: world.checkRuns });
else out({});
`;

const state = (sha, status) =>
  `Summary\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: sha, status, has_any_findings: null, has_unresolved_findings: null }, security_review: {} })} -->`;
const stateComment = (sha, status) => ({
  id: 1,
  body: state(sha, status),
  user: CODEX,
  html_url: 'https://github.com/o/r/pull/7#issuecomment-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:01:00Z',
});
const thread = (level, over = {}) => ({
  isResolved: false,
  isOutdated: false,
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
};

function run(world, command = 'evaluate') {
  const dir = mkdtempSync(join(tmpdir(), 'codex-gate-host-'));
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
      stateComment(SHA, 'failed'),
      {
        id: 11,
        body: `<!-- review-gate-retry:${SHA}:1 -->`,
        user: ACTIONS,
        created_at: '2026-01-01T00:05:00Z',
      },
    ],
    checkRuns: [],
  });
  assert.equal(out.commentPosts.length, 0);
  assert.equal(out.body(out.checkWrites[0]).status, 'in_progress');
});

test('an exhausted allowance fails the check, labels the PR and posts no retry', () => {
  const limit = {
    id: 2,
    body: LIMIT_BODY,
    user: CODEX,
    created_at: '2026-01-01T00:10:00Z',
    updated_at: '2026-01-01T00:10:00Z',
  };
  const out = run({
    comments: [stateComment(OTHER, 'completed'), limit],
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
      { ...limit, user: { login: 'mallory', type: 'User' } },
    ],
    checkRuns: [],
  });
  assert.equal(forged.body(forged.checkWrites[0]).status, 'in_progress');
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
  const dir = mkdtempSync(join(tmpdir(), 'codex-gate-cmd-'));
  const result = spawnSync(process.execPath, [gateScript, 'nope'], {
    encoding: 'utf8',
    cwd: dir,
    env: { PATH: process.env.PATH },
  });
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
    checkRuns: [ownRun()],
    comments: [
      {
        id: 9,
        body: `<!-- review-gate-request:${SHA} -->\n@codex review`,
        user: ACTIONS,
        created_at: '2026-01-01T00:20:00Z',
        updated_at: '2026-01-01T00:20:00Z',
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
