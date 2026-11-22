import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { readable, unreadable } from './poll-read.mjs';
import { laneName, preflightRef, preflightRuns, watchVerdict } from './preflight.mjs';
import {
  failedGreenContexts,
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
  const green = readable([
    run('check', 'success'),
    run('pack-smoke', 'success'),
    run('e2e-gate', 'success'),
  ]);
  const missing = readable({ ok: false, failed: [] });
  assert.deepEqual(
    preflightEvidence({
      shas: ['aaa', 'bbb'],
      pushedTree: 'T',
      treeOf: (sha) => readable(sha === 'bbb' ? 'T' : 'other'),
      checkRunsOf: () => green,
    }),
    readable({ ok: true, sha: 'bbb', failed: [] }),
  );
  assert.deepEqual(
    preflightEvidence({
      shas: ['aaa'],
      pushedTree: 'T',
      treeOf: () => readable('other'),
      checkRunsOf: () => green,
    }),
    missing,
  );
  const evidence = (shas, checkRunsOf) =>
    preflightEvidence({ shas, pushedTree: 'T', treeOf: () => readable('T'), checkRunsOf });
  assert.deepEqual(
    evidence(['local-stamp', 'preflighted'], (sha) =>
      sha === 'local-stamp' ? readable([]) : green,
    ),
    readable({ ok: true, sha: 'preflighted', failed: [] }),
  );
  assert.deepEqual(
    evidence(['local-stamp'], () => readable([])),
    missing,
  );
  assert.deepEqual(
    evidence(['aaa'], () => readable([run('check', 'success')])),
    missing,
  );
  assert.deepEqual(
    evidence(['aaa'], () => unreadable('check runs')),
    unreadable('check runs'),
  );
});

test('the verdict comes only from a completed run with a conclusion', () => {
  assert.deepEqual(watchVerdict(readable({ status: 'completed', conclusion: 'success' })), {
    verdict: 'green',
    conclusion: 'success',
  });
  assert.deepEqual(watchVerdict(readable({ status: 'completed', conclusion: 'failure' })), {
    verdict: 'red',
    conclusion: 'failure',
  });
  assert.equal(
    watchVerdict(readable({ status: 'in_progress', conclusion: null })).verdict,
    'pending',
  );
  assert.equal(
    watchVerdict(readable({ status: 'completed', conclusion: null })).verdict,
    'pending',
  );
  assert.equal(watchVerdict(unreadable('run state')).verdict, 'unreadable');
});

test('the pre-flight ref and run lookup are lane-scoped', () => {
  assert.equal(preflightRef('mac/wt'), 'refs/heads/preflight/mac/wt');
  const ci = {
    name: 'ci',
    head_sha: 'S',
    head_branch: 'preflight/mac/wt',
    html_url: 'https://example/run/1',
    path: '.github/workflows/ci.yml',
    event: 'push',
    created_at: '2026-11-22T12:00:01Z',
  };
  const startedAt = Date.parse('2026-11-22T12:00:00Z');
  assert.deepEqual(
    preflightRuns([{ ...ci, head_branch: 'queue/main' }, ci], 'S', 'preflight/mac/wt', startedAt),
    [ci],
  );
  assert.deepEqual(preflightRuns([ci], 'S', 'preflight/other/wt', startedAt), []);
  assert.deepEqual(preflightRuns([ci], 'S', 'preflight/mac/wt', Date.parse(ci.created_at)), []);
});

test('--wait rebases onto the live candidate, arms preflight once, then polls', () => {
  const base = {
    live: X,
    headOnLive: false,
    deadBase: false,
    head: 'sha1',
    armedSha: null,
    evidence: { ok: false },
    failed: [],
  };
  assert.deepEqual(nextWaitAction(base), { action: 'rebase', onto: X });
  assert.deepEqual(nextWaitAction({ ...base, headOnLive: true }), { action: 'preflight' });
  assert.deepEqual(nextWaitAction({ ...base, headOnLive: true, armedSha: 'sha1' }), {
    action: 'poll',
  });
  assert.deepEqual(
    nextWaitAction({ ...base, headOnLive: true, armedSha: 'sha1', failed: ['check'] }),
    { action: 'fail', contexts: ['check'] },
  );
});

test('--wait on a freed queue rebases off a dropped base, waits for evidence, then pushes', () => {
  const base = {
    live: null,
    headOnLive: false,
    deadBase: true,
    head: 'sha1',
    armedSha: 'sha1',
    evidence: { ok: false },
    failed: [],
  };
  assert.deepEqual(nextWaitAction(base), { action: 'rebase', onto: 'origin/main' });
  assert.deepEqual(nextWaitAction({ ...base, deadBase: false, failed: ['e2e-gate'] }), {
    action: 'fail',
    contexts: ['e2e-gate'],
  });
  assert.deepEqual(nextWaitAction({ ...base, deadBase: false, armedSha: 'sha2' }), {
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

function runWithFakes(script, scenario, settings = {}) {
  const cwd = makeTestTempDir('cairn-queue-');
  const statePath = join(cwd, 'state.json');
  try {
    writeFileSync(
      statePath,
      JSON.stringify({
        now: 100_000,
        watches: 0,
        verdictReads: 0,
        snapshots: 0,
        checks: 0,
        calls: [],
      }),
    );
    const { error, status, stdout, stderr } = spawnSync(
      process.execPath,
      [
        '--require',
        join(import.meta.dirname, 'fixtures/queue-commands.cjs'),
        join(import.meta.dirname, `${script}.mjs`),
        '--wait',
      ],
      {
        cwd,
        timeout: 20_000,
        encoding: 'utf8',
        env: {
          ...process.env,
          CAIRN_REPO: 'test-owner/test-repo',
          PUSH_QUEUE_WAIT_MINUTES: '1',
          PUSH_QUEUE_POLL_SECONDS: '15',
          QUEUE_TEST_SCENARIO: scenario,
          ...settings,
        },
      },
    );
    assert.ifError(error);
    return { status, output: stdout + stderr, ...JSON.parse(readFileSync(statePath, 'utf8')) };
  } finally {
    releaseTestTempDir(cwd);
  }
}

for (const [name, scenario, verify] of [
  [
    '1: the watched run id wins over a different run for the same sha and ref',
    'duplicate-run',
    (result) => {
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /went failure: https:\/\/example\.test\/runs\/100/);
    },
  ],
  [
    '2: a successful retry watch still requires a conclusion from GitHub',
    'retry-exit',
    (result) => {
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /went failure/);
      assert.equal(result.watches, 2);
    },
  ],
  [
    '3: completed with no conclusion is not red',
    'missing-conclusion',
    (result) => {
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /green/);
      assert.doesNotMatch(result.output, /went null/);
    },
  ],
  [
    '4: the last retry can return a terminal conclusion',
    'last-retry',
    (result) => {
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /went failure/);
      assert.equal(result.watches, 6);
    },
  ],
  [
    '5: discovery, watch and retry all use the selected repository',
    'repo',
    (result) => {
      assert.equal(result.status, 0, result.output);
      assert.equal(result.watches, 2);
      const gh = result.calls.filter(([command]) => command === 'gh');
      assert.ok(
        gh.every((call) => call.some((arg) => arg.includes('test-owner/test-repo'))),
        JSON.stringify(gh),
      );
    },
  ],
  [
    '6: a readable in-progress result is not a query error',
    'progress',
    (result) => {
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /in.progress/);
      assert.doesNotMatch(result.output, /query failed|watch exited/);
    },
  ],
]) {
  test(name, () => verify(runWithFakes('preflight', scenario)));
}

for (const [item, scenario] of [
  ['7: an unreadable first queue read retries', 'initial-read'],
  ['7: an unreadable final check-runs read retries', 'final-read'],
  ['8: a failed fetch is not a live candidate', 'fetch'],
  ['8: an ancestry error is not a negative ancestry result', 'ancestry'],
  ['8: an unreadable release marker is not an absent marker', 'release'],
  ['9: an unreadable second check-runs read cannot arm preflight', 'duplicate-check-read'],
  ['10: the preflight push need not discover its run', 'no-child-run'],
]) {
  test(item, () => {
    const result = runWithFakes('push-queue', scenario);
    assert.equal(result.status, 0, result.output);
    assert.equal(
      result.calls.filter((call) => call.includes(`${X}:refs/heads/queue/main`)).length,
      1,
    );
    assert.equal(result.calls.filter((call) => call[1] === 'rebase').length, 0);
    assert.equal(Boolean(result.pushedPreflight), scenario === 'no-child-run');
    if (scenario === 'final-read') assert.equal(result.failedFinal, true);
  });
}

for (const scenario of ['slow', 'slow-error', 'slow-green', 'sleep-limit']) {
  test(`11: the deadline bounds ${scenario} and reports what was blocking`, () => {
    const result = runWithFakes('push-queue', scenario);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /wait deadline reached/);
    if (scenario === 'sleep-limit') assert.match(result.output, /could not read the queue/);
    else if (scenario === 'slow-green') assert.doesNotMatch(result.output, /green evidence/);
    else assert.match(result.output, /last known live candidate: bbbbbbbbb/i);
    assert.equal(result.now, 160_000);
    assert.equal(result.calls.filter((call) => ['push', 'rebase'].includes(call[1])).length, 0);
  });
}

test('review 2: same-tree fallback cannot bypass an unreadable or failed HEAD', () => {
  const failure = unreadable('HEAD check runs');
  const green = readable(
    ['check', 'pack-smoke', 'e2e-gate'].map((name) => ({ name, conclusion: 'success' })),
  );
  for (const [primary, expected] of [
    [failure, failure],
    [
      readable([{ name: 'check', conclusion: 'failure' }]),
      readable({ ok: false, failed: ['check'] }),
    ],
  ]) {
    const read = [];
    assert.deepEqual(
      preflightEvidence({
        shas: ['HEAD-sha', 'previous-sha'],
        pushedTree: 'T',
        treeOf: () => readable('T'),
        checkRunsOf: (sha) => {
          read.push(sha);
          return sha === 'HEAD-sha' ? primary : green;
        },
      }),
      expected,
    );
    assert.deepEqual(read, ['HEAD-sha']);
  }
});

test('review 3: preflight waits for a new ci push run; a no-op has no new verdict', () => {
  const fresh = runWithFakes('preflight', 'stale-run');
  assert.equal(fresh.status, 1, fresh.output);
  assert.match(fresh.output, /went failure: https:\/\/example\.test\/runs\/100/);
  assert.deepEqual(
    fresh.calls.filter((call) => call[2] === 'watch').map((call) => call[3]),
    ['100'],
  );
  const noop = runWithFakes('preflight', 'noop');
  assert.equal(noop.status, 2, noop.output);
  assert.match(noop.output, /already.*no new ci run/i);
  assert.equal(noop.watches, 0);
});

test('review 4: both pushes use the captured SHA instead of the symbolic HEAD', () => {
  const preflight = runWithFakes('preflight', 'normal');
  const queue = runWithFakes('push-queue', 'normal');
  assert.equal(preflight.status, 0, preflight.output);
  assert.equal(queue.status, 0, queue.output);
  assert.ok(
    preflight.calls.some(
      (call) => call.at(-1) === `${X}:refs/heads/preflight/test-host/test-worktree`,
    ),
  );
  assert.ok(queue.calls.some((call) => call.at(-1) === `${X}:refs/heads/queue/main`));
});

test('review 6: watch is deadline-bound and invalid queue settings are refused before any commands', () => {
  const stuck = runWithFakes('preflight', 'watch-timeout');
  assert.equal(stuck.watches, 1, stuck.output);
  assert.ok(stuck.now <= 100_000 + 120 * 60_000, stuck.output);
  assert.equal(stuck.status, 2, stuck.output);
  const gate = runWithFakes('push-queue', 'gate-timeout');
  assert.equal(gate.status, 2, gate.output);
  assert.equal(gate.now, 160_000);
  assert.match(gate.output, /Timed out during English-only gate/);
  for (const [name, value] of [
    ['PUSH_QUEUE_WAIT_MINUTES', 'oops'],
    ['PUSH_QUEUE_WAIT_MINUTES', '0'],
    ['PUSH_QUEUE_POLL_SECONDS', 'oops'],
    ['PUSH_QUEUE_POLL_SECONDS', '-2'],
  ]) {
    const invalid = runWithFakes('push-queue', 'normal', { [name]: value });
    assert.equal(invalid.status, 1, invalid.output);
    assert.match(invalid.output, new RegExp(name));
    assert.deepEqual(invalid.calls, []);
  }
});

test('review 8: a live base already in HEAD is removed if it drops', () => {
  for (const scenario of ['startup-base', 'startup-base-unreadable']) {
    const result = runWithFakes('push-queue', scenario);
    assert.equal(result.status, 0, result.output);
    const rebase = result.calls.find((call) => call[1] === 'rebase');
    assert.deepEqual(rebase, ['git', 'rebase', '--onto', 'origin/main', 'b'.repeat(40)]);
  }
});

test('review 9: a rebased SHA with the armed tree but no usable evidence starts CI', () => {
  const result = runWithFakes('push-queue', 'rebase-same-tree');
  assert.equal(result.status, 0, result.output);
  const refspecs = result.calls.filter((call) => call[1] === 'push').map((call) => call.at(-1));
  const preflight = ':refs/heads/preflight/test-host/test-worktree';
  assert.deepEqual(refspecs, [
    `${'c'.repeat(40)}${preflight}`,
    `${'d'.repeat(40)}${preflight}`,
    `${'d'.repeat(40)}:refs/heads/queue/main`,
  ]);
});

test('review 11: preflight exit 2 means no verdict, while exit 1 means red', () => {
  const pending = runWithFakes('preflight', 'no-verdict');
  assert.equal(pending.status, 2, pending.output);
  assert.match(pending.output, /no verdict/i);
  const red = runWithFakes('preflight', 'retry-exit');
  assert.equal(red.status, 1, red.output);
  assert.match(red.output, /went failure/);
});

test('review 12: a check failure observed at the deadline remains in the timeout reason', () => {
  const result = runWithFakes('push-queue', 'slow-red');
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /deadline.*(?:fail|without success).*pack-smoke/i);
  assert.equal(
    result.calls.some((call) => call[1] === 'push'),
    false,
  );
});
