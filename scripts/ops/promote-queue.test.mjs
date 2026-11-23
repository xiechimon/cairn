import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closeLandedIssues,
  closingTargets,
  dropNotice,
  evaluate,
  ghPages,
  isCheckLagRefusal,
  ownerOf,
  planDrop,
  pushToMain,
  REQUIRED_CHECKS,
} from './promote-queue.mjs';

const SHA = 'a'.repeat(40);
const run = (over) => ({
  name: 'ci',
  head_sha: SHA,
  head_branch: 'queue/main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  ...over,
});
const checks = REQUIRED_CHECKS.map((name) => ({ name, conclusion: 'success' }));
const base = {
  queueHead: SHA,
  ciRuns: [run()],
  checkRuns: checks,
  mainTip: 'b'.repeat(40),
  candidateContainsMain: true,
};

test('green run on the queue head promotes that exact sha', () => {
  assert.deepEqual(evaluate(base), { action: 'promote', sha: SHA });
});

test('requeued sha uses the latest check result regardless of response order', () => {
  const older = '2026-11-19T07:08:53Z';
  const newer = '2026-11-19T07:33:42Z';
  for (const [oldTiming, newTiming] of [
    [
      { completed_at: older, id: 9 },
      { completed_at: newer, id: 1 },
    ],
    [
      { started_at: older, id: 9 },
      { started_at: newer, id: 1 },
    ],
    [
      { completed_at: older, id: 9 },
      { completed_at: null, started_at: newer, id: 1 },
    ],
    [{ id: 1 }, { id: 9 }],
    [
      { completed_at: newer, id: 1 },
      { completed_at: newer, id: 9 },
    ],
  ]) {
    for (const conclusion of ['success', 'skipped', 'failure', 'cancelled', null]) {
      const latest = checks.map((check) => ({ ...check, ...newTiming, conclusion }));
      const previous = checks.map((check, index) => ({
        ...check,
        ...oldTiming,
        conclusion:
          conclusion === 'success' || conclusion === 'skipped'
            ? ['failure', 'cancelled', 'failure'][index]
            : 'success',
      }));
      for (const checkRuns of [
        [...latest, ...previous],
        [...previous, ...latest],
      ]) {
        assert.deepEqual(
          evaluate({ ...base, checkRuns }),
          conclusion === 'success' || conclusion === 'skipped'
            ? { action: 'promote', sha: SHA }
            : { action: 'wait', reason: 'checks pending: check, pack-smoke, e2e-gate' },
        );
      }
    }
  }
});

test('no run, running run or pending check waits', () => {
  assert.equal(evaluate({ ...base, ciRuns: [] }).action, 'wait');
  assert.equal(
    evaluate({ ...base, ciRuns: [run({ status: 'in_progress', conclusion: null })] }).action,
    'wait',
  );
  assert.equal(
    evaluate({ ...base, checkRuns: checks.filter((c) => c.name !== 'e2e-gate') }).action,
    'wait',
  );
});

test('cancelled or failed run never counts as green', () => {
  for (const conclusion of ['cancelled', 'failure']) {
    const verdict = evaluate({ ...base, ciRuns: [run({ conclusion })] });
    assert.notEqual(verdict.action, 'promote');
    assert.equal(verdict.action, 'retry');
  }
});

test('a check skipped by classification counts the same as the ruleset does', () => {
  const skipped = checks.map((c) =>
    c.name === 'pack-smoke' ? { ...c, conclusion: 'skipped' } : c,
  );
  assert.deepEqual(evaluate({ ...base, checkRuns: skipped }), {
    action: 'promote',
    sha: SHA,
  });
});

test('a successful run for a different sha or branch does not promote', () => {
  const other = run({ head_sha: 'c'.repeat(40) });
  assert.equal(evaluate({ ...base, ciRuns: [other] }).action, 'wait');
  const wrongBranch = run({ head_branch: 'main' });
  assert.equal(evaluate({ ...base, ciRuns: [wrongBranch] }).action, 'wait');
});

const failedJobs = [
  { name: 'check-core', conclusion: 'failure' },
  { name: 'vitest-light', conclusion: 'success' },
  { name: 'e2e', conclusion: 'cancelled' },
];

test('a red run with a failed job reruns the failed jobs once, then drops after the rerun stays red', () => {
  const first = run({ conclusion: 'failure', run_attempt: 1, id: 7 });
  assert.deepEqual(evaluate({ ...base, ciRuns: [first], jobs: failedJobs }), {
    action: 'retry',
    reason: 'ci failure in check-core',
    sha: SHA,
    runId: 7,
    runUrl: undefined,
    rerun: 'rerun-failed-jobs',
    dropReason: 'ci failed again after one rerun of the failed jobs (check-core)',
  });
  const second = run({ conclusion: 'failure', run_attempt: 2, id: 7 });
  assert.equal(evaluate({ ...base, ciRuns: [second], jobs: failedJobs }).action, 'drop');
});

test('a timed out job counts as a failed job', () => {
  const jobs = [{ name: 'e2e', conclusion: 'timed_out' }];
  const verdict = evaluate({ ...base, ciRuns: [run({ conclusion: 'failure' })], jobs });
  assert.equal(verdict.action, 'retry');
  assert.equal(verdict.rerun, 'rerun-failed-jobs');
});

test('a cancelled run, or a failure with only cancelled jobs, reruns the whole run once and then drops', () => {
  const jobs = [
    { name: 'check-core', conclusion: 'success' },
    { name: 'e2e', conclusion: 'cancelled' },
  ];
  for (const conclusion of ['cancelled', 'failure']) {
    const first = evaluate({ ...base, ciRuns: [run({ conclusion, id: 4 })], jobs });
    assert.equal(first.action, 'retry');
    assert.equal(first.rerun, 'rerun');
    const second = evaluate({
      ...base,
      ciRuns: [run({ conclusion, id: 4, run_attempt: 2 })],
      jobs,
    });
    assert.equal(second.action, 'drop');
    assert.match(second.dropReason, /ended .* again after one rerun/);
  }
});

test('another workflow run on the same sha never stands in for the ci run', () => {
  const guard = run({ name: 'queue-guard', conclusion: 'success' });
  const red = run({ conclusion: 'failure', id: 9 });
  for (const ciRuns of [
    [guard, red],
    [red, guard],
  ]) {
    assert.equal(evaluate({ ...base, ciRuns, jobs: failedJobs }).action, 'retry');
  }
  assert.deepEqual(evaluate({ ...base, ciRuns: [guard] }), {
    action: 'wait',
    reason: 'no ci run yet',
  });
});

test('a candidate that no longer contains main is dropped, and a missing queue is idle', () => {
  assert.deepEqual(evaluate({ ...base, candidateContainsMain: false }), {
    action: 'drop',
    reason: 'stale',
    sha: SHA,
    dropReason: 'it does not contain main, which moved past it',
  });
  assert.equal(evaluate({ ...base, queueHead: null }).action, 'idle');
});

test('ownerOf reads the last owner trailer: an Amp thread as URL or bare id, or a lane', () => {
  assert.equal(ownerOf('subject\n\nbody\n'), null);
  assert.deepEqual(
    ownerOf(
      's\n\nAmp-Thread-ID: https://ampcode.com/threads/T-01a1f406-0526-758a-9293-f3cf47c2e3e8\n',
    ),
    {
      key: 'amp:T-01a1f406-0526-758a-9293-f3cf47c2e3e8',
      label: 'https://ampcode.com/threads/T-01a1f406-0526-758a-9293-f3cf47c2e3e8',
    },
  );
  assert.equal(
    ownerOf('s\n\nAmp-Thread-ID: T-aaaa-1\nAmp-Thread-ID: T-bbbb-2\n').key,
    'amp:T-bbbb-2',
  );
  assert.deepEqual(ownerOf('s\n\nLane: macbook/ecstatic-brahmagupta\n'), {
    key: 'lane:macbook/ecstatic-brahmagupta',
    label: 'lane macbook/ecstatic-brahmagupta',
  });
  assert.equal(ownerOf('subject that mentions Lane: x\n\n  Lane: indented is not a trailer'), null);
});

const commit = (sha, owner) => ({
  sha,
  subject: sha,
  owner: owner ? { key: owner, label: owner } : null,
});

test('planDrop takes the consecutive commits of the head owner and keeps the rest', () => {
  assert.deepEqual(planDrop([commit('a', 'T-1'), commit('b', 'T-2'), commit('c', 'T-2')]), {
    dropped: [commit('b', 'T-2'), commit('c', 'T-2')],
    keepTip: 'a',
  });
});

test('planDrop does not split an owner run and never drops an earlier run of the same owner', () => {
  const chain = [commit('a', 'T-2'), commit('b', 'T-1'), commit('c', 'T-2')];
  assert.deepEqual(planDrop(chain), { dropped: [commit('c', 'T-2')], keepTip: 'b' });
});

test('planDrop drops unmarked candidates together and deletes the queue when everything goes', () => {
  assert.deepEqual(planDrop([commit('a'), commit('b')]), {
    dropped: [commit('a'), commit('b')],
    keepTip: null,
  });
  assert.deepEqual(planDrop([commit('a', 'T-1'), commit('b')]), {
    dropped: [commit('b')],
    keepTip: 'a',
  });
  assert.deepEqual(planDrop([]), { dropped: [], keepTip: null });
});

test('the drop notice names the owners and the run, or says no owner is marked', () => {
  const verdict = {
    dropReason: 'ci failed again after one rerun of the failed jobs (check-core)',
    runUrl: 'https://example.test/run/1',
  };
  const marked = dropNotice({
    verdict,
    dropped: [commit('a'.repeat(40), 'lane x/y')],
    keepTip: null,
  });
  assert.match(marked, /lane x\/y/);
  assert.match(marked, /check-core/);
  assert.match(marked, /queue\/main was deleted/);
  assert.match(marked, /Run: https:\/\/example\.test\/run\/1/);
  const unmarked = dropNotice({
    verdict: { dropReason: 'it does not contain main, which moved past it' },
    dropped: [commit('b'.repeat(40))],
    keepTip: 'c'.repeat(40),
  });
  assert.match(unmarked, /No Amp-Thread-ID or Lane trailer/);
  assert.match(unmarked, /ccccccccc/);
  assert.doesNotMatch(unmarked, /Run:/);
});

const closesCommit = (sha, trailer) => ({
  sha,
  subject: `subject of ${sha.slice(0, 9)}`,
  body: `subject of ${sha.slice(0, 9)}\n\n${trailer}\n`,
});

test('closingTargets names issues from Closes and Fixes trailers, never Part of', () => {
  const targets = closingTargets([
    closesCommit('a'.repeat(40), 'Closes #5399\nPart of #5380'),
    closesCommit('b'.repeat(40), 'Fixes #5374\nCloses #5399'),
    closesCommit('c'.repeat(40), 'See #123 for context, resolves #5'),
  ]);
  assert.deepEqual(
    [...targets.keys()].sort((a, b) => a - b),
    [5, 5374, 5399],
  );
  assert.deepEqual(
    targets.get(5399).map((c) => c.sha),
    ['a'.repeat(40), 'b'.repeat(40)],
  );
});

function fakeIssues(open) {
  const states = new Map(Object.entries(open));
  const calls = [];
  return {
    calls,
    states,
    io: {
      commits: [],
      getIssue: (n) => {
        if (!states.has(String(n))) throw new Error('HTTP 404');
        return { state: states.get(String(n)) };
      },
      postComment: (n, body) => calls.push(['comment', n, body]),
      closeIssue: (n) => {
        states.set(String(n), 'closed');
        calls.push(['close', n]);
      },
      warn: (m) => calls.push(['warn', m]),
    },
  };
}

test('landing two commits with Closes trailers closes both issues exactly once and names the commits', () => {
  const { calls, states, io } = fakeIssues({ 5399: 'open', 5374: 'open' });
  const commits = [
    closesCommit('d'.repeat(40), 'Closes #5399'),
    closesCommit('e'.repeat(40), 'Fixes #5374'),
  ];
  closeLandedIssues({ ...io, commits });
  assert.equal(states.get('5399'), 'closed');
  assert.equal(states.get('5374'), 'closed');
  const closedNumbers = calls.filter(([k]) => k === 'close').map(([, n]) => n);
  assert.deepEqual(closedNumbers.sort(), [5374, 5399]);
  const commentFor = (n) => calls.find(([k, m]) => k === 'comment' && m === n)[2];
  assert.match(commentFor(5399), /ddddddddd/);
  assert.match(commentFor(5374), /eeeeeeeee/);
});

test('Part of trailers never close an issue', () => {
  const { calls, states, io } = fakeIssues({ 31: 'open' });
  closeLandedIssues({
    ...io,
    commits: [closesCommit('f'.repeat(40), 'Part of #31')],
  });
  assert.equal(states.get('31'), 'open');
  assert.deepEqual(calls, []);
});

test('already closed issues are skipped, so a rerun is a no-op', () => {
  const { calls, io } = fakeIssues({ 5399: 'open', 5374: 'open' });
  const commits = [closesCommit('d'.repeat(40), 'Closes #5399\nCloses #5374')];
  closeLandedIssues({ ...io, commits });
  const firstRunCalls = calls.length;
  assert.ok(firstRunCalls > 0);
  closeLandedIssues({ ...io, commits });
  assert.equal(calls.length, firstRunCalls);
  assert.deepEqual(
    calls
      .filter(([k]) => k === 'close')
      .map(([, n]) => n)
      .sort(),
    [5374, 5399],
  );
});

test('a failure to close is logged and never aborts the other issues', () => {
  const { calls, states, io } = fakeIssues({ 5399: 'open', 5374: 'open' });
  io.closeIssue = (n) => {
    if (n === 5399) throw new Error('boom');
    states.set(String(n), 'closed');
    calls.push(['close', n]);
  };
  closeLandedIssues({
    ...io,
    commits: [closesCommit('d'.repeat(40), 'Closes #5399\nFixes #5374')],
  });
  assert.equal(states.get('5374'), 'closed');
  assert.equal(states.get('5399'), 'open');
  assert.ok(calls.some(([k, m]) => k === 'warn' && /5399/.test(m)));
});

const MAIN_TIP = 'b'.repeat(40);

const rulesetRefusal = (detail) =>
  `remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: Review all repository rules at https://github.com/xiechimon/cairn/rules?ref=refs%2Fheads%2Fmain
remote:
remote: - ${detail}
remote:
 ! [remote rejected]     ${SHA} -> main (push declined due to repository rule violations)
error: failed to push some refs to 'https://github.com/xiechimon/cairn'
`;

const REAL_REFUSAL_DETAILS = [
  'Required status check "check" is expected.',
  'Required status check "e2e-gate" is expected.',
  '2 of 3 required status checks are expected.',
  '3 of 3 required status checks have not succeeded: 2 expected.',
];

test('the GH013 ruleset check-lag refusal is the only retryable push failure', () => {
  for (const detail of REAL_REFUSAL_DETAILS) {
    assert.ok(isCheckLagRefusal(rulesetRefusal(detail)), detail);
  }
  assert.equal(
    isCheckLagRefusal(
      ` ! [rejected]        HEAD -> main (non-fast-forward)\nerror: failed to push some refs to 'https://github.com/xiechimon/cairn'\n`,
    ),
    false,
  );
  assert.equal(
    isCheckLagRefusal(
      `remote: error: GH013: Repository rule violations found for refs/heads/main.\nremote: - Commits must have verified signatures.\n`,
    ),
    false,
  );
  assert.equal(isCheckLagRefusal(''), false);
});

const noop = () => {};
const stillHead = () => ({ queueHead: SHA, mainTip: MAIN_TIP, landed: false });

const landing = ({ push, recheck = stillHead, sleep = noop, log = noop, ...options }) =>
  pushToMain({
    sha: SHA,
    mainTip: MAIN_TIP,
    push,
    recheck,
    sleep,
    log,
    baseSeconds: 0,
    ...options,
  });

const thrown = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected the push helper to throw');
};

test('a GH013 refusal followed by success lands the push', () => {
  let pushes = 0;
  const sleeps = [];
  let rechecks = 0;
  landing({
    push: () => {
      pushes += 1;
      return pushes === 1
        ? { status: 1, stderr: rulesetRefusal('Required status check "check" is expected.') }
        : { status: 0, stdout: '', stderr: '' };
    },
    recheck: () => {
      rechecks += 1;
      return stillHead();
    },
    sleep: (seconds) => sleeps.push(seconds),
  });
  assert.equal(pushes, 2);
  assert.equal(rechecks, 1);
  assert.equal(sleeps.length, 1);
});

test('a push failure that is not the ruleset check lag fails once, with its real exit code', () => {
  let pushes = 0;
  let rechecks = 0;
  const error = thrown(() =>
    landing({
      push: () => {
        pushes += 1;
        return {
          status: 1,
          stderr: ` ! [rejected]        HEAD -> main (non-fast-forward)\nerror: failed to push some refs to 'https://github.com/xiechimon/cairn'\n`,
        };
      },
      recheck: () => {
        rechecks += 1;
        return stillHead();
      },
    }),
  );
  assert.equal(error.status, 1);
  assert.equal(pushes, 1);
  assert.equal(rechecks, 0);
});

test('a ruleset refusal that never clears gives up after the bounded attempts', () => {
  let pushes = 0;
  const error = thrown(() =>
    landing({
      attempts: 3,
      push: () => {
        pushes += 1;
        return { status: 1, stderr: rulesetRefusal('2 of 3 required status checks are expected.') };
      },
    }),
  );
  assert.equal(error.status, 1);
  assert.equal(pushes, 3);
  assert.match(error.message, /GH013/);
});

test('before each retry the candidate must still be the queue head and main must not have moved', () => {
  for (const recheck of [
    () => ({ queueHead: 'c'.repeat(40), mainTip: MAIN_TIP, landed: false }),
    () => ({ queueHead: SHA, mainTip: 'd'.repeat(40), landed: false }),
  ]) {
    let pushes = 0;
    const error = thrown(() =>
      landing({
        push: () => {
          pushes += 1;
          return {
            status: 1,
            stderr: rulesetRefusal('Required status check "e2e-gate" is expected.'),
          };
        },
        recheck,
      }),
    );
    assert.match(error.message, /moved/);
    assert.equal(error.status, 1);
    assert.equal(pushes, 1);
  }
});

test('main already containing the candidate during the backoff counts as landed', () => {
  let pushes = 0;
  landing({
    push: () => {
      pushes += 1;
      return { status: 1, stderr: rulesetRefusal('2 of 3 required status checks are expected.') };
    },
    recheck: () => ({ queueHead: SHA, mainTip: 'd'.repeat(40), landed: true }),
  });
  assert.equal(pushes, 1);
});

test('ghPages asks gh to paginate and flattens every page', () => {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    return [
      { check_runs: [{ name: 'check' }] },
      { check_runs: [{ name: 'e2e-gate' }] },
      { check_runs: [] },
    ];
  };
  assert.deepEqual(ghPages(gh, 'repos/o/r/commits/x/check-runs?per_page=100', 'check_runs'), [
    { name: 'check' },
    { name: 'e2e-gate' },
  ]);
  assert.deepEqual(calls, [
    ['--paginate', '--slurp', 'repos/o/r/commits/x/check-runs?per_page=100'],
  ]);
});
