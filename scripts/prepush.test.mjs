import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepushPlan } from './prepush.mjs';

test('documentation skips code checks, unknown paths fail closed', () => {
  assert.deepEqual(prepushPlan(['docs/lessons.md', 'AGENTS.md']), []);
  assert.ok(prepushPlan(['new-config']).length > 0);
});

test('local code checks include both UI gates and affected e2e', () => {
  const commands = prepushPlan(['apps/web/src/main.tsx']).map((args) => args.join(' '));
  for (const command of [
    'node scripts/ci-job-structure-gate.mjs',
    'node scripts/ui-debt-gate.mjs',
    'node scripts/ui-drift-gate.mjs',
    'node scripts/ui-dead-class-gate.mjs --compile',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm spec:parse',
    'node scripts/prepush-vitest.mjs',
    'pnpm --filter @cairn/web e2e:affected -- apps/web/src/main.tsx',
  ])
    assert.ok(commands.includes(command), command);
});

test('CI shares the plan but keeps advisory and full e2e in separate jobs', () => {
  const paths = ['apps/web/src/main.tsx'];
  assert.deepEqual(prepushPlan(paths, 'ci'), prepushPlan(paths).slice(0, -3));
  assert.deepEqual(prepushPlan(paths, 'advisory'), [
    ['node', 'scripts/ui-dead-class-gate.mjs', '--compile'],
  ]);
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const jobs = workflow.split(/\n(?= {2}[a-z][\w-]*:)/);
  const requiredJob = jobs.find((job) => job.startsWith('  check:'));
  const advisoryJob = jobs.find((job) => job.startsWith('  dead-class-gate:'));
  assert.ok(requiredJob?.includes('run: pnpm prepush --ci'));
  assert.ok(!requiredJob?.includes('run: pnpm prepush --advisory'));
  assert.ok(advisoryJob?.includes('run: pnpm prepush --advisory'));
  for (const job of [requiredJob, advisoryJob]) {
    assert.ok(job?.includes('PREPUSH_BASE_SHA:'));
    assert.ok(job?.includes('fetch-depth: 0'));
  }
  for (const command of [
    'pnpm prepush --ci',
    'pnpm prepush --advisory',
    'pnpm prepush --e2e-shard',
  ]) {
    assert.ok(workflow.includes(`run: ${command}`));
  }
  for (const command of [
    'pnpm lint',
    'pnpm typecheck',
    'pnpm spec:parse',
    'node scripts/ui-debt-gate.mjs',
    'node scripts/ui-drift-gate.mjs',
    'node scripts/ui-dead-class-gate.mjs',
  ]) {
    assert.ok(!workflow.includes(`run: ${command}`));
  }
});

test('CLI skips real document changes and rejects a missing base', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-prepush-'));
  const runGit = (args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=prepush-test', '-c', 'user.email=prepush@example.invalid', ...args],
      { cwd: directory, stdio: 'pipe' },
    );
  try {
    mkdirSync(join(directory, 'scripts'));
    copyFileSync('scripts/prepush.mjs', join(directory, 'scripts/prepush.mjs'));
    runGit(['init']);
    writeFileSync(join(directory, 'README.md'), 'first\n');
    runGit(['add', 'README.md', 'scripts/prepush.mjs']);
    runGit(['commit', '-m', 'initial']);
    runGit(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFileSync(join(directory, 'README.md'), 'second\n');
    runGit(['add', 'README.md']);
    runGit(['commit', '-m', 'docs']);
    writeFileSync(join(directory, 'NOTES.md'), 'untracked\n');
    const result = spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, PREPUSH_BASE_SHA: 'origin/main' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS \(0 checks\)/);
    writeFileSync(join(directory, 'new.ts'), 'export const probe = 1;\n');
    for (const staged of [false, true]) {
      if (staged) runGit(['add', 'new.ts']);
      const code = spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, PREPUSH_BASE_SHA: 'origin/main' },
      });
      assert.notEqual(code.status, 0);
      assert.match(code.stdout, /prepush.*node scripts\/ui-debt-gate.mjs/);
    }
    const firstPush = spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, PREPUSH_BASE_SHA: '0'.repeat(40) },
    });
    assert.match(firstPush.stdout, /prepush.*node scripts\/ui-debt-gate.mjs/);
    const missing = spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, PREPUSH_BASE_SHA: 'missing-ref' },
    });
    assert.notEqual(missing.status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('prepush vitest only forgives files listed as known local red', async () => {
  const { unexpectedFailures } = await import('./prepush-vitest.mjs');
  const known = [{ file: 'a/known.test.ts', reason: 'r' }];
  const report = {
    testResults: [
      { name: '/r/a/known.test.ts', status: 'failed' },
      { name: '/r/b/new.test.ts', status: 'failed' },
      { name: '/r/c/ok.test.ts', status: 'passed' },
    ],
  };
  assert.deepEqual(unexpectedFailures(report, known, '/r'), {
    unexpected: ['b/new.test.ts'],
    knownFailed: ['a/known.test.ts'],
  });
});
