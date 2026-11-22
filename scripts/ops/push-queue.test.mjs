import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preflightRef, preflightRun, watchVerdict } from './preflight.mjs';
import {
  failedGreenContexts,
  laneName,
  missingGreenContexts,
  nextWaitAction,
  planPush,
  preflightEvidence,
  stampCommand,
  unownedCommits,
} from './push-queue.mjs';

const X = 'a'.repeat(40);

test('with no live candidate the push goes through', () => {
  assert.equal(planPush({ live: null, queueHead: null }).action, 'push');
  assert.equal(planPush({ live: null, queueHead: X }).action, 'push');
});

test('a live candidate makes the push wait on it, and says when queue/main was deleted under it', () => {
  assert.deepEqual(planPush({ live: X, queueHead: X }), {
    action: 'wait',
    sha: X,
    restoring: false,
  });
  assert.deepEqual(planPush({ live: X, queueHead: null }), {
    action: 'wait',
    sha: X,
    restoring: true,
  });
});

test('commits without an Amp-Thread-ID or Lane trailer are the ones that get stamped', () => {
  const commits = [
    { sha: '1', body: 'a\n\nAmp-Thread-ID: https://ampcode.com/threads/T-1\n' },
    { sha: '2', body: 'b\n\nsome text\n' },
    { sha: '3', body: 'c\n\nLane: mac/wt\n' },
    { sha: '4', body: 'd mentions Lane: x in the subject\n' },
  ];
  assert.deepEqual(unownedCommits(commits), ['2', '4']);
});

test('the lane name is host and worktree, safe for a trailer and a shell quote', () => {
  assert.equal(
    laneName('xmons-MacBook', 'ecstatic-brahmagupta-aee8fe'),
    'xmons-MacBook/ecstatic-brahmagupta-aee8fe',
  );
  assert.equal(laneName("my host's", 'wt dir'), 'my-host-s/wt-dir');
  assert.match(stampCommand('mac/wt'), /--trailer 'Lane: mac\/wt'/);
});

test('the pre-flight gate needs the three green-main contexts on a tree-identical sha', () => {
  const run = (name, conclusion) => ({ name, conclusion });
  assert.deepEqual(missingGreenContexts([]), ['check', 'pack-smoke', 'e2e-gate']);
  assert.deepEqual(missingGreenContexts([run('check', 'success'), run('pack-smoke', 'success')]), [
    'e2e-gate',
  ]);
  assert.equal(
    missingGreenContexts([
      run('check', 'success'),
      run('check', 'failure'),
      run('pack-smoke', 'success'),
      run('e2e-gate', 'success'),
    ]).length,
    0,
  );
  assert.equal(
    missingGreenContexts([
      run('check', 'success'),
      run('pack-smoke', 'skipped'),
      run('e2e-gate', 'skipped'),
    ]).length,
    0,
  );
  const checkRunsOf = () => [
    run('check', 'success'),
    run('pack-smoke', 'success'),
    run('e2e-gate', 'success'),
  ];
  assert.deepEqual(
    preflightEvidence({
      shas: ['aaa', 'bbb'],
      pushedTree: 'T',
      treeOf: (sha) => (sha === 'bbb' ? 'T' : 'other'),
      checkRunsOf,
    }),
    { ok: true, sha: 'bbb' },
  );
  assert.deepEqual(
    preflightEvidence({
      shas: ['aaa'],
      pushedTree: 'T',
      treeOf: () => 'other',
      checkRunsOf,
    }),
    { ok: false },
  );
  assert.deepEqual(
    preflightEvidence({
      shas: ['local-stamp', 'preflighted'],
      pushedTree: 'T',
      treeOf: () => 'T',
      checkRunsOf: (sha) => (sha === 'local-stamp' ? null : checkRunsOf(sha)),
    }),
    { ok: true, sha: 'preflighted' },
  );
  assert.deepEqual(
    preflightEvidence({
      shas: ['local-stamp'],
      pushedTree: 'T',
      treeOf: () => 'T',
      checkRunsOf: () => null,
    }),
    { ok: false },
  );
  assert.deepEqual(
    preflightEvidence({
      shas: ['aaa'],
      pushedTree: 'T',
      treeOf: () => 'T',
      checkRunsOf: () => [run('check', 'success')],
    }),
    { ok: false },
  );
});

test('the verdict comes from the run conclusion, never from a failed watch', () => {
  assert.deepEqual(watchVerdict('completed', 'success', 1), {
    verdict: 'green',
    conclusion: 'success',
  });
  assert.deepEqual(watchVerdict('completed', 'failure', 1), {
    verdict: 'red',
    conclusion: 'failure',
  });
  assert.equal(watchVerdict('in_progress', null, 1).verdict, 'unreadable');
  assert.equal(watchVerdict(null, null, 1).verdict, 'unreadable');
  assert.equal(watchVerdict(null, null, 0).verdict, 'unreadable');
});

test('the pre-flight ref and run lookup are lane-scoped', () => {
  assert.equal(preflightRef('mac/wt'), 'refs/heads/preflight/mac/wt');
  const ci = {
    name: 'ci',
    head_sha: 'S',
    head_branch: 'preflight/mac/wt',
    html_url: 'https://example/run/1',
  };
  assert.equal(
    preflightRun(
      [{ name: 'ci', head_sha: 'S', head_branch: 'queue/main' }, ci],
      'S',
      'preflight/mac/wt',
    ),
    ci,
  );
  assert.equal(preflightRun([ci], 'S', 'preflight/other/wt'), null);
  assert.equal(preflightRun([], 'S', 'preflight/mac/wt'), null);
});

test('--wait rebases onto the live candidate, arms preflight once, then polls', () => {
  const base = {
    live: X,
    headOnLive: false,
    deadBase: false,
    headTree: 'T1',
    armedTree: null,
    evidence: { ok: false },
    failed: [],
  };
  assert.deepEqual(nextWaitAction(base), { action: 'rebase', onto: X });
  assert.deepEqual(nextWaitAction({ ...base, headOnLive: true }), { action: 'preflight' });
  assert.deepEqual(nextWaitAction({ ...base, headOnLive: true, armedTree: 'T1' }), {
    action: 'poll',
  });
  assert.deepEqual(
    nextWaitAction({ ...base, headOnLive: true, armedTree: 'T1', failed: ['check'] }),
    { action: 'fail', contexts: ['check'] },
  );
});

test('--wait on a freed queue rebases off a dropped base, waits for evidence, then pushes', () => {
  const base = {
    live: null,
    headOnLive: false,
    deadBase: true,
    headTree: 'T1',
    armedTree: 'T1',
    evidence: { ok: false },
    failed: [],
  };
  assert.deepEqual(nextWaitAction(base), { action: 'rebase', onto: 'origin/main' });
  assert.deepEqual(nextWaitAction({ ...base, deadBase: false, failed: ['e2e-gate'] }), {
    action: 'fail',
    contexts: ['e2e-gate'],
  });
  assert.deepEqual(nextWaitAction({ ...base, deadBase: false, armedTree: 'T2' }), {
    action: 'preflight',
  });
  assert.deepEqual(nextWaitAction({ ...base, deadBase: false }), { action: 'poll' });
  assert.deepEqual(nextWaitAction({ ...base, deadBase: false, evidence: { ok: true, sha: 's' } }), {
    action: 'push',
  });
});

test('failedGreenContexts flags only required contexts that went red', () => {
  const run = (name, conclusion) => ({ name, conclusion });
  assert.deepEqual(
    failedGreenContexts([
      run('check', 'failure'),
      run('pack-smoke', 'success'),
      run('e2e (3)', 'failure'),
      run('e2e-gate', 'in_progress'),
    ]),
    ['check'],
  );
  assert.deepEqual(failedGreenContexts([run('check', 'cancelled')]), ['check']);
  assert.deepEqual(failedGreenContexts([run('check', 'in_progress')]), []);
});
