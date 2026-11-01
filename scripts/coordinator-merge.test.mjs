import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/coordinator-merge.mjs');
const sha = (letter) => letter.repeat(40);
const A = sha('a');
const B = sha('b');
const FAIL = { error: true };
const bot = { login: 'cairnwright[bot]' };
const passComment = (head, suffix = '', user = bot) => ({
  user,
  body: `<!-- review-gate:${head} -->\n**Independent review gate: PASS**${suffix} for \`${head.slice(0, 8)}\`.`,
});
const blockComment = (head, user = bot) => ({
  user,
  body: `<!-- review-gate:${head} -->\n**Independent review gate: BLOCK** for \`${head.slice(0, 8)}\`.`,
});
const green = ['check', 'pack-smoke', 'e2e-gate', 'pr-evidence'].map((name) => ({
  name,
  bucket: 'pass',
}));
const mustBeGreen = ['gates', 'dead-class-gate', 'ops-backup-test'].map((name) => ({
  name,
  bucket: 'pass',
}));
const base = {
  head: [A],
  comments: [[passComment(A)]],
  checks: [green],
  allChecks: [[...green, ...mustBeGreen]],
  markers: [[]],
  commits: [[{ commit: { message: 'Subject line\n\nBody text\n\ncloses #42' } }]],
  view: [{ state: 'MERGED', mergeCommit: { oid: sha('c') } }],
};

function run(t, timeline = {}, args = ['7']) {
  const dir = mkdtempSync(join(tmpdir(), 'coordinator-merge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'data'), JSON.stringify({ ...base, ...timeline }));
  writeFileSync(
    join(dir, 'gh'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const d = JSON.parse(fs.readFileSync(process.env.DATA));
const p = args[1] ?? '';
let key;
if (args[0] === 'pr' && args[1] === 'checks') key = args.includes('--required') ? 'checks' : 'allChecks';
else if (args[0] === 'pr' && args[1] === 'view') key = 'view';
else if (args[0] === 'pr' && args[1] === 'merge') process.exit(0);
else if (p.includes('/issues?')) key = 'markers';
else if (p.endsWith('/comments?per_page=100')) key = 'comments';
else if (p.endsWith('/commits?per_page=100')) key = 'commits';
else if (/\\/pulls\\/\\d+$/.test(p)) key = 'head';
else process.exit(2);
const counterFile = process.env.DATA + '.' + key;
const count = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) : 0;
fs.writeFileSync(counterFile, String(count + 1));
const seq = d[key];
const item = seq[Math.min(count, seq.length - 1)];
if (item && item.error) process.exit(1);
if (key === 'head') console.log(JSON.stringify({ head: { sha: item } }));
else if (key === 'checks' || key === 'allChecks' || key === 'view') console.log(JSON.stringify(item));
else console.log(JSON.stringify([item]));
`,
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'owner/repo',
      GH_REPO: 'other/elsewhere',
      DATA: join(dir, 'data'),
      CALLS: join(dir, 'calls'),
      COORDINATOR_MERGE_ITERATIONS: '6',
      COORDINATOR_MERGE_INTERVAL_MS: '1',
    },
  });
  let calls = [];
  try {
    calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
  } catch {}
  const merges = calls.filter((c) => c[0] === 'pr' && c[1] === 'merge');
  return { result, calls, merges };
}
const flag = (args, name) => args[args.indexOf(name) + 1];

test('merges on PASS with green checks and no brake', (t) => {
  const { result, merges } = run(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(merges.length, 1);
  assert.equal(flag(merges[0], '--subject'), 'Subject line (#7)');
  assert.equal(flag(merges[0], '--match-head-commit'), A);
  assert.ok(merges[0].includes('--squash'));
  assert.ok(!merges[0].includes('--auto'));
  assert.match(result.stdout, new RegExp(`7 MERGED ${sha('c')}`));
});

test('carried-over PASS counts', (t) => {
  const { merges } = run(t, { comments: [[passComment(A, ' (carried over)')]] });
  assert.equal(merges.length, 1);
});

test('network errors mid-loop neither exit nor change state', (t) => {
  const { result, merges } = run(t, { head: [FAIL, A], checks: [FAIL, green] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(merges.length, 1);
});

test('empty head retries', (t) => {
  const { result, merges } = run(t, { head: [FAIL, FAIL, A] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(merges.length, 1);
});

test('open brake blocks merge, then proceeds once closed', (t) => {
  const { result, merges, calls } = run(t, { markers: [[{ number: 9 }], [{ number: 9 }], []] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(merges.length, 1);
  assert.equal(calls.filter((c) => c[1]?.includes('/issues?')).length, 3);
});

test('marker lookup failure waits and never merges', (t) => {
  const { result, merges } = run(t, { markers: [FAIL] });
  assert.notEqual(result.status, 0);
  assert.equal(merges.length, 0);
});

test('BLOCK on the current head stops nonzero', (t) => {
  const { result, merges } = run(t, { comments: [[passComment(A), blockComment(A)]] });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /BLOCK/);
  assert.equal(merges.length, 0);
});

test('newest verdict wins over an older BLOCK', (t) => {
  const { merges } = run(t, { comments: [[blockComment(A), passComment(A)]] });
  assert.equal(merges.length, 1);
});

test('verdict for another head is ignored', (t) => {
  const { result, merges } = run(t, { comments: [[passComment(B)]] });
  assert.notEqual(result.status, 0);
  assert.equal(merges.length, 0);
});

test('fewer than 4 required checks waits', (t) => {
  const { result, merges } = run(t, { checks: [green.slice(0, 3)] });
  assert.notEqual(result.status, 0);
  assert.equal(merges.length, 0);
});

test('failing or pending required checks wait', (t) => {
  const red = green.map((c, i) => (i ? c : { ...c, bucket: 'fail' }));
  assert.equal(run(t, { checks: [red] }).merges.length, 0);
  const pending = green.map((c, i) => (i ? c : { ...c, bucket: 'pending' }));
  assert.equal(run(t, { checks: [pending] }).merges.length, 0);
});

test('skipped checks count as green', (t) => {
  const skipped = green.map((c, i) => (i ? c : { ...c, bucket: 'skipping' }));
  assert.equal(run(t, { checks: [skipped] }).merges.length, 1);
});

const withJob = (name, bucket) =>
  [...green, ...mustBeGreen].map((check) => (check.name === name ? { ...check, bucket } : check));
const withoutJob = (name) => [...green, ...mustBeGreen].filter((check) => check.name !== name);

test('required checks green but gates red does not merge', (t) => {
  for (const bucket of ['fail', 'cancel', 'pending']) {
    const { result, merges } = run(t, { allChecks: [withJob('gates', bucket)] });
    assert.notEqual(result.status, 0);
    assert.equal(merges.length, 0);
  }
});

test('gates green merges', (t) => {
  assert.equal(run(t, { allChecks: [withJob('gates', 'pass')] }).merges.length, 1);
});

test('gates missing after required checks completed waits, then merges once it reports', (t) => {
  assert.equal(run(t, { allChecks: [withoutJob('gates')] }).merges.length, 0);
  const { merges } = run(t, { allChecks: [withoutJob('gates'), withJob('gates', 'pass')] });
  assert.equal(merges.length, 1);
});

test('every must-be-green job gates the merge', (t) => {
  for (const name of mustBeGreen.map((check) => check.name))
    assert.equal(run(t, { allChecks: [withJob(name, 'fail')] }).merges.length, 0);
});

test('a skipped must-be-green job counts as green', (t) => {
  assert.equal(run(t, { allChecks: [withJob('ops-backup-test', 'skipping')] }).merges.length, 1);
});

test('head moved after PASS re-waits for the new head verdict', (t) => {
  const { result, merges } = run(t, {
    head: [A, B, B],
    comments: [[passComment(A)], [passComment(A)], [passComment(A), passComment(B)]],
    markers: [[{ number: 9 }], []],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(merges.length, 1);
  assert.equal(flag(merges[0], '--match-head-commit'), B);
});

test('multi-commit closing keywords are carried once', (t) => {
  const { merges } = run(t, {
    commits: [
      [
        { commit: { message: 'Subject\n\nBody\n\ncloses #42' } },
        { commit: { message: 'Second\n\nFixes #43\ncloses #42' } },
        { commit: { message: 'Third\n\nresolves #44\nfixes #43' } },
      ],
    ],
  });
  const body = flag(merges[0], '--body');
  assert.equal(flag(merges[0], '--subject'), 'Subject (#7)');
  assert.equal(body.match(/closes #42/gi).length, 1);
  assert.equal(body.match(/fixes #43/gi).length, 1);
  assert.match(body, /resolves #44/);
  assert.match(body, /^Body/);
});

test('forged PASS from another user after a real BLOCK still stops', (t) => {
  const { result, merges } = run(t, {
    comments: [[blockComment(A), passComment(A, '', { login: 'mallory' })]],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /BLOCK/);
  assert.equal(merges.length, 0);
});

test('PASS from a non-reviewer alone is not a verdict', (t) => {
  const { merges } = run(t, { comments: [[passComment(A, '', { login: 'mallory' })]] });
  assert.equal(merges.length, 0);
});

test('a verdict quoted inside another comment body is ignored', (t) => {
  const quoted = { user: bot, body: `Earlier:\n> ${passComment(A).body}\nnothing yet` };
  const { merges } = run(t, { comments: [[quoted]] });
  assert.equal(merges.length, 0);
  const trailing = { user: bot, body: `note\n${passComment(A).body}` };
  assert.equal(run(t, { comments: [[trailing]] }).merges.length, 0);
});

test('every gh call targets the configured repo, not GH_REPO', (t) => {
  const { result, calls } = run(t);
  assert.equal(result.status, 0, result.stderr);
  const prCalls = calls.filter((c) => c[0] === 'pr');
  assert.equal(prCalls.length, 4);
  for (const c of prCalls) assert.equal(flag(c, '-R'), 'owner/repo');
  for (const c of calls.filter((c) => c[0] === 'api')) assert.match(c[1], /^repos\/owner\/repo\//);
});

test('refuses without PR numbers', (t) => {
  const { result } = run(t, {}, []);
  assert.notEqual(result.status, 0);
});
