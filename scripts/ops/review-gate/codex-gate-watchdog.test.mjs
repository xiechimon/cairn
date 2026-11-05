import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';

const HOST = new URL('./codex-gate-watchdog.mjs', import.meta.url);
const ACTIONS = 'github-actions';

const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const input = args.includes('--input') ? fs.readFileSync(0, 'utf8') : null;
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, input }) + '\\n');
const world = JSON.parse(fs.readFileSync(process.env.FAKE_WORLD, 'utf8'));
const joined = args.join(' ');
const out = (value) => process.stdout.write(JSON.stringify(value));
if (joined.includes('--slurp') && joined.includes('/pulls?')) out([world.pulls]);
else if (joined.includes('--slurp') && joined.includes('/check-runs?')) out([world.checkRuns]);
else if (joined.includes('--slurp') && joined.includes('/runs?'))
  out([{ workflow_runs: world.runs }]);
else if (joined.includes('check-runs?')) out({ check_runs: world.checkRuns });
else if (/--input -/.test(joined) && joined.includes('/dispatches')) out({});
else if (joined.includes('gh api')) out({});
else throw new Error('unexpected gh call: ' + joined);
`;

function run(world, opts = {}) {
  const dir = makeTestTempDir('review-gate-watchdog-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  const worldPath = join(dir, 'world.json');
  const log = join(dir, 'calls.log');
  writeFileSync(worldPath, JSON.stringify(world));
  writeFileSync(log, '');
  const statePath = join(dir, 'state.json');
  const result = spawnSync(process.execPath, [HOST.pathname, ...(opts.args ?? [])], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GH_TOKEN: 'fake',
      REPO: 'o/r',
      CAIRN_WATCHDOG_NOW: '2026-01-01T00:30:00Z',
      CAIRN_WATCHDOG_STATE: statePath,
      FAKE_WORLD: worldPath,
      FAKE_LOG: log,
      ...(opts.env ?? {}),
    },
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  let state = null;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {}
  releaseTestTempDir(dir);
  return {
    result,
    calls,
    state,
    dispatches: calls.filter((call) => call.args.join(' ').includes('/dispatches')),
  };
}

const pr = (over = {}) => ({
  number: 7,
  state: 'open',
  draft: false,
  head: { sha: 'c'.repeat(40), ref: 'feature/x' },
  user: { login: 'dev' },
  author_association: 'OWNER',
  ...over,
});

const check = (over = {}) => ({
  id: 55,
  name: 'review-gate',
  app: { slug: ACTIONS },
  status: 'in_progress',
  conclusion: null,
  started_at: '2026-01-01T00:00:00Z',
  head_sha: 'c'.repeat(40),
  ...over,
});

const runRecord = (over = {}) => ({
  name: 'review-gate-codex',
  event: 'schedule',
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-01-01T00:29:00Z',
  ...over,
});

const world = (over = {}) => ({
  pulls: [pr()],
  checkRuns: [check()],
  runs: [runRecord()],
  ...over,
});

test('a stale in-progress github-actions check dispatches one evaluation', () => {
  const out = run(world());
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(out.dispatches.length, 1);
  const scheduleCalls = out.calls.filter((call) => call.args.join(' ').includes('/runs?'));
  assert.equal(scheduleCalls.length, 1);
  assert.match(scheduleCalls[0].args.join(' '), /per_page=5/);
  assert.doesNotMatch(scheduleCalls[0].args.join(' '), /--paginate/);
  assert.deepEqual(JSON.parse(out.dispatches[0].input), {
    ref: 'main',
    inputs: { pr: '7' },
  });
  assert.equal(out.state.dispatched[`7:${'c'.repeat(40)}:55`], Date.parse('2026-01-01T00:30:00Z'));
  assert.equal(Object.keys(out.state.dispatched).length, 1);
});

test('a fresh or completed check is not dispatched', () => {
  const fresh = run(world({ checkRuns: [check({ started_at: '2026-01-01T00:25:00Z' })] }));
  assert.equal(fresh.result.status, 0, fresh.result.stderr);
  assert.equal(fresh.dispatches.length, 0);
  const completed = run(
    world({
      checkRuns: [check({ status: 'completed', conclusion: 'success' })],
    }),
  );
  assert.equal(completed.result.status, 0, completed.result.stderr);
  assert.equal(completed.dispatches.length, 0);
});

test('a foreign app check is ignored', () => {
  const out = run(world({ checkRuns: [check({ app: { slug: 'mergify' } })] }));
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(out.dispatches.length, 0);
});

test('a draft PR is ignored even when its check is stale', () => {
  const out = run(world({ pulls: [pr({ draft: true })] }));
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(out.dispatches.length, 0);
});

test('a malformed API response fails closed and dispatches nothing', () => {
  const out = run(world({ checkRuns: [{ ...check(), started_at: null }] }));
  assert.equal(out.result.status, 1);
  assert.match(out.result.stderr, /malformed|invalid/);
  assert.equal(out.dispatches.length, 0);
});

test('a missing or stale schedule run alerts through the exit status', () => {
  const out = run(
    world({
      runs: [runRecord({ created_at: '2026-01-01T00:00:00Z' })],
    }),
  );
  assert.equal(out.result.status, 1);
  assert.match(out.result.stderr, /schedule/);
  assert.equal(out.dispatches.length, 1);
});

test('an unknown command fails with usage', () => {
  const out = run(world(), { args: ['unknown'] });
  assert.equal(out.result.status, 1);
  assert.match(out.result.stderr, /usage/);
  assert.equal(out.dispatches.length, 0);
});
