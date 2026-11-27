import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { buildPublicResults, publishPublicResults } from './eval-public-results.mjs';

function makeTempDir(t) {
  const dir = makeTestTempDir('eval-public-results-');
  t.after(() => releaseTestTempDir(dir));
  return dir;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function createEvalRepo(root, { laneId = 'lane-one', remote = null } = {}) {
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'eval', 'tasks', 'lane', laneId), { recursive: true });
  mkdirSync(join(repo, 'eval', 'tasks', 'runtime'), { recursive: true });
  mkdirSync(join(repo, 'eval', 'tasks', 'canary'), { recursive: true });
  writeFileSync(
    join(repo, 'eval', 'suite.json'),
    `${JSON.stringify(
      {
        version: 1,
        dataset: 'cairn-eval-suite',
        repeats: { runtime: 2, lane: 1, canary: 1 },
        expectedCounts: { runtime: 1, lane: 1, canary: 1 },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(repo, 'eval', 'tasks', 'lane', laneId, 'task.json'), '{}\n');
  writeFileSync(join(repo, 'eval', 'tasks', 'runtime', 'runtime-one.json'), '{}\n');
  writeFileSync(join(repo, 'eval', 'tasks', 'canary', 'canary-one.json'), '{}\n');
  git(repo, ['init', '-q']);
  if (remote) git(repo, ['remote', 'add', 'origin', remote]);
  return repo;
}

function makeRecord({ date = '2026-11-27T05:00:00.000Z', sha = 'a'.repeat(40) } = {}) {
  return {
    runId: `daily-${date.replace(/\D/g, '')}`,
    arm: 'daily-test',
    sha,
    startedAt: '2026-11-27T04:00:00.000Z',
    finishedAt: date,
    durationMs: 1000,
    status: 'incomplete',
    evalExitCode: 0,
    summary: {
      total: 4,
      passed: 2,
      failed: 1,
      incomplete: 1,
      byKind: {
        lane: { total: 1, passed: 1, failed: 0, incomplete: 0 },
        runtime: { total: 2, passed: 1, failed: 1, incomplete: 0 },
        canary: { total: 1, passed: 0, failed: 0, incomplete: 1 },
      },
    },
    items: [
      {
        caseId: 'lane-one',
        kind: 'lane',
        repeat: 0,
        scores: { 'lane.completed': 1 },
        traceId: 'trace-secret',
        traceUrl: 'https://mac-mini.tailac09a9.ts.net/project/cairn/traces/trace-secret',
        diagnostics: '/Users/ian/private sk-abcdefghijklmnop quota details',
      },
      {
        caseId: 'runtime-one',
        kind: 'runtime',
        repeat: 0,
        scores: { 'runtime.completed': 1 },
      },
      {
        caseId: 'runtime-one',
        kind: 'runtime',
        repeat: 1,
        scores: { 'runtime.completed': 0 },
        comments: { 'runtime.completed': 'private comment' },
      },
      {
        caseId: 'canary-one',
        kind: 'canary',
        repeat: 0,
        scores: {},
        incomplete: 'Langfuse quota details https://internal.example',
      },
    ],
  };
}

function publishOptions(repo, stateDir) {
  return { repoDir: repo, stateDir, env: {}, enforceCanonicalRemote: false };
}

test('builds official snapshot with per-kind counts', (t) => {
  const dir = makeTempDir(t);
  const repo = createEvalRepo(join(dir, 'fixture'));
  const built = buildPublicResults(makeRecord(), { repoDir: repo, env: {} });
  assert.equal(built.skipReason, undefined);
  const payload = built.payload;
  assert.equal(payload.version, 1);
  assert.equal(payload.dataset, 'cairn-eval-suite');
  assert.equal(payload.summary.total, 4);
  assert.deepEqual(payload.summary.byKind.lane, {
    total: 1,
    passed: 1,
    failed: 0,
    incomplete: 0,
  });
  const runtime = payload.cases.find((row) => row.caseId === 'runtime-one');
  assert.deepEqual(runtime, {
    caseId: 'runtime-one',
    kind: 'runtime',
    status: 'partial',
    passed: 1,
    failed: 1,
    incomplete: 0,
    trials: 2,
    model: 'fauxProvider replay',
  });
  const lane = payload.cases.find((row) => row.caseId === 'lane-one');
  assert.equal(lane.model, 'Devin CLI · model not recorded');
  const canary = payload.cases.find((row) => row.caseId === 'canary-one');
  assert.equal(canary.status, 'incomplete');
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    'trace-secret',
    'tailac09a9',
    '/Users/ian',
    'sk-abcdefghijklmnop',
    'private comment',
    'quota details',
    'https://',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('validates allowlisted payload before writing', (t) => {
  const dir = makeTempDir(t);
  const repo = createEvalRepo(join(dir, 'fixture'));
  const unknown = makeRecord();
  unknown.items[0] = { ...unknown.items[0], caseId: 'private-lane' };
  assert.throws(
    () => buildPublicResults(unknown, { repoDir: repo, env: {} }),
    /not a public eval task/,
  );

  const duplicated = makeRecord();
  duplicated.items[1] = { ...duplicated.items[0], repeat: 0 };
  assert.throws(() => buildPublicResults(duplicated, { repoDir: repo, env: {} }), /duplicated/);

  const tokenRepo = createEvalRepo(join(dir, 'token-fixture'), {
    laneId: 'sk-abcdefghijklmnop',
  });
  const tokenRecord = makeRecord();
  tokenRecord.items[0] = { ...tokenRecord.items[0], caseId: 'sk-abcdefghijklmnop' };
  assert.throws(
    () => buildPublicResults(tokenRecord, { repoDir: tokenRepo, env: {} }),
    /unsafe public payload/,
  );

  const tailnetRepo = createEvalRepo(join(dir, 'tailnet-fixture'), {
    laneId: 'mac-mini.tailac09a9.ts.net',
  });
  const tailnetRecord = makeRecord();
  tailnetRecord.items[0] = { ...tailnetRecord.items[0], caseId: 'mac-mini.tailac09a9.ts.net' };
  assert.throws(
    () => buildPublicResults(tailnetRecord, { repoDir: tailnetRepo, env: {} }),
    /unsafe public payload/,
  );

  const bare = join(dir, 'remote.git');
  git(dir, ['init', '-q', '--bare', bare]);
  const publishingRepo = createEvalRepo(join(dir, 'publish-fixture'), { remote: bare });
  const unsafeRepo = createEvalRepo(join(dir, 'unsafe-fixture'), {
    laneId: 'sk-abcdefghijklmnop',
    remote: bare,
  });
  void publishingRepo;
  const result = publishPublicResults(tokenRecord, {
    ...publishOptions(unsafeRepo, join(dir, 'state')),
  });
  assert.equal(result.state, 'failed');
  assert.equal(git(dir, ['--git-dir', bare, 'for-each-ref', 'refs/heads/eval-results']), '');
});

test('publishes orphan branch and prunes tree', (t) => {
  const dir = makeTempDir(t);
  const bare = join(dir, 'remote.git');
  git(dir, ['init', '-q', '--bare', bare]);
  const seed = join(dir, 'seed');
  mkdirSync(seed, { recursive: true });
  git(seed, ['init', '-q']);
  git(seed, ['config', 'user.email', 'eval@cairn.dev']);
  git(seed, ['config', 'user.name', 'eval']);
  writeFileSync(join(seed, 'extra.txt'), 'must not survive\n');
  writeFileSync(join(seed, 'latest.json'), '{"version":0}\n');
  git(seed, ['add', 'extra.txt', 'latest.json']);
  git(seed, ['commit', '-qm', 'seed public branch']);
  git(seed, ['remote', 'add', 'origin', bare]);
  git(seed, ['push', '-q', 'origin', 'HEAD:eval-results']);

  const repo = createEvalRepo(join(dir, 'fixture'), { remote: bare });
  const result = publishPublicResults(makeRecord(), publishOptions(repo, join(dir, 'state')));
  assert.equal(result.state, 'published');
  assert.match(result.commit, /^[0-9a-f]{40}$/);
  const tree = git(dir, ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'eval-results'])
    .trim()
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(tree, ['latest.json']);
  const raw = git(dir, ['--git-dir', bare, 'show', 'eval-results:latest.json']);
  const payload = JSON.parse(raw);
  assert.equal(payload.version, 1);
  assert.equal(payload.cases.length, 3);

  const sentinel = join(dir, 'outside-secret.json');
  writeFileSync(sentinel, JSON.stringify({ date: '2099-01-01T00:00:00.000Z', secret: 'keep-me' }));
  const symlinkSeed = join(dir, 'symlink-seed');
  mkdirSync(symlinkSeed, { recursive: true });
  git(symlinkSeed, ['init', '-q']);
  git(symlinkSeed, ['config', 'user.email', 'eval@cairn.dev']);
  git(symlinkSeed, ['config', 'user.name', 'eval']);
  execFileSync('ln', ['-s', sentinel, join(symlinkSeed, 'latest.json')]);
  git(symlinkSeed, ['add', 'latest.json']);
  git(symlinkSeed, ['commit', '-qm', 'seed symlink']);
  git(symlinkSeed, ['remote', 'add', 'origin', bare]);
  git(symlinkSeed, ['push', '-qf', 'origin', 'HEAD:eval-results']);

  const symlinkResult = publishPublicResults(
    makeRecord(),
    publishOptions(repo, join(dir, 'symlink-state')),
  );
  assert.equal(symlinkResult.state, 'published');
  assert.equal(JSON.parse(readFileSync(sentinel, 'utf8')).secret, 'keep-me');
  const modeLine = git(dir, ['--git-dir', bare, 'ls-tree', 'eval-results', '--', 'latest.json']);
  assert.match(modeLine, /^100644 blob /);

  const symlinkTmpState = join(dir, 'symlink-tmp-state');
  const outsideTarget = join(dir, 'outside-dir');
  mkdirSync(symlinkTmpState, { recursive: true });
  mkdirSync(outsideTarget, { recursive: true });
  execFileSync('ln', ['-s', outsideTarget, join(symlinkTmpState, 'tmp')]);
  const badTmpResult = publishPublicResults(makeRecord(), publishOptions(repo, symlinkTmpState));
  assert.equal(badTmpResult.state, 'failed');
  assert.match(badTmpResult.reason, /unsafe state tmp directory/);

  const symlinkStateTarget = join(dir, 'symlink-state-target');
  const symlinkState = join(dir, 'symlinked-state-dir');
  mkdirSync(symlinkStateTarget, { recursive: true });
  execFileSync('ln', ['-s', symlinkStateTarget, symlinkState]);
  const badStateResult = publishPublicResults(
    makeRecord(),
    publishOptions(repo, `${symlinkState}/`),
  );
  assert.equal(badStateResult.state, 'failed');
  assert.match(badStateResult.reason, /unsafe state tmp directory/);
  assert.equal(readFileSync(join(dir, 'outside-secret.json'), 'utf8').includes('keep-me'), true);
  assert.equal(
    git(dir, ['--git-dir', bare, 'show', 'eval-results:latest.json']).includes('lane-one'),
    true,
  );
  assert.equal(existsSync(join(symlinkStateTarget, 'tmp')), false);
});

test('handles unchanged stale remote and push failure', (t) => {
  const dir = makeTempDir(t);
  const bare = join(dir, 'remote.git');
  git(dir, ['init', '-q', '--bare', bare]);
  const repo = createEvalRepo(join(dir, 'fixture'), { remote: bare });
  const newer = makeRecord({ date: '2026-11-27T06:00:00.000Z' });
  assert.equal(
    publishPublicResults(newer, publishOptions(repo, join(dir, 'state'))).state,
    'published',
  );
  assert.equal(
    publishPublicResults(newer, publishOptions(repo, join(dir, 'state'))).state,
    'unchanged',
  );

  const older = makeRecord({ date: '2026-11-27T05:00:00.000Z', sha: 'b'.repeat(40) });
  const stale = publishPublicResults(older, publishOptions(repo, join(dir, 'state')));
  assert.equal(stale.state, 'skipped');
  assert.match(stale.reason, /stale/);
  const current = JSON.parse(git(dir, ['--git-dir', bare, 'show', 'eval-results:latest.json']));
  assert.equal(current.date, newer.finishedAt);

  const rejectBare = join(dir, 'reject-push.git');
  git(dir, ['init', '-q', '--bare', rejectBare]);
  const rejectSeed = join(dir, 'reject-seed');
  mkdirSync(rejectSeed, { recursive: true });
  git(rejectSeed, ['init', '-q']);
  git(rejectSeed, ['config', 'user.email', 'eval@cairn.dev']);
  git(rejectSeed, ['config', 'user.name', 'eval']);
  writeFileSync(
    join(rejectSeed, 'latest.json'),
    `${JSON.stringify({ version: 1, date: '2026-11-26T00:00:00.000Z' })}\n`,
  );
  git(rejectSeed, ['add', 'latest.json']);
  git(rejectSeed, ['commit', '-qm', 'seed reject remote']);
  git(rejectSeed, ['remote', 'add', 'origin', rejectBare]);
  git(rejectSeed, ['push', '-q', 'origin', 'HEAD:eval-results']);
  const hookPath = join(rejectBare, 'hooks', 'pre-receive');
  writeFileSync(hookPath, '#!/bin/sh\necho "push rejected by hook" >&2\nexit 1\n');
  chmodSync(hookPath, 0o755);

  const failingRepo = createEvalRepo(join(dir, 'failing-fixture'), { remote: rejectBare });
  const failed = publishPublicResults(
    makeRecord({ date: '2026-11-27T07:00:00.000Z' }),
    publishOptions(failingRepo, join(dir, 'failed-state')),
  );
  assert.equal(failed.state, 'failed');
  assert.match(failed.reason, /push rejected/);
  const afterRejected = JSON.parse(
    git(dir, ['--git-dir', rejectBare, 'show', 'eval-results:latest.json']),
  );
  assert.equal(afterRejected.date, '2026-11-26T00:00:00.000Z');

  const forkRepo = createEvalRepo(join(dir, 'fork-fixture'), {
    remote: 'https://github.com/example/fork.git',
  });
  const disallowed = publishPublicResults(makeRecord(), {
    repoDir: forkRepo,
    stateDir: join(dir, 'fork-state'),
    env: {},
  });
  assert.equal(disallowed.state, 'failed');
  assert.match(disallowed.reason, /canonical/);

  const pushInsteadOfRepo = createEvalRepo(join(dir, 'push-instead-fixture'), {
    remote: 'https://github.com/xiechimon/cairn.git',
  });
  const hijacked = publishPublicResults(makeRecord(), {
    repoDir: pushInsteadOfRepo,
    stateDir: join(dir, 'hijack-state'),
    env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'url.https://github.com/example/hijack.pushInsteadOf',
      GIT_CONFIG_VALUE_0: 'https://github.com/xiechimon/cairn',
    },
  });
  assert.equal(hijacked.state, 'failed');
  assert.match(hijacked.reason, /canonical/);
});

test('skips partial and non-official runs', (t) => {
  const dir = makeTempDir(t);
  const repo = createEvalRepo(join(dir, 'fixture'));
  const partial = makeRecord();
  partial.items = partial.items.slice(0, 2);
  const built = buildPublicResults(partial, { repoDir: repo, env: {} });
  assert.equal(built.payload, null);
  assert.match(built.skipReason, /complete official/);
  const crashed = { ...makeRecord(), evalExitCode: 1 };
  assert.match(
    buildPublicResults(crashed, { repoDir: repo, env: {} }).skipReason,
    /complete official/,
  );
});
