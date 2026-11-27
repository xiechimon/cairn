import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import * as fastGate from './preflight-fast-gate.mjs';
import {
  committedPaths,
  exactTreeError,
  extractFailedTestFiles,
  fastGatePlan,
  fastGateShellCommand,
  parseGateWrapper,
  readLastFailedTests,
  runFastGate,
  typecheckPackagesForPaths,
} from './preflight-fast-gate.mjs';

test('typecheck package selection follows package blast radius', () => {
  assert.deepEqual(typecheckPackagesForPaths(['scripts/ops/preflight.mjs']), []);
  assert.deepEqual(typecheckPackagesForPaths(['apps/web/src/App.tsx']), ['@cairn/web']);
  assert.deepEqual(typecheckPackagesForPaths(['apps/server/src/index.ts']), [
    '@xiechimon/cairn',
    '@cairn/integration',
  ]);
  assert.deepEqual(typecheckPackagesForPaths(['apps/daemon/src/machine-client.ts']), [
    '@xiechimon/cairn-cli',
    '@cairn/integration',
  ]);
  assert.deepEqual(typecheckPackagesForPaths(['packages/shared/src/protocol/wire.ts']), [
    '@cairn/shared',
    '@xiechimon/cairn',
    '@cairn/web',
    '@xiechimon/cairn-cli',
    '@cairn/desktop',
    '@cairn/integration',
  ]);
  assert.deepEqual(typecheckPackagesForPaths(['pnpm-lock.yaml']), [
    '@cairn/shared',
    '@xiechimon/cairn',
    '@cairn/web',
    '@xiechimon/cairn-cli',
    '@cairn/desktop',
    '@cairn/integration',
  ]);
});

test('fast gate plan is revert guard, cheap checks, static regression, biome, touched package typechecks, then changed tests', () => {
  assert.deepEqual(fastGatePlan(['apps/web/src/App.tsx', 'apps/server/src/index.ts']), [
    REVERT_GUARD_STEP,
    CHEAP_STEP,
    ['node', 'scripts/regression-inversion-gate.mjs', '--mode', 'static'],
    ['pnpm', 'lint'],
    ['pnpm', '--filter', '@xiechimon/cairn', 'typecheck'],
    ['pnpm', '--filter', '@cairn/web', 'typecheck'],
    ['pnpm', '--filter', '@cairn/integration', 'typecheck'],
    ['pnpm', 'test:changed'],
  ]);
});

test('fast gate runs capacity and merge-queue checks for CI scheduling changes', () => {
  const plan = fastGatePlan(['scripts/ops/push-queue.mjs', '.github/workflows/ci.yml']);
  const rendered = plan.map((step) => step.join(' '));
  assert.ok(rendered.includes('node scripts/ops/ci-capacity-gate.mjs'));
  assert.ok(
    rendered.includes(
      'node --test scripts/ops/merge-queue-invariants.test.mjs scripts/ops/ci-capacity-gate.test.mjs scripts/ops/push-queue.test.mjs scripts/ops/speculative-queue.test.mjs scripts/workflow-concurrency.test.mjs scripts/workflow-scalars.test.mjs scripts/ci-tiers.test.mjs',
    ),
  );
  assert.ok(
    rendered.indexOf('node scripts/ops/ci-capacity-gate.mjs') <
      rendered.indexOf('pnpm test:changed'),
  );
});

test('exact tree and committed path helpers read only the committed candidate', () => {
  const root = makeTestTempDir('preflight-fast-gate-');
  try {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    writeFileSync(join(root, 'one.txt'), 'one\n');
    git(['add', 'one.txt']);
    git(['commit', '-m', 'init']);
    mkdirSync(join(root, 'refs'));
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFileSync(join(root, 'two.txt'), 'two\n');
    git(['add', 'two.txt']);
    git(['commit', '-m', 'candidate']);
    assert.equal(exactTreeError(root), null);
    assert.deepEqual(committedPaths(root), ['two.txt']);
    writeFileSync(join(root, 'scratch.txt'), 'scratch\n');
    assert.match(exactTreeError(root) ?? '', /does not exactly match HEAD/);
  } finally {
    releaseTestTempDir(root);
  }
});

test('runFastGate stops before test:changed when a typecheck fails', () => {
  const calls = [];
  const result = runFastGate({
    cwd: process.cwd(),
    wrapper: '',
    checkTree: () => null,
    listPaths: () => ['apps/web/src/App.tsx'],
    spawn: (command, args) => {
      calls.push([command, ...args].join(' '));
      return { status: args.includes('typecheck') ? 1 : 0 };
    },
    log: () => {},
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /failed on the exact HEAD tree/);
  assert.ok(calls.some((call) => call.includes('typecheck')));
  assert.ok(!calls.some((call) => call === 'pnpm test:changed'));
});

test('CAIRN_PREFLIGHT_GATE_WRAPPER runs the full fast-gate plan in one sh -c call', () => {
  assert.deepEqual(parseGateWrapper('  remote-runner   /tmp/wt --  '), [
    'remote-runner',
    '/tmp/wt',
    '--',
  ]);
  assert.equal(
    fastGateShellCommand([
      ['pnpm', 'lint'],
      ['pnpm', '--filter', '@cairn/web', 'typecheck'],
      ['pnpm', 'test:changed'],
    ]),
    'pnpm lint && pnpm --filter @cairn/web typecheck && pnpm test:changed',
  );

  const calls = [];
  const ok = runFastGate({
    cwd: '/wt',
    wrapper: 'remote-runner /wt --',
    checkTree: () => null,
    listPaths: () => ['apps/web/src/App.tsx'],
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
    log: () => {},
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.wrapped, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    command: 'remote-runner',
    args: [
      '/wt',
      '--',
      'sh',
      '-c',
      'node scripts/ops/revert-guard.mjs && node scripts/ops/preflight-fast-gate.mjs --cheap-checks && node scripts/regression-inversion-gate.mjs --mode static && pnpm lint && pnpm --filter @cairn/web typecheck && pnpm test:changed',
    ],
    options: { cwd: '/wt', stdio: 'inherit' },
  });

  const failed = runFastGate({
    cwd: '/wt',
    wrapper: 'remote-runner --',
    checkTree: () => null,
    listPaths: () => ['scripts/ops/preflight.mjs'],
    spawn: () => ({ status: 2 }),
    log: () => {},
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 2);
  assert.match(failed.error, /remote-runner failed on the exact HEAD tree/);
});

test('fastGatePlan puts previously failed vitest files first and runFastGate clears cache on pass', () => {
  assert.deepEqual(fastGatePlan(['apps/web/src/App.tsx'], ['apps/web/test/remote-host.test.ts']), [
    REVERT_GUARD_STEP,
    CHEAP_STEP,
    ['node', 'scripts/regression-inversion-gate.mjs', '--mode', 'static'],
    ['pnpm', 'exec', 'vitest', 'run', 'apps/web/test/remote-host.test.ts'],
    ['pnpm', 'lint'],
    ['pnpm', '--filter', '@cairn/web', 'typecheck'],
    ['pnpm', 'test:changed'],
  ]);

  const root = makeTestTempDir('preflight-fail-first-');
  try {
    mkdirSync(join(root, 'apps/web/test'), { recursive: true });
    const testRel = 'apps/web/test/sample.test.ts';
    writeFileSync(join(root, testRel), 'export {};\n');
    const cachePath = join(root, 'cache.json');
    const reportPath = `${cachePath}.report.json`;
    writeFileSync(
      cachePath,
      JSON.stringify({ failedTests: [testRel, 'apps/web/test/gone.test.ts'] }),
    );
    assert.deepEqual(readLastFailedTests(cachePath, root), [testRel]);

    const calls = [];
    const failFirst = runFastGate({
      cwd: root,
      wrapper: '',
      checkTree: () => null,
      listPaths: () => ['apps/web/src/App.tsx'],
      cachePath,
      spawn: (command, args) => {
        calls.push([command, ...args].join(' '));
        return { status: args.includes(testRel) ? 1 : 0 };
      },
      log: () => {},
    });
    assert.equal(failFirst.ok, false);
    assert.deepEqual(calls, [
      REVERT_GUARD_STEP.join(' '),
      CHEAP_STEP.join(' '),
      'node scripts/regression-inversion-gate.mjs --mode static',
      `pnpm exec vitest run ${testRel}`,
    ]);
    assert.equal(existsSync(cachePath), true);

    writeFileSync(
      reportPath,
      JSON.stringify({
        testResults: [
          { name: join(root, testRel), status: 'failed' },
          { name: join(root, 'apps/web/test/ok.test.ts'), status: 'passed' },
        ],
      }),
    );
    assert.deepEqual(extractFailedTestFiles(reportPath, root), [testRel]);

    const passed = runFastGate({
      cwd: root,
      wrapper: '',
      checkTree: () => null,
      listPaths: () => ['apps/web/src/App.tsx'],
      cachePath,
      spawn: () => ({ status: 0 }),
      log: () => {},
    });
    assert.equal(passed.ok, true);
    assert.equal(existsSync(cachePath), false);
    assert.equal(existsSync(reportPath), false);
  } finally {
    releaseTestTempDir(root);
  }
});

test('cached failures that this machine refuses to run together do not block the gate', () => {
  const root = makeTestTempDir('preflight-cached-multi-');
  try {
    mkdirSync(join(root, 'apps/web/test'), { recursive: true });
    const failedTests = ['apps/web/test/one.test.ts', 'apps/web/test/two.test.ts'];
    for (const file of failedTests) writeFileSync(join(root, file), 'export {};\n');
    const cachePath = join(root, 'cache.json');
    writeFileSync(cachePath, JSON.stringify({ failedTests }));
    const calls = [];
    const result = runFastGate({
      cwd: root,
      wrapper: '',
      env: {},
      checkTree: () => null,
      listPaths: () => ['apps/web/src/App.tsx'],
      cachePath,
      spawn: (command, args) => {
        calls.push([command, ...args].join(' '));
        return { status: args.includes('vitest') ? 1 : 0 };
      },
      log: () => {},
    });
    assert.equal(result.ok, true, result.error);
    assert.ok(calls.includes('pnpm test:changed'));
  } finally {
    releaseTestTempDir(root);
  }
});

const REVERT_GUARD_STEP = ['node', 'scripts/ops/revert-guard.mjs'];
const CHEAP_STEP = ['node', 'scripts/ops/preflight-fast-gate.mjs', '--cheap-checks'];
const CI_TEXT = readFileSync(join(import.meta.dirname, '../../.github/workflows/ci.yml'), 'utf8');
const selected = (paths, workflow = CI_TEXT) =>
  fastGate.ciChecks(workflow, paths).checks.map((step) => step.slice(1).join(' '));
const oneStep = (step, jobIf = 'always()') =>
  `jobs:\n  gates:\n    if: ${jobIf}\n    steps:\n      - name: new step\n        ${step}\n`;

test('every step in the real CI workflow can be classified, and no skip entry is stale', () => {
  for (const paths of [['apps/server/src/app.ts'], ['docs/spec/a.md']]) {
    assert.deepEqual(fastGate.ciChecks(CI_TEXT, paths).unclassified, []);
  }
  assert.deepEqual(fastGate.staleSkips(CI_TEXT), []);
});

test('a docs-only head gets every check CI runs for it, including those outside prepush', () => {
  const docs = selected(['.claude/skills/verify-cairn/feature-map.md']);
  for (const check of [
    'scripts/generate-feature-map.mjs --check',
    'scripts/generate-canon.mjs --check',
    'scripts/migration-main-gate.mjs',
    'scripts/ops/ci-capacity-gate.mjs',
    'scripts/ui-registry-gate.mjs',
    'scripts/ui-consumer-shape-gate.mjs',
    'scripts/public-content-gate.mjs',
  ])
    assert.ok(docs.includes(check), `${check} is missing`);
  assert.ok(!docs.includes('scripts/ui-debt-gate.mjs'));
  assert.ok(
    !docs.some((check) => check.includes('--check-reach')),
    'an advisory step must not block',
  );
  const code = selected(['apps/web/src/a.ts']);
  assert.ok(code.includes('scripts/ui-debt-gate.mjs'));
  assert.ok(code.includes('scripts/test-integrity-gate.mjs'));
  assert.ok(code.includes('scripts/plan-gate.mjs'));
  assert.ok(!docs.includes('scripts/plan-gate.mjs'));
  assert.ok(!code.includes('scripts/comment-discipline-gate.mjs'));
});

test('a new CI check is picked up with the condition CI gives it', () => {
  for (const run of [
    'run: node scripts/brand-new-gate.mjs',
    'run: node --no-warnings ./scripts/brand-new-gate.cjs',
    'run: node scripts/ops/ci-failed-only.mjs step --key k -- node scripts/brand-new-gate.ts',
  ])
    assert.equal(selected(['a.ts'], oneStep(run)).length, 1, run);
  const gated = oneStep(
    'run: node scripts/brand-new-gate.mjs',
    "needs.changes.outputs.has-code != 'false'",
  );
  assert.equal(selected(['a.ts'], gated).length, 1);
  assert.equal(selected(['docs/a.md'], gated).length, 0);
  const advisory = oneStep('continue-on-error: true\n        run: node scripts/brand-new-gate.mjs');
  assert.deepEqual(fastGate.ciChecks(advisory, ['a.ts']), { checks: [], unclassified: [] });
});

test('a CI step that cannot be classified is reported', () => {
  for (const workflow of [
    oneStep('run: node scripts/brand-new-thing.mjs'),
    oneStep('run: pnpm brand:new-gate'),
    oneStep('run: scripts/brand-new.sh'),
    oneStep('run: test -z "$(git ls-files secrets)"'),
    oneStep('run: node scripts/brand-new-gate.mjs', 'matrix.shard == 1'),
    oneStep(
      'run: node scripts/brand-new-gate.mjs',
      "needs.changes.outputs.ops-selftests == 'true'",
    ),
  ])
    assert.equal(fastGate.ciChecks(workflow, ['a.ts']).unclassified.length, 1, workflow);
});

function runCheap(overrides) {
  const lines = [];
  return fastGate
    .runCheapChecks({
      cwd: '/wt',
      resolveBase: () => 'abc123',
      select: () => ({ checks: [['node', 'a.mjs']], unclassified: [] }),
      log: (line) => lines.push(line),
      ...overrides,
    })
    .then((status) => ({ status, output: lines.join('\n') }));
}

test('cheap checks get the pushed base and no inherited override', async () => {
  const seen = [];
  const { status } = await runCheap({
    env: { TEST_INTEGRITY_BASE_SHA: 'stale', ENGLISH_ONLY_BASE_SHA: 'stale' },
    run: async (_step, { env }) => {
      seen.push(env);
      return { status: 0, output: '' };
    },
  });
  assert.equal(status, 0);
  assert.equal(seen[0].PREPUSH_BASE_SHA, 'abc123');
  assert.equal(seen[0].TEST_INTEGRITY_BASE_SHA, undefined);
  assert.equal(seen[0].ENGLISH_ONLY_BASE_SHA, undefined);
});

test('every failure is reported, and anything that cannot run is red', async () => {
  const exits = { 'a.mjs': 1, 'b.mjs': null, 'c.mjs': 0 };
  const failed = await runCheap({
    select: () => ({
      checks: Object.keys(exits).map((script) => ['node', script]),
      unclassified: [],
    }),
    run: async ([, script]) => ({ status: exits[script], output: `${script} said no` }),
  });
  assert.equal(failed.status, 2);
  assert.match(
    failed.output,
    /a\.mjs said no[\s\S]*b\.mjs said no|b\.mjs said no[\s\S]*a\.mjs said no/,
  );
  assert.match(failed.output, /1\/3 passed/);
  for (const override of [
    { resolveBase: () => '' },
    { select: () => ({ checks: [], unclassified: [] }) },
    { select: () => ({ checks: [['node', 'a.mjs']], unclassified: ['new step: pnpm x'] }) },
  ])
    assert.equal((await runCheap(override)).status, 2);
});

test('a really failing check reaches pre-flight as a non-zero exit', async () => {
  const real = (code) =>
    runCheap({
      cwd: process.cwd(),
      select: () => ({ checks: [[process.execPath, '-e', code]], unclassified: [] }),
    }).then((result) => result.status);
  assert.equal(await real('process.exit(0)'), 0);
  assert.equal(await real('process.exit(1)'), 1);
  assert.equal(await real("process.kill(process.pid, 'SIGKILL')"), 2);
  const root = makeTestTempDir('cheap-checks-cli-');
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    const cli = join(import.meta.dirname, 'preflight-fast-gate.mjs');
    assert.equal(spawnSync(process.execPath, [cli, '--cheap-checks'], { cwd: root }).status, 2);
  } finally {
    releaseTestTempDir(root);
  }
});

test('a long failure reaches a pipe in full, ending with the summary', () => {
  const root = makeTestTempDir('cheap-checks-pipe-');
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root });
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    mkdirSync(join(root, 'scripts'));
    writeFileSync(
      join(root, '.github/workflows/ci.yml'),
      'jobs:\n  c:\n    steps:\n      - run: node scripts/loud-gate.mjs\n',
    );
    writeFileSync(
      join(root, 'scripts/loud-gate.mjs'),
      "process.stdout.write('bad line\\n'.repeat(200000)); process.exitCode = 1;\n",
    );
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'fixture');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const cli = join(import.meta.dirname, 'preflight-fast-gate.mjs');
    const result = spawnSync(
      'sh',
      ['-c', '"$0" "$1" --cheap-checks | cat', process.execPath, cli],
      { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 },
    );
    assert.equal(result.stdout.match(/^bad line$/gm).length, 200000);
    assert.match(result.stdout, /0\/1 passed in [\d.]+s\n$/);
  } finally {
    releaseTestTempDir(root);
  }
});

test('a check run through the retry script still runs in the local fast gate', () => {
  const wrapped = oneStep('run: bash scripts/ci-retry.sh node scripts/brand-new-gate.mjs');
  assert.deepEqual(selected(['docs/spec/a.md'], wrapped), ['scripts/brand-new-gate.mjs']);
});

test('runFastGate fails if the worktree becomes dirty while checks are running', () => {
  let dirty = false;
  const result = runFastGate({
    cwd: '/wt',
    wrapper: '',
    checkTree: () =>
      dirty
        ? 'the worktree does not exactly match HEAD; commit or remove the uncommitted files so the gate tests the tree that preflight pushes'
        : null,
    listPaths: () => ['scripts/ops/preflight.mjs'],
    spawn: () => {
      dirty = true;
      return { status: 0 };
    },
    log: () => {},
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /does not exactly match HEAD/);
});
