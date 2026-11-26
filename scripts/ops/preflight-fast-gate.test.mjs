import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test('fast gate plan is biome, touched package typechecks, then changed tests', () => {
  assert.deepEqual(fastGatePlan(['apps/web/src/App.tsx', 'apps/server/src/index.ts']), [
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
      'pnpm lint && pnpm --filter @cairn/web typecheck && pnpm test:changed',
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
    assert.deepEqual(calls, [`pnpm exec vitest run ${testRel}`]);
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
    '.claude/skills/verify-cairn/scripts/vp-registry-gate.mjs --check-reach',
    'scripts/ops/ci-capacity-gate.mjs',
    'scripts/ui-registry-gate.mjs',
    'scripts/ui-consumer-shape-gate.mjs',
    'scripts/public-content-gate.mjs',
  ])
    assert.ok(docs.includes(check), `${check} is missing`);
  assert.ok(!docs.includes('scripts/ui-debt-gate.mjs'));
  const code = selected(['apps/web/src/a.ts']);
  assert.ok(code.includes('scripts/ui-debt-gate.mjs'));
  assert.ok(code.includes('scripts/test-integrity-gate.mjs'));
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
