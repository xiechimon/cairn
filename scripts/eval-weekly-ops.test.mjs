import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/ops/eval-weekly.sh');
const day = new Date().toISOString().slice(0, 10);

function runWeekly(env, extraEnv = {}) {
  return spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: env.home,
      CAIRN_EVAL_STATE_DIR: env.state,
      CAIRN_EVAL_RELAY_URL: 'https://relay.example/v1',
      CAIRN_EVAL_RELAY_KEY: 'relay-key',
      CAIRN_EVAL_REPO: env.repo,
      ...extraEnv,
    },
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'eval-weekly-ops-'));
  const home = join(root, 'home');
  const state = join(root, 'state');
  const repo = join(root, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(repo, { recursive: true });
  return { root, home, state, repo };
}

test('same-day re-run exits before flows when the review directory already exists', () => {
  const env = fixture();
  try {
    const review = join(env.state, 'reviews', day);
    mkdirSync(review, { recursive: true });
    writeFileSync(join(review, 'review.json'), '{"week":"already"}\n');
    const result = runWeekly(env, {
      CAIRN_LABELER_BASE_URL: 'https://labeler.example/v1',
      CAIRN_LABELER_API_KEY: 'labeler-key',
      CAIRN_LABELER_MODEL: 'gpt-5-mini',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(`${result.stdout}${result.stderr}`, /review already exists/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /eval-weekly: chief-dispatch start/);
    assert.equal(readFileSync(join(review, 'review.json'), 'utf8'), '{"week":"already"}\n');
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test('labeler environment unset fails before a zero-pack review', () => {
  const env = fixture();
  try {
    const result = runWeekly(env);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /labeler environment is unset/);
    assert.equal(
      spawnSync('bash', ['-c', `test ! -e "${join(env.state, 'reviews', day)}"`]).status,
      0,
    );
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test('weekly script exports packs by default and echoes sampler trace hit counts', () => {
  const source = readFileSync(script, 'utf8');
  const reviewCheck = source.indexOf('REVIEW_OUT=');
  const reviewExists = source.indexOf('review already exists');
  const labelerCheck = source.indexOf('labeler environment is unset');
  const exportStep = source.indexOf('traj:export');
  const labelStep = source.indexOf('traj:label');
  const sampleStep = source.indexOf('eval-sample-failures.mjs');
  const firstFlow = source.indexOf('run_flow chief-dispatch');
  assert.ok(reviewExists >= 0, 'same-day review message missing');
  assert.ok(reviewCheck >= 0 && reviewCheck < firstFlow, 'review-dir check must precede flows');
  assert.ok(labelerCheck >= 0 && labelerCheck < firstFlow, 'labeler check must precede flows');
  assert.ok(exportStep > firstFlow, 'traj:export must follow flows');
  assert.ok(labelStep > exportStep, 'traj:label must follow traj:export');
  assert.ok(sampleStep > labelStep, 'sampler must follow labeled packs');
  assert.match(source, /traces\.hit|traces hit/);
});
