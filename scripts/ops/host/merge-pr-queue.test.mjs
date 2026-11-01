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
if (args[0] === 'pr' && args[1] === 'comment') process.exit(data.commentError ? 1 : 0);
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

function mergePr(t, { opener, gateExit, commentError = false, labels = [], ref = 'feature/x' }) {
  const home = mkdtempSync(join(tmpdir(), 'merge-pr-queue-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const calls = join(home, 'calls');
  writeFileSync(calls, '');
  writeFileSync(
    join(home, 'gh-data.json'),
    JSON.stringify({
      commentError,
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
  writeExecutable(
    join(home, '.cairn/tools/review-gate/review-gate.mjs'),
    `process.exit(${gateExit});\n`,
  );
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
    queued: recorded.some(
      (c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'comment' && c.includes('@mergifyio queue'),
    ),
    merged: recorded.some((c) => c.includes('merge')),
  };
}

test('an unprotected human-opened PR is queued in Mergify, not merged', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', gateExit: 3 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.queued);
  assert.equal(result.merged, false);
});

test('a failed queue comment fails the helper without merging', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', gateExit: 3, commentError: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.merged, false);
});

test('an unprotected bot-opened PR keeps the rebase route', (t) => {
  const result = mergePr(t, { opener: 'app/cairnwright', gateExit: 3 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.queued, false);
  assert.ok(result.merged);
});

test('a protected human-opened PR without a passing review is never queued', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', gateExit: 0 });
  assert.notEqual(result.status, 0);
  assert.equal(result.queued, false);
  assert.equal(result.merged, false);
});

test('a PR Mergify already queued gets no second command', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', gateExit: 3, labels: ['queued'] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.queued, false);
  assert.equal(result.merged, false);
});

test('a PR Mergify dequeued is left for a human', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', gateExit: 3, labels: ['dequeued'] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dequeued/);
  assert.equal(result.queued, false);
  assert.equal(result.merged, false);
});

test('a lane PR keeps its review requirement and is never queued', (t) => {
  const result = mergePr(t, { opener: 'xiechimon', gateExit: 3, ref: 'lane/12' });
  assert.notEqual(result.status, 0);
  assert.equal(result.queued, false);
  assert.equal(result.merged, false);
});
