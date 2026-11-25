import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { preflightRef, preflightRun, watchVerdict } from './preflight.mjs';
import {
  classifyWaitStatus,
  DEFAULT_POLL_SECONDS,
  failedGreenContexts,
  fetchCheckRuns,
  landingTarget,
  laneName,
  missingGreenContexts,
  nextWaitAction,
  planEnqueueOrLand,
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

test('landingTarget fast-forwards main when exact SHA is preflight-green and contains origin/main', () => {
  assert.deepEqual(landingTarget({ pushedSha: X, evidenceSha: X, containsMain: true }), {
    action: 'fast-forward-main',
    sha: X,
  });
  assert.deepEqual(
    landingTarget({ pushedSha: X, evidenceSha: 'b'.repeat(40), containsMain: true }),
    {
      action: 'queue',
      sha: X,
    },
  );
  assert.deepEqual(landingTarget({ pushedSha: X, evidenceSha: X, containsMain: false }), {
    action: 'reject-stale',
  });
});

test('--wait rebases onto origin/main when main moved ahead of HEAD while queue/main is free', () => {
  assert.deepEqual(
    nextWaitAction({
      live: null,
      headOnLive: false,
      headOnMain: false,
      deadBase: false,
      headTree: 'T1',
      armedTree: 'T1',
      evidence: { ok: true, sha: X },
      failed: [],
    }),
    { action: 'rebase', onto: 'origin/main' },
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

    const preflightScript = join(dirname(fileURLToPath(import.meta.url)), 'preflight.mjs');
    const run = spawnSync(process.execPath, [preflightScript], {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        EXPECTED_PREFLIGHT_REF: `preflight/${laneName(execFileSync('hostname', { encoding: 'utf8' }).trim(), 'wt')}`,
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

test('stamp-then-preflight produces evidence on pushedSha so landingTarget fast-forwards main', () => {
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
  assert.deepEqual(
    landingTarget({ pushedSha: stampedSha, evidenceSha: evidence.sha, containsMain: true }),
    { action: 'fast-forward-main', sha: stampedSha },
  );
});

test('planEnqueueOrLand fast-forwards only when queue is empty and HEAD is directly green on main', () => {
  assert.equal(DEFAULT_POLL_SECONDS, 15);
  assert.deepEqual(
    planEnqueueOrLand({
      activeEnqueueCount: 0,
      hasLegacyLive: false,
      pushedSha: X,
      evidenceSha: X,
      containsMain: true,
    }),
    { action: 'fast-forward-main', sha: X },
  );
  assert.deepEqual(
    planEnqueueOrLand({
      activeEnqueueCount: 1,
      hasLegacyLive: false,
      pushedSha: X,
      evidenceSha: X,
      containsMain: true,
    }),
    { action: 'enqueue', sha: X },
  );
  assert.deepEqual(
    planEnqueueOrLand({
      activeEnqueueCount: 0,
      hasLegacyLive: false,
      pushedSha: X,
      evidenceSha: X,
      containsMain: false,
    }),
    { action: 'enqueue', sha: X },
  );
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
      mainMoved: true,
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
      mainMoved: true,
    }),
    {
      state: 'ejected',
    },
  );
});
