import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  cancelSupersededRuns,
  evaluateGreenRerunGuard,
  extractCiFailedTestFiles,
  fastGateInvocation,
  isActivePreflightRun,
  MAX_CONCURRENT_PREFLIGHT_RUNS,
  PREFLIGHT_PUSH_POOL,
  parsePreflightArgs,
  preflightCapacityDecision,
  preflightRef,
  preflightRun,
  runFastGateBeforePush,
  upsertPreflightReason,
  waitForPreflightCapacity,
  watchVerdict,
  withPreflightAdmission,
} from './preflight.mjs';
import {
  classifyWaitStatus,
  commitCommentsApiArgs,
  failedGreenContexts,
  fetchCheckRuns,
  isTransientGitNetworkError,
  laneName,
  machineLaneId,
  missingGreenContexts,
  pollWaitStep,
  preflightEvidence,
  resolveRebaseOnlyEvidence,
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

test('the lane name is machine id and worktree, safe for a trailer and a shell quote', () => {
  assert.equal(
    laneName('m-0123abcd', 'ecstatic-brahmagupta-aee8fe'),
    'm-0123abcd/ecstatic-brahmagupta-aee8fe',
  );
  assert.equal(laneName("my id's", 'wt dir'), 'my-id-s/wt-dir');
  assert.match(stampCommand('mac/wt'), /--trailer 'Lane: mac\/wt'/);
});

test('a machine keeps one lane id, two machines differ, and a damaged id is refused', () => {
  const root = makeTestTempDir('lane-id-');
  try {
    const id = machineLaneId(join(root, 'a'));
    assert.equal(machineLaneId(join(root, 'a')), id);
    assert.notEqual(machineLaneId(join(root, 'b')), id);
    writeFileSync(join(root, 'a/.config/cairn-dev/lane-machine-id'), 'my-host.local\n');
    assert.throws(() => machineLaneId(join(root, 'a')), /delete it and run again/);
  } finally {
    releaseTestTempDir(root);
  }
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

test('preflight and push-queue stamp unowned commits with the same machine lane', () => {
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
      'ops/revert-guard.mjs',
      'ops/secret-scan.mjs',
      'test-admission.mjs',
      'heavy-slots.mjs',
      'owned-process.mjs',
      'diff-base.mjs',
      'plan-spec.mjs',
      'regression-inversion-gate.mjs',
      'prepush.mjs',
      'ci-failed-only-state.mjs',
      'scrub-git-env.mjs',
    ]) {
      copyFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', file),
        join(work, 'scripts', file),
      );
      git(work, ['add', `scripts/${file}`]);
    }
    symlinkSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../node_modules'),
      join(root, 'node_modules'),
    );
    for (const [file, text] of [
      [
        '.github/workflows/ci.yml',
        'jobs:\n  c:\n    steps:\n      - run: node scripts/stub-gate.mjs\n',
      ],
      ['scripts/stub-gate.mjs', ''],
    ]) {
      mkdirSync(dirname(join(work, file)), { recursive: true });
      writeFileSync(join(work, file), text);
      git(work, ['add', file]);
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
const id = require('node:fs').readFileSync(process.env.HOME + '/.config/cairn-dev/lane-machine-id', 'utf8').trim();
const branch = 'preflight/' + id + '/wt';
const checkRunsSha = args.join(' ').match(/commits\\/([0-9a-f]+)\\/check-runs/)?.[1];
const git = (...a) => require('node:child_process').execFileSync('git', a, { encoding: 'utf8' }).trim();
const during = process.env.STUB_COMMIT_DURING;
const queries = { wait: 'status=queued', lookup: 'head_sha=', watch: 'watch' };
if (queries[during] && args.some((a) => a.includes(queries[during]))) {
  if (git('log', '-1', '--format=%s') !== 'during ' + during) git('commit', '-q', '--allow-empty', '-m', 'during ' + during);
}
if (during === 'gate' && args.some((a) => a.includes('status=queued'))) {
  console.error('asked for a CI slot for a HEAD that had already moved');
}
let checkRuns = [];
if (process.env.STUB_QUEUE && checkRunsSha && git('ls-remote', 'origin', 'refs/heads/preflight/*').startsWith(checkRunsSha)) {
  if (git('log', '-1', '--format=%s', checkRunsSha) === 'reworded after arming') {
    checkRuns = ['check', 'pack-smoke', 'e2e-gate'].map((name) => ({ name, conclusion: 'success' }));
  } else if (git('log', '-1', '--format=%s') !== 'reworded after arming') {
    git('commit', '-q', '--allow-empty', '-m', 'reworded after arming');
  }
}
if (process.env.STUB_QUEUE && args.some((a) => a.includes('head_sha='))) {
  if (git('log', '-1', '--format=%s') === 'during push') {
    git('commit', '-q', '--allow-empty', '-m', 'moved during child preflight');
  }
}
if (process.env.STUB_QUEUE && args.some((a) => a.endsWith('/dispatches'))) {
  git('push', '-q', '--no-follow-tags', 'origin', 'HEAD:refs/heads/main');
}
console.log(JSON.stringify(checkRunsSha ? [{ check_runs: checkRuns }] : { workflow_runs: [{ id: 1, name: 'ci', head_sha: sha, head_branch: branch, html_url: 'https://example/run/1', status: 'completed', conclusion: 'success' }] }));
`,
    );
    chmodSync(ghStub, 0o755);
    const pnpmStub = join(bin, 'pnpm');
    writeFileSync(
      pnpmStub,
      '#!/bin/sh\nif [ "$STUB_COMMIT_DURING $1" = "gate lint" ]; then git commit -q --allow-empty -m "during gate"; fi\n',
    );
    chmodSync(pnpmStub, 0o755);
    const gitleaksStub = join(bin, 'gitleaks');
    writeFileSync(
      gitleaksStub,
      '#!/bin/sh\ncat > /dev/null\nif [ -n "$STUB_LEAKS" ]; then exit "$STUB_LEAKS"; fi\n',
    );
    chmodSync(gitleaksStub, 0o755);
    const home = join(root, 'home');
    mkdirSync(home, { recursive: true });

    const preflightScript = join(dirname(fileURLToPath(import.meta.url)), 'preflight.mjs');
    const stubbedEnv = (extraEnv) => ({
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      CAIRN_PREFLIGHT_GATE_WRAPPER: '',
      CAIRN_HEAVY_SLOTS_DIR: join(root, 'slots'),
      ...extraEnv,
    });
    const preflight = (extraEnv, args = []) =>
      spawnSync(process.execPath, [preflightScript, ...args], {
        cwd: work,
        encoding: 'utf8',
        env: stubbedEnv(extraEnv),
      });
    git(work, ['config', 'push.followTags', 'true']);
    git(work, ['tag', '-a', '-m', 'never gated', 'local-only', 'main']);
    const leaking = preflight({ STUB_LEAKS: '1' });
    assert.notEqual(leaking.status, 0);
    assert.match(leaking.stderr, /rotate it first/);
    assert.equal(git(work, ['ls-remote', 'origin', 'refs/heads/preflight/*']), '');
    const run = preflight({});
    assert.equal(run.status, 0, run.stderr);
    assert.equal(git(work, ['ls-remote', '--tags', 'origin']), '');
    const body = git(work, ['log', '-1', '--format=%B', 'HEAD']);
    const id = readFileSync(join(home, '.config/cairn-dev/lane-machine-id'), 'utf8').trim();
    const lane = `${id}/wt`;
    assert.match(id, /^m-[0-9a-f]{8}$/);
    assert.match(body, new RegExp(`^Lane: ${lane}$`, 'm'));
    assert.ok(!`${body}\n${run.stdout}`.includes(laneName(hostname(), 'wt')));
    const headSha = git(work, ['rev-parse', 'HEAD']);
    const remoteSha = git(work, ['ls-remote', 'origin', preflightRef(lane)]).split(/\s+/)[0];
    assert.equal(remoteSha, headSha);

    git(work, ['commit', '--allow-empty', '-m', 'unowned change after preflight']);
    const queued = spawnSync(
      process.execPath,
      [join(dirname(fileURLToPath(import.meta.url)), 'push-queue.mjs')],
      {
        cwd: work,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home },
      },
    );
    assert.equal(queued.status, 1, queued.stderr);
    assert.match(queued.stderr, /no green ci evidence/);
    assert.match(
      git(work, ['log', '-1', '--format=%B', 'HEAD']),
      new RegExp(`^Lane: ${lane}$`, 'm'),
    );
    assert.equal(git(work, ['ls-remote', 'origin', 'refs/heads/enqueue/*']), '');

    const remotePreflight = () =>
      git(work, ['ls-remote', 'origin', preflightRef(lane)]).split(/\s+/)[0];
    for (const moment of ['gate', 'wait']) {
      const moved = preflight({ STUB_COMMIT_DURING: moment });
      assert.equal(moved.status, 1, `${moment}: ${moved.stderr}`);
      assert.match(moved.stderr, /HEAD moved/);
      assert.doesNotMatch(moved.stderr, /already moved/);
      assert.equal(git(work, ['log', '-1', '--format=%s', 'HEAD']), `during ${moment}`);
      assert.equal(remotePreflight(), headSha);
    }

    for (const [moment, args] of [
      ['lookup', ['--reason', 'test moved head at lookup']],
      ['watch', ['--wait', '--reason', 'test moved head at watch']],
    ]) {
      const moved = preflight({ STUB_COMMIT_DURING: moment }, args);
      assert.equal(moved.status, 1, `${moment}: ${moved.stdout}${moved.stderr}`);
      assert.match(moved.stderr, /HEAD moved/);
      assert.doesNotMatch(moved.stdout, /push-queue will accept|rerun with --wait/);
    }

    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const gitStub = join(bin, 'git');
    writeFileSync(
      gitStub,
      `#!/bin/sh\nif [ "$STUB_COMMIT_DURING $1" = "push push" ]; then '${realGit}' commit -q --allow-empty -m "during push"; fi\nexec '${realGit}' "$@"\n`,
    );
    chmodSync(gitStub, 0o755);
    const movedAtPush = preflight({ STUB_COMMIT_DURING: 'push' }, [
      '--reason',
      'test moved head at push',
    ]);
    assert.equal(movedAtPush.status, 1, movedAtPush.stderr);
    assert.equal(git(work, ['log', '-1', '--format=%s', 'HEAD']), 'during push');
    assert.equal(remotePreflight(), git(work, ['rev-parse', 'HEAD~1']));

    const waited = spawnSync(
      process.execPath,
      [
        join(dirname(fileURLToPath(import.meta.url)), 'push-queue.mjs'),
        '--wait',
        '--reason',
        're-preflight queued head',
      ],
      {
        cwd: work,
        encoding: 'utf8',
        env: stubbedEnv({
          STUB_QUEUE: '1',
          PUSH_QUEUE_POLL_SECONDS: '0.1',
          PUSH_QUEUE_WAIT_MINUTES: '5',
        }),
      },
    );
    const reworded = git(work, ['rev-parse', 'HEAD']);
    assert.equal(waited.status, 0, `${waited.stdout}${waited.stderr}`);
    assert.equal(git(work, ['log', '-1', '--format=%s', reworded]), 'reworded after arming');
    assert.match(
      git(work, ['ls-remote', 'origin', 'refs/heads/enqueue/*']),
      new RegExp(`^${reworded}\\s`),
    );
    assert.equal(git(work, ['ls-remote', '--tags', 'origin']), '');

    const beforeRevert = remotePreflight();
    git(work, ['rm', '-q', 'scripts/stub-gate.mjs']);
    git(work, ['commit', '-qm', 'accidentally drop stub gate']);
    const reverted = preflight({}, ['--reason', 'test revert guard']);
    assert.notEqual(reverted.status, 0);
    assert.match(reverted.stderr, /undeclared revert/);
    assert.equal(remotePreflight(), beforeRevert);
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

test('a new preflight push cancels only older runs and leaves newer runs on the same ref alive', () => {
  const run = (id, patch) => ({
    id,
    name: 'ci',
    status: 'in_progress',
    head_branch: 'preflight/host/lane',
    head_sha: 'a'.repeat(40),
    created_at: '2026-11-27T09:00:00Z',
    ...patch,
  });
  const calls = [];
  const cancelled = cancelSupersededRuns({
    repo: 'xiechimon/cairn',
    ref: 'preflight/host/lane',
    sha: 'b'.repeat(40),
    queuedShas: () => new Set(),
    gh: (args) => {
      calls.push(args.at(-1));
      return {
        workflow_runs: [
          run(1, {}),
          run(2, { status: 'queued' }),
          run(3, { status: 'completed' }),
          run(4, { head_sha: 'b'.repeat(40), created_at: '2026-11-27T09:01:00Z' }),
          run(5, { head_branch: 'preflight/host/other' }),
          run(6, { name: 'promote' }),
          run(7, { head_sha: 'c'.repeat(40), created_at: '2026-11-27T09:02:00Z' }),
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
    queuedShas: () => new Set(['c'.repeat(40)]),
    gh: () => ({ workflow_runs: [run(1, 'a'.repeat(40)), run(2, 'c'.repeat(40))] }),
    cancel: () => true,
    log: () => {},
  });
  assert.deepEqual(cancelled, [1]);
});

test('a sha queued after the lane started waiting is still protected when old runs are cancelled', () => {
  const run = (id, head_sha) => ({
    id,
    name: 'ci',
    status: 'in_progress',
    head_branch: 'preflight/host/lane',
    head_sha,
  });
  let queued = new Set();
  const cancelled = cancelSupersededRuns({
    repo: 'xiechimon/cairn',
    ref: 'preflight/host/lane',
    sha: 'b'.repeat(40),
    queuedShas: () => queued,
    gh: () => {
      queued = new Set(['c'.repeat(40)]);
      return { workflow_runs: [run(1, 'a'.repeat(40)), run(2, 'c'.repeat(40))] };
    },
    cancel: () => true,
    log: () => {},
  });
  assert.deepEqual(cancelled, [1]);
});

test('an unreadable queue cancels nothing', () => {
  const cancelled = cancelSupersededRuns({
    repo: 'xiechimon/cairn',
    ref: 'preflight/host/lane',
    sha: 'b'.repeat(40),
    queuedShas: () => {
      throw new Error('ls-remote failed');
    },
    gh: () => ({
      workflow_runs: [
        {
          id: 1,
          name: 'ci',
          status: 'in_progress',
          head_branch: 'preflight/host/lane',
          head_sha: 'a'.repeat(40),
        },
      ],
    }),
    cancel: () => assert.fail('must not cancel without knowing the queue'),
    log: () => {},
  });
  assert.deepEqual(cancelled, []);
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

test('pollWaitStep retries when another worktree holds or has moved the shared origin/main ref', () => {
  for (const reason of [
    'is at 7d69ef17fade78995ff2289f9768ce6e7aed78ab but expected 65f587b2647f07abfbc9d09cf57d981ac68283ec',
    "Unable to create '/repo/.git/refs/remotes/origin/main.lock': File exists.",
  ]) {
    const raced = pollWaitStep({
      fetchMain: () => {
        throw new Error(`error: cannot lock ref 'refs/remotes/origin/main': ${reason}\n`);
      },
      listQueue: () => ({ entries: [], mainSha: null }),
      isOnMain: () => false,
      hasUnappliedCherry: () => true,
      readRemovalNote: () => null,
      sleep: () => {},
      enqueueRef: 'refs/heads/enqueue/1-abc',
    });
    assert.equal(raced.state, 'retry', reason);
  }
});

test('resolveRebaseOnlyEvidence reuses a green tested SHA only for a clean rebase with identical patches', () => {
  const greenChecks = ['check', 'pack-smoke', 'e2e-gate'].map((name) => ({
    name,
    conclusion: 'success',
  }));
  const reused = resolveRebaseOnlyEvidence({
    pushedSha: 'rebased-s2',
    candidateShas: ['red-sha', 's1-tested'],
    isCleanRebase: (testedSha, headSha) => testedSha === 's1-tested' && headSha === 'rebased-s2',
    checkRunsOf: (sha) =>
      sha === 's1-tested' ? greenChecks : [{ name: 'check', conclusion: 'failure' }],
  });
  assert.deepEqual(reused, { ok: true, sha: 's1-tested', mode: 'rebase-only' });

  const modified = resolveRebaseOnlyEvidence({
    pushedSha: 'edited-s2',
    candidateShas: ['s1-tested'],
    isCleanRebase: () => false,
    checkRunsOf: () => greenChecks,
  });
  assert.deepEqual(modified, { ok: false });

  const redSource = resolveRebaseOnlyEvidence({
    pushedSha: 'rebased-s2',
    candidateShas: ['s1-red'],
    isCleanRebase: () => true,
    checkRunsOf: () => [{ name: 'check', conclusion: 'failure' }],
  });
  assert.deepEqual(redSource, { ok: false });
});

test('preflight --stamp-only stamps Lane trailer and exits 0 without running fast gate or pushing', () => {
  const root = makeTestTempDir('preflight-stamp-only-');
  const bare = join(root, 'origin.git');
  const work = join(root, 'work');
  const home = join(root, 'home');
  try {
    mkdirSync(bare, { recursive: true });
    mkdirSync(home, { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
    execFileSync('git', ['clone', bare, work], { encoding: 'utf8' });
    const gitEnv = {
      ...process.env,
      NODE_TEST_CONTEXT: undefined,
      HOME: home,
      GIT_AUTHOR_NAME: 'xiechimon',
      GIT_AUTHOR_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'xiechimon',
      GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
    };
    const git = (args) =>
      execFileSync('git', args, {
        cwd: work,
        encoding: 'utf8',
        env: gitEnv,
      }).trim();
    writeFileSync(join(work, 'base.txt'), 'base\n');
    git(['add', 'base.txt']);
    git(['commit', '--quiet', '-m', 'chore: base']);
    git(['push', '--quiet', '-u', 'origin', 'main']);

    git(['checkout', '--quiet', '-b', 'feat']);
    writeFileSync(join(work, 'feat.txt'), 'feat\n');
    git(['add', 'feat.txt']);
    git(['commit', '--quiet', '-m', 'feat: work']);

    const scriptPath = fileURLToPath(new URL('./preflight.mjs', import.meta.url));
    const res = spawnSync(process.execPath, [scriptPath, '--stamp-only'], {
      cwd: work,
      encoding: 'utf8',
      env: gitEnv,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /stamped/i);
    const body = git(['log', '-1', '--format=%B']);
    assert.match(body, /^Lane: m-[0-9a-f]{8}\/work$/m);
    assert.equal(git(['ls-remote', 'origin', 'refs/heads/preflight/*']), '');
  } finally {
    releaseTestTempDir(root);
  }
});

test('parsePreflightArgs parses --wait, --stamp-only, and validates --reason values', () => {
  assert.deepEqual(parsePreflightArgs(['--wait', '--reason', '  fix\nreview  items ']), {
    ok: true,
    wait: true,
    stampOnly: false,
    reason: 'fix review items',
  });
  assert.deepEqual(parsePreflightArgs(['--stamp-only', '--reason=batch findings']), {
    ok: true,
    wait: false,
    stampOnly: true,
    reason: 'batch findings',
  });
  assert.equal(parsePreflightArgs(['--reason']).ok, false);
  assert.equal(parsePreflightArgs(['--reason', '']).ok, false);
  assert.equal(parsePreflightArgs(['--reason', '--wait']).ok, false);
});

test('evaluateGreenRerunGuard blocks round 3+ after a green run unless --reason is provided', () => {
  const twoGreens = [
    { sha: '111', conclusion: 'success' },
    { sha: '222', conclusion: 'success' },
  ];
  assert.equal(
    evaluateGreenRerunGuard({
      priorEntries: [],
      sha: '111',
      reason: null,
      lane: 'm-1/wt',
      taskBranch: 'feat',
      previousConclusion: null,
    }).ok,
    true,
  );
  assert.equal(
    evaluateGreenRerunGuard({
      priorEntries: [{ sha: '111', conclusion: 'success' }],
      sha: '222',
      reason: null,
      lane: 'm-1/wt',
      taskBranch: 'feat',
      previousConclusion: 'success',
    }).ok,
    true,
  );
  assert.equal(
    evaluateGreenRerunGuard({
      priorEntries: twoGreens,
      sha: '222',
      reason: null,
      lane: 'm-1/wt',
      taskBranch: 'feat',
      previousConclusion: 'success',
    }).sameSha,
    true,
  );
  assert.equal(
    evaluateGreenRerunGuard({
      priorEntries: [
        { sha: '111', conclusion: 'success' },
        { sha: '222', conclusion: 'failure' },
      ],
      sha: '333',
      reason: null,
      lane: 'm-1/wt',
      taskBranch: 'feat',
      previousConclusion: 'failure',
    }).ok,
    true,
  );
  const blocked = evaluateGreenRerunGuard({
    priorEntries: twoGreens,
    sha: '333',
    reason: null,
    lane: 'm-1/wt',
    taskBranch: 'feat',
    previousConclusion: 'success',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.round, 3);
  assert.match(blocked.error, /先把评审发现批量改完/);
  assert.match(blocked.error, /--reason/);
  const allowed = evaluateGreenRerunGuard({
    priorEntries: twoGreens,
    sha: '333',
    reason: 'batch review fixes',
    lane: 'm-1/wt',
    taskBranch: 'feat',
    previousConclusion: 'success',
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.round, 3);
});

test('upsertPreflightReason sets and updates Preflight-Reason trailer cleanly', () => {
  const first = upsertPreflightReason('fix(a): one\n\nLane: m-1/wt\n', 'batch review fixes');
  assert.equal(first, 'fix(a): one\n\nLane: m-1/wt\nPreflight-Reason: batch review fixes\n');
  const updated = upsertPreflightReason(first, 're-run after final batch');
  assert.equal(
    updated,
    'fix(a): one\n\nLane: m-1/wt\nPreflight-Reason: re-run after final batch\n',
  );
  const noTrailers = upsertPreflightReason('fix(a): bare subject\n', 'first reason');
  assert.equal(noTrailers, 'fix(a): bare subject\n\nPreflight-Reason: first reason\n');
});

test('ci workflow exposes Preflight-Reason in run-name for preflight pushes without renaming workflow', () => {
  const ci = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/ci.yml'),
    'utf8',
  );
  assert.match(ci, /^name: ci$/m);
  assert.match(
    ci,
    /^run-name: \$\{\{[\s\S]*refs\/heads\/preflight\/[\s\S]*Preflight-Reason:[\s\S]*\|\| '' \}\}$/m,
  );
});

test('preflight CLI enforces --reason on 3rd green rerun for same lane+branch and resets per branch', () => {
  const root = makeTestTempDir('preflight-reason-cli-');
  const bare = join(root, 'origin.git');
  const work = join(root, 'work');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const gateLog = join(root, 'gate-runs');
  try {
    mkdirSync(bare, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(home, { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
    execFileSync('git', ['clone', bare, work], { encoding: 'utf8' });
    const gitEnv = {
      ...process.env,
      NODE_TEST_CONTEXT: undefined,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      GIT_AUTHOR_NAME: 'xiechimon',
      GIT_AUTHOR_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'xiechimon',
      GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      CAIRN_PREFLIGHT_GATE_WRAPPER: '',
      CAIRN_HEAVY_SLOTS_DIR: join(root, 'slots'),
    };
    const git = (args) =>
      execFileSync('git', args, { cwd: work, encoding: 'utf8', env: gitEnv }).trim();
    mkdirSync(join(work, 'scripts/ops'), { recursive: true });
    writeFileSync(
      join(work, 'scripts/ops/preflight-fast-gate.mjs'),
      `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(gateLog)}, '1\\n');\n`,
    );
    git(['add', 'scripts/ops/preflight-fast-gate.mjs']);
    git(['commit', '--quiet', '-m', 'chore: base']);
    git(['push', '--quiet', '-u', 'origin', 'main']);

    const runsFile = join(root, 'gh-runs.json');
    writeFileSync(runsFile, '[]');
    const ghStub = join(bin, 'gh');
    writeFileSync(
      ghStub,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const idFile = process.env.HOME + '/.config/cairn-dev/lane-machine-id';
const id = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : 'uninitialized';
const branch = 'preflight/' + id + '/work';
const runsFile = ${JSON.stringify(runsFile)};
const runs = JSON.parse(fs.readFileSync(runsFile, 'utf8'));
const apiUrl = args.find((a) => a.startsWith('repos/')) || '';
if (apiUrl.includes('status=')) {
  console.log(JSON.stringify({ workflow_runs: [] }));
} else if (apiUrl.includes('head_sha=')) {
  const sha = (apiUrl.match(/head_sha=([0-9a-f]+)/) || [])[1] || '';
  const conclusion = process.env.STUB_CONCLUSION || 'success';
  const entry = { id: 100 + runs.length, name: 'ci', head_sha: sha, head_branch: branch, status: 'completed', conclusion, html_url: 'https://example/run/' + (100 + runs.length) };
  runs.unshift(entry);
  fs.writeFileSync(runsFile, JSON.stringify(runs));
  console.log(JSON.stringify({ workflow_runs: [entry] }));
} else if (apiUrl.includes('workflows/ci.yml/runs')) {
  console.log(JSON.stringify({ workflow_runs: runs }));
} else {
  console.log('{}');
}
`,
      { mode: 0o755 },
    );

    const scriptPath = fileURLToPath(new URL('./preflight.mjs', import.meta.url));
    const runCli = (extraArgs = [], extraEnv = {}) =>
      spawnSync(process.execPath, [scriptPath, ...extraArgs], {
        cwd: work,
        encoding: 'utf8',
        env: { ...gitEnv, ...extraEnv },
      });

    git(['checkout', '--quiet', '-b', 'task-1']);
    writeFileSync(join(work, 'f1.txt'), '1\n');
    git(['add', 'f1.txt']);
    git(['commit', '--quiet', '-m', 'fix: round 1']);
    const r1 = runCli();
    assert.equal(r1.status, 0, r1.stderr);

    writeFileSync(join(work, 'f2.txt'), '2\n');
    git(['add', 'f2.txt']);
    git(['commit', '--quiet', '-m', 'fix: round 2']);
    const r2 = runCli();
    assert.equal(r2.status, 0, r2.stderr);

    writeFileSync(join(work, 'f3.txt'), '3\n');
    git(['add', 'f3.txt']);
    git(['commit', '--quiet', '-m', 'fix: round 3']);
    const sha3Before = git(['rev-parse', 'HEAD']);
    const gateCountBefore = readFileSync(gateLog, 'utf8').trim().split('\n').length;
    const r3Blocked = runCli();
    assert.notEqual(r3Blocked.status, 0, '3rd green rerun without --reason must refuse');
    assert.match(r3Blocked.stderr, /先把评审发现批量改完/);
    assert.equal(readFileSync(gateLog, 'utf8').trim().split('\n').length, gateCountBefore);
    const id = readFileSync(join(home, '.config/cairn-dev/lane-machine-id'), 'utf8').trim();
    assert.notEqual(
      git(['ls-remote', 'origin', preflightRef(`${id}/work`)]).split(/\s+/)[0],
      sha3Before,
    );

    const r3Allowed = runCli(['--reason', '修评审发现的归档属主']);
    assert.equal(r3Allowed.status, 0, r3Allowed.stderr);
    const sha3After = git(['rev-parse', 'HEAD']);
    assert.equal(
      git(['ls-remote', 'origin', preflightRef(`${id}/work`)]).split(/\s+/)[0],
      sha3After,
    );
    assert.match(git(['log', '-1', '--format=%B']), /^Preflight-Reason: 修评审发现的归档属主$/m);

    const r3RestampSame = runCli(['--stamp-only', '--reason', '修评审发现的归档属主']);
    assert.equal(r3RestampSame.status, 0, r3RestampSame.stderr);
    assert.equal(
      git(['rev-parse', 'HEAD']),
      sha3After,
      'restamping the same --reason must not change the reviewed HEAD SHA',
    );

    git(['checkout', '--quiet', '-b', 'task-2', 'origin/main']);
    writeFileSync(join(work, 't2.txt'), 't2\n');
    git(['add', 't2.txt']);
    git(['commit', '--quiet', '-m', 'fix: new task branch']);
    const rOtherBranch = runCli();
    assert.equal(rOtherBranch.status, 0, rOtherBranch.stderr);

    writeFileSync(join(work, 't2b.txt'), 't2b\n');
    git(['add', 't2b.txt']);
    git(['commit', '--quiet', '-m', 'fix: branch red round 2']);
    const rBranchRed = runCli([], { STUB_CONCLUSION: 'failure' });
    assert.equal(rBranchRed.status, 0, rBranchRed.stderr);

    const redSha = git(['rev-parse', 'HEAD']);
    const currentRuns = JSON.parse(readFileSync(runsFile, 'utf8')).filter(
      (entry) => entry.head_sha !== redSha,
    );
    currentRuns.unshift({
      id: 999,
      name: 'ci',
      head_sha: '0'.repeat(40),
      head_branch: `preflight/${id}/work`,
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://example/run/999',
    });
    writeFileSync(runsFile, JSON.stringify(currentRuns));
    writeFileSync(join(work, 't2c.txt'), 't2c\n');
    git(['add', 't2c.txt']);
    git(['commit', '--quiet', '-m', 'fix: retry red without reason']);
    const rAfterRed = runCli();
    assert.equal(
      rAfterRed.status,
      0,
      `other-branch green run must not block red-predecessor retry: ${rAfterRed.stderr}`,
    );
  } finally {
    releaseTestTempDir(root);
  }
});

test('push-queue --wait --reason arms the post-reason SHA once while checks stay pending', () => {
  const root = makeTestTempDir('push-queue-reason-wait-');
  const bare = join(root, 'origin.git');
  const work = join(root, 'work');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const gateLog = join(root, 'gate-runs');
  const checkCalls = join(root, 'check-calls');
  try {
    mkdirSync(bare, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(home, { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
    execFileSync('git', ['clone', bare, work], { encoding: 'utf8' });
    const gitEnv = {
      ...process.env,
      NODE_TEST_CONTEXT: undefined,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      GIT_AUTHOR_NAME: 'xiechimon',
      GIT_AUTHOR_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'xiechimon',
      GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      CAIRN_PREFLIGHT_GATE_WRAPPER: '',
      CAIRN_HEAVY_SLOTS_DIR: join(root, 'slots'),
      PUSH_QUEUE_POLL_SECONDS: '0.05',
      PUSH_QUEUE_WAIT_MINUTES: '2',
    };
    const git = (args) =>
      execFileSync('git', args, { cwd: work, encoding: 'utf8', env: gitEnv }).trim();
    mkdirSync(join(work, 'scripts/ops'), { recursive: true });
    writeFileSync(
      join(work, 'scripts/ops/preflight-fast-gate.mjs'),
      `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(gateLog)}, '1\\n');\n`,
    );
    git(['add', 'scripts/ops/preflight-fast-gate.mjs']);
    git(['commit', '--quiet', '-m', 'chore: base']);
    git(['push', '--quiet', '-u', 'origin', 'main']);

    writeFileSync(checkCalls, '0');
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const idFile = process.env.HOME + '/.config/cairn-dev/lane-machine-id';
const id = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : 'uninitialized';
const branch = 'preflight/' + id + '/work';
const apiUrl = args.find((a) => a.startsWith('repos/')) || '';
const gitOut = (...a) => require('node:child_process').execFileSync('git', a, { encoding: 'utf8' }).trim();
if (apiUrl.includes('status=')) {
  console.log(JSON.stringify({ workflow_runs: [] }));
} else if (apiUrl.includes('/check-runs')) {
  const n = Number(fs.readFileSync(${JSON.stringify(checkCalls)}, 'utf8').trim()) + 1;
  fs.writeFileSync(${JSON.stringify(checkCalls)}, String(n));
  const sha = apiUrl.match(/commits\\/([0-9a-f]+)/)?.[1] || '';
  const pushed = gitOut('ls-remote', 'origin', 'refs/heads/' + branch).split(/\\s+/)[0];
  const ready = sha && pushed === sha && n >= 3;
  const check_runs = ready
    ? ['check', 'pack-smoke', 'e2e-gate'].map((name) => ({ name, conclusion: 'success' }))
    : [{ name: 'check', conclusion: null }];
  console.log(JSON.stringify([{ check_runs }]));
} else if (apiUrl.includes('head_sha=')) {
  const sha = (apiUrl.match(/head_sha=([0-9a-f]+)/) || [])[1] || '';
  console.log(JSON.stringify({ workflow_runs: [{ id: 101, name: 'ci', head_sha: sha, head_branch: branch, status: 'completed', conclusion: 'success', html_url: 'https://example/run/101' }] }));
} else if (apiUrl.endsWith('/dispatches')) {
  gitOut('push', '-q', '--no-follow-tags', 'origin', 'HEAD:refs/heads/main');
  console.log('{}');
} else {
  console.log('{}');
}
`,
      { mode: 0o755 },
    );

    git(['checkout', '--quiet', '-b', 'feat']);
    writeFileSync(join(work, 'a.txt'), 'a\n');
    git(['add', 'a.txt']);
    git(['commit', '--quiet', '-m', 'fix: pending arm check']);

    const pqPath = fileURLToPath(new URL('./push-queue.mjs', import.meta.url));
    const waited = spawnSync(
      process.execPath,
      [pqPath, '--wait', '--reason', 'batch pending check'],
      { cwd: work, encoding: 'utf8', env: gitEnv },
    );
    assert.equal(waited.status, 0, `${waited.stdout}\n${waited.stderr}`);
    assert.equal(
      readFileSync(gateLog, 'utf8').trim().split('\n').length,
      1,
      'push-queue --wait --reason must arm child preflight once and wait instead of re-arming',
    );
  } finally {
    releaseTestTempDir(root);
  }
});

test('push-queue runs secret-scan before enqueueing a rebase-only head whose commit body changed', () => {
  const root = makeTestTempDir('push-queue-rebase-scan-');
  const bare = join(root, 'origin.git');
  const work = join(root, 'wt');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  try {
    mkdirSync(bare, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(home, { recursive: true });
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      GIT_AUTHOR_NAME: 'xiechimon',
      GIT_AUTHOR_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'xiechimon',
      GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
    };
    const git = (args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', env }).trim();
    execFileSync('git', ['init', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
    execFileSync('git', ['clone', bare, work], { encoding: 'utf8' });
    writeFileSync(join(work, 'base.txt'), 'base\n');
    git(['add', 'base.txt']);
    git(['commit', '-qm', 'chore: base']);
    git(['push', '-qu', 'origin', 'main']);

    git(['checkout', '-qb', 'feat']);
    writeFileSync(join(work, 'feat.txt'), 'feat\n');
    git(['add', 'feat.txt']);
    git(['commit', '-qm', 'feat: work']);

    const stampOut = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./preflight.mjs', import.meta.url)), '--stamp-only'],
      { cwd: work, encoding: 'utf8', env },
    );
    assert.equal(stampOut.status, 0, stampOut.stderr);
    const testedSha = git(['rev-parse', 'HEAD']);
    const id = readFileSync(join(home, '.config/cairn-dev/lane-machine-id'), 'utf8').trim();
    git(['push', '-q', 'origin', `${testedSha}:refs/heads/preflight/${id}/wt`]);

    git(['commit', '--quiet', '--amend', '-m', `feat: work\n\nAmended body\n\nLane: ${id}/wt`]);
    writeFileSync(
      join(bin, 'gitleaks'),
      '#!/bin/sh\ncat > /dev/null\necho "WRN leaks found: 1" >&2\nexit 1\n',
    );
    chmodSync(join(bin, 'gitleaks'), 0o755);
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args.includes('/check-runs')) {
  const runs = args.includes('${testedSha}')
    ? ['check', 'pack-smoke', 'e2e-gate'].map((name) => ({ name, conclusion: 'success' }))
    : [];
  console.log(JSON.stringify([{ check_runs: runs }]));
} else {
  console.log(JSON.stringify({ workflow_runs: [{ head_sha: '${testedSha}' }] }));
}
`,
    );
    chmodSync(join(bin, 'gh'), 0o755);

    const push = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./push-queue.mjs', import.meta.url))],
      { cwd: work, encoding: 'utf8', env },
    );
    assert.notEqual(push.status, 0);
    assert.match(push.stderr, /rotate it first/);
    assert.equal(git(['ls-remote', 'origin', 'refs/heads/enqueue/*']), '');
  } finally {
    releaseTestTempDir(root);
  }
});

test('withPreflightAdmission serializes callers FIFO, releases on throw, and honours bypass/env policy', async () => {
  assert.deepEqual(PREFLIGHT_PUSH_POOL, {
    defaultCount: 1,
    dirName: 'preflight-push',
    label: 'preflight-queue',
  });

  const dir = makeTestTempDir('preflight-fifo-');
  const queueDir = join(dir, PREFLIGHT_PUSH_POOL.dirName);
  const env = { CAIRN_HEAVY_SLOTS_DIR: dir, CAIRN_HEAVY_GATE_BYPASS: '1' };
  const waitForTicketCount = async (expected) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const tickets = readdirSync(queueDir).filter((name) => name.startsWith('queue-'));
      if (tickets.length >= expected) return;
      if (Date.now() > deadline)
        throw new Error(`expected ${expected} queue tickets, saw ${tickets.length}`);
      await delay(20);
    }
  };
  try {
    let active = 0;
    let maxActive = 0;
    const order = [];
    let markEnteredA;
    const enteredA = new Promise((done) => {
      markEnteredA = done;
    });
    let releaseA;
    const holdA = new Promise((done) => {
      releaseA = done;
    });

    const pA = withPreflightAdmission({ env, log: () => {} }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push('A');
      markEnteredA();
      try {
        await holdA;
        throw new Error('slot A boom');
      } finally {
        active -= 1;
      }
    });
    await enteredA;

    const pB = withPreflightAdmission({ env, log: () => {} }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push('B');
      await delay(30);
      active -= 1;
      return 'ok-B';
    });
    await waitForTicketCount(1);

    const pC = withPreflightAdmission({ env, log: () => {} }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push('C');
      active -= 1;
      return 'ok-C';
    });
    await waitForTicketCount(2);

    const bypassRan = await withPreflightAdmission(
      { bypass: true, env, log: () => {} },
      async () => 'bypassed',
    );
    assert.equal(bypassRan, 'bypassed');
    assert.deepEqual(order, ['A']);

    releaseA();
    await assert.rejects(pA, /slot A boom/);
    assert.equal(await pB, 'ok-B');
    assert.equal(await pC, 'ok-C');
    assert.equal(maxActive, 1);
    assert.deepEqual(order, ['A', 'B', 'C']);

    let seenOpts = null;
    await withPreflightAdmission(
      {
        env: { CAIRN_HEAVY_GATE_BYPASS: '1', CAIRN_CPU_SATURATION_PERCENT: '90', CUSTOM_X: 'yes' },
        log: () => {},
        acquire: async (opts) => {
          seenOpts = opts;
          return { slot: 1, owner: process.pid, release() {} };
        },
      },
      async () => 'done',
    );
    assert.equal(seenOpts.pool, PREFLIGHT_PUSH_POOL);
    assert.equal(seenOpts.env.CAIRN_HEAVY_GATE_BYPASS, '');
    assert.equal(seenOpts.env.CAIRN_CPU_SATURATION_PERCENT, '0');
    assert.equal(seenOpts.env.CUSTOM_X, 'yes');
  } finally {
    releaseTestTempDir(dir);
  }
});

test('two CLI preflight processes hold FIFO lock across stale-id and moved-head visibility delays', async () => {
  const root = makeTestTempDir('preflight-cli-fifo-');
  const bare = join(root, 'origin.git');
  const wt1 = join(root, 'wt1');
  const wt2 = join(root, 'wt2');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const slotsDir = join(root, 'slots');
  const eventsFile = join(root, 'events.log');
  const readyFile = join(root, 'run-visible');
  try {
    mkdirSync(bare, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(eventsFile, '');
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const baseEnv = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      GIT_AUTHOR_NAME: 'xiechimon',
      GIT_AUTHOR_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'xiechimon',
      GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      CAIRN_PREFLIGHT_GATE_WRAPPER: '',
      CAIRN_HEAVY_SLOTS_DIR: slotsDir,
    };
    const gitAt = (cwd, args) =>
      execFileSync(realGit, args, { cwd, encoding: 'utf8', env: baseEnv }).trim();
    execFileSync(realGit, ['init', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
    execFileSync(realGit, ['clone', bare, wt1], { encoding: 'utf8' });
    mkdirSync(join(wt1, 'scripts/ops'), { recursive: true });
    writeFileSync(join(wt1, 'scripts/ops/preflight-fast-gate.mjs'), '');
    gitAt(wt1, ['add', 'scripts/ops/preflight-fast-gate.mjs']);
    gitAt(wt1, ['commit', '-qm', 'chore: base']);
    gitAt(wt1, ['push', '-qu', 'origin', 'main']);
    execFileSync(realGit, ['clone', bare, wt2], { encoding: 'utf8' });

    gitAt(wt1, ['checkout', '-qb', 'lane1']);
    writeFileSync(join(wt1, 'f1.txt'), '1\n');
    gitAt(wt1, ['add', 'f1.txt']);
    gitAt(wt1, ['commit', '-qm', 'feat: wt1']);

    gitAt(wt2, ['checkout', '-qb', 'lane2']);
    writeFileSync(join(wt2, 'f2.txt'), '2\n');
    gitAt(wt2, ['add', 'f2.txt']);
    gitAt(wt2, ['commit', '-qm', 'feat: wt2']);

    const scriptPath = fileURLToPath(new URL('./preflight.mjs', import.meta.url));
    assert.equal(
      spawnSync(process.execPath, [scriptPath, '--stamp-only'], {
        cwd: wt1,
        encoding: 'utf8',
        env: baseEnv,
      }).status,
      0,
    );
    assert.equal(
      spawnSync(process.execPath, [scriptPath, '--stamp-only'], {
        cwd: wt2,
        encoding: 'utf8',
        env: baseEnv,
      }).status,
      0,
    );
    const sha1 = gitAt(wt1, ['rev-parse', 'HEAD']);
    const sha2 = gitAt(wt2, ['rev-parse', 'HEAD']);
    const id = readFileSync(join(home, '.config/cairn-dev/lane-machine-id'), 'utf8').trim();
    const ref1 = `preflight/${id}/wt1`;
    const ref2 = `preflight/${id}/wt2`;

    writeFileSync(
      join(bin, 'git'),
      `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const realGit = ${JSON.stringify(realGit)};
const res = spawnSync(realGit, args, { stdio: 'inherit' });
if (args[0] === 'push' && res.status === 0) {
  const tag = args.some((a) => a.includes('wt1')) ? 'wt1' : 'wt2';
  appendFileSync(${JSON.stringify(eventsFile)}, 'push:' + tag + '\\n');
  if (tag === 'wt1' && process.env.STUB_MOVE_WT1 === '1') {
    spawnSync(realGit, ['commit', '-q', '--allow-empty', '-m', 'moved after push'], { stdio: 'ignore' });
  }
}
process.exit(res.status ?? 1);
`,
      { mode: 0o755 },
    );

    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env node
const { appendFileSync, existsSync } = require('node:fs');
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('repos/')) || '';
const sha1 = ${JSON.stringify(sha1)};
const sha2 = ${JSON.stringify(sha2)};
const ref1 = ${JSON.stringify(ref1)};
const ref2 = ${JSON.stringify(ref2)};
const staleRun = { id: 50, name: 'ci', head_sha: sha1, head_branch: ref1, status: 'completed', conclusion: 'failure', html_url: 'https://example/run/50' };
const newRun1 = { id: 201, name: 'ci', head_sha: sha1, head_branch: ref1, status: 'in_progress', html_url: 'https://example/run/201' };
const newRun2 = { id: 202, name: 'ci', head_sha: sha2, head_branch: ref2, status: 'in_progress', html_url: 'https://example/run/202' };
const visible = existsSync(${JSON.stringify(readyFile)});
if (url.includes('status=')) {
  console.log(JSON.stringify({ workflow_runs: visible ? [newRun1] : [] }));
} else if (url.includes('workflows/ci.yml/runs') && url.includes(encodeURIComponent(ref1))) {
  console.log(JSON.stringify({ workflow_runs: [staleRun] }));
} else if (url.includes('workflows/ci.yml/runs')) {
  console.log(JSON.stringify({ workflow_runs: [] }));
} else if (url.includes('head_sha=' + sha1)) {
  if (!visible) {
    appendFileSync(${JSON.stringify(eventsFile)}, 'miss:wt1\\n');
    console.log(JSON.stringify({ workflow_runs: [staleRun] }));
  } else {
    appendFileSync(${JSON.stringify(eventsFile)}, 'visible:wt1\\n');
    console.log(JSON.stringify({ workflow_runs: [staleRun, newRun1] }));
  }
} else if (url.includes('head_sha=' + sha2)) {
  appendFileSync(${JSON.stringify(eventsFile)}, 'visible:wt2\\n');
  console.log(JSON.stringify({ workflow_runs: [newRun2] }));
} else {
  console.log('{}');
}
`,
      { mode: 0o755 },
    );

    const runSpawned = (cwd, extraEnv = {}) => {
      const child = spawn(process.execPath, [scriptPath], {
        cwd,
        env: { ...baseEnv, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      const done = new Promise((resolve) => {
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      });
      return { child, done };
    };

    const waitForEvent = async (needle) => {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const text = readFileSync(eventsFile, 'utf8');
        if (text.includes(needle)) return text;
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${needle} in events:\n${text}`);
        }
        await delay(50);
      }
    };

    const p1 = runSpawned(wt1, { STUB_MOVE_WT1: '1' });
    await Promise.race([
      waitForEvent('miss:wt1'),
      p1.done.then((res) => {
        throw new Error(
          `wt1 exited early (${res.status}) before checking post-push run visibility:\n${res.stderr}`,
        );
      }),
    ]);

    const p2 = runSpawned(wt2);
    await delay(500);
    assert.doesNotMatch(
      readFileSync(eventsFile, 'utf8'),
      /push:wt2/,
      'wt2 must wait in FIFO lock while wt1 run is invisible even when wt1 HEAD moved after push',
    );
    assert.equal(gitAt(wt2, ['ls-remote', 'origin', `refs/heads/${ref2}`]), '');

    writeFileSync(readyFile, 'ok\n');
    const [r1, r2] = await Promise.all([p1.done, p2.done]);
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /HEAD moved/);
    assert.equal(r2.status, 0, r2.stderr);
    const events = readFileSync(eventsFile, 'utf8').trim().split('\n');
    assert.ok(events.indexOf('visible:wt1') !== -1);
    assert.ok(events.indexOf('visible:wt1') < events.indexOf('push:wt2'));
  } finally {
    releaseTestTempDir(root);
  }
});

test('extractCiFailedTestFiles extracts existing vitest, playwright, and node:test paths from CI logs', () => {
  const root = makeTestTempDir('ci-failed-log-parse-');
  try {
    for (const rel of [
      'apps/server/test/d121-owner-controls.test.ts',
      'apps/web/e2e/chief-home-questions.spec.ts',
      'apps/web/e2e/web-vitals-perf.spec.ts',
      'apps/web/e2e/providers-order.spec.ts',
      'scripts/ops/push-queue.test.mjs',
      'apps/web/test/ok.test.ts',
    ]) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), 'export {};\n');
    }
    const sampleLog = [
      'vitest-light (5)\tTest\t2026-11-27T12:07:39Z  ✓ @cairn/web test/ok.test.ts (3 tests) 10ms',
      'vitest-light (5)\tTest\t2026-11-27T12:07:40Z \x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m @xiechimon/cairn test/d121-owner-controls.test.ts > no deadline',
      'e2e (6)\tE2E\t2026-11-27T13:16:48Z   ✓  364 e2e/thread-pr-panel.spec.ts:303:1 › ok',
      'e2e (6)\tE2E\t2026-11-27T13:16:50Z   1) e2e/chief-home-questions.spec.ts:347:1 › at 375px each card sits',
      'e2e (2)\tE2E\t2026-11-27T13:06:50Z   1 failed',
      'e2e (2)\tE2E\t2026-11-27T13:06:50Z     e2e/providers-order.spec.ts:146:1 › A10: hovering',
      'e2e-affected (1)\tE2E\t2026-11-27T13:30:03Z flake ledger: unlisted Playwright spec file(s) went green on retry: apps/web/e2e/web-vitals-perf.spec.ts. Fix the flake',
      'check\tnode\t✖ scripts/ops/push-queue.test.mjs (10ms)',
      'check\tnode\t    at /home/runner/work/cairn/cairn/apps/server/test/nonexistent.test.ts:1:1',
    ].join('\n');

    assert.deepEqual(extractCiFailedTestFiles(sampleLog, { cwd: root }), [
      'apps/server/test/d121-owner-controls.test.ts',
      'apps/web/e2e/chief-home-questions.spec.ts',
      'apps/web/e2e/providers-order.spec.ts',
      'apps/web/e2e/web-vitals-perf.spec.ts',
      'scripts/ops/push-queue.test.mjs',
    ]);
  } finally {
    releaseTestTempDir(root);
  }
});

test('preflight refuses to push when a test file from the branch previous red preflight still fails', () => {
  const root = makeTestTempDir('preflight-rerun-failed-');
  const bare = join(root, 'origin.git');
  const work = join(root, 'work');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  try {
    mkdirSync(bare, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(home, { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
    execFileSync('git', ['clone', bare, work], { encoding: 'utf8' });
    const gitEnv = {
      ...process.env,
      NODE_TEST_CONTEXT: undefined,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      GIT_AUTHOR_NAME: 'xiechimon',
      GIT_AUTHOR_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'xiechimon',
      GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      CAIRN_PREFLIGHT_GATE_WRAPPER: '',
      CAIRN_HEAVY_SLOTS_DIR: join(root, 'slots'),
    };
    const git = (args) =>
      execFileSync('git', args, { cwd: work, encoding: 'utf8', env: gitEnv }).trim();
    mkdirSync(join(work, 'scripts/ops'), { recursive: true });
    writeFileSync(
      join(work, 'scripts/ops/preflight-fast-gate.mjs'),
      `import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--last-failed' && args[i + 1]) {
    const res = spawnSync(process.execPath, ['--test', args[i + 1]], { stdio: 'inherit' });
    if (res.status !== 0) process.exit(res.status ?? 1);
    i += 1;
  }
}
`,
    );
    writeFileSync(join(work, 'scripts/demo-flag.txt'), 'ok\n');
    writeFileSync(
      join(work, 'scripts/demo-fail.test.mjs'),
      `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
test('demo flag must be ok', () => {
  assert.equal(readFileSync('scripts/demo-flag.txt', 'utf8').trim(), 'ok');
});
`,
    );
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'chore: base']);
    git(['push', '--quiet', '-u', 'origin', 'main']);

    const runsFile = join(root, 'gh-runs.json');
    writeFileSync(runsFile, '[]');
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const idFile = process.env.HOME + '/.config/cairn-dev/lane-machine-id';
const id = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : 'uninitialized';
const branch = 'preflight/' + id + '/work';
const runsFile = ${JSON.stringify(runsFile)};
const runs = JSON.parse(fs.readFileSync(runsFile, 'utf8'));
const apiUrl = args.find((a) => a.startsWith('repos/')) || '';
if (args[0] === 'run' && args[1] === 'view' && args.includes('--log-failed')) {
  console.log('check\\tnode\\t✖ scripts/demo-fail.test.mjs (5ms)');
} else if (apiUrl.includes('status=')) {
  console.log(JSON.stringify({ workflow_runs: [] }));
} else if (apiUrl.includes('head_sha=')) {
  const sha = (apiUrl.match(/head_sha=([0-9a-f]+)/) || [])[1] || '';
  let entry = runs.find((r) => r.head_sha === sha);
  if (!entry) {
    const conclusion = process.env.STUB_CONCLUSION || 'success';
    entry = { id: 300 + runs.length, name: 'ci', head_sha: sha, head_branch: branch, status: 'completed', conclusion, html_url: 'https://example/run/' + (300 + runs.length) };
    runs.unshift(entry);
    fs.writeFileSync(runsFile, JSON.stringify(runs));
  }
  console.log(JSON.stringify({ workflow_runs: [entry] }));
} else if (apiUrl.includes('workflows/ci.yml/runs')) {
  console.log(JSON.stringify({ workflow_runs: runs }));
} else {
  console.log('{}');
}
`,
      { mode: 0o755 },
    );

    const scriptPath = fileURLToPath(new URL('./preflight.mjs', import.meta.url));
    const runCli = (extraArgs = [], extraEnv = {}) =>
      spawnSync(process.execPath, [scriptPath, ...extraArgs], {
        cwd: work,
        encoding: 'utf8',
        env: { ...gitEnv, ...extraEnv },
      });

    git(['checkout', '--quiet', '-b', 'feat-red']);
    writeFileSync(join(work, 'scripts/demo-flag.txt'), 'broken\n');
    git(['add', 'scripts/demo-flag.txt']);
    git(['commit', '--quiet', '-m', 'fix: broken change']);
    const r1 = runCli(['--wait'], { STUB_CONCLUSION: 'failure' });
    assert.equal(r1.status, 1);
    const id = readFileSync(join(home, '.config/cairn-dev/lane-machine-id'), 'utf8').trim();
    const sha1 = git(['rev-parse', 'HEAD']);
    assert.equal(git(['ls-remote', 'origin', preflightRef(`${id}/work`)]).split(/\s+/)[0], sha1);

    writeFileSync(join(work, 'unrelated.txt'), 'noise\n');
    git(['add', 'unrelated.txt']);
    git(['commit', '--quiet', '-m', 'fix: unrelated commit without fixing flag']);
    const r2 = runCli();
    assert.notEqual(
      r2.status,
      0,
      `preflight must block pushing while previously failed test still fails\nr1.out=${r1.stdout}\nr1.err=${r1.stderr}\nr2.out=${r2.stdout}\nr2.err=${r2.stderr}`,
    );
    assert.equal(
      git(['ls-remote', 'origin', preflightRef(`${id}/work`)]).split(/\s+/)[0],
      sha1,
      'broken commit must not be pushed to preflight ref',
    );

    writeFileSync(join(work, 'scripts/demo-flag.txt'), 'ok\n');
    git(['add', 'scripts/demo-flag.txt']);
    git(['commit', '--quiet', '-m', 'fix: restore ok flag']);
    const r3 = runCli();
    assert.equal(r3.status, 0, r3.stderr);
    const sha3 = git(['rev-parse', 'HEAD']);
    assert.equal(git(['ls-remote', 'origin', preflightRef(`${id}/work`)]).split(/\s+/)[0], sha3);
  } finally {
    releaseTestTempDir(root);
  }
});
