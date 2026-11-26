import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  cancelSupersededRuns,
  fastGateInvocation,
  isActivePreflightRun,
  MAX_CONCURRENT_PREFLIGHT_RUNS,
  preflightCapacityDecision,
  preflightRef,
  preflightRun,
  runFastGateBeforePush,
  waitForPreflightCapacity,
  watchVerdict,
} from './preflight.mjs';
import {
  classifyWaitStatus,
  commitCommentsApiArgs,
  failedGreenContexts,
  fetchCheckRuns,
  isTransientGitNetworkError,
  laneName,
  missingGreenContexts,
  pollWaitStep,
  preflightEvidence,
  stampCommand,
  unownedCommits,
} from './push-queue.mjs';

const X = 'a'.repeat(40);

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

test('fetchCheckRuns paginates so a green check on a later page still counts', () => {
  const seen = [];
  const runs = fetchCheckRuns({
    repo: 'o/r',
    sha: X,
    gh: (args) => {
      seen.push(args);
      return [
        {
          check_runs: [
            { name: 'check', conclusion: 'success' },
            { name: 'pack-smoke', conclusion: 'success' },
          ],
        },
        { check_runs: [{ name: 'e2e-gate', conclusion: 'success' }] },
      ];
    },
  });
  assert.deepEqual(missingGreenContexts(runs), []);
  assert.ok(seen[0].includes('--paginate') && seen[0].includes('--slurp'));
});

test('fetchCheckRuns returns null when the commit is unknown to GitHub', () => {
  assert.equal(
    fetchCheckRuns({
      repo: 'o/r',
      sha: X,
      gh: () => {
        throw new Error('gh: No commit found for the ref (HTTP 404)');
      },
    }),
    null,
  );
});

test('preflight stamps unowned commits with Lane: before pushing the preflight ref', () => {
  const root = makeTestTempDir('preflight-stamp-');
  try {
    const bare = join(root, 'origin.git');
    const work = join(root, 'wt');
    const bin = join(root, 'bin');
    mkdirSync(bare, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    git(bare, ['init', '--bare', '-b', 'main']);
    git(root, ['clone', bare, work]);
    git(work, ['config', 'user.email', 'test@example.com']);
    git(work, ['config', 'user.name', 'Test']);
    git(work, ['commit', '--allow-empty', '-m', 'init']);
    git(work, ['push', '-u', 'origin', 'main']);
    mkdirSync(join(work, 'scripts/ops'), { recursive: true });
    for (const file of [
      'ops/preflight-fast-gate.mjs',
      'test-admission.mjs',
      'heavy-slots.mjs',
      'owned-process.mjs',
    ]) {
      copyFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', file),
        join(work, 'scripts', file),
      );
      git(work, ['add', `scripts/${file}`]);
    }
    git(work, ['commit', '-m', 'add fast gate']);
    git(work, ['push', 'origin', 'main']);
    git(work, ['checkout', '-b', 'feature']);
    git(work, ['commit', '--allow-empty', '-m', 'unowned change']);

    const ghStub = join(bin, 'gh');
    writeFileSync(
      ghStub,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const apiArg = args.find((a) => a.includes('head_sha=')) || '';
const sha = (apiArg.match(/head_sha=([0-9a-f]+)/) || [])[1] || '';
const branch = process.env.EXPECTED_PREFLIGHT_REF || '';
console.log(JSON.stringify({ workflow_runs: [{ name: 'ci', head_sha: sha, head_branch: branch, html_url: 'https://example/run/1' }] }));
`,
    );
    chmodSync(ghStub, 0o755);
    const pnpmStub = join(bin, 'pnpm');
    writeFileSync(pnpmStub, '#!/bin/sh\nexit 0\n');
    chmodSync(pnpmStub, 0o755);
    mkdirSync(join(root, 'home'), { recursive: true });

    const preflightScript = join(dirname(fileURLToPath(import.meta.url)), 'preflight.mjs');
    const run = spawnSync(process.execPath, [preflightScript], {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        EXPECTED_PREFLIGHT_REF: `preflight/${laneName(execFileSync('hostname', { encoding: 'utf8' }).trim(), 'wt')}`,
        CAIRN_PREFLIGHT_GATE_WRAPPER: '',
      },
    });
    assert.equal(run.status, 0, run.stderr);
    const body = git(work, ['log', '-1', '--format=%B', 'HEAD']);
    assert.match(body, /^Lane:\s+\S+\/wt$/m);
    const headSha = git(work, ['rev-parse', 'HEAD']);
    const lane = laneName(execFileSync('hostname', { encoding: 'utf8' }).trim(), 'wt');
    const remoteSha = git(work, ['ls-remote', 'origin', preflightRef(lane)]).split(/\s+/)[0];
    assert.equal(remoteSha, headSha);
  } finally {
    releaseTestTempDir(root);
  }
});

test('stamp-then-preflight produces exact-SHA evidence for train admission', () => {
  const stampedSha = 'c'.repeat(40);
  const tree = 't'.repeat(40);
  const evidence = preflightEvidence({
    shas: [stampedSha],
    pushedTree: tree,
    treeOf: () => tree,
    checkRunsOf: (sha) =>
      sha === stampedSha
        ? [
            { name: 'check', conclusion: 'success' },
            { name: 'pack-smoke', conclusion: 'success' },
            { name: 'e2e-gate', conclusion: 'success' },
          ]
        : null,
  });
  assert.deepEqual(evidence, { ok: true, sha: stampedSha });
});

test('classifyWaitStatus distinguishes landed (including rebased cherry), queued, and ejected', () => {
  assert.deepEqual(
    classifyWaitStatus({ stillQueued: false, onMain: true, cherryHasUnapplied: false }),
    {
      state: 'landed',
    },
  );
  assert.deepEqual(
    classifyWaitStatus({ stillQueued: false, onMain: false, cherryHasUnapplied: false }),
    {
      state: 'landed',
    },
  );
  assert.deepEqual(
    classifyWaitStatus({ stillQueued: true, onMain: false, cherryHasUnapplied: true }),
    {
      state: 'queued',
    },
  );
  assert.deepEqual(
    classifyWaitStatus({ stillQueued: false, onMain: false, cherryHasUnapplied: true }),
    {
      state: 'ejected',
    },
  );
  assert.deepEqual(
    classifyWaitStatus({
      stillQueued: false,
      onMain: false,
      cherryHasUnapplied: true,
      ejectedByComment: false,
      matchedOnMainBySignature: false,
    }),
    {
      state: 'ejected',
    },
  );
  assert.deepEqual(
    classifyWaitStatus({
      stillQueued: false,
      onMain: false,
      cherryHasUnapplied: true,
      ejectedByComment: false,
      matchedOnMainBySignature: true,
    }),
    {
      state: 'landed',
    },
  );
  assert.deepEqual(
    classifyWaitStatus({
      stillQueued: false,
      onMain: false,
      cherryHasUnapplied: true,
      ejectedByComment: true,
      matchedOnMainBySignature: true,
    }),
    {
      state: 'ejected',
    },
  );
});

test('commitCommentsApiArgs includes gh api subcommand so --wait reads ejection comments', () => {
  assert.deepEqual(commitCommentsApiArgs('xiechimon/cairn', X), [
    'api',
    `repos/xiechimon/cairn/commits/${X}/comments?per_page=20`,
  ]);
});

test('isTransientGitNetworkError and pollWaitStep retry transient TLS or network failures instead of aborting --wait', () => {
  assert.equal(
    isTransientGitNetworkError(
      new Error(
        'fatal: unable to access https://github.com: LibreSSL SSL_connect: SSL_ERROR_SYSCALL',
      ),
    ),
    true,
  );
  assert.equal(isTransientGitNetworkError(new Error('gh: HTTP 403 (secondary throttle)')), true);
  assert.equal(isTransientGitNetworkError(new Error('fatal: bad revision HEAD')), false);

  const truncatedListing = Object.assign(new Error('Command failed: git ls-remote origin'), {
    stderr:
      'error: RPC failed; curl 18 Transferred a partial file\nerror: 5 bytes of body are still expected\nfatal: expected flush after ref listing\n',
  });
  assert.equal(isTransientGitNetworkError(truncatedListing), true);

  const transient = pollWaitStep({
    fetchMain: () => {
      throw new Error(
        "fatal: unable to access 'https://github.com/xiechimon/cairn.git/': LibreSSL SSL_connect: SSL_ERROR_SYSCALL",
      );
    },
    listQueue: () => ({ entries: [], mainSha: null }),
    isOnMain: () => false,
    hasUnappliedCherry: () => true,
    readRemovalNote: () => null,
    sleep: () => {},
  });
  assert.equal(transient.state, 'retry');
  assert.match(transient.reason, /SSL_ERROR_SYSCALL/);

  assert.throws(() =>
    pollWaitStep({
      fetchMain: () => {
        throw new Error('fatal: repository is corrupt');
      },
      listQueue: () => ({ entries: [], mainSha: null }),
      isOnMain: () => false,
      hasUnappliedCherry: () => true,
      readRemovalNote: () => null,
      sleep: () => {},
      initialMainSha: X,
    }),
  );
});

test('preflight capacity counts only active preflight runs and admits below two', () => {
  assert.equal(MAX_CONCURRENT_PREFLIGHT_RUNS, 2);
  for (const status of ['queued', 'in_progress', 'waiting', 'requested']) {
    assert.equal(isActivePreflightRun({ status, head_branch: 'preflight/a' }), true);
  }
  assert.equal(isActivePreflightRun({ status: 'completed', head_branch: 'preflight/a' }), false);
  assert.equal(isActivePreflightRun({ status: 'queued', head_branch: 'queue/try/a' }), false);
  assert.equal(isActivePreflightRun({ status: 'in_progress', head_branch: 'main' }), false);

  assert.deepEqual(preflightCapacityDecision({ activeCount: 0 }), { action: 'push' });
  assert.deepEqual(preflightCapacityDecision({ activeCount: 1 }), { action: 'push' });
  assert.deepEqual(preflightCapacityDecision({ activeCount: 2 }), {
    action: 'wait',
    activeCount: 2,
    maxRuns: 2,
  });
  assert.deepEqual(preflightCapacityDecision({ activeCount: 3, bypass: true }), { action: 'push' });
});

test('waitForPreflightCapacity waits for a free slot and degrades open when the count API fails', () => {
  const pages = [
    [
      { status: 'queued', head_branch: 'preflight/a' },
      { status: 'in_progress', head_branch: 'preflight/b' },
    ],
    [{ status: 'in_progress', head_branch: 'preflight/a' }],
  ];
  const sleeps = [];
  let calls = 0;
  const waited = waitForPreflightCapacity({
    repo: 'o/r',
    gh: () => {
      calls += 1;
      return { workflow_runs: pages[Math.floor((calls - 1) / 4) === 0 ? 0 : 1] ?? [] };
    },
    sleep: (seconds) => sleeps.push(seconds),
    log: () => {},
    pollSeconds: 1,
  });
  assert.equal(waited.ok, true);
  assert.equal(waited.activeCount, 1);
  assert.deepEqual(sleeps, [1]);

  const degraded = waitForPreflightCapacity({
    repo: 'o/r',
    gh: () => {
      throw new Error('api down');
    },
    sleep: () => {},
    log: () => {},
  });
  assert.deepEqual(degraded, { ok: true, degraded: true });
});

test('preflight fast gate invokes preflight-fast-gate locally or via CAIRN_PREFLIGHT_GATE_WRAPPER', () => {
  const local = fastGateInvocation({ env: {} });
  assert.equal(local.command, process.execPath);
  assert.deepEqual(local.args, ['scripts/ops/preflight-fast-gate.mjs']);
  assert.equal(local.runner, 'local exact tree');

  const wrapped = fastGateInvocation({ env: { CAIRN_PREFLIGHT_GATE_WRAPPER: 'runner --' } });
  assert.equal(wrapped.command, process.execPath);
  assert.deepEqual(wrapped.args, ['scripts/ops/preflight-fast-gate.mjs']);
  assert.equal(wrapped.runner, 'CAIRN_PREFLIGHT_GATE_WRAPPER');

  const calls = [];
  const result = runFastGateBeforePush({
    root: '/wt',
    invocation: wrapped,
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.equal(result.status, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cwd, '/wt');
});

test('a new preflight push cancels only the still-active older runs on the same lane ref', () => {
  const run = (id, patch) => ({
    id,
    name: 'ci',
    status: 'in_progress',
    head_branch: 'preflight/host/lane',
    head_sha: 'a'.repeat(40),
    ...patch,
  });
  const calls = [];
  const cancelled = cancelSupersededRuns({
    repo: 'xiechimon/cairn',
    ref: 'preflight/host/lane',
    sha: 'b'.repeat(40),
    gh: (args) => {
      calls.push(args.at(-1));
      return {
        workflow_runs: [
          run(1, {}),
          run(2, { status: 'queued' }),
          run(3, { status: 'completed' }),
          run(4, { head_sha: 'b'.repeat(40) }),
          run(5, { head_branch: 'preflight/host/other' }),
          run(6, { name: 'promote' }),
        ],
      };
    },
    cancel: (id) => id !== 2,
    log: () => {},
  });
  assert.deepEqual(cancelled, [1]);
  assert.match(calls[0], /branch=preflight%2Fhost%2Flane/);
});

test('an unreadable run list never blocks a preflight push', () => {
  const cancelled = cancelSupersededRuns({
    repo: 'xiechimon/cairn',
    ref: 'preflight/host/lane',
    sha: 'b'.repeat(40),
    gh: () => {
      throw new Error('HTTP 502');
    },
    cancel: () => assert.fail('nothing to cancel'),
    log: () => {},
  });
  assert.deepEqual(cancelled, []);
});

test('a superseded run whose sha is already queued keeps running', () => {
  const run = (id, head_sha) => ({
    id,
    name: 'ci',
    status: 'in_progress',
    head_branch: 'preflight/host/lane',
    head_sha,
  });
  const cancelled = cancelSupersededRuns({
    repo: 'xiechimon/cairn',
    ref: 'preflight/host/lane',
    sha: 'b'.repeat(40),
    keepShas: new Set(['c'.repeat(40)]),
    gh: () => ({ workflow_runs: [run(1, 'a'.repeat(40)), run(2, 'c'.repeat(40))] }),
    cancel: () => true,
    log: () => {},
  });
  assert.deepEqual(cancelled, [1]);
});

test('runs this push is about to replace do not count against the preflight cap', () => {
  const run = (id, head_branch) => ({ id, name: 'ci', status: 'in_progress', head_branch });
  const verdict = waitForPreflightCapacity({
    repo: 'xiechimon/cairn',
    gh: () => ({
      workflow_runs: [run(1, 'preflight/host/lane'), run(2, 'preflight/host/other')],
    }),
    sleep: () => assert.fail('must not wait on its own stale run'),
    replaced: (item) => item.head_branch === 'preflight/host/lane',
    log: () => {},
  });
  assert.deepEqual(verdict, { ok: true, activeCount: 1 });
});
