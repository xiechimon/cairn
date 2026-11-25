import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
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
