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
import { docReaderTests } from './doc-reader-tests.mjs';
import { readEvents, recordAll } from './lessons-ledger-gate.mjs';
import {
  ciOnlyScripts,
  gateOf,
  hasCode,
  localOnly,
  prepushModules,
  prepushPlan,
  recordInterception,
  runPlan,
  selfTests,
  workflowTestSteps,
} from './prepush.mjs';
import { scrubGateEnv } from './scrub-git-env.mjs';

const prepushFixtureFiles = [
  ...prepushModules,
  'scripts/doc-reader-tests.mjs',
  'scripts/prepush-known-red.json',
];

test('scrubGateEnv drops every gate base SHA and the force-full switch', () => {
  const env = {
    PATH: 'p',
    LANE_FILE_BASE_SHA: 'a',
    ENGLISH_ONLY_BASE_SHA: 'b',
    PREPUSH_BASE_SHA: 'c',
    PREPUSH_FORCE_FULL: 'true',
    GIT_DIR: 'g',
  };
  assert.deepEqual(scrubGateEnv(env), { PATH: 'p', GIT_DIR: 'g' });
  assert.equal(env.LANE_FILE_BASE_SHA, 'a');
});

for (const [name, paths, expected] of [
  ['documents', ['README.md', 'AGENTS.md', 'docs/ops/agent-bot-identity.md', 'LICENSE'], false],
  ['server markdown fixtures', ['apps/server/test/fixtures/x.md'], true],
  ['shared markdown fixtures', ['packages/shared/test/fixtures/plan1606-verification.md'], true],
  ['integration markdown fixtures', ['integration/test/fixtures/x.md'], true],
  [
    'executable evidence',
    [
      'docs/verify/2136/review-check.test.mjs',
      'docs/verify/1/probe.mts',
      'docs/verify/1/run.sh',
      'docs/verify/1/check.py',
    ],
    true,
  ],
  ['non-markdown evidence', ['docs/verify/1/result.json', 'docs/verify/1/shot.png'], false],
  [
    'unknown or executable-like files under docs',
    ['docs/verify/1/drive.tsx', 'docs/verify/1/run', 'docs/verify/1/notes.yaml'],
    true,
  ],
  ['data beside an executable check', ['docs/verify/2136/fixture.json'], true],
  [
    'the #2188 lessons and evidence change',
    [
      'docs/lessons/1678-no-verify-fixup-commit.md',
      'docs/lessons/events.jsonl',
      'docs/verify/2182/README.md',
      'docs/verify/2182/hookspath-green.log',
      'docs/verify/2182/hookspath-red.log',
    ],
    false,
  ],
  ['epic data', ['.claude/epics/E1.0a.json'], false],
  ['code', ['apps/server/src/app.ts', 'scripts/prepush.mjs'], true],
  ['unknown paths', ['new-config', 'package.json', '.claude/epics-other/data.json'], true],
  ['mixed changes', ['README.md', '.claude/epics/E1.0a.json', 'new-config'], true],
  ['empty changes', [], false],
]) {
  test(`hasCode classifies ${name}`, () => {
    assert.equal(hasCode(paths), expected);
    if (name !== 'mixed changes')
      for (const path of paths) assert.equal(hasCode([path]), expected, path);
    assert.equal(
      prepushPlan(paths, 'ci').some((step) => step[1] === 'lint'),
      expected,
    );
  });
}

test('--has-code prints only a boolean, uses the supplied base and fails closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-has-code-'));
  const slots = join(directory, 'unused-slots');
  const run = (base, extraEnv = {}) => {
    const result = spawnSync(process.execPath, ['scripts/prepush.mjs', '--has-code'], {
      cwd: directory,
      encoding: 'utf8',
      env: prepushEnv({ PREPUSH_BASE_SHA: base, CAIRN_HEAVY_SLOTS_DIR: slots, ...extraEnv }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^(true|false)\n$/);
    assert.equal(existsSync(slots), false);
    return result.stdout.trim();
  };
  try {
    mkdirSync(join(directory, 'scripts'));
    for (const file of prepushFixtureFiles) copyFileSync(file, join(directory, file));
    gitIn(directory, ['init']);
    gitIn(directory, ['add', ...prepushFixtureFiles]);
    gitIn(directory, ['commit', '-m', 'initial']);
    const base = gitIn(directory, ['rev-parse', 'HEAD']).trim();
    assert.equal(run(base), 'false');
    writeFileSync(join(directory, 'README.md'), 'docs\n');
    mkdirSync(join(directory, '.claude/epics'), { recursive: true });
    writeFileSync(join(directory, '.claude/epics/E1.0a.json'), '{}\n');
    gitIn(directory, ['add', 'README.md', '.claude/epics/E1.0a.json']);
    gitIn(directory, ['commit', '-m', 'data']);
    assert.equal(run(base), 'false');
    writeFileSync(join(directory, 'unknown-config'), 'code\n');
    assert.equal(run(base), 'true');
    gitIn(directory, ['add', 'unknown-config']);
    assert.equal(run(base), 'true');
    gitIn(directory, ['commit', '-m', 'code']);
    assert.equal(run(base), 'true');
    const codeBase = gitIn(directory, ['rev-parse', 'HEAD']).trim();
    gitIn(directory, ['mv', 'unknown-config', 'renamed.md']);
    assert.equal(run(codeBase), 'true');
    gitIn(directory, ['commit', '-m', 'rename']);
    assert.equal(run(codeBase), 'true');
    gitIn(directory, ['rm', 'renamed.md']);
    assert.equal(run(codeBase), 'true');
    assert.equal(run('missing-ref'), 'true');
    assert.equal(run('0'.repeat(40)), 'true');
    assert.equal(run(base, { PATH: '/nonexistent' }), 'true');
    const extra = spawnSync(process.execPath, ['scripts/prepush.mjs', '--has-code', 'extra'], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(extra.status, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const workflowJobs = () => {
  const [, jobs] = readFileSync('.github/workflows/ci.yml', 'utf8').split('\njobs:\n');
  assert.ok(jobs);
  return new Map(
    jobs.split(/\n(?= {2}[a-z][\w-]*:)/).map((job) => [job.match(/^ {2}([\w-]+):/)[1], job]),
  );
};

test('CI classifies before heavy work and always runs push coverage', () => {
  const jobs = workflowJobs();
  const changes = jobs.get('changes');
  assert.ok(changes);
  assert.match(readFileSync('.github/workflows/ci.yml', 'utf8'), /^jobs:$/m);
  assert.ok(
    readFileSync('.github/workflows/ci.yml', 'utf8').includes(
      "on:\n  push:\n    branches: [main, 'prototype/**']\n  pull_request:\n",
    ),
  );
  assert.match(changes, /has-code: \$\{\{ steps.classify.outputs.has-code \}\}/);
  assert.match(changes, /PREPUSH_BASE_SHA: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.match(changes, /node scripts\/prepush.mjs --has-code/);
  assert.match(changes, /has_code=true/);
  assert.match(changes, /\|\| has_code=true/);
  assert.match(changes, /fetch-depth: 0/);
  assert.doesNotMatch(readFileSync('.github/workflows/ci.yml', 'utf8'), /^ {4}paths(?:-ignore)?:/m);
  for (const name of [
    'vitest-light',
    'vitest-integration',
    'e2e',
    'pack-smoke',
    'dead-class-gate',
  ]) {
    const job = jobs.get(name);
    assert.match(job ?? '', /^ {4}needs: changes$/m, name);
    assert.match(
      job,
      /^ {4}if: github.event_name != 'pull_request' \|\| needs.changes.outputs.has-code != 'false'$/m,
      name,
    );
  }
  for (const [name, suite] of [
    ['vitest-light', 'light'],
    ['vitest-integration', 'integration'],
  ]) {
    const job = jobs.get(name);
    assert.ok(job.includes(`run: VITEST_PROJECT_SET=${suite} pnpm test`));
    assert.match(job, /pnpm install --frozen-lockfile/);
  }
  assert.ok(
    jobs.get('vitest-integration').includes('pnpm exec playwright install chromium --with-deps'),
  );
  assert.ok(!jobs.get('vitest-light').includes('playwright install'));
  const check = jobs.get('check');
  assert.ok(!check.includes('VITEST_PROJECT_SET='));
  assert.ok(!check.includes('playwright install'));
  const core = jobs.get('check-core');
  assert.match(core ?? '', /^ {4}needs: changes$/m);
  assert.doesNotMatch(core, /^ {4}if:/m);
  const verify = core
    .split(/\n(?= {6}- )/)
    .find((step) => step.includes('name: verify-cairn CLI self-test'));
  assert.match(
    verify,
    /if: github.event_name != 'pull_request' \|\| needs.changes.outputs.has-code != 'false'/,
  );
  for (const variable of ['PREPUSH_BASE_SHA', 'ENGLISH_ONLY_BASE_SHA'])
    assert.ok(
      core.includes(
        `${variable}: \${{ github.event.pull_request.base.sha || github.event.before }}`,
      ),
      variable,
    );
  assert.ok(core.includes(`PREPUSH_FORCE_FULL: \${{ github.event_name == 'push' }}`));
  assert.doesNotMatch(core, /0{40}/);
});

test('required aggregates only accept skipped work after a successful docs-only classification', () => {
  const jobs = workflowJobs();
  for (const [name, dependencies] of [
    ['check', ['changes', 'check-core', 'vitest-light', 'vitest-integration']],
    ['e2e-gate', ['changes', 'e2e']],
  ]) {
    const job = jobs.get(name);
    assert.ok(job.includes(`    needs: [${dependencies.join(', ')}]\n`));
    assert.match(job, /^ {4}if: always\(\)$/m);
    assert.doesNotMatch(job, /^ {4}name:/m);
    assert.equal((job.match(/^ {6}- /gm) ?? []).length, 1);
    assert.doesNotMatch(job, /uses:|checkout|continue-on-error/);
    const command = job.match(/run: \|\n([\s\S]*)/)[1].replace(/^ {10}/gm, '');
    const scenarios = [
      Object.fromEntries(dependencies.map((dependency) => [dependency, 'success'])),
    ];
    for (const dependency of dependencies)
      for (const result of ['skipped', 'failure', 'cancelled', 'unknown'])
        scenarios.push({ ...scenarios[0], [dependency]: result });
    scenarios.push(
      Object.fromEntries(
        dependencies.map((dependency) => [
          dependency,
          dependency === 'changes' ? 'success' : 'skipped',
        ]),
      ),
    );
    for (const hasCode of ['true', 'false', '', 'unknown']) {
      for (const results of scenarios) {
        const shell = command.replace(/\$\{\{ (.*?) \}\}/g, (_, expression) => {
          if (expression === 'needs.changes.outputs.has-code') return hasCode;
          const match = /^needs\.([\w-]+)\.result$/.exec(expression);
          assert.ok(match, expression);
          assert.ok(dependencies.includes(match[1]), expression);
          return results[match[1]];
        });
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
          encoding: 'utf8',
        });
        assert.equal(
          result.status === 0,
          results.changes === 'success' &&
            dependencies
              .slice(1)
              .every(
                (dependency) =>
                  results[dependency] === 'success' ||
                  (hasCode === 'false' && results[dependency] === 'skipped'),
              ),
          `${name}: ${hasCode} ${JSON.stringify(results)}`,
        );
      }
    }
  }
});

test('folded gates stay visibly red, continue after failures and retain full history', () => {
  const jobs = workflowJobs();
  const gates = jobs.get('gates');
  assert.ok(gates);
  assert.match(gates, /permissions:\n {6}contents: read\n {6}issues: read/);
  const expected = [
    ['Issue label gate', false, 'GH_TOKEN'],
    ['Feature map staleness gate (#1160)', false],
    ['Comment discipline gate (advisory, #1520)', false, 'COMMENT_DISCIPLINE_BASE_SHA'],
    ['Probe reach gate (advisory, #1542)', false, 'VP_REACH_BASE_SHA'],
    ['Single-use helper gate (advisory, #1543)', false, 'SINGLE_USE_HELPER_BASE_SHA'],
    ['Package names in install commands exist on npm', false],
    ['Funding links gate (#2002)', false],
    ['Dispatch agent start/check round trip (#1556)', false],
    ['Closing keyword gate (advisory, #1541)', true],
    [
      'Baseline ratchet gate and gardener sweep self-test (#1617)',
      true,
      'BASELINE_RATCHET_BASE_SHA',
    ],
  ];
  for (const [name, prOnly, variable] of expected) {
    const step = gates
      .split(/\n(?= {6}- )/)
      .find((step) => step.startsWith(`      - name: ${name}\n`));
    assert.ok(step, name);
    assert.doesNotMatch(step, /continue-on-error:/, name);
    assert.ok(
      step.includes(
        prOnly
          ? `if: \${{ !cancelled() && github.event_name == 'pull_request' }}`
          : `if: \${{ !cancelled() }}`,
      ),
      name,
    );
    if (variable) assert.ok(step.includes(`${variable}:`), name);
  }
  assert.doesNotMatch(gates, /--depth(?:[=\s]|$)/);
  assert.match(gates, /fetch-depth: 0/);
  for (const job of jobs.values()) assert.doesNotMatch(job, /^ {4}needs:.*\bgates\b/m);
  assert.ok(gates.includes(`GH_TOKEN: \${{ github.token }}`));
  assert.ok(jobs.get('dead-class-gate').includes('pnpm prepush --advisory'));
  assert.ok(!jobs.get('check').includes('pnpm prepush --advisory'));
});

test('documentation skips code checks, unknown paths fail closed', () => {
  assert.deepEqual(prepushPlan(['docs/lessons.md', 'AGENTS.md']), [
    ['node', 'scripts/english-only-gate.mjs'],
    ['node', 'scripts/lessons-ledger-gate.mjs'],
    ['node', 'scripts/doc-reader-tests.mjs', 'docs/lessons.md', 'AGENTS.md'],
  ]);
  assert.deepEqual(prepushPlan(['docs/lessons.md'], 'ci'), [
    ['node', 'scripts/english-only-gate.mjs'],
    ['node', 'scripts/lessons-ledger-gate.mjs'],
    ['node', 'scripts/doc-reader-tests.mjs', 'docs/lessons.md'],
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
  for (const path of [
    'scripts/heavy-slots.mjs',
    '.github/workflows/ci.yml',
    'scripts/epic-done.mjs',
    ...selfTests,
    ...selfTests.map((path) => path.replace(/\.test\.mjs$/, '.mjs')),
  ])
    assert.ok(
      prepushPlan([path]).some((args) => args.join(' ') === selfTest.join(' ')),
      path,
    );
  assert.ok(
    !prepushPlan(['apps/web/src/main.tsx']).some((args) => args.join(' ') === selfTest.join(' ')),
  );
});

test('the CI self-test step runs selfTests through prepush and names no self-test file itself', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const checkJob = workflow
    .split(/\n(?= {2}[a-z][\w-]*:)/)
    .find((job) => job.startsWith('  check-core:'));
  const step = /^ {6}- name: Prepush self-test\n((?: {8}.*\n)*)/m.exec(checkJob ?? '');
  assert.equal(step?.[1], '        run: pnpm prepush --self-test\n');
  for (const file of selfTests)
    assert.ok(
      !workflow.includes(file),
      `${file} is named in .github/workflows/ci.yml; list self-test files only in selfTests in scripts/prepush.mjs`,
    );
});

test('--self-test runs exactly the selfTests files, skips change detection and fails with them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-prepush-self-test-'));
  const env = prepushEnv({ CAIRN_HEAVY_SLOTS_DIR: join(directory, 'heavy-slots') });
  delete env.NODE_TEST_CONTEXT;
  const run = () =>
    spawnSync(process.execPath, ['scripts/prepush.mjs', '--self-test'], {
      cwd: directory,
      encoding: 'utf8',
      env,
    });
  try {
    mkdirSync(join(directory, 'scripts'));
    for (const file of prepushFixtureFiles) copyFileSync(file, join(directory, file));
    for (const file of selfTests)
      writeFileSync(
        join(directory, file),
        `import test from 'node:test';\ntest('ran ${file}', () => {});\n`,
      );
    const passing = run();
    assert.equal(passing.status, 0, passing.stdout + passing.stderr);
    assert.ok(
      passing.stdout.includes(`[prepush] node --test ${selfTests.join(' ')}\n`),
      passing.stdout,
    );
    for (const file of selfTests) assert.ok(passing.stdout.includes(`ran ${file}`), file);
    assert.match(passing.stdout, /\[prepush\] PASS \(1 checks\)/);
    writeFileSync(
      join(directory, selfTests.at(-1)),
      `import test from 'node:test';\ntest('red', () => { throw new Error('red'); });\n`,
    );
    const failing = run();
    assert.notEqual(failing.status, 0, failing.stdout);
    assert.doesNotMatch(failing.stdout, /PASS/);
    const extra = spawnSync(process.execPath, ['scripts/prepush.mjs', '--self-test', 'x'], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(extra.status, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
});

test('a ledger entry change runs the ledger gate even when only documents changed', () => {
  const ledgerGate = ['node', 'scripts/lessons-ledger-gate.mjs'];
  for (const mode of ['local', 'ci'])
    for (const path of ['docs/lessons/1656-new-entry.md', 'docs/lessons.md'])
      assert.deepEqual(prepushPlan([path], mode), [
        ['node', 'scripts/english-only-gate.mjs'],
        ledgerGate,
        ['node', 'scripts/doc-reader-tests.mjs', path],
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

test('affected e2e receives executable evidence as code and data evidence as documents', () => {
  const paths = [
    'docs/verify/1/shot.png',
    'docs/verify/2136/review-check.test.mjs',
    'README.md',
    '.claude/epics/E1.json',
    'scripts/evidence-prune.mjs',
  ];
  const plan = prepushPlan(paths);
  assert.deepEqual(
    plan.find((args) => args.includes('e2e:affected')),
    [
      'pnpm',
      '--filter',
      '@cairn/web',
      'e2e:affected',
      '--',
      'docs/verify/2136/review-check.test.mjs',
      'scripts/evidence-prune.mjs',
    ],
  );
  assert.deepEqual(
    plan.find((args) => args[1] === 'scripts/doc-reader-tests.mjs'),
    ['node', 'scripts/doc-reader-tests.mjs', 'docs/verify/1/shot.png', 'README.md'],
  );
});

test('a docs-only data change still runs every test that reads the changed file', () => {
  const data = 'docs/verify/920/wire-new/manifest-new.json';
  assert.deepEqual(prepushPlan(['docs/lessons/events.jsonl', data], 'ci'), [
    ['node', 'scripts/english-only-gate.mjs'],
    ['node', 'scripts/lessons-ledger-gate.mjs'],
    ['node', 'scripts/doc-reader-tests.mjs', 'docs/lessons/events.jsonl', data],
  ]);
  const grep = (doc) => {
    const result = spawnSync(
      'git',
      ['-c', 'color.ui=never', 'grep', '-l', '-F', '-e', doc, '--', '*.test.ts', '*.test.mjs'],
      { encoding: 'utf8' },
    );
    return result.status === 0 ? result.stdout.split('\n').filter(Boolean) : [];
  };
  assert.ok(
    docReaderTests([data], grep, []).vitest.includes(
      'apps/daemon/test/skills-version-skew.test.ts',
    ),
  );
});

test('every node --test step in any workflow runs locally when its tests, sources or workflow change', () => {
  const steps = workflowTestSteps();
  const written = readdirSync('.github/workflows')
    .filter((name) => name.endsWith('.yml'))
    .flatMap(
      (name) => readFileSync(join('.github/workflows', name), 'utf8').match(/node --test\b/g) ?? [],
    );
  assert.equal(steps.length, written.length, 'every node --test step is parsed');
  assert.ok(steps.some(({ workflow }) => workflow === '.github/workflows/silent-revert-gate.yml'));
  assert.ok(steps.some(({ tests }) => tests.includes('scripts/lane-model-policy.test.mjs')));
  for (const { workflow, tests } of steps) {
    const step = ['node', '--test', ...tests].join(' ');
    for (const path of [workflow, tests[0], tests[0].replace(/\.test\.mjs$/, '.mjs')]) {
      assert.equal(
        prepushPlan([path]).filter((args) => args.join(' ') === step).length,
        1,
        `${path} should run ${step} exactly once`,
      );
    }
  }
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
  const requiredJob = jobs.find((job) => job.startsWith('  check-core:'));
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

const prepushEnv = (overrides = {}) => ({ ...scrubGateEnv(), ...overrides });

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
    for (const file of prepushFixtureFiles) copyFileSync(file, join(directory, file));
    runGit(['init']);
    writeFileSync(join(directory, 'README.md'), 'first\n');
    runGit(['add', 'README.md', ...prepushFixtureFiles]);
    runGit(['commit', '-m', 'initial']);
    runGit(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFileSync(join(directory, 'README.md'), 'second\n');
    runGit(['add', 'README.md']);
    runGit(['commit', '-m', 'docs']);
    writeFileSync(join(directory, 'NOTES.md'), 'untracked\n');
    const result = spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
      cwd: directory,
      encoding: 'utf8',
      env: prepushEnv({ PREPUSH_BASE_SHA: 'origin/main' }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS \(2 checks\)/);
    const forced = spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
      cwd: directory,
      encoding: 'utf8',
      env: prepushEnv({ PREPUSH_BASE_SHA: 'origin/main', PREPUSH_FORCE_FULL: 'true' }),
    });
    assert.notEqual(forced.status, 0);
    assert.match(forced.stdout, /english-only-gate: 0 line\(s\)/);
    assert.match(forced.stdout, /prepush.*node scripts\/ui-debt-gate.mjs/);
    writeFileSync(join(directory, 'new.ts'), 'export const probe = 1;\n');
    for (const staged of [false, true]) {
      if (staged) runGit(['add', 'new.ts']);
      const code = spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
        cwd: directory,
        encoding: 'utf8',
        env: prepushEnv({ PREPUSH_BASE_SHA: 'origin/main' }),
      });
      assert.notEqual(code.status, 0);
      assert.match(code.stdout, /prepush.*node scripts\/ui-debt-gate.mjs/);
    }
    const firstPush = spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
      cwd: directory,
      encoding: 'utf8',
      env: prepushEnv({ PREPUSH_BASE_SHA: '0'.repeat(40) }),
    });
    assert.match(firstPush.stdout, /prepush.*node scripts\/ui-debt-gate.mjs/);
    const missing = spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
      cwd: directory,
      encoding: 'utf8',
      env: prepushEnv({ PREPUSH_BASE_SHA: 'missing-ref' }),
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

const runPrepushCi = (cwd) =>
  spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
    cwd,
    encoding: 'utf8',
    env: prepushEnv(),
  });

test('a stale local origin/main is refreshed by fetch before computing changes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-prepush-stale-'));
  const remote = join(directory, 'remote.git');
  const upstream = join(directory, 'upstream');
  const work = join(directory, 'work');
  try {
    gitIn(directory, ['init', '--bare', remote]);
    gitIn(directory, ['clone', remote, upstream]);
    mkdirSync(join(upstream, 'scripts'));
    for (const file of prepushFixtureFiles) copyFileSync(file, join(upstream, file));
    writeFileSync(join(upstream, 'README.md'), 'first\n');
    gitIn(upstream, ['add', 'README.md', ...prepushFixtureFiles]);
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
    assert.match(result.stdout, /PASS \(2 checks\)/);
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
    for (const file of prepushFixtureFiles) copyFileSync(file, join(work, file));
    writeFileSync(join(work, 'README.md'), 'first\n');
    gitIn(work, ['add', 'README.md', ...prepushFixtureFiles]);
    gitIn(work, ['commit', '-m', 'initial']);
    gitIn(work, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFileSync(join(work, 'README.md'), 'second\n');
    gitIn(work, ['add', 'README.md']);
    gitIn(work, ['commit', '-m', 'docs']);
    const result = runPrepushCi(work);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS \(2 checks\)/);
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

test('CI doc-reader checks select the real codeowners reader for identity documentation', () => {
  const path = 'docs/ops/agent-bot-identity.md';
  for (const mode of ['local', 'ci'])
    for (const paths of [[path], ['apps/server/src/app.ts', path]])
      assert.deepEqual(
        prepushPlan(paths, mode).filter((step) => step[1] === 'scripts/doc-reader-tests.mjs'),
        [['node', 'scripts/doc-reader-tests.mjs', path]],
      );
  const readers = docReaderTests(
    [path],
    (doc) =>
      execFileSync('git', ['grep', '-l', '-F', '-e', doc, '--', '*.test.ts', '*.test.mjs'], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n'),
    JSON.parse(readFileSync('scripts/prepush-known-red.json', 'utf8')).map((entry) => entry.file),
  );
  assert.ok(readers.vitest.includes('apps/server/test/codeowners.test.ts'));
});

test('workflow preserves comments about external behavior', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  for (const pattern of [
    /#.*#765.*pnpm.*forwards.*`--`/,
    /#.*#762.*branch protection.*skipped.*success/,
    /#.*trailing version is Dependabot's anchor/,
  ])
    assert.match(workflow, pattern);
  assert.match(workflowJobs().get('vitest-integration'), /#.*integration.*launch real Chromium/);
});

test('forced push coverage preserves the English gate range across multiple commits', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-push-english-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    for (const file of prepushFixtureFiles) copyFileSync(file, join(directory, file));
    gitIn(directory, ['init']);
    gitIn(directory, ['add', ...prepushFixtureFiles]);
    gitIn(directory, ['commit', '-m', 'initial']);
    const before = gitIn(directory, ['rev-parse', 'HEAD']).trim();
    writeFileSync(join(directory, 'README.md'), 'first\n');
    gitIn(directory, ['add', 'README.md']);
    gitIn(directory, ['commit', '-m', '\u4e2d\u6587']);
    const offending = gitIn(directory, ['rev-parse', '--short=10', 'HEAD']).trim();
    writeFileSync(join(directory, 'README.md'), 'second\n');
    gitIn(directory, ['add', 'README.md']);
    gitIn(directory, ['commit', '-m', 'second']);
    const result = spawnSync(process.execPath, ['scripts/prepush.mjs', '--ci'], {
      cwd: directory,
      encoding: 'utf8',
      env: prepushEnv({
        PREPUSH_BASE_SHA: before,
        ENGLISH_ONLY_BASE_SHA: before,
        PREPUSH_FORCE_FULL: 'true',
        CAIRN_HEAVY_SLOTS_DIR: join(directory, 'heavy-slots'),
      }),
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes(`commit ${offending}:1: Chinese text`), result.stderr);
    assert.doesNotMatch(result.stdout, /ui-debt-gate/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
