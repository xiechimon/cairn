import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { scrubGitEnv } from './scrub-git-env.mjs';
import {
  buildReferencing,
  declaredIdentifiers,
  selectTests,
  selectTestsWithReport,
} from './test-changed.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const tests = [
  'apps/daemon/test/computer-host-desktop.test.ts',
  'apps/server/test/machine-computer.test.ts',
  'apps/server/test/coordinator-computer-tool-offers.test.ts',
  'apps/web/test/fleet-status.test.ts',
  'packages/shared/test/snapshot.test.ts',
  'apps/server/test/wire.test.ts',
  'apps/server/test/machine-wire.test.ts',
  'packages/shared/test/vocabulary.test.ts',
];

test('a changed test file is selected', () => {
  assert.deepEqual(selectTests(['apps/web/test/fleet-status.test.ts'], tests), [
    'apps/web/test/fleet-status.test.ts',
  ]);
});

test('a changed source file selects same-package tests whose name contains its basename', () => {
  assert.deepEqual(selectTests(['apps/daemon/src/computer/host-desktop.ts'], tests), [
    'apps/daemon/test/computer-host-desktop.test.ts',
  ]);
  assert.deepEqual(selectTests(['apps/server/src/services/machine-computer.ts'], tests), [
    'apps/server/test/machine-computer.test.ts',
    'apps/server/test/machine-wire.test.ts',
    'apps/server/test/wire.test.ts',
    'packages/shared/test/snapshot.test.ts',
    'packages/shared/test/vocabulary.test.ts',
  ]);
});

test('a shared protocol change runs the contract tests but does not fan out to every importer', () => {
  assert.deepEqual(selectTests(['packages/shared/src/protocol/computer.ts'], tests), [
    'apps/server/test/machine-wire.test.ts',
    'apps/server/test/wire.test.ts',
    'packages/shared/test/snapshot.test.ts',
    'packages/shared/test/vocabulary.test.ts',
  ]);
});

test('a server source change runs the route and schema contract tests', () => {
  assert.deepEqual(selectTests(['apps/server/src/routes-computers.ts'], tests), [
    'apps/server/test/machine-wire.test.ts',
    'apps/server/test/wire.test.ts',
    'packages/shared/test/snapshot.test.ts',
    'packages/shared/test/vocabulary.test.ts',
  ]);
});

const auditTests = [
  'apps/web/test/anti-slop-foundations.test.ts',
  'apps/web/test/brand-assets.test.ts',
  'apps/web/test/color-token-duplicates.test.ts',
  'apps/web/test/gallery-coverage.test.ts',
  'apps/web/test/i18n-coverage.test.ts',
  'apps/web/test/unslop-signs.test.ts',
  'packages/shared/test/vocabulary.test.ts',
  'packages/shared/test/test-tmp-ratchet.test.ts',
];

test('tree-scanning audit tests run when the scanned trees change', () => {
  for (const change of [
    'apps/web/src/i18n/en.js',
    'apps/web/src/styles/app.css',
    'apps/web/index.html',
  ])
    for (const audit of auditTests.filter((file) => file.startsWith('apps/web/')))
      assert.ok(selectTests([change], auditTests).includes(audit), `${change}: ${audit}`);
  assert.ok(
    selectTests(['scripts/brand/logo.mjs'], auditTests).includes(
      'apps/web/test/brand-assets.test.ts',
    ),
  );
  for (const change of ['apps/server/test/x.test.ts', 'scripts/release.mjs'])
    assert.ok(
      selectTests([change], auditTests).includes('packages/shared/test/test-tmp-ratchet.test.ts'),
      change,
    );
  assert.ok(
    !selectTests(['apps/web/e2e/overlay-focus.spec.ts'], auditTests).includes(
      'apps/web/test/i18n-coverage.test.ts',
    ),
  );
});

test('docs and other packages select nothing', () => {
  assert.deepEqual(selectTests(['docs/design/mac-vm-computer.md'], tests), []);
});

test('a deleted test file is not selected', () => {
  assert.deepEqual(selectTests(['apps/daemon/test/gone.test.ts'], tests), []);
});

test('a changed create_todo behavior selects the tests that exercise it without being named after the file', () => {
  const exercising = [
    'apps/server/test/mcp-entry.test.ts',
    'apps/server/test/coordinator/source-binding.test.ts',
    'apps/server/test/coordinator-source-binding.test.ts',
  ];
  const protocol = [
    'export const CHIEF_REMOTE_TOOLS = [',
    '  {',
    "    name: 'create_todo',",
    "    description: 'Create a todo',",
    '  },',
    '];',
  ].join('\n');
  assert.deepEqual(declaredIdentifiers(protocol, [4]), ['CHIEF_REMOTE_TOOLS', 'create_todo']);
  const referencing = (file) =>
    file === 'apps/server/src/services/coordinator-request.ts'
      ? exercising.map((candidate) => [candidate, 1])
      : [];
  const selected = selectTests(
    [
      'apps/server/src/services/coordinator-request.ts',
      'packages/shared/src/protocol/chief-tools.ts',
    ],
    [...tests, ...exercising],
    [],
    referencing,
  );
  for (const candidate of exercising) assert.equal(selected.includes(candidate), true);
});

test('a schema or migration change runs every old-database migration test', () => {
  const migrationTests = ['apps/server/test/research-retirement.test.ts'];
  for (const change of [
    'apps/server/src/db/schema.ts',
    'apps/server/drizzle/0184_machine_own_computer_enabled.sql',
  ])
    assert.deepEqual(
      selectTests([change], [...tests, ...migrationTests], migrationTests).includes(
        'apps/server/test/research-retirement.test.ts',
      ),
      true,
    );
});

test('buildReferencing scores matching tests in memory without spawning git per identifier', () => {
  const readCounts = new Map();
  const referencing = buildReferencing({
    readSource: () => 'export function buildPlanRoute() {}\nexport function unusedHelper() {}',
    diffFor: () => '',
    tests: ['apps/server/test/plan.test.ts', 'apps/server/test/other.test.ts'],
    readTest: (file) => {
      readCounts.set(file, (readCounts.get(file) ?? 0) + 1);
      return file.includes('plan') ? 'expect(buildPlanRoute()).toBeTruthy()' : 'unrelated';
    },
  });
  assert.deepEqual(referencing('apps/server/src/services/plan-route.ts'), [
    ['apps/server/test/plan.test.ts', 1],
  ]);
  assert.deepEqual(referencing('apps/server/src/services/plan-route.ts'), [
    ['apps/server/test/plan.test.ts', 1],
  ]);
  assert.equal(readCounts.get('apps/server/test/plan.test.ts'), 1);
});

test('stem matching prioritizes exact filename match and caps broad fan-out', () => {
  const manyRunnerTests = [
    ...Array.from(
      { length: 12 },
      (_, i) => `apps/daemon/test/runner-extra-${String(i).padStart(2, '0')}.test.ts`,
    ),
    'apps/daemon/test/runner.test.ts',
  ];
  const report = selectTestsWithReport(['apps/daemon/src/runner.ts'], manyRunnerTests);
  assert.equal(report.selected.length, 8);
  assert.equal(report.selected.includes('apps/daemon/test/runner.test.ts'), true);
  assert.equal(report.dropped.length, 5);
});

function runOnMachineWithoutHeavyRuns(testFiles) {
  const root = makeTestTempDir('test-changed-local-');
  const env = scrubGitEnv({ ...process.env });
  for (const name of ['CI', 'CAIRN_MINI_TEST', 'CAIRN_LOCAL_HEAVY']) delete env[name];
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, env },
    );
  try {
    git('init', '-q');
    writeFileSync(join(root, '.gitignore'), 'bin/\n');
    mkdirSync(join(root, 'apps/server/test'), { recursive: true });
    writeFileSync(join(root, 'apps/server/test/migration.test.ts'), 'migrateUpTo(1);\n');
    git('add', '.gitignore', 'apps/server/test/migration.test.ts');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(join(root, 'apps/web/test'), { recursive: true });
    for (const name of testFiles) writeFileSync(join(root, 'apps/web/test', name), 'export {};\n');
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin/pnpm'), '#!/bin/sh\necho "vitest started: $*"\nexit 1\n');
    chmodSync(join(root, 'bin/pnpm'), 0o755);
    return spawnSync(process.execPath, [join(import.meta.dirname, 'test-changed.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...env,
        PATH: `${join(root, 'bin')}${delimiter}${env.PATH}`,
        CAIRN_HEAVY_GATE_BYPASS: '1',
      },
    });
  } finally {
    releaseTestTempDir(root);
  }
}

test('a machine that refuses multi-file runs defers them to CI instead of failing', () => {
  const run = runOnMachineWithoutHeavyRuns(['one.test.ts', 'two.test.ts']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.doesNotMatch(run.stdout, /vitest started/);
  assert.match(run.stdout, /none ran here/);
});

test('a single related test file still runs on that machine', () => {
  const run = runOnMachineWithoutHeavyRuns(['one.test.ts']);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /vitest started: exec vitest run apps\/web\/test\/one\.test\.ts/);
});
