import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closeLandedIssues,
  closingTargets,
  isCheckLagRefusal,
  ownerOf,
  pushToMain,
} from './promote-queue.mjs';

const SHA = 'a'.repeat(40);
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
const stillHead = () => ({ mainTip: MAIN_TIP, landed: false });

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

test('a retry stops when main moved during the backoff', () => {
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
      recheck: () => ({ mainTip: 'd'.repeat(40), landed: false }),
    }),
  );
  assert.match(error.message, /moved/);
  assert.equal(error.status, 1);
  assert.equal(pushes, 1);
});

test('main already containing the candidate during the backoff counts as landed', () => {
  let pushes = 0;
  landing({
    push: () => {
      pushes += 1;
      return { status: 1, stderr: rulesetRefusal('2 of 3 required status checks are expected.') };
    },
    recheck: () => ({ mainTip: 'd'.repeat(40), landed: true }),
  });
  assert.equal(pushes, 1);
});
