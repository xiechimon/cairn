import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  runQueuePass,
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
      [SHA('2'), { state: 'pending', runId: 102 }],
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

const IDENTITY = {
  GIT_AUTHOR_NAME: 'xiechimon',
  GIT_AUTHOR_EMAIL: '157263579+xiechimon@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'xiechimon',
  GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
};

const FAKE_GH = `#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync } = require('node:fs');
const state = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
const args = process.argv.slice(2);
const path = args.find((arg) => arg.startsWith('repos/'));
if (args.includes('POST')) {
  if (state.rerunRefusal && path.includes('/rerun')) {
    const refusal = typeof state.rerunRefusal === 'string' ? { error: state.rerunRefusal } : state.rerunRefusal;
    if (refusal.patch) {
      const id = Number(/runs\\/(\\d+)\\//.exec(path)?.[1]);
      state.runs = state.runs.map((run) => (run.id === id ? { ...run, ...refusal.patch } : run));
      writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
    }
    console.error(refusal.error);
    process.exit(1);
  }
  appendFileSync(process.env.FAKE_GH_LOG, path + '\\n');
  console.log('{}');
} else {
  const checks = /commits\\/([0-9a-f]+)\\/check-runs/.exec(path);
  const runs = /head_sha=([0-9a-f]+)/.exec(path);
  const jobs = /runs\\/(\\d+)\\/jobs/.exec(path);
  let body = [];
  if (checks) {
    body = { check_runs: state.green.includes(checks[1]) ? ['check', 'pack-smoke', 'e2e-gate'].map((name) => ({ name, status: 'completed', conclusion: 'success' })) : [] };
  } else if (runs) {
    body = { workflow_runs: state.runs.filter((run) => run.head_sha === runs[1]) };
  } else if (jobs) {
    body = { jobs: state.jobs?.[jobs[1]] ?? [] };
  }
  console.log(JSON.stringify(args.includes('--slurp') ? [body] : body));
}
`;

function queueHarness(prefix, scenario) {
  const root = makeTestTempDir(prefix);
  const bare = join(root, 'origin.git');
  const work = join(root, 'work');
  const bin = join(root, 'bin');
  const stateFile = join(root, 'state.json');
  const logFile = join(root, 'posts.log');
  mkdirSync(bare, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const git = (cwd, args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...IDENTITY },
    }).trim();
  git(bare, ['init', '--bare', '-b', 'main']);
  git(root, ['clone', bare, work]);
  const commit = (parent, file, content, message = `feat: ${file}`) => {
    git(work, ['checkout', '--quiet', '--detach', parent]);
    writeFileSync(join(work, file), content);
    git(work, ['add', file]);
    git(work, ['commit', '--quiet', '-m', message]);
    return git(work, ['rev-parse', 'HEAD']);
  };
  const push = (sha, ref) => git(work, ['push', '--quiet', '--force', 'origin', `${sha}:${ref}`]);
  writeFileSync(join(work, 'base.txt'), 'base\n');
  git(work, ['add', 'base.txt']);
  git(work, ['commit', '--quiet', '-m', 'base']);
  git(work, ['push', '--quiet', '-u', 'origin', 'main']);
  const base = git(work, ['rev-parse', 'HEAD']);

  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(logFile, '');
  const state = { green: [], runs: [] };
  const run = (sha, id, branch, patch) => {
    state.runs = state.runs.filter((item) => item.head_sha !== sha);
    state.runs.push({
      id,
      name: 'ci',
      head_sha: sha,
      head_branch: branch,
      status: 'in_progress',
      conclusion: null,
      run_attempt: 1,
      ...patch,
    });
  };
  const pass = () => {
    writeFileSync(stateFile, JSON.stringify(state));
    const saved = { ...process.env };
    Object.assign(process.env, {
      PATH: `${bin}:${saved.PATH}`,
      FAKE_GH_STATE: stateFile,
      FAKE_GH_LOG: logFile,
      ...IDENTITY,
    });
    try {
      return runQueuePass({ repo: 'xiechimon/cairn', cwd: work });
    } finally {
      for (const key of ['PATH', 'FAKE_GH_STATE', 'FAKE_GH_LOG', ...Object.keys(IDENTITY)]) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  };
  const remote = (ref) => git(work, ['ls-remote', 'origin', ref]).split(/\s+/)[0] || null;
  try {
    scenario({
      base,
      commit,
      push,
      state,
      run,
      pass,
      remote,
      git: (args) => git(work, args),
      posts: () => readFileSync(logFile, 'utf8').split('\n').filter(Boolean),
      cancelled: () =>
        [...readFileSync(logFile, 'utf8').matchAll(/runs\/(\d+)\/cancel/g)].map((m) =>
          Number(m[1]),
        ),
    });
  } finally {
    releaseTestTempDir(root);
  }
}

const idAt = (n, sha) => makeEnqueueId(sha, 1_795_000_000_000 + n);

test('an entry stacked unchanged on the tested commit ahead of it lands without a second ci run', () => {
  queueHarness('queue-unchanged-', (q) => {
    const main1 = q.commit(q.base, 'x.txt', 'x\n');
    q.push(main1, 'refs/heads/main');
    const a = q.commit(q.base, 'a.txt', 'a\n');
    const aTry = q.commit(main1, 'a.txt', 'a\n');
    const b = q.commit(aTry, 'b.txt', 'b\n');
    const [idA, idB] = [idAt(1, a), idAt(2, b)];
    q.push(a, `${ENQUEUE_PREFIX}${idA}`);
    q.push(aTry, `${TRY_PREFIX}${idA}`);
    q.push(b, `${ENQUEUE_PREFIX}${idB}`);
    q.state.green = [a, b];
    q.run(aTry, 1, `queue/try/${idA}`, { status: 'completed', conclusion: 'success' });
    q.state.green.push(aTry);
    q.pass();
    assert.equal(q.remote(`${TRY_PREFIX}${idB}`), null);
    assert.equal(q.remote('refs/heads/main'), b);
    assert.deepEqual(q.cancelled(), []);
  });
});

test('a second entry carrying the same change as the one ahead shares its run', () => {
  queueHarness('queue-same-tree-', (q) => {
    const main1 = q.commit(q.base, 'x.txt', 'x\n');
    q.push(main1, 'refs/heads/main');
    const a = q.commit(q.base, 'a.txt', 'a\n', 'feat: a');
    const twin = q.commit(q.base, 'a.txt', 'a\n', 'feat: a again');
    const aTry = q.commit(main1, 'a.txt', 'a\n', 'feat: a');
    const [idA, idTwin] = [idAt(1, a), idAt(2, twin)];
    q.push(a, `${ENQUEUE_PREFIX}${idA}`);
    q.push(aTry, `${TRY_PREFIX}${idA}`);
    q.push(twin, `${ENQUEUE_PREFIX}${idTwin}`);
    q.state.green = [a, twin];
    q.run(aTry, 1, `queue/try/${idA}`, {});
    assert.equal(q.pass().action, 'wait');
    assert.equal(q.remote(`${TRY_PREFIX}${idTwin}`), null);
    assert.equal(q.remote('refs/heads/main'), main1);
    q.run(aTry, 1, `queue/try/${idA}`, { status: 'completed', conclusion: 'success' });
    q.state.green.push(aTry);
    q.pass();
    assert.equal(q.remote('refs/heads/main'), aTry);
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idTwin}`), null);
  });
});

test('a landing that leaves the tree unchanged neither cancels nor restarts the run testing that tree', () => {
  queueHarness('queue-hold-', (q) => {
    const a = q.commit(q.base, 'a.txt', 'a\n', 'feat: a');
    const b = q.commit(q.base, 'b.txt', 'b\n', 'feat: b');
    const aTry = q.commit(q.base, 'a.txt', 'a\n', 'feat: a');
    const bTry = q.commit(aTry, 'b.txt', 'b\n', 'feat: b');
    const landedA = q.commit(q.base, 'a.txt', 'a\n', 'feat: a (landed under another sha)');
    const idB = idAt(2, b);
    q.push(b, `${ENQUEUE_PREFIX}${idB}`);
    q.push(bTry, `${TRY_PREFIX}${idB}`);
    q.push(landedA, 'refs/heads/main');
    q.state.green = [a, b];
    q.run(bTry, 2, `queue/try/${idB}`, {});
    assert.equal(q.pass().action, 'wait');
    assert.equal(q.remote(`${TRY_PREFIX}${idB}`), bTry);
    assert.deepEqual(q.cancelled(), []);

    q.run(bTry, 2, `queue/try/${idB}`, { status: 'completed', conclusion: 'success' });
    q.state.green.push(bTry);
    q.pass();
    const rebuilt = q.remote(`${TRY_PREFIX}${idB}`);
    assert.notEqual(rebuilt, bTry);
    assert.equal(q.git(['rev-parse', `${rebuilt}^{tree}`]), q.git(['rev-parse', `${bTry}^{tree}`]));
    assert.equal(q.remote('refs/heads/main'), landedA, 'a new sha waits for its own checks');
  });
});

test('a rebuild that changes the tree still cancels the stale run and tests the new tree', () => {
  queueHarness('queue-changed-', (q) => {
    const b = q.commit(q.base, 'b.txt', 'b\n', 'feat: b');
    const aTry = q.commit(q.base, 'a.txt', 'a\n', 'feat: a');
    const bTry = q.commit(aTry, 'b.txt', 'b\n', 'feat: b');
    const main1 = q.commit(q.base, 'x.txt', 'x\n');
    const idB = idAt(2, b);
    q.push(b, `${ENQUEUE_PREFIX}${idB}`);
    q.push(bTry, `${TRY_PREFIX}${idB}`);
    q.push(main1, 'refs/heads/main');
    q.state.green = [b];
    q.run(bTry, 2, `queue/try/${idB}`, {});
    assert.equal(q.pass().action, 'rebuilt');
    assert.notEqual(q.remote(`${TRY_PREFIX}${idB}`), bTry);
    assert.deepEqual(q.cancelled(), [2]);
    assert.equal(q.remote('refs/heads/main'), main1);
  });
});

test('entries behind a held one still start or keep their speculative runs', () => {
  queueHarness('queue-hold-tail-', (q) => {
    const [a, b, c] = ['a', 'b', 'c'].map((name) =>
      q.commit(q.base, `${name}.txt`, `${name}\n`, `feat: ${name}`),
    );
    const aTry = q.commit(q.base, 'a.txt', 'a\n', 'feat: a');
    const bTry = q.commit(aTry, 'b.txt', 'b\n', 'feat: b');
    const landedA = q.commit(q.base, 'a.txt', 'a\n', 'feat: a (landed under another sha)');
    const [idB, idC] = [idAt(2, b), idAt(3, c)];
    q.push(b, `${ENQUEUE_PREFIX}${idB}`);
    q.push(bTry, `${TRY_PREFIX}${idB}`);
    q.push(c, `${ENQUEUE_PREFIX}${idC}`);
    q.push(landedA, 'refs/heads/main');
    q.state.green = [b, c];
    q.run(bTry, 2, `queue/try/${idB}`, {});

    assert.equal(q.pass().action, 'rebuilt');
    assert.equal(q.remote(`${TRY_PREFIX}${idB}`), bTry);
    const cTry = q.remote(`${TRY_PREFIX}${idC}`);
    assert.equal(q.git(['rev-parse', `${cTry}^`]), bTry);

    q.run(cTry, 3, `queue/try/${idC}`, {});
    assert.equal(q.pass().action, 'wait');
    assert.equal(q.remote(`${TRY_PREFIX}${idC}`), cTry);
    assert.deepEqual(q.cancelled(), []);
  });
});

test('a conflict against a held base that lacks current main waits instead of ejecting', () => {
  queueHarness('queue-hold-conflict-', (q) => {
    const start = q.commit(q.base, 'x.txt', '1\n', 'feat: x one');
    const squashed = q.commit(start, 'x.txt', '3\n', 'feat: x to three');
    const b = q.commit(start, 'b.txt', 'b\n', 'feat: b');
    const bTry = q.commit(squashed, 'b.txt', 'b\n', 'feat: b');
    const step = q.commit(start, 'x.txt', '2\n', 'feat: x two');
    const main = q.commit(step, 'x.txt', '3\n', 'feat: x three');
    const c = q.commit(main, 'c.txt', 'c\n', 'feat: c');
    const [idB, idC] = [idAt(2, b), idAt(3, c)];
    q.push(b, `${ENQUEUE_PREFIX}${idB}`);
    q.push(bTry, `${TRY_PREFIX}${idB}`);
    q.push(c, `${ENQUEUE_PREFIX}${idC}`);
    q.push(main, 'refs/heads/main');
    q.state.green = [b, c];
    q.run(bTry, 2, `queue/try/${idB}`, {});
    assert.equal(q.pass().action, 'wait');
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idC}`), c);
    assert.equal(q.remote(`${TRY_PREFIX}${idB}`), bTry);
    assert.deepEqual(q.cancelled(), []);
  });
});

const RUN_STATES = {
  green: { state: 'green', runId: 2 },
  'first attempt running': { state: 'pending', runId: 2 },
  'waiting for its retry': { state: 'retry', runId: 2, rerun: 'rerun-failed-jobs' },
  'retry running': { state: 'pending', runId: 2, retrying: true },
  red: { state: 'red', runId: 2, runAttempt: 2 },
};

test('what may be passed on the way to main, for every run state ahead', () => {
  const landsThrough = (ahead, follower) => {
    const ids = ['1-a', '2-b', '3-c'];
    const plan = planQueueStep({
      mainTip: MAIN,
      entries: ids.map((id, i) => entry(id, 'abc'[i])),
      tryMap: new Map(ids.map((id, i) => [id, { sha: SHA(`${i + 1}`), validOnParent: true }])),
      verdicts: new Map([
        [SHA('1'), { state: 'green', runId: 1 }],
        [SHA('2'), RUN_STATES[ahead]],
        [SHA('3'), { state: 'green', runId: follower === 'own queue run' ? 3 : null }],
      ]),
    });
    return plan.promote?.entries.length ?? 0;
  };
  const table = Object.fromEntries(
    Object.keys(RUN_STATES).map((ahead) => [
      ahead,
      [landsThrough(ahead, 'own queue run'), landsThrough(ahead, 'pre-flight only')],
    ]),
  );
  assert.deepEqual(table, {
    green: [3, 3],
    'first attempt running': [3, 1],
    'waiting for its retry': [1, 1],
    'retry running': [1, 1],
    red: [1, 1],
  });
});

test('evaluateSpeculativeCandidate tells a running retry from a running first attempt', () => {
  const sha = SHA('1');
  const running = (attempt) =>
    evaluateSpeculativeCandidate({
      sha,
      checkRuns: [],
      ciRuns: [
        {
          id: 9,
          name: 'ci',
          head_sha: sha,
          head_branch: 'queue/try/x',
          status: 'in_progress',
          run_attempt: attempt,
        },
      ],
    });
  assert.equal(Boolean(running(1).retrying), false);
  assert.equal(running(2).retrying, true);
});

function failingHead(q, follower) {
  const main1 = q.commit(q.base, 'x.txt', 'x\n');
  q.push(main1, 'refs/heads/main');
  const a = q.commit(q.base, 'a.txt', 'a\n');
  const b = q.commit(q.base, 'b.txt', 'b\n');
  const aTry = q.commit(main1, 'a.txt', 'a\n');
  const stacked = follower === 'pre-flight only';
  const second = stacked ? q.commit(aTry, 'b.txt', 'b\n') : b;
  const bTry = stacked ? second : q.commit(aTry, 'b.txt', 'b\n');
  const [idA, idB] = [idAt(1, a), idAt(2, second)];
  q.push(a, `${ENQUEUE_PREFIX}${idA}`);
  q.push(aTry, `${TRY_PREFIX}${idA}`);
  q.push(second, `${ENQUEUE_PREFIX}${idB}`);
  if (!stacked) {
    q.push(bTry, `${TRY_PREFIX}${idB}`);
    q.run(bTry, 2, `queue/try/${idB}`, { status: 'completed', conclusion: 'success' });
  }
  q.state.green = [a, second, bTry];
  const head = (patch) => q.run(aTry, 1, `queue/try/${idA}`, patch);
  return { main1, aTry, bTry, idA, head };
}

const FAILED_ONCE = { status: 'completed', conclusion: 'failure', run_attempt: 1 };
const RETRY_RUNNING = { status: 'in_progress', run_attempt: 2 };

for (const follower of ['own queue run', 'pre-flight only']) {
  test(`a green follower (${follower}) stays off main while the head has failed or is retrying`, () => {
    queueHarness('queue-failed-head-', (q) => {
      const { main1, aTry, bTry, head } = failingHead(q, follower);
      head(FAILED_ONCE);
      assert.equal(q.pass().action, 'retry');
      assert.equal(q.remote('refs/heads/main'), main1, 'landed past a failed run');
      head(RETRY_RUNNING);
      assert.equal(q.pass().action, 'wait');
      assert.equal(q.remote('refs/heads/main'), main1, 'landed past a running retry');
      assert.deepEqual(q.cancelled(), []);
      head({ status: 'completed', conclusion: 'success', run_attempt: 2 });
      q.state.green.push(aTry);
      q.pass();
      assert.equal(q.remote('refs/heads/main'), bTry);
    });
  });
}

test('a head that fails twice is ejected and a follower with its own queue run does not land it', () => {
  queueHarness('queue-twice-red-', (q) => {
    const { main1, aTry, idA, head } = failingHead(q, 'own queue run');
    head({ ...FAILED_ONCE, run_attempt: 2 });
    q.pass();
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idA}`), null);
    assert.equal(q.remote('refs/heads/main'), main1);
    assert.throws(() => q.git(['merge-base', '--is-ancestor', aTry, 'origin/main']));
  });
});

test('a pre-flight-only entry waits for a running first attempt ahead of it', () => {
  queueHarness('queue-past-pending-', (q) => {
    const { main1, aTry, bTry, head } = failingHead(q, 'pre-flight only');
    head({});
    assert.equal(q.pass().action, 'wait');
    assert.equal(q.remote('refs/heads/main'), main1, 'landed past a pending run');
    head({ status: 'completed', conclusion: 'success' });
    q.state.green.push(aTry);
    q.pass();
    assert.equal(q.remote('refs/heads/main'), bTry);
  });
});

test('an entry that is the queue commit ahead of it never overrides that run verdict', () => {
  queueHarness('queue-same-sha-', (q) => {
    const main1 = q.commit(q.base, 'x.txt', 'x\n');
    q.push(main1, 'refs/heads/main');
    const a = q.commit(q.base, 'a.txt', 'a\n');
    const aTry = q.commit(main1, 'a.txt', 'a\n');
    q.push(a, `${ENQUEUE_PREFIX}${idAt(1, a)}`);
    q.push(aTry, `${TRY_PREFIX}${idAt(1, a)}`);
    q.push(aTry, `${ENQUEUE_PREFIX}${idAt(2, aTry)}`);
    q.state.green = [a, aTry];
    q.run(aTry, 1, 'queue/try/a', FAILED_ONCE);
    assert.equal(q.pass().action, 'retry');
    assert.equal(q.remote('refs/heads/main'), main1);
  });
});

function carriedCommit(q, extra = {}) {
  const main1 = q.commit(q.base, 'x.txt', 'x\n');
  q.push(main1, 'refs/heads/main');
  const carried = q.commit(main1, 'a.txt', 'a\n');
  const b = q.commit(carried, 'b.txt', 'b\n');
  const idB = idAt(2, b);
  q.push(b, `${ENQUEUE_PREFIX}${idB}`);
  q.state.green = [b];
  const failed = (patch) => q.run(carried, 1, 'queue/try/gone', patch);
  failed(extra);
  return { main1, carried, b, idB, failed };
}

function batchWithCarried(q, carriedPatch = FAILED_ONCE) {
  const main1 = q.commit(q.base, 'x.txt', 'x\n');
  q.push(main1, 'refs/heads/main');
  const a = q.commit(q.base, 'a.txt', 'a\n');
  const aTry = q.commit(main1, 'a.txt', 'a\n');
  const carried = q.commit(aTry, 'c.txt', 'c\n');
  const b = q.commit(carried, 'b.txt', 'b\n');
  const d = q.commit(q.base, 'd.txt', 'd\n');
  const [idA, idB, idD] = [idAt(1, a), idAt(2, b), idAt(3, d)];
  q.push(a, `${ENQUEUE_PREFIX}${idA}`);
  q.push(aTry, `${TRY_PREFIX}${idA}`);
  q.push(b, `${ENQUEUE_PREFIX}${idB}`);
  q.push(d, `${ENQUEUE_PREFIX}${idD}`);
  q.state.green = [a, aTry, b, d];
  q.run(aTry, 1, `queue/try/${idA}`, { status: 'completed', conclusion: 'success' });
  q.run(carried, 7, 'queue/try/gone', carriedPatch);
  return { main1, aTry, carried, b, d, idA, idB, idD };
}

const rerunPosts = (q) => q.posts().filter((path) => path.includes('/rerun'));

test('a carried commit that failed once gets one retry, holds main while it runs and releases it green', () => {
  queueHarness('queue-carried-flake-', (q) => {
    const { main1, b, failed } = carriedCommit(q, FAILED_ONCE);
    assert.equal(q.pass().action, 'retry');
    assert.equal(q.remote('refs/heads/main'), main1, 'landed a commit whose run failed');
    assert.deepEqual(rerunPosts(q), ['repos/xiechimon/cairn/actions/runs/1/rerun']);
    failed(RETRY_RUNNING);
    assert.equal(q.pass().action, 'wait');
    assert.equal(q.remote('refs/heads/main'), main1, 'landed past a running retry');
    assert.equal(rerunPosts(q).length, 1);
    failed({ status: 'completed', conclusion: 'success', run_attempt: 2 });
    q.pass();
    assert.equal(q.remote('refs/heads/main'), b);
  });
});

test('a carried commit that failed twice ejects the entry that brings it', () => {
  queueHarness('queue-carried-red-', (q) => {
    const { main1, idB } = carriedCommit(q, { ...FAILED_ONCE, run_attempt: 2 });
    q.pass();
    assert.equal(q.remote('refs/heads/main'), main1);
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idB}`), null);
    assert.ok(q.posts().some((path) => /commits\/[0-9a-f]+\/comments$/.test(path)));
    assert.equal(rerunPosts(q).length, 0);
  });
});

test('a carried commit whose only run was cancelled does not hold the entry', () => {
  queueHarness('queue-carried-cancelled-', (q) => {
    const { b } = carriedCommit(q, { status: 'completed', conclusion: 'cancelled' });
    q.pass();
    assert.equal(q.remote('refs/heads/main'), b);
    assert.equal(rerunPosts(q).length, 0);
  });
});

test('a rebuilt entry whose own history holds a twice-failed commit is ejected though its rebuild is green', () => {
  queueHarness('queue-carried-history-', (q) => {
    const { main1, carried, b, idB } = carriedCommit(q, { ...FAILED_ONCE, run_attempt: 2 });
    const moved = q.commit(main1, 'y.txt', 'y\n');
    q.push(moved, 'refs/heads/main');
    const rebuilt = q.commit(q.commit(moved, 'a.txt', 'a\n'), 'b.txt', 'b\n');
    q.push(rebuilt, `${TRY_PREFIX}${idB}`);
    q.run(rebuilt, 2, `queue/try/${idB}`, { status: 'completed', conclusion: 'success' });
    q.state.green = [b, rebuilt];
    q.pass();
    assert.equal(q.remote('refs/heads/main'), moved);
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idB}`), null);
    assert.notEqual(carried, rebuilt);
  });
});

test('ejecting a twice-failed head does not let a follower stacked on its try commit land it', () => {
  queueHarness('queue-carried-follower-', (q) => {
    const { main1, idA, head } = failingHead(q, 'pre-flight only');
    head({ ...FAILED_ONCE, run_attempt: 2 });
    q.pass();
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idA}`), null);
    assert.equal(q.remote('refs/heads/main'), main1, 'the failed try commit reached main');
  });
});

test('a held carrier does not delay the entry ahead of it or the build of the entry behind it', () => {
  queueHarness('queue-carried-batch-', (q) => {
    const { aTry, b, idB, idD } = batchWithCarried(q);
    q.pass();
    assert.equal(q.remote('refs/heads/main'), aTry, 'the innocent entry ahead waited too');
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idB}`), b);
    const dTry = q.remote(`${TRY_PREFIX}${idD}`);
    assert.ok(dTry, 'the entry behind got no run while the carrier waited');
    assert.equal(q.git(['rev-parse', `${dTry}^`]), b);
    assert.equal(rerunPosts(q).length, 1);
  });
});

test('a carried retry cancelled without failed jobs gets one replacement rerun then ejects at attempt 3', () => {
  queueHarness('queue-carried-retry-cancelled-', (q) => {
    const { main1, b, idB, failed } = carriedCommit(q, {
      status: 'completed',
      conclusion: 'cancelled',
      run_attempt: 2,
    });
    assert.equal(q.pass().action, 'retry');
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idB}`), b);
    assert.equal(q.remote('refs/heads/main'), main1);
    assert.deepEqual(rerunPosts(q), ['repos/xiechimon/cairn/actions/runs/1/rerun']);

    failed({ status: 'completed', conclusion: 'cancelled', run_attempt: 3 });
    q.pass();
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idB}`), null);
    assert.equal(q.remote('refs/heads/main'), main1);
    assert.equal(rerunPosts(q).length, 1);
    assert.ok(q.posts().some((path) => /commits\/[0-9a-f]+\/comments$/.test(path)));
  });
});

test('a carried retry cancelled after a job failed ejects immediately without a third attempt', () => {
  queueHarness('queue-carried-retry-cancelled-failed-job-', (q) => {
    const { main1, idB } = carriedCommit(q, {
      status: 'completed',
      conclusion: 'cancelled',
      run_attempt: 2,
    });
    q.state.jobs = { 1: [{ name: 'e2e (5)', conclusion: 'failure' }] };
    q.pass();
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idB}`), null);
    assert.equal(q.remote('refs/heads/main'), main1);
    assert.equal(rerunPosts(q).length, 0);
  });
});

test('a permanent rerun refusal ejects only the carrier and still lands ahead and rebuilds behind', () => {
  for (const error of [
    'gh: exceeded the maximum number of reruns (HTTP 403)',
    'gh: Unable to retry this workflow run because it was created over a month ago (HTTP 403)',
    'gh: Not Found (HTTP 404)',
    'gh: Workflow run cannot be retried (HTTP 422)',
  ]) {
    queueHarness('queue-carried-perm-refusal-', (q) => {
      const { aTry, idB, idD } = batchWithCarried(q);
      q.state.rerunRefusal = error;
      q.pass();
      assert.equal(q.remote('refs/heads/main'), aTry, error);
      assert.equal(q.remote(`${ENQUEUE_PREFIX}${idB}`), null, error);
      assert.ok(
        q.posts().some((path) => /commits\/[0-9a-f]+\/comments$/.test(path)),
        error,
      );
      const dTry = q.remote(`${TRY_PREFIX}${idD}`);
      assert.ok(dTry, error);
      assert.equal(q.git(['rev-parse', `${dTry}^`]), aTry, error);
    });
  }
});

test('a transient rerun failure holds only the carrier without aborting the pass', () => {
  for (const error of [
    'gh: Server Error (HTTP 502)',
    'gh: Too Many Requests (HTTP 429)',
    'gh: secondary rate limit (HTTP 403)',
    'Get "https://api.github.com/": EOF',
  ]) {
    queueHarness('queue-carried-transient-refusal-', (q) => {
      const { aTry, b, idB, idD } = batchWithCarried(q);
      q.state.rerunRefusal = error;
      q.pass();
      assert.equal(q.remote('refs/heads/main'), aTry, error);
      assert.equal(q.remote(`${ENQUEUE_PREFIX}${idB}`), b, error);
      const dTry = q.remote(`${TRY_PREFIX}${idD}`);
      assert.ok(dTry, error);
      assert.equal(q.git(['rev-parse', `${dTry}^`]), b, error);
      assert.equal(q.posts().filter((p) => /comments$/.test(p)).length, 0, error);
    });
  }
});

test('a 4xx rerun refusal whose re-read shows an already running retry holds instead of ejecting', () => {
  queueHarness('queue-carried-refusal-race-', (q) => {
    const { aTry, b, idB } = batchWithCarried(q);
    q.state.rerunRefusal = {
      error: 'gh: Run is already running (HTTP 403)',
      patch: { status: 'in_progress', conclusion: null, run_attempt: 2 },
    };
    q.pass();
    assert.equal(q.remote('refs/heads/main'), aTry);
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idB}`), b);
    assert.equal(q.posts().filter((p) => /comments$/.test(p)).length, 0);
  });
});

test('a superseded queue ref is deleted with its run, so a cancelled attempt is never counted later', () => {
  queueHarness('queue-superseded-', (q) => {
    const main1 = q.commit(q.base, 'x.txt', 'x\n');
    q.push(main1, 'refs/heads/main');
    const a = q.commit(q.base, 'a.txt', 'a\n', 'feat: a');
    const twin = q.commit(q.base, 'a.txt', 'a\n', 'feat: a again');
    const aTry = q.commit(main1, 'a.txt', 'a\n', 'feat: a');
    const twinOld = q.commit(q.base, 'a.txt', 'a\n', 'feat: a again, old try');
    const [idA, idTwin] = [idAt(1, a), idAt(2, twin)];
    q.push(a, `${ENQUEUE_PREFIX}${idA}`);
    q.push(aTry, `${TRY_PREFIX}${idA}`);
    q.push(twin, `${ENQUEUE_PREFIX}${idTwin}`);
    q.push(twinOld, `${TRY_PREFIX}${idTwin}`);
    q.state.green = [a, twin];
    q.run(aTry, 1, `queue/try/${idA}`, {});
    q.run(twinOld, 7, `queue/try/${idTwin}`, {});
    q.pass();
    assert.deepEqual(q.cancelled(), [7]);
    assert.equal(q.remote(`${TRY_PREFIX}${idTwin}`), null);
  });
});

test('no queue ref is ever built on a sha that is already an entry, so its checks cannot be overwritten', () => {
  queueHarness('queue-own-sha-', (q) => {
    const b = q.commit(q.base, 'b.txt', 'b\n', 'feat: b');
    const aTry = q.commit(q.base, 'a.txt', 'a\n', 'feat: a');
    const bTry = q.commit(aTry, 'b.txt', 'b\n', 'feat: b');
    const s = q.commit(bTry, 's.txt', 's\n', 'feat: s');
    const landedA = q.commit(q.base, 'a.txt', 'a\n', 'feat: a (landed under another sha)');
    const [idB, idS] = [idAt(2, b), idAt(3, s)];
    q.push(b, `${ENQUEUE_PREFIX}${idB}`);
    q.push(bTry, `${TRY_PREFIX}${idB}`);
    q.push(s, `${ENQUEUE_PREFIX}${idS}`);
    q.push(landedA, 'refs/heads/main');
    q.state.green = [b, s];
    q.run(bTry, 2, `queue/try/${idB}`, {});
    assert.equal(q.pass().action, 'wait');
    assert.equal(q.remote(`${TRY_PREFIX}${idS}`), null);
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idS}`), s);
  });
});

test('no queue ref is pushed when a rebuild adds no changes to its parent, and any stale ref is deleted', () => {
  queueHarness('queue-empty-rebuild-', (q) => {
    const b = q.commit(q.base, 'b.txt', 'b\n', 'feat: b');
    const aTry = q.commit(q.base, 'a.txt', 'a\n', 'feat: a');
    const bTry = q.commit(aTry, 'b.txt', 'b\n', 'feat: b');
    const twin = q.commit(q.base, 'b.txt', 'b\n', 'feat: b again');
    const twinOld = q.commit(q.base, 'z.txt', 'z\n', 'feat: old');
    const landedA = q.commit(q.base, 'a.txt', 'a\n', 'feat: a (landed under another sha)');
    const [idB, idTwin] = [idAt(2, b), idAt(3, twin)];
    q.push(b, `${ENQUEUE_PREFIX}${idB}`);
    q.push(bTry, `${TRY_PREFIX}${idB}`);
    q.push(twin, `${ENQUEUE_PREFIX}${idTwin}`);
    q.push(twinOld, `${TRY_PREFIX}${idTwin}`);
    q.push(landedA, 'refs/heads/main');
    q.state.green = [b, twin];
    q.run(bTry, 2, `queue/try/${idB}`, {});
    assert.equal(q.pass().action, 'wait');
    assert.equal(q.remote(`${TRY_PREFIX}${idTwin}`), null);
    assert.equal(q.remote(`${ENQUEUE_PREFIX}${idTwin}`), twin);
  });
});
