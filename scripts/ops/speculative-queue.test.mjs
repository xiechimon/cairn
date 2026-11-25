import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  ENQUEUE_PREFIX,
  evaluateSpeculativeCandidate,
  isTryValid,
  latestCompletedCheckMap,
  MAX_SPECULATIVE_DEPTH,
  makeEnqueueId,
  parseEnqueueRef,
  planQueueStep,
  rebaseOntoTry,
  sortEnqueueEntries,
  TRY_PREFIX,
} from './speculative-queue.mjs';

const SHA = (ch) => ch.repeat(40);
const MAIN = SHA('0');

function entry(id, shaCh, baseCh = '0', verified = true, released = false) {
  return {
    id,
    ref: `${ENQUEUE_PREFIX}${id}`,
    sha: SHA(shaCh),
    base: SHA(baseCh),
    verified,
    released,
  };
}

test('makeEnqueueId, parseEnqueueRef, and sortEnqueueEntries order FIFO deterministically', () => {
  const idA = makeEnqueueId(SHA('a'), 1732510000123);
  const idB = makeEnqueueId(SHA('b'), 1732510000123);
  const idC = makeEnqueueId(SHA('c'), 1732510000999);
  assert.equal(idA, '1732510000123-aaaaaaaaa');
  assert.deepEqual(parseEnqueueRef(`${ENQUEUE_PREFIX}${idA}`), {
    id: idA,
    ref: `${ENQUEUE_PREFIX}${idA}`,
    ts: 1732510000123,
    shortSha: 'aaaaaaaaa',
  });
  assert.equal(parseEnqueueRef('refs/heads/main'), null);

  const sorted = sortEnqueueEntries([
    { ref: `${ENQUEUE_PREFIX}${idC}`, sha: SHA('c') },
    { ref: `${ENQUEUE_PREFIX}${idB}`, sha: SHA('b') },
    { ref: `${ENQUEUE_PREFIX}${idA}`, sha: SHA('a') },
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    [idA, idB, idC],
  );
});

test('planQueueStep prunes already-landed and operator-released entries', () => {
  const plan = planQueueStep({
    mainTip: MAIN,
    entries: [entry('1-a', 'a'), entry('2-b', 'b', '0', true, true), entry('3-c', 'c')],
    tryMap: new Map([
      ['1-a', { sha: SHA('1'), validOnParent: true }],
      ['2-b', { sha: SHA('2'), validOnParent: true }],
      ['3-c', { sha: SHA('3'), validOnParent: true }],
    ]),
    verdicts: new Map(),
    landedSet: new Set([SHA('1')]),
  });
  assert.deepEqual(
    plan.prune.map((p) => p.id),
    ['1-a', '2-b'],
  );
  assert.deepEqual(plan.activeIds, ['3-c']);
});

test('planQueueStep rejects unverified entries at admission before building try refs', () => {
  const plan = planQueueStep({
    mainTip: MAIN,
    entries: [entry('1-a', 'a', '0', false), entry('2-b', 'b', '0', true)],
    tryMap: new Map(),
    verdicts: new Map(),
    landedSet: new Set(),
  });
  assert.deepEqual(
    plan.ejectUnverified.map((e) => e.id),
    ['1-a'],
  );
  assert.deepEqual(
    plan.rebuild.map((r) => r.entry.id),
    ['2-b'],
  );
});

test('planQueueStep batch-promotes furthest green prefix T_3 and cancels superseded runs', () => {
  const plan = planQueueStep({
    mainTip: MAIN,
    entries: [entry('1-a', 'a'), entry('2-b', 'b'), entry('3-c', 'c'), entry('4-d', 'd')],
    tryMap: new Map([
      ['1-a', { sha: SHA('1'), validOnParent: true }],
      ['2-b', { sha: SHA('2'), validOnParent: true }],
      ['3-c', { sha: SHA('3'), validOnParent: true }],
      ['4-d', { sha: SHA('4'), validOnParent: true }],
    ]),
    verdicts: new Map([
      [SHA('1'), { state: 'pending', runId: 101 }],
      [SHA('2'), { state: 'red', runId: 102, runAttempt: 2, failedJobs: ['e2e (1)'] }],
      [SHA('3'), { state: 'green', runId: 103 }],
      [SHA('4'), { state: 'pending', runId: 104 }],
    ]),
    landedSet: new Set(),
  });
  assert.equal(plan.promote?.targetSha, SHA('3'));
  assert.deepEqual(
    plan.promote?.entries.map((e) => e.id),
    ['1-a', '2-b', '3-c'],
  );
  assert.deepEqual(plan.promote?.cancelRunIds, [101, 102]);
});

test('planQueueStep keeps valid downstream T_2 untouched when T_1 promotes partially', () => {
  const plan = planQueueStep({
    mainTip: MAIN,
    entries: [entry('1-a', 'a'), entry('2-b', 'b')],
    tryMap: new Map([
      ['1-a', { sha: SHA('1'), validOnParent: true }],
      ['2-b', { sha: SHA('2'), validOnParent: true }],
    ]),
    verdicts: new Map([
      [SHA('1'), { state: 'green', runId: 201 }],
      [SHA('2'), { state: 'pending', runId: 202 }],
    ]),
    landedSet: new Set(),
  });
  assert.equal(plan.promote?.targetSha, SHA('1'));
  assert.deepEqual(plan.rebuild, []);
  assert.deepEqual(plan.promote?.cancelRunIds, []);
});

test('planQueueStep waits when #2 is red while #1 is still pending (zero false blame)', () => {
  const plan = planQueueStep({
    mainTip: MAIN,
    entries: [entry('1-a', 'a'), entry('2-b', 'b')],
    tryMap: new Map([
      ['1-a', { sha: SHA('1'), validOnParent: true }],
      ['2-b', { sha: SHA('2'), validOnParent: true }],
    ]),
    verdicts: new Map([
      [SHA('1'), { state: 'pending', runId: 301 }],
      [SHA('2'), { state: 'red', runId: 302, runAttempt: 2, failedJobs: ['check'] }],
    ]),
    landedSet: new Set(),
  });
  assert.equal(plan.promote, null);
  assert.equal(plan.ejectRed, null);
  assert.deepEqual(plan.retry, []);
});

test('planQueueStep retries run_attempt 1 failed/cancelled jobs once and ejects head after rerun fails', () => {
  const retryPlan = planQueueStep({
    mainTip: MAIN,
    entries: [entry('1-a', 'a'), entry('2-b', 'b')],
    tryMap: new Map([
      ['1-a', { sha: SHA('1'), validOnParent: true }],
      ['2-b', { sha: SHA('2'), validOnParent: true }],
    ]),
    verdicts: new Map([
      [
        SHA('1'),
        {
          state: 'retry',
          runId: 401,
          rerun: 'rerun-failed-jobs',
          runUrl: 'https://ci/401',
          failedJobs: ['e2e (2)'],
        },
      ],
      [SHA('2'), { state: 'pending', runId: 402 }],
    ]),
    landedSet: new Set(),
  });
  assert.equal(retryPlan.retry.length, 1);
  assert.equal(retryPlan.retry[0].runId, 401);
  assert.equal(retryPlan.ejectRed, null);

  const ejectPlan = planQueueStep({
    mainTip: MAIN,
    entries: [entry('1-a', 'a'), entry('2-b', 'b')],
    tryMap: new Map([
      ['1-a', { sha: SHA('1'), validOnParent: true }],
      ['2-b', { sha: SHA('2'), validOnParent: true }],
    ]),
    verdicts: new Map([
      [
        SHA('1'),
        {
          state: 'red',
          runId: 401,
          runAttempt: 2,
          runUrl: 'https://ci/401',
          failedJobs: ['e2e (2)'],
        },
      ],
      [SHA('2'), { state: 'pending', runId: 402 }],
    ]),
    landedSet: new Set(),
  });
  assert.equal(ejectPlan.ejectRed?.entry.id, '1-a');
  assert.deepEqual(ejectPlan.ejectRed?.cancelRunIds, [402]);
});

test('planQueueStep caps speculative try ref creation at MAX_SPECULATIVE_DEPTH (4)', () => {
  assert.equal(MAX_SPECULATIVE_DEPTH, 4);
  const entries = ['1-a', '2-b', '3-c', '4-d', '5-e', '6-f'].map((id, i) =>
    entry(id, String.fromCharCode(97 + i)),
  );
  const plan = planQueueStep({
    mainTip: MAIN,
    entries,
    tryMap: new Map(),
    verdicts: new Map(),
    landedSet: new Set(),
  });
  assert.deepEqual(
    plan.rebuild.map((r) => r.entry.id),
    ['1-a', '2-b', '3-c', '4-d'],
  );
});

test('planQueueStep invalidates downstream try refs and flags orphan try refs when main jumps externally', () => {
  const plan = planQueueStep({
    mainTip: MAIN,
    entries: [entry('1-a', 'a'), entry('2-b', 'b')],
    tryMap: new Map([
      ['1-a', { sha: SHA('1'), validOnParent: false }],
      ['2-b', { sha: SHA('2'), validOnParent: false }],
      ['orphan-9', { sha: SHA('9'), validOnParent: false }],
    ]),
    verdicts: new Map([
      [SHA('1'), { state: 'pending', runId: 501 }],
      [SHA('2'), { state: 'pending', runId: 502 }],
    ]),
    landedSet: new Set(),
  });
  assert.deepEqual(
    plan.rebuild.map((r) => r.entry.id),
    ['1-a', '2-b'],
  );
  assert.deepEqual(plan.cancelObsoleteRunIds, [501, 502]);
  assert.deepEqual(plan.orphanTryRefs, [`${TRY_PREFIX}orphan-9`]);
});

test('evaluateSpeculativeCandidate classifies green, retry, red, and pending runs accurately', () => {
  const greenRuns = [
    { name: 'check', conclusion: 'success' },
    { name: 'pack-smoke', conclusion: 'success' },
    { name: 'e2e-gate', conclusion: 'skipped' },
  ];
  assert.equal(
    evaluateSpeculativeCandidate({
      sha: SHA('1'),
      ciRuns: [
        {
          id: 10,
          name: 'ci',
          head_sha: SHA('1'),
          head_branch: 'queue/try/1',
          status: 'completed',
          conclusion: 'success',
          run_attempt: 1,
          html_url: 'https://ci/10',
        },
      ],
      checkRuns: greenRuns,
      jobs: [],
    }).state,
    'green',
  );
  const retry = evaluateSpeculativeCandidate({
    sha: SHA('2'),
    ciRuns: [
      {
        id: 11,
        name: 'ci',
        head_sha: SHA('2'),
        head_branch: `${TRY_PREFIX}2`,
        status: 'completed',
        conclusion: 'failure',
        run_attempt: 1,
        html_url: 'https://ci/11',
      },
    ],
    checkRuns: [],
    jobs: [{ name: 'e2e (3)', conclusion: 'failure' }],
  });
  assert.equal(retry.state, 'retry');
  assert.equal(retry.rerun, 'rerun-failed-jobs');
  assert.deepEqual(retry.failedJobs, ['e2e (3)']);

  const red = evaluateSpeculativeCandidate({
    sha: SHA('3'),
    ciRuns: [
      {
        id: 12,
        name: 'ci',
        head_sha: SHA('3'),
        head_branch: `${TRY_PREFIX}3`,
        status: 'completed',
        conclusion: 'cancelled',
        run_attempt: 2,
        html_url: 'https://ci/12',
      },
    ],
    checkRuns: [],
    jobs: [],
  });
  assert.equal(red.state, 'red');
});

test('real git rebaseOntoTry & isTryValid build speculative chains, handle conflicts, and fast-forward cleanly', () => {
  const root = makeTestTempDir('speculative-queue-git-');
  try {
    const bare = join(root, 'origin.git');
    const work = join(root, 'work');
    mkdirSync(bare, { recursive: true });
    const git = (cwd, args) =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'xiechimon',
          GIT_AUTHOR_EMAIL: '157263579+xiechimon@users.noreply.github.com',
          GIT_COMMITTER_NAME: 'xiechimon',
          GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
        },
      }).trim();

    git(bare, ['init', '--bare', '-b', 'main']);
    git(root, ['clone', bare, work]);
    writeFileSync(join(work, 'a.txt'), 'base\n');
    writeFileSync(join(work, 'b.txt'), 'base\n');
    writeFileSync(join(work, 'c.txt'), 'base\n');
    git(work, ['add', 'a.txt', 'b.txt', 'c.txt']);
    git(work, ['commit', '-m', 'base']);
    git(work, ['push', '-u', 'origin', 'main']);
    const main0 = git(work, ['rev-parse', 'HEAD']);

    git(work, ['checkout', '-b', 'br-a', main0]);
    writeFileSync(join(work, 'a.txt'), 'from-a\n');
    git(work, ['add', 'a.txt']);
    git(work, ['commit', '-m', 'feat: update a']);
    const shaA = git(work, ['rev-parse', 'HEAD']);

    git(work, ['checkout', '-b', 'br-conflict', main0]);
    writeFileSync(join(work, 'a.txt'), 'conflicting-a\n');
    git(work, ['add', 'a.txt']);
    git(work, ['commit', '-m', 'feat: conflicting a']);
    const shaConflict = git(work, ['rev-parse', 'HEAD']);

    git(work, ['checkout', '-b', 'br-c', main0]);
    writeFileSync(join(work, 'c.txt'), 'from-c\n');
    git(work, ['add', 'c.txt']);
    git(work, ['commit', '-m', 'feat: update c']);
    const shaC = git(work, ['rev-parse', 'HEAD']);

    git(work, ['checkout', 'main']);

    const resA = rebaseOntoTry({ cwd: work, expectedParent: main0, entrySha: shaA });
    assert.equal(resA.ok, true);
    assert.equal(resA.sha, shaA);

    const resConflict = rebaseOntoTry({
      cwd: work,
      expectedParent: resA.sha,
      entrySha: shaConflict,
    });
    assert.equal(resConflict.ok, false);
    assert.ok(resConflict.conflicts.includes('a.txt'));

    const resC = rebaseOntoTry({ cwd: work, expectedParent: resA.sha, entrySha: shaC });
    assert.equal(resC.ok, true);
    assert.notEqual(resC.sha, shaC);

    assert.equal(
      isTryValid({ cwd: work, expectedParent: resA.sha, trySha: resC.sha, entrySha: shaC }),
      true,
    );

    const committer = git(work, ['log', '-1', '--format=%cn <%ce>', resC.sha]);
    assert.equal(committer, 'xiechimon <157263579+xiechimon@users.noreply.github.com>');

    git(work, ['push', 'origin', `${resC.sha}:refs/heads/main`]);
    assert.equal(
      `${git(work, ['show', `${resC.sha}:a.txt`])}|${git(work, ['show', `${resC.sha}:c.txt`])}`,
      'from-a|from-c',
    );
    rmSync(join(work, '.git', 'worktrees'), { recursive: true, force: true });
  } finally {
    releaseTestTempDir(root);
  }
});

test('latestCompletedCheckMap picks latest completed run per check chronologically', () => {
  const map = latestCompletedCheckMap([
    {
      id: 10,
      name: 'check',
      status: 'completed',
      conclusion: 'failure',
      completed_at: '2026-11-25T01:00:00Z',
    },
    {
      id: 20,
      name: 'check',
      status: 'completed',
      conclusion: 'success',
      completed_at: '2026-11-25T02:00:00Z',
    },
    {
      id: 30,
      name: 'check',
      status: 'in_progress',
      conclusion: null,
      started_at: '2026-11-25T03:00:00Z',
    },
  ]);
  assert.equal(map.get('check'), 'success');
});
