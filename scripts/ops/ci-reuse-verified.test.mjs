import assert from 'node:assert/strict';
import test from 'node:test';
import { selectVerifiedPriorRun } from './ci-reuse-verified.mjs';

const SHA = 'a'.repeat(40);

function makeJobs(overrides = {}) {
  const base = {
    check: 'success',
    'e2e-gate': 'success',
    'pack-smoke': 'success',
    eval: 'skipped',
  };
  return Object.entries({ ...base, ...overrides }).map(([name, conclusion]) => ({
    name,
    status: 'completed',
    conclusion,
  }));
}

function makeRun(overrides = {}) {
  return {
    id: 1001,
    name: 'ci',
    event: 'push',
    head_sha: SHA,
    head_branch: 'queue/try/1795588850188-774b4be61',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    repository: { full_name: 'xiechimon/cairn' },
    ...overrides,
  };
}

test('selectVerifiedPriorRun reuses exact-SHA queue/try or preflight green run on main push', () => {
  for (const headBranch of [
    'queue/try/1795588850188-774b4be61',
    'preflight/xmonsMac.local/my-branch',
  ]) {
    const decision = selectVerifiedPriorRun({
      ref: 'refs/heads/main',
      eventName: 'push',
      repo: 'xiechimon/cairn',
      sha: SHA,
      hasSidecar: false,
      evalRequired: false,
      runs: [makeRun({ head_branch: headBranch })],
      jobsOf: () => makeJobs(),
    });
    assert.deepEqual(decision, { reuse: true, runId: 1001 });
  }
});

test('selectVerifiedPriorRun fails closed outside push-to-main or when hasSidecar is true', () => {
  assert.equal(
    selectVerifiedPriorRun({
      ref: 'refs/heads/queue/try/1',
      eventName: 'push',
      repo: 'xiechimon/cairn',
      sha: SHA,
      hasSidecar: false,
      evalRequired: false,
      runs: [makeRun()],
      jobsOf: () => makeJobs(),
    }).reuse,
    false,
  );
  assert.equal(
    selectVerifiedPriorRun({
      ref: 'refs/heads/main',
      eventName: 'workflow_dispatch',
      repo: 'xiechimon/cairn',
      sha: SHA,
      hasSidecar: false,
      evalRequired: false,
      runs: [makeRun()],
      jobsOf: () => makeJobs(),
    }).reuse,
    false,
  );
  assert.equal(
    selectVerifiedPriorRun({
      ref: 'refs/heads/main',
      eventName: 'push',
      repo: 'xiechimon/cairn',
      sha: SHA,
      hasSidecar: true,
      evalRequired: false,
      runs: [makeRun()],
      jobsOf: () => makeJobs(),
    }).reuse,
    false,
  );
});

test('selectVerifiedPriorRun rejects non-queue/non-preflight, wrong-sha, wrong-repo, or incomplete runs', () => {
  for (const patch of [
    { head_branch: 'feature/foo' },
    { head_branch: 'main' },
    { head_sha: 'b'.repeat(40) },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { event: 'pull_request' },
    { repository: { full_name: 'fork/cairn' } },
  ]) {
    assert.equal(
      selectVerifiedPriorRun({
        ref: 'refs/heads/main',
        eventName: 'push',
        repo: 'xiechimon/cairn',
        sha: SHA,
        hasSidecar: false,
        evalRequired: false,
        runs: [makeRun(patch)],
        jobsOf: () => makeJobs(),
      }).reuse,
      false,
      JSON.stringify(patch),
    );
  }
});

test('selectVerifiedPriorRun checks required job conclusions, eval requirement, and fails closed on errors', () => {
  assert.equal(
    selectVerifiedPriorRun({
      ref: 'refs/heads/main',
      eventName: 'push',
      repo: 'xiechimon/cairn',
      sha: SHA,
      hasSidecar: false,
      evalRequired: false,
      runs: [makeRun()],
      jobsOf: () => makeJobs({ 'pack-smoke': 'skipped' }),
    }).reuse,
    true,
  );
  assert.equal(
    selectVerifiedPriorRun({
      ref: 'refs/heads/main',
      eventName: 'push',
      repo: 'xiechimon/cairn',
      sha: SHA,
      hasSidecar: false,
      evalRequired: false,
      runs: [makeRun()],
      jobsOf: () => makeJobs({ 'e2e-gate': 'skipped' }),
    }).reuse,
    false,
  );
  assert.equal(
    selectVerifiedPriorRun({
      ref: 'refs/heads/main',
      eventName: 'push',
      repo: 'xiechimon/cairn',
      sha: SHA,
      hasSidecar: false,
      evalRequired: true,
      runs: [makeRun()],
      jobsOf: () => makeJobs({ eval: 'skipped' }),
    }).reuse,
    false,
  );
  assert.equal(
    selectVerifiedPriorRun({
      ref: 'refs/heads/main',
      eventName: 'push',
      repo: 'xiechimon/cairn',
      sha: SHA,
      hasSidecar: false,
      evalRequired: true,
      runs: [makeRun()],
      jobsOf: () => makeJobs({ eval: 'success' }),
    }).reuse,
    true,
  );
  assert.equal(
    selectVerifiedPriorRun({
      ref: 'refs/heads/main',
      eventName: 'push',
      repo: 'xiechimon/cairn',
      sha: SHA,
      hasSidecar: false,
      evalRequired: false,
      runs: [makeRun()],
      jobsOf: () => {
        throw new Error('HTTP 500');
      },
    }).reuse,
    false,
  );
});

const TREE = 'c'.repeat(40);

function tryDecision(patch = {}, input = {}) {
  return selectVerifiedPriorRun({
    ref: 'refs/heads/queue/try/1795588850188-774b4be61',
    eventName: 'push',
    repo: 'xiechimon/cairn',
    sha: SHA,
    tree: TREE,
    hasSidecar: false,
    evalRequired: false,
    runs: [
      makeRun({
        head_sha: 'b'.repeat(40),
        head_branch: 'preflight/host/lane',
        head_commit: { tree_id: TREE },
        ...patch,
      }),
    ],
    jobsOf: () => makeJobs(),
    ...input,
  });
}

test('a queue/try commit reuses the green verdict of an identical tree from preflight or queue/try', () => {
  for (const head_branch of ['preflight/host/lane', 'queue/try/1795588850000-aaaaaaaaa']) {
    assert.deepEqual(tryDecision({ head_branch }), { reuse: true, runId: 1001 });
  }
});

test('tree reuse refuses every tree that never had a complete green ci', () => {
  for (const patch of [
    { head_commit: { tree_id: 'd'.repeat(40) } },
    { head_commit: undefined },
    { status: 'in_progress', conclusion: null },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { head_branch: 'main' },
    { head_branch: 'feature/x' },
    { event: 'pull_request' },
    { repository: { full_name: 'fork/cairn' } },
  ]) {
    assert.equal(tryDecision(patch).reuse, false, JSON.stringify(patch));
  }
  assert.equal(tryDecision({}, { tree: '' }).reuse, false);
  assert.equal(tryDecision({}, { hasSidecar: true }).reuse, false);
  assert.equal(tryDecision({}, { evalRequired: true }).reuse, false);
  assert.equal(tryDecision({}, { jobsOf: () => makeJobs({ check: 'failure' }) }).reuse, false);
  assert.equal(tryDecision({}, { ref: 'refs/heads/preflight/host/lane' }).reuse, false);
});

test('main still requires the exact sha, never only the same tree', () => {
  assert.equal(tryDecision({}, { ref: 'refs/heads/main' }).reuse, false);
});
