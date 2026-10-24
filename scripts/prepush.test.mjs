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
    'node scripts/comment-discipline-gate.mjs',
    'node scripts/single-use-helper-gate.mjs',
    'node scripts/baseline-ratchet-gate.mjs',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm spec:parse',
    'node scripts/e2e-affected.mjs --check-coverage',
    'node --test docs/verify/1542/reach.test.mjs',
    'node scripts/prepush-vitest.mjs',
    'pnpm --filter @cairn/web e2e:affected -- apps/web/src/main.tsx',
  ])
    assert.ok(commands.includes(command), command);
});

test('e2e coverage check passes on the real suite and names an unmapped spec', () => {
  const ciCommands = prepushPlan(['apps/web/src/main.tsx'], 'ci').map((args) => args.join(' '));
  assert.ok(ciCommands.includes('node scripts/e2e-affected.mjs --check-coverage'));
  const suite = spawnSync(process.execPath, ['scripts/e2e-affected.mjs', '--check-coverage'], {
    encoding: 'utf8',
  });
  assert.equal(suite.status, 0, suite.stdout);
  const probe = 'apps/web/e2e/zz-unmapped-probe.spec.ts';
  const unmapped = spawnSync(
    process.execPath,
    ['scripts/e2e-affected.mjs', '--check-coverage', probe],
    { encoding: 'utf8' },
  );
  assert.equal(unmapped.status, 1);
  assert.match(unmapped.stdout, new RegExp(`${probe}: no family table entry reaches this spec`));
  const bare = spawnSync(
    process.execPath,
    ['scripts/e2e-affected.mjs', '--check-coverage', 'zz-unmapped-probe.spec.ts'],
    { encoding: 'utf8' },
  );
  assert.equal(bare.status, 1, bare.stdout);
  assert.match(bare.stdout, new RegExp(`${probe}: no family table entry reaches this spec`));
});

test('a board card source change selects the spec that reads its title', () => {
  const plan = spawnSync(
    process.execPath,
    ['scripts/e2e-affected.mjs', '--dry-run', '--', 'apps/web/src/board/todo-card.tsx'],
    { encoding: 'utf8' },
  );
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /\baccent-typo\.spec\.ts\b/);
});

test('CI shares the plan but keeps advisory and full e2e in separate jobs', () => {
  const paths = ['apps/web/src/main.tsx'];
  assert.deepEqual(
    prepushPlan(paths, 'ci'),
    prepushPlan(paths)
      .slice(0, -3)
      .filter((args) => !args[1].endsWith('-gate.mjs') || args[1].startsWith('scripts/ui-')),
  );
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
  process.env.CAIRN_HEAVY_SLOTS_DIR = join(directory, 'heavy-slots');
  const runGit = (args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=prepush-test', '-c', 'user.email=prepush@example.invalid', ...args],
      { cwd: directory, stdio: 'pipe' },
    );
  try {
    mkdirSync(join(directory, 'scripts'));
    copyFileSync('scripts/prepush.mjs', join(directory, 'scripts/prepush.mjs'));
    copyFileSync('scripts/heavy-slots.mjs', join(directory, 'scripts/heavy-slots.mjs'));
    runGit(['init']);
    writeFileSync(join(directory, 'README.md'), 'first\n');
    runGit(['add', 'README.md', 'scripts/prepush.mjs', 'scripts/heavy-slots.mjs']);
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

const gitIn = (cwd, args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=prepush-test', '-c', 'user.email=prepush@example.invalid', ...args],
    { cwd, encoding: 'utf8', stdio: 'pipe' },
  );

const runPrepushCi = (cwd) => {
  const env = { ...process.env };
  delete env.PREPUSH_BASE_SHA;
  return spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
    cwd,
    encoding: 'utf8',
    env,
  });
};

test('a stale local origin/main is refreshed by fetch before computing changes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-prepush-stale-'));
  const remote = join(directory, 'remote.git');
  const upstream = join(directory, 'upstream');
  const work = join(directory, 'work');
  try {
    gitIn(directory, ['init', '--bare', remote]);
    gitIn(directory, ['clone', remote, upstream]);
    mkdirSync(join(upstream, 'scripts'));
    copyFileSync('scripts/prepush.mjs', join(upstream, 'scripts/prepush.mjs'));
    writeFileSync(join(upstream, 'README.md'), 'first\n');
    gitIn(upstream, ['add', 'README.md', 'scripts/prepush.mjs']);
    gitIn(upstream, ['commit', '-m', 'initial']);
    gitIn(upstream, ['push', 'origin', 'HEAD:main']);
    mkdirSync(join(upstream, 'apps'));
    writeFileSync(join(upstream, 'apps/other.ts'), 'export const other = 1;\n');
    gitIn(upstream, ['add', 'apps/other.ts']);
    gitIn(upstream, ['commit', '-m', 'merged elsewhere']);
    gitIn(upstream, ['push', 'origin', 'HEAD:main']);
    const stale = gitIn(upstream, ['rev-parse', 'HEAD~1']).trim();
    gitIn(directory, ['clone', '--branch', 'main', remote, work]);
    gitIn(work, ['update-ref', 'refs/remotes/origin/main', stale]);
    writeFileSync(join(work, 'README.md'), 'second\n');
    gitIn(work, ['add', 'README.md']);
    gitIn(work, ['commit', '-m', 'docs']);
    const result = runPrepushCi(work);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS \(0 checks\)/);
    assert.doesNotMatch(result.stderr, /may be stale/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fetch failure falls back to the local origin/main and prints a stale notice', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-prepush-offline-'));
  const work = join(directory, 'work');
  try {
    gitIn(directory, ['init', work]);
    mkdirSync(join(work, 'scripts'));
    copyFileSync('scripts/prepush.mjs', join(work, 'scripts/prepush.mjs'));
    writeFileSync(join(work, 'README.md'), 'first\n');
    gitIn(work, ['add', 'README.md', 'scripts/prepush.mjs']);
    gitIn(work, ['commit', '-m', 'initial']);
    gitIn(work, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFileSync(join(work, 'README.md'), 'second\n');
    gitIn(work, ['add', 'README.md']);
    gitIn(work, ['commit', '-m', 'docs']);
    const result = runPrepushCi(work);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS \(0 checks\)/);
    assert.match(result.stderr, /git fetch origin main failed.*may be stale/);
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
