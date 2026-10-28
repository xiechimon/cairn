import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readEvents, recordAll } from './lessons-ledger-gate.mjs';
import {
  ciOnlyScripts,
  gateOf,
  localOnly,
  prepushModules,
  prepushPlan,
  recordInterception,
  runPlan,
  selfTests,
} from './prepush.mjs';

test('documentation skips code checks, unknown paths fail closed', () => {
  assert.deepEqual(prepushPlan(['docs/lessons.md', 'AGENTS.md']), [
    ['node', 'scripts/english-only-gate.mjs'],
    ['node', 'scripts/lessons-ledger-gate.mjs'],
    ['node', 'scripts/doc-reader-tests.mjs', 'docs/lessons.md', 'AGENTS.md'],
  ]);
  assert.deepEqual(prepushPlan(['docs/lessons.md'], 'ci'), [
    ['node', 'scripts/english-only-gate.mjs'],
    ['node', 'scripts/lessons-ledger-gate.mjs'],
  ]);
  assert.deepEqual(
    prepushPlan(['apps/server/src/app.ts', 'docs/ops/langfuse.md']).filter(
      (args) => args[1] === 'scripts/doc-reader-tests.mjs',
    ),
    [['node', 'scripts/doc-reader-tests.mjs', 'docs/ops/langfuse.md']],
  );
  assert.deepEqual(prepushPlan(['docs/lessons.md'], 'advisory'), [
    ['node', 'scripts/ui-dead-class-gate.mjs', '--compile'],
  ]);
  assert.ok(prepushPlan(['new-config']).length > 0);
});

test('changes to prepush scripts run the CI self-test files locally', () => {
  const selfTest = ['node', '--test', ...selfTests];
  assert.ok(
    prepushPlan(['scripts/heavy-slots.mjs']).some((args) => args.join(' ') === selfTest.join(' ')),
  );
  assert.ok(
    !prepushPlan(['apps/web/src/main.tsx']).some((args) => args.join(' ') === selfTest.join(' ')),
  );
  assert.ok(
    readFileSync('.github/workflows/ci.yml', 'utf8').includes(`run: ${selfTest.join(' ')}\n`),
  );
});

test('escape-trace tests stay mandatory for every code prepush plan', () => {
  const step = 'node --test scripts/escape-trace.test.mjs';
  for (const mode of ['local', 'ci']) {
    for (const paths of [
      ['apps/server/src/app.ts'],
      ['scripts/prepush.mjs'],
      ['.github/workflows/ci.yml'],
      ['scripts/escape-trace.mjs'],
    ])
      assert.ok(
        prepushPlan(paths, mode)
          .map((args) => args.join(' '))
          .includes(step),
        `${mode} ${paths.join(',')}`,
      );
  }
});

test('the recording gate runs in local prepush, in CI prepush and in the CI self-test step', () => {
  const gate = 'node scripts/recording-gate.mjs';
  for (const mode of ['local', 'ci'])
    assert.ok(
      prepushPlan(['apps/web/src/board/card.tsx'], mode)
        .map((args) => args.join(' '))
        .includes(gate),
      mode,
    );
  assert.ok(selfTests.includes('scripts/recording-gate.test.mjs'));
  assert.ok(
    /scripts\/(prepush|heavy-slots|english-only-gate|lessons-ledger-gate|recording-gate|scrub-git-env|doc-reader-tests)/.test(
      'scripts/recording-gate.mjs',
    ),
  );
  assert.ok(
    readFileSync('.github/workflows/ci.yml', 'utf8').includes('scripts/recording-gate.test.mjs'),
  );
});

test('a ledger entry change runs the ledger gate even when only documents changed', () => {
  const ledgerGate = ['node', 'scripts/lessons-ledger-gate.mjs'];
  for (const mode of ['local', 'ci'])
    for (const path of ['docs/lessons/1656-new-entry.md', 'docs/lessons.md'])
      assert.deepEqual(prepushPlan([path], mode), [
        ['node', 'scripts/english-only-gate.mjs'],
        ledgerGate,
        ...(mode === 'local' ? [['node', 'scripts/doc-reader-tests.mjs', path]] : []),
      ]);
  assert.ok(
    prepushPlan(['apps/web/src/main.tsx'], 'ci').some(
      (args) => args.join(' ') === ledgerGate.join(' '),
    ),
  );
});

test('local code checks include both UI gates and affected e2e', () => {
  const commands = prepushPlan(['apps/web/src/main.tsx']).map((args) => args.join(' '));
  for (const command of [
    'node scripts/ci-job-structure-gate.mjs',
    'node scripts/feature-map-staleness-gate.mjs',
    'node scripts/english-only-gate.mjs',
    'node scripts/lessons-ledger-gate.mjs',
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

test('every CI node scripts step also runs in local prepush or is listed as CI-only', () => {
  const local = prepushPlan(['apps/web/src/main.tsx']).map((args) => args.join(' '));
  const ciScripts = [
    ...readFileSync('.github/workflows/ci.yml', 'utf8').matchAll(/node (scripts\/[\w-]+\.mjs)\n/g),
  ].map((match) => match[1]);
  assert.ok(ciScripts.includes('scripts/ui-registry-gate.mjs'));
  for (const script of ciScripts)
    assert.ok(
      local.includes(`node ${script}`) || script in ciOnlyScripts,
      `${script} runs in CI but not in local prepush; add it to prepushPlan or ciOnlyScripts`,
    );
  for (const script of Object.keys(ciOnlyScripts)) assert.ok(ciScripts.includes(script), script);
});

test('a web change runs the whole web unit suite, which catches tests that read sources instead of importing them', () => {
  const webSuite = 'pnpm --filter @cairn/web test';
  assert.ok(
    prepushPlan(['apps/web/src/components/ui/skeleton.tsx'])
      .map((args) => args.join(' '))
      .includes(webSuite),
  );
  assert.ok(
    !prepushPlan(['apps/server/src/index.ts'])
      .map((args) => args.join(' '))
      .includes(webSuite),
  );
});

test('local gates default their base to the merge-base, not the moving origin/main tip', () => {
  for (const file of readdirSync('scripts').filter((name) => /-gate\.mjs$/.test(name)))
    assert.doesNotMatch(
      readFileSync(join('scripts', file), 'utf8'),
      /\|\|\s*'origin\/main'/,
      `scripts/${file} falls back to the origin/main tip; use git merge-base origin/main HEAD`,
    );
});

test('affected e2e gets only code paths, so a bulk evidence prune fits on the command line', () => {
  const evidence = Array.from({ length: 5000 }, (_, i) => `docs/verify/${i}/shot.png`);
  const e2e = (paths) =>
    prepushPlan(paths)
      .filter((args) => args.includes('e2e:affected'))
      .map((args) => args.join(' '));
  assert.deepEqual(e2e([...evidence, 'scripts/evidence-prune.mjs']), [
    'pnpm --filter @cairn/web e2e:affected -- scripts/evidence-prune.mjs',
  ]);
  assert.deepEqual(e2e([...evidence, 'README.md', '.github/workflows/ci.yml']), [
    'pnpm --filter @cairn/web e2e:affected -- .github/workflows/ci.yml',
  ]);
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
    prepushPlan(paths).filter(
      (args) =>
        !localOnly.some((local) => local.join(' ') === args.join(' ')) &&
        !['node scripts/prepush-vitest.mjs', 'pnpm --filter @cairn/web test'].includes(
          args.join(' '),
        ) &&
        !args.includes('e2e:affected') &&
        !args.includes('--compile'),
    ),
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
    for (const file of prepushModules) copyFileSync(file, join(directory, file));
    runGit(['init']);
    writeFileSync(join(directory, 'README.md'), 'first\n');
    runGit(['add', 'README.md', ...prepushModules]);
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
    assert.match(result.stdout, /PASS \(1 checks\)/);
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
    for (const file of prepushModules) copyFileSync(file, join(upstream, file));
    writeFileSync(join(upstream, 'README.md'), 'first\n');
    gitIn(upstream, ['add', 'README.md', ...prepushModules]);
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
    assert.match(result.stdout, /PASS \(1 checks\)/);
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
    for (const file of prepushModules) copyFileSync(file, join(work, file));
    writeFileSync(join(work, 'README.md'), 'first\n');
    gitIn(work, ['add', 'README.md', ...prepushModules]);
    gitIn(work, ['commit', '-m', 'initial']);
    gitIn(work, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFileSync(join(work, 'README.md'), 'second\n');
    gitIn(work, ['add', 'README.md']);
    gitIn(work, ['commit', '-m', 'docs']);
    const result = runPrepushCi(work);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS \(1 checks\)/);
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

test('plan children do not inherit the git hook repository binding', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-prepush-hook-env-'));
  const victim = join(directory, 'victim');
  const scratch = join(directory, 'scratch');
  try {
    gitIn(directory, ['init', '-q', victim]);
    mkdirSync(scratch);
    runPlan([['git', 'init', '-q']], {
      cwd: scratch,
      env: { ...process.env, GIT_DIR: join(victim, '.git') },
    });
    assert.equal(gitIn(victim, ['config', 'core.bare']).trim(), 'false');
    assert.equal(gitIn(scratch, ['rev-parse', '--is-inside-work-tree']).trim(), 'true');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('only gate scripts are mapped to a ledger category when a step goes red', () => {
  assert.equal(
    gateOf(['node', 'scripts/comment-discipline-gate.mjs']),
    'scripts/comment-discipline-gate.mjs',
  );
  assert.equal(gateOf(['node', '--test', 'scripts/prepush.test.mjs']), null);
  assert.equal(gateOf(['pnpm', 'lint']), null);
  assert.equal(gateOf(['node', 'scripts/e2e-affected.mjs', '--check-coverage']), null);
});

test('a gate that blocks a push records one intercept for every entry whose safeguard names it', () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-prepush-intercept-'));
  try {
    mkdirSync(join(root, 'docs/lessons'), { recursive: true });
    for (const [name, safeguard] of [
      ['2001-comment-discipline.md', '`scripts/comment-discipline-gate.mjs` checks added lines'],
      ['2002-unrelated-gate.md', '`scripts/single-use-helper-gate.mjs` checks helpers'],
    ])
      writeFileSync(
        join(root, 'docs/lessons', name),
        `---\nCategory: a symptom\nSource: #1\nLevel: 2\nSafeguard: ${safeguard}; since 2026-10-20\nIntercepts: 0\nRecurrences: 0\nNotes: kept\n---\n`,
      );
    const gate = 'scripts/comment-discipline-gate.mjs';
    const log = join(root, 'gate-log.jsonl');
    const env = { CAIRN_REPO: 'xiechimon/cairn', CAIRN_BRANCH: 'lane/2023', CAIRN_GATE_LOG: log };
    assert.equal(recordInterception({ root, gate, env }), 1);
    assert.equal(recordInterception({ root, gate, env }), 1);
    recordAll(
      root,
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    );
    assert.equal(readEvents(root).length, 1);
    assert.equal(readEvents(root)[0].category, 'comment-discipline');
    assert.match(
      readFileSync(join(root, 'docs/lessons', '2001-comment-discipline.md'), 'utf8'),
      /^Intercepts: 1$/m,
    );
    assert.equal(recordInterception({ root, gate: 'scripts/no-such-gate.mjs', env }), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function interceptRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'docs/lessons'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, 'docs/lessons/2001-comment-discipline.md'),
    '---\nCategory: a symptom\nSource: #1\nLevel: 2\nSafeguard: `scripts/comment-discipline-gate.mjs`; since 2026-10-20\nIntercepts: 0\nRecurrences: 0\nNotes: kept\n---\n',
  );
  writeFileSync(join(root, 'scripts/comment-discipline-gate.mjs'), 'process.exit(3);\n');
  return root;
}

test('a red gate step leaves the repository untouched and still exits non-zero', () => {
  const root = interceptRepo('cairn-prepush-red-');
  try {
    const exits = [];
    runPlan([['node', 'scripts/comment-discipline-gate.mjs']], {
      cwd: root,
      env: { ...process.env, CAIRN_BRANCH: 'lane/2023' },
      exit: (code) => exits.push(code),
    });
    assert.deepEqual(exits, [3]);
    assert.equal(readEvents(root).length, 0);
    assert.match(
      readFileSync(join(root, 'docs/lessons/2001-comment-discipline.md'), 'utf8'),
      /^Intercepts: 0$/m,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retrying the same gate on the same branch after another commit records nothing new', () => {
  const root = interceptRepo('cairn-prepush-retry-');
  try {
    const log = join(root, 'gate-log.jsonl');
    const env = { ...process.env, CAIRN_BRANCH: 'lane/2023', CAIRN_GATE_LOG: log };
    const exits = [];
    for (const commit of ['first', 'second']) {
      runPlan([['node', 'scripts/comment-discipline-gate.mjs']], {
        cwd: root,
        env: { ...env, CAIRN_HEAD: commit },
        exit: (code) => exits.push(code),
      });
    }
    assert.deepEqual(exits, [3, 3]);
    recordAll(
      root,
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    );
    assert.equal(readEvents(root).length, 1);
    assert.match(
      readFileSync(join(root, 'docs/lessons/2001-comment-discipline.md'), 'utf8'),
      /^Intercepts: 1$/m,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CAIRN_GATE_LOG appends the gate-red events for a CI job to collect', () => {
  const root = interceptRepo('cairn-prepush-log-');
  try {
    const log = join(root, '.cairn', 'gate-log.jsonl');
    const env = { ...process.env, CAIRN_BRANCH: 'lane/2023', CAIRN_GATE_LOG: log };
    runPlan([['node', 'scripts/comment-discipline-gate.mjs']], { cwd: root, env, exit: () => {} });
    runPlan([['node', 'scripts/comment-discipline-gate.mjs']], {
      cwd: root,
      env,
      exit: () => {},
    });
    const logged = readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(logged.length, 2);
    assert.equal(logged[0].category, 'comment-discipline');
    assert.equal(logged[0].branch, 'lane/2023');
    assert.equal(readEvents(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a checkout without docs/lessons, or CAIRN_LESSONS_LEDGER=0, leaves the tree untouched', () => {
  const bare = mkdtempSync(join(tmpdir(), 'cairn-prepush-bare-'));
  const off = interceptRepo('cairn-prepush-off-');
  try {
    const before = readdirSync(bare);
    assert.equal(
      recordInterception({ root: bare, gate: 'scripts/comment-discipline-gate.mjs', env: {} }),
      0,
    );
    assert.deepEqual(readdirSync(bare), before);
    assert.equal(
      recordInterception({
        root: off,
        gate: 'scripts/comment-discipline-gate.mjs',
        env: { CAIRN_LESSONS_LEDGER: '0', CAIRN_BRANCH: 'lane/2023' },
      }),
      0,
    );
    assert.equal(existsSync(join(off, 'docs/lessons/events.jsonl')), false);
  } finally {
    rmSync(bare, { recursive: true, force: true });
    rmSync(off, { recursive: true, force: true });
  }
});

test('logging is opt-in and never projects counters into the checkout', () => {
  const root = interceptRepo('cairn-log-opt-in-');
  try {
    const path = join(root, 'docs/lessons/2001-comment-discipline.md');
    const before = readFileSync(path, 'utf8');
    assert.equal(
      recordInterception({ root, gate: 'scripts/comment-discipline-gate.mjs', env: {} }),
      0,
    );
    assert.equal(readEvents(root).length, 0);
    const log = join(root, 'external.jsonl');
    recordInterception({
      root,
      gate: 'scripts/comment-discipline-gate.mjs',
      env: { CAIRN_GATE_LOG: log, CAIRN_BRANCH: 'lane/1' },
    });
    assert.equal(JSON.parse(readFileSync(log, 'utf8')).branch, 'lane/1');
    assert.equal(readEvents(root).length, 0);
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
