import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
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

const GIT_FAKE = `#!/bin/sh
echo "git $*" >> "$FAKE_DIR/calls.log"
case "$1" in
  rev-parse)
    case "$2" in
      --show-toplevel) echo "$FAKE_TOPLEVEL" ;;
      HEAD) echo "$FAKE_HEAD" ;;
      *) echo T ;;
    esac ;;
esac
exit 0
`;

const GH_FAKE = String.raw`#!/bin/sh
echo "gh $*" >> "$FAKE_DIR/calls.log"
if [ "$1" = run ] && [ "$2" = watch ]; then exit "$FAKE_WATCH_EXIT"; fi
if [ "$1" != api ]; then exit 1; fi
pick() {
  n=$(cat "$FAKE_DIR/$1.count" 2>/dev/null || echo 0)
  echo $((n + 1)) > "$FAKE_DIR/$1.count"
  i=$n
  while [ ! -f "$FAKE_DIR/$1.$i" ] && [ "$i" -gt 0 ]; do i=$((i - 1)); done
  echo "$FAKE_DIR/$1.$i"
}
answer() {
  file=$(pick "$1")
  code=$(head -n 1 "$file")
  if [ "$code" = 0 ]; then
    tail -n +2 "$file"
  else
    tail -n +2 "$file" >&2
  fi
  exit "$code"
}
case "$2" in
  *actions/runs\?*) answer search ;;
  *actions/runs/*) answer byId ;;
  *check-runs*) answer checkRuns ;;
  *comments*) echo '[]' ;;
  *) exit 1 ;;
esac
exit 0
`;

const LANE = laneName(hostname(), 'fake-wt');
const GREEN_RUNS = [
  { name: 'check', conclusion: 'success' },
  { name: 'pack-smoke', conclusion: 'success' },
  { name: 'e2e-gate', conclusion: 'success' },
];
const ciRun = (status, conclusion) => ({
  id: 4242,
  name: 'ci',
  head_sha: X,
  head_branch: `preflight/${LANE}`,
  html_url: 'https://example.invalid/actions/runs/4242',
  status,
  conclusion,
});
const answer = (code, body) =>
  `${code}\n${typeof body === 'string' ? body : JSON.stringify(body)}\n`;

const sandbox = (files) => {
  const dir = makeTestTempDir('cairn-ops-');
  const tools = { git: GIT_FAKE, gh: GH_FAKE, sleep: '#!/bin/sh\nexit 0\n' };
  for (const [name, content] of Object.entries(tools)) {
    writeFileSync(join(dir, name), content);
    chmodSync(join(dir, name), 0o755);
  }
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
};

test('the scripts read the run by id, never judge by a watch, and retry an unreadable answer', () => {
  const rows = [
    {
      name: 'preflight takes green from the completed success of that run id, not from the watch',
      script: 'preflight.mjs',
      args: ['--wait'],
      status: 0,
      search: ciRun('in_progress', null),
      byId: [ciRun('completed', 'success')],
      matches: [/\[preflight\] green/],
    },
    {
      name: 'preflight uses the last read of that run id for the verdict',
      script: 'preflight.mjs',
      args: ['--wait'],
      status: 0,
      search: ciRun('in_progress', null),
      byId: [ciRun('in_progress', null), ciRun('completed', 'success')],
      matches: [/\[preflight\] green/],
    },
    {
      name: 'preflight never calls a completed run with no conclusion red',
      script: 'preflight.mjs',
      args: ['--wait'],
      status: 1,
      search: ciRun('completed', null),
      byId: [ciRun('completed', null)],
      matches: [/could not read the run at/],
      misses: [/the run went/],
    },
    {
      name: 'preflight logs a pending run as pending, not as a failed query',
      script: 'preflight.mjs',
      args: ['--wait'],
      status: 1,
      search: ciRun('pending', null),
      byId: [ciRun('pending', null)],
      matches: [/the run is pending/],
      misses: [/query failed/],
    },
    {
      name: 'preflight reports a verdict that arrives on the final retry read',
      script: 'preflight.mjs',
      args: ['--wait'],
      status: 0,
      search: ciRun('in_progress', null),
      byId: [
        [1, 'gh: HTTP 500'],
        [1, 'gh: HTTP 500'],
        [1, 'gh: HTTP 500'],
        [1, 'gh: HTTP 500'],
        [1, 'gh: HTTP 500'],
        ciRun('completed', 'success'),
      ],
      matches: [/\[preflight\] green/],
      misses: [/could not read the run at/],
      watchCount: 1,
      byIdReads: 6,
    },
    {
      name: 'preflight starts no further watch after a read that failed',
      script: 'preflight.mjs',
      args: ['--wait'],
      status: 1,
      byId: [[1, 'gh: HTTP 500']],
      matches: [/could not read the run at/],
      watchCount: 1,
    },
    {
      name: 'preflight re-reads the run before watching again, so a run finished during the sleep is watched once',
      script: 'preflight.mjs',
      args: ['--wait'],
      status: 0,
      search: ciRun('in_progress', null),
      byId: [ciRun('in_progress', null), ciRun('completed', 'success')],
      matches: [/\[preflight\] green/],
      watchCount: 1,
    },
    {
      name: 'push-queue retries an unreadable check-runs answer and never arms a preflight push',
      script: 'push-queue.mjs',
      args: ['--wait'],
      status: 2,
      checkRuns: [[1, 'gh: HTTP 500']],
      matches: [/could not read the check runs/],
      calls: /push --force-with-lease/,
      env: { PUSH_QUEUE_WAIT_MINUTES: '0.03', PUSH_QUEUE_POLL_SECONDS: '0' },
    },
    {
      name: 'push-queue uses the check runs it read, so a failed second read never becomes absent evidence',
      script: 'push-queue.mjs',
      args: ['--wait'],
      status: 1,
      checkRuns: [
        [0, { check_runs: GREEN_RUNS }],
        [1, 'gh: HTTP 500'],
      ],
      misses: [/still waiting on/],
      calls: /push --force-with-lease/,
      env: { PUSH_QUEUE_WAIT_MINUTES: '0.03', PUSH_QUEUE_POLL_SECONDS: '0' },
    },
  ];
  for (const row of rows) {
    const dir = sandbox({
      'search.0': answer(0, { workflow_runs: [row.search ?? ciRun('completed', 'success')] }),
      ...Object.fromEntries(
        (row.byId ?? [ciRun('completed', 'success')]).map((entry, index) => [
          `byId.${index}`,
          Array.isArray(entry) ? answer(entry[0], entry[1]) : answer(0, entry),
        ]),
      ),
      ...Object.fromEntries(
        (row.checkRuns ?? [[0, { check_runs: GREEN_RUNS }]]).map((entry, index) => [
          `checkRuns.${index}`,
          answer(entry[0], entry[1]),
        ]),
      ),
    });
    try {
      const result = spawnSync(
        process.execPath,
        [join(import.meta.dirname, row.script), ...row.args],
        {
          cwd: dir,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            FAKE_DIR: dir,
            FAKE_TOPLEVEL: '/tmp/fake-wt',
            FAKE_HEAD: X,
            FAKE_WATCH_EXIT: String(row.watchExit ?? 1),
            ...row.env,
          },
        },
      );
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.status, row.status, `${row.name}\n${output}`);
      for (const pattern of row.matches ?? []) assert.match(output, pattern, row.name);
      for (const pattern of row.misses ?? []) assert.doesNotMatch(output, pattern, row.name);
      const calls = existsSync(join(dir, 'calls.log'))
        ? readFileSync(join(dir, 'calls.log'), 'utf8')
        : '';
      if (row.calls) assert.doesNotMatch(calls, row.calls, row.name);
      if (row.watchCount !== undefined) {
        assert.equal(
          (calls.match(/^gh run watch /gm) ?? []).length,
          row.watchCount,
          `${row.name}\n${calls}`,
        );
      }
      if (row.byIdReads !== undefined) {
        assert.equal(
          (calls.match(/\/actions\/runs\/4242/g) ?? []).length,
          row.byIdReads,
          `${row.name}\n${calls}`,
        );
      }
    } finally {
      releaseTestTempDir(dir);
    }
  }
});
