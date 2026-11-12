import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ops/host/tools/merge-pr.sh');
const signed = { name: 'Cairnwright', email: '348051526+cairnwright@users.noreply.github.com' };

const ghStub = `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(['gh', ...args]) + '\\n');
const data = JSON.parse(fs.readFileSync(process.env.GH_DATA, 'utf8'));
if (args[0] === 'pr' && args[1] === 'edit') process.exit(data.labelError ? 1 : 0);
if (args[0] === 'pr' && args[1] === 'view' && data.labelsReadError && args.includes('labels')) process.exit(1);
if (args[0] === 'api' && args[1].includes('/check-runs?')) {
  const name = /check_name=([^&]+)/.exec(args[1])[1];
  const conclusion = data.checks[name];
  const runs = conclusion == null ? [] : [{ id: 1, app: { slug: 'github-actions' }, status: conclusion === 'in_progress' ? 'in_progress' : 'completed', conclusion: conclusion === 'in_progress' ? null : conclusion }];
  const out = spawnSync('jq', ['-r', args[args.indexOf('--jq') + 1]], { input: JSON.stringify({ check_runs: runs }), encoding: 'utf8' });
  process.stdout.write(out.stdout);
}
if (args[0] === 'pr' && args[1] === 'view' && args.includes('--jq')) {
  const out = spawnSync('jq', ['-r', args[args.indexOf('--jq') + 1]], { input: JSON.stringify(data.view), encoding: 'utf8' });
  process.stdout.write(out.stdout);
}
`;

const recorder = (name) => `#!${process.execPath}
require('node:fs').appendFileSync(process.env.CALLS, JSON.stringify([${JSON.stringify(name)}, ...process.argv.slice(2)]) + '\\n');
`;

function writeExecutable(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function mergePr(t, { opener, route, labelsReadError = false, labels = [], ref = 'feature/x' }) {
  const home = mkdtempSync(join(tmpdir(), 'merge-pr-queue-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const calls = join(home, 'calls');
  writeFileSync(calls, '');
  writeFileSync(
    join(home, 'gh-data.json'),
    JSON.stringify({
      labelsReadError,
      checks: { 'merge-route': route },
      view: {
        headRefName: ref,
        labels: labels.map((name) => ({ name })),
        body: '',
        headRefOid: 'a'.repeat(40),
        author: { login: opener },
        comments: [],
        commits: [
          {
            messageHeadline: 'Subject',
            messageBody: 'Subject',
            authors: [{ ...signed, login: signed.name }],
          },
        ],
      },
    }),
  );
  writeExecutable(join(home, 'bin/gh'), ghStub);
  writeExecutable(join(home, '.cairn/tools/merge-order/deps-open.mjs'), 'process.exit(0);\n');
  writeExecutable(join(home, '.cairn/tools/app-token/as-bot.sh'), recorder('as-bot'));
  const result = spawnSync('bash', [script, '7'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      PATH: `${join(home, 'bin')}:${process.env.PATH}`,
      CALLS: calls,
      GH_DATA: join(home, 'gh-data.json'),
    },
  });
  const recorded = readFileSync(calls, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  return {
    ...result,
    labelled: recorded.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'edit'),
    commented: recorded.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'comment'),
    merged: recorded.some((c) => c.includes('merge')),
    readReviewGate: recorded.some((c) => c.some((arg) => arg.includes('check_name=review-gate'))),
  };
}

test('a routed PR whose labels cannot be read is refused, failing closed on the dequeue check', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', route: 'success', labelsReadError: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.merged, false);
  assert.match(result.stderr, /could not read its labels/);
});

for (const [name, opener] of [
  ['a human-opened', 'xiechimon'],
  ['a bot-opened', 'app/cairnwright'],
])
  test(`${name} PR carrying coordinator-hold is left to Mergify like any other`, (t) => {
    const result = mergePr(t, { opener, route: 'success', labels: ['coordinator-hold'] });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.merged, false);
    assert.match(result.stdout, /Mergify queues it automatically/);
  });

test('an unprotected human-opened PR is left to Mergify without a label, comment or merge', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', route: 'success' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.readReviewGate, false);
  assert.equal(result.labelled, false);
  assert.equal(result.commented, false);
  assert.equal(result.merged, false);
  assert.match(result.stdout, /Mergify queues it automatically/);
});

test('a PR Mergify already queued is neither commented nor merged', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', route: 'success', labels: ['queued'] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.commented, false);
  assert.equal(result.merged, false);
});

test('an unprotected bot-opened PR is left to Mergify like any other PR', (t) => {
  const result = mergePr(t, { opener: 'app/cairnwright', route: 'success' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.commented, false);
  assert.equal(result.merged, false);
  assert.match(result.stdout, /Mergify queues it automatically/);
});

test('a PR whose merge-route check failed is never merged: a failed router is not a route', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', route: 'failure' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /merge-route check for a{40} failed/);
  assert.equal(result.commented, false);
  assert.equal(result.merged, false);
});

for (const route of ['in_progress', null])
  test(`a PR whose merge-route check is ${route ?? 'missing'} waits for CI`, (t) => {
    const result = mergePr(t, { opener: 'xiechimon', route });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /merge-route check/);
    assert.equal(result.merged, false);
  });

test('a PR Mergify dequeued is left for a human', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', route: 'success', labels: ['dequeued'] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dequeued/);
  assert.equal(result.commented, false);
  assert.equal(result.merged, false);
});

test('a lane PR is squash-merged directly, with no review-gate check read', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', route: 'success', ref: 'lane/12' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.readReviewGate, false);
  assert.equal(result.commented, false);
  assert.ok(result.merged);
});
