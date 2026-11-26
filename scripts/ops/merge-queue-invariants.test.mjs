import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectVerifiedPriorRun } from './ci-reuse-verified.mjs';
import {
  commitCommentsApiArgs,
  DEFAULT_POLL_SECONDS,
  isTransientGitNetworkError,
} from './push-queue.mjs';
import { MAX_SPECULATIVE_DEPTH } from './speculative-queue.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('safety invariant: merge-gate-paths protects CI workflows, ops scripts, and eval suites', () => {
  const gatePaths = JSON.parse(read('packages/shared/merge-gate-paths.json'));
  assert.ok(gatePaths.protected.includes('.github/**'));
  assert.ok(gatePaths.protected.includes('**/scripts/**'));
  assert.ok(gatePaths.humanQueue.releaseAndControlPlane.includes('scripts/ops/**'));
  assert.ok(gatePaths.humanQueue.evalConfig.includes('eval/**'));
});

test('safety invariant: promote workflow keeps main-only environment, serialized concurrency, and speculative enforcer', () => {
  const promote = read('.github/workflows/promote.yml');
  assert.match(promote, /group:\s*promote-main/);
  assert.match(promote, /cancel-in-progress:\s*false/);
  assert.match(promote, /environment:\s*desktop-release/);
  assert.match(promote, /run:\s*node scripts\/ops\/speculative-queue\.mjs --enforce/);
});

test('safety invariant: ci workflow keeps green-main contexts, non-cancelling queue groups, and verified-only reuse', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/);
  assert.match(ci, /reused-sha:\s*\$\{\{\s*steps\.reuse\.outputs\.reused-sha\s*\}\}/);
  assert.match(ci, /GITHUB_REF"\s*=\s*"refs\/heads\/main"/);
  assert.match(ci, /scripts\/ops\/ci-reuse-verified\.mjs/);
  assert.match(ci, /scripts\/ops\/merge-queue-invariants\.test\.mjs/);
  assert.match(ci, /node scripts\/ops\/ci-capacity-gate\.mjs/);
});

test('safety invariant: reuse never covers a tree without green ci, and main stays bound to the exact sha', () => {
  const green = {
    id: 1,
    name: 'ci',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_sha: 'b'.repeat(40),
    head_branch: 'preflight/host/lane',
    head_commit: { tree_id: 'c'.repeat(40) },
  };
  const reuses = (ref, tree, run = green) =>
    selectVerifiedPriorRun({
      ref,
      eventName: 'push',
      repo: 'xiechimon/cairn',
      sha: 'a'.repeat(40),
      tree,
      hasSidecar: false,
      evalRequired: false,
      runs: [run],
      jobsOf: () =>
        ['check', 'pack-smoke', 'e2e-gate'].map((name) => ({ name, conclusion: 'success' })),
    }).reuse;
  assert.equal(reuses('refs/heads/queue/try/1-a', 'c'.repeat(40)), true);
  assert.equal(reuses('refs/heads/queue/try/1-a', 'd'.repeat(40)), false);
  assert.equal(
    reuses('refs/heads/queue/try/1-a', 'c'.repeat(40), { ...green, conclusion: 'failure' }),
    false,
  );
  assert.equal(reuses('refs/heads/main', 'c'.repeat(40)), false);
  assert.equal(reuses('refs/heads/preflight/host/lane', 'c'.repeat(40)), false);
});

test('safety invariant: no ci job can fail while all three required contexts stay green', () => {
  const jobs = new Map(
    read('.github/workflows/ci.yml')
      .split('\njobs:\n')[1]
      .split(/^(?= {2}[\w-]+:$)/m)
      .map((block) => [/^ {2}([\w-]+):$/m.exec(block)?.[1], block])
      .filter(([name]) => name),
  );
  const covered = new Set();
  const cover = (name) => {
    if (covered.has(name)) return;
    covered.add(name);
    const needs = /^ {4}needs: (?:\[([^\]]+)\]|([\w-]+))$/m.exec(jobs.get(name));
    for (const dependency of (needs?.[1] ?? needs?.[2] ?? '').split(',')) {
      const trimmed = dependency.trim();
      if (!trimmed) continue;
      const aggregated = new RegExp(`needs\\.${trimmed}\\.result`).test(jobs.get(name));
      if (aggregated) cover(trimmed);
    }
  };
  for (const required of ['check', 'pack-smoke', 'e2e-gate']) cover(required);
  assert.deepEqual(
    [...jobs.keys()].filter((name) => !covered.has(name)),
    [],
  );
});

test('safety invariant: speculative queue verifies admission checks and never force-pushes main', () => {
  const spec = read('scripts/ops/speculative-queue.mjs');
  assert.match(spec, /REQUIRED_CHECKS/);
  assert.match(spec, /commits\/\$\{sha\}\/check-runs/);
  assert.match(spec, /GIT_COMMITTER_NAME:\s*'xiechimon'/);
  assert.doesNotMatch(spec, /'push'[^\n]*'--force'[^\n]*refs\/heads\/main/);
});

test('efficiency invariant: queue depth, poll cadence, shard cap, and poll resilience stay bounded', () => {
  assert.ok(
    MAX_SPECULATIVE_DEPTH >= 2 && MAX_SPECULATIVE_DEPTH <= 6,
    `MAX_SPECULATIVE_DEPTH=${MAX_SPECULATIVE_DEPTH} out of [2, 6]`,
  );
  assert.ok(
    DEFAULT_POLL_SECONDS >= 5 && DEFAULT_POLL_SECONDS <= 20,
    `DEFAULT_POLL_SECONDS=${DEFAULT_POLL_SECONDS} out of [5, 20]`,
  );
  assert.equal(
    isTransientGitNetworkError(new Error('LibreSSL SSL_connect: SSL_ERROR_SYSCALL')),
    true,
  );
  assert.equal(commitCommentsApiArgs('xiechimon/cairn', 'a'.repeat(40))[0], 'api');

  const ci = read('.github/workflows/ci.yml');
  const integrationBlock = ci.split('\n  vitest-integration:')[1]?.split('\n  e2e:')[0] ?? '';
  const shardMatch = /shard:\s*\[([^\]]+)\]/.exec(integrationBlock);
  assert.ok(shardMatch, 'vitest-integration defines a shard matrix');
  const shards = shardMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  assert.ok(shards.length >= 1 && shards.length <= 2, `vitest-integration shards=${shards.length}`);
});

test('governance invariant: AGENTS.md locks merge-queue edits to invariant and efficiency checks', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /scripts\/ops\/merge-queue-invariants\.test\.mjs/);
  assert.match(agents, /green-main/);
});

test('efficiency & safety invariant: failed-only rerun binds to exact sha/run/attempt and covers every ci test job', () => {
  const ci = read('.github/workflows/ci.yml');
  for (const jobName of [
    'check-core',
    'vitest-light',
    'vitest-integration',
    'e2e',
    'e2e-affected',
    'tsnet-sidecar',
    'gates',
  ]) {
    const block = ci.split(`\n  ${jobName}:`)[1]?.split(/\n {2}[a-z][\w-]*:/)[0] ?? '';
    assert.match(
      block,
      /uses:\s*\.\/\.github\/actions\/failed-only-restore/,
      `${jobName} restores state`,
    );
    assert.match(
      block,
      /if:\s*[^\n]*failure\(\)[\s\S]*?uses:\s*\.\/\.github\/actions\/failed-only-save/,
      `${jobName} saves state on job failure`,
    );
  }
  const saveAction = read('.github/actions/failed-only-save/action.yml');
  assert.doesNotMatch(
    saveAction,
    /\bif:\s*failure\(\)/,
    'composite save action must not guard itself with if: failure() because caller step owns failure condition',
  );
  const mac = read('.github/workflows/desktop-mac.yml');
  for (const jobName of ['update-signature', 'package']) {
    const block = mac.split(`\n  ${jobName}:`)[1]?.split(/\n {2}[a-z][\w-]*:/)[0] ?? '';
    assert.match(
      block,
      /uses:\s*\.\/\.github\/actions\/failed-only-restore/,
      `mac.${jobName} restores state`,
    );
    assert.match(
      block,
      /uses:\s*\.\/\.github\/actions\/failed-only-save/,
      `mac.${jobName} saves state`,
    );
  }
  const state = read('scripts/ci-failed-only-state.mjs');
  assert.match(state, /parsed\.sha !== sha/);
  assert.match(state, /parsed\.attempt !== attempt - 1/);
  assert.match(state, /parsed\.jobKey !== jobKey/);
});
