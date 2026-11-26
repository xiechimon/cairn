import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { contextFromEnv, readPrevState, recordStepState } from './ci-failed-only-state.mjs';
import { mergeBase } from './diff-base.mjs';
import { acquireSlot, leaseEnv } from './heavy-slots.mjs';
import { OWNED_PROCESS_CLI } from './owned-process.mjs';
import { scrubGitEnv } from './scrub-git-env.mjs';

const root = resolve(import.meta.dirname, '..');

export const prepushModules = [
  'scripts/prepush.mjs',
  'scripts/ci-failed-only-state.mjs',
  'scripts/heavy-slots.mjs',
  'scripts/owned-process.mjs',
  'scripts/english-only-gate.mjs',
  'scripts/public-content-gate.mjs',
  'scripts/public-content-allowlist.json',
  'scripts/journal-newline-gate.mjs',
  'scripts/test-integrity-gate.mjs',
  'scripts/regression-test-ledger.mjs',
  'scripts/regression-test-ledger.json',
  'scripts/diff-base.mjs',
  'scripts/scrub-git-env.mjs',
  'scripts/import-cycle-gate.mjs',
  'scripts/conflict-marker-gate.mjs',
  'scripts/drizzle-drift-gate.mjs',
  'scripts/doc-refs-gate.mjs',
  'scripts/doc-retired-terms-gate.mjs',
  'scripts/doc-retired-terms.json',
  'scripts/living-docs.mjs',
];

export const ciOnlyScripts = {
  'scripts/migration-main-gate.mjs':
    'compares committed PR additions against freshly fetched main; local uncommitted migrations are outside HEAD',
  'scripts/css-mechanism-gate.mjs': 'greps the apps/web/dist build the CI e2e step writes',
};

export const ciOnlyTestSteps = {
  'scripts/ops/backup-server-db.test.mjs':
    'needs GNU rsync 3.x and the rrsync script the gates job downloads',
};

export const selfTests = [
  'scripts/ops/push-test.test.mjs',
  'scripts/ops/push-worker.test.mjs',
  'scripts/ops/ci-reuse-verified.test.mjs',
  'scripts/ops/ci-failed-only.test.mjs',
  'scripts/ops/merge-queue-invariants.test.mjs',
  'scripts/ops/preflight-fast-gate.test.mjs',
  'scripts/ops/ci-capacity-gate.test.mjs',
  'scripts/regression-inversion-gate.test.mjs',
  'scripts/flake-ledger.test.mjs',
  'scripts/test-integrity-gate.test.mjs',
  'scripts/regression-test-ledger.test.mjs',
  'scripts/prepush.test.mjs',
  'scripts/heavy-slots.test.mjs',
  'scripts/test-admission.test.mjs',
  'scripts/owned-process.test.mjs',
  'scripts/spawn-ownership.test.mjs',
  'scripts/english-only-gate.test.mjs',
  'scripts/public-content-gate.test.mjs',
  'scripts/journal-newline-gate.test.mjs',
  'scripts/doc-reader-tests.test.mjs',
  'scripts/doc-refs-gate.test.mjs',
  'scripts/doc-retired-terms-gate.test.mjs',
  'scripts/import-cycle-gate.test.mjs',
  'scripts/epic-done.test.mjs',
  'scripts/agent-rules.test.mjs',
  'scripts/test-changed.test.mjs',
  'scripts/design-rules-for.test.mjs',
  'scripts/dead-runtime-exports-gate.test.mjs',
  'scripts/product-surface-gate.test.mjs',
  'scripts/ui-debt-gate.test.mjs',
];

const selfTest = ['node', '--test', ...selfTests];

export const localOnly = [
  ['node', 'scripts/comment-discipline-gate.mjs'],
  ['node', 'scripts/ui-registry-gate.mjs'],
  ['node', 'scripts/ui-consumer-shape-gate.mjs'],
  ['node', 'scripts/generate-feature-map.mjs', '--check'],
  ['node', 'scripts/generate-canon.mjs', '--check'],
];

const SOURCE_TREES = /^(apps|packages|integration)\//;
const MARKDOWN = /(?:\.md$|^LICENSE$)/;
const DATA =
  /\.(?:png|jpe?g|gif|webp|svg|webm|mp4|log|txt|json|jsonl|ndjson|csv|drawio|diff|html)$/;
const EXECUTABLE = /\.(?:[cm]?[jt]sx?|sh|bash|zsh|py)$/;

function isDocument(path) {
  if (SOURCE_TREES.test(path)) return false;
  if (MARKDOWN.test(path)) return true;
  if (!path.startsWith('docs/') || !DATA.test(path)) return false;
  const dir = join(root, dirname(path));
  return !existsSync(dir) || !readdirSync(dir).some((name) => EXECUTABLE.test(name));
}

export function hasCode(paths) {
  return paths.some((path) => !path.startsWith('.claude/epics/') && !isDocument(path));
}

const SIDECAR_INPUTS = ['apps/tsnet-sidecar/'];

export function hasSidecar(paths) {
  return paths.some((path) => SIDECAR_INPUTS.some((input) => path.startsWith(input)));
}

export function needsGates(paths, testsRead) {
  return hasCode(paths) || paths.some((path) => !path.startsWith('docs/') || testsRead(path));
}

const FEATURE_REGISTRY = '.claude/skills/verify-cairn/feature-map.json';

const OPS_SELFTEST_PATHS =
  /^(?:scripts\/|\.github\/|\.claude\/skills\/verify-cairn\/scripts\/|ops\/langfuse\/|packages\/shared\/|package\.json$|pnpm-lock\.yaml$)/;
const DRIZZLE_CHANGE = /^apps\/server\/(?:drizzle\/|src\/db\/schema\.ts$)/;
const conflictMarker = ['node', 'scripts/conflict-marker-gate.mjs'];

export function testsRead(path) {
  const result = spawnSync(
    'git',
    [
      '-c',
      'color.ui=never',
      'grep',
      '-l',
      '-F',
      '-e',
      path,
      '--',
      '*.test.ts',
      '*.test.mjs',
      FEATURE_REGISTRY,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status === 1) return false;
  if (result.status !== 0) throw new Error(result.stderr);
  return true;
}

export function workflowTestSteps(workflows = join(root, '.github/workflows')) {
  if (!existsSync(workflows)) return [];
  return readdirSync(workflows)
    .filter((name) => name.endsWith('.yml'))
    .flatMap((name) =>
      [
        ...readFileSync(join(workflows, name), 'utf8').matchAll(
          /node --test((?: [\w./-]+\.test\.mjs)+)/g,
        ),
      ].map((match) => ({
        workflow: `.github/workflows/${name}`,
        tests: match[1].trim().split(' '),
      })),
    );
}

export function prepushPlan(paths, mode = 'local', forceFull = false) {
  const advisory = [['node', 'scripts/ui-dead-class-gate.mjs', '--compile']];
  if (mode === 'advisory') return advisory;
  const language = ['node', 'scripts/english-only-gate.mjs'];
  const publicContent = ['node', 'scripts/public-content-gate.mjs'];
  const codePaths = paths.filter((path) => hasCode([path]));
  const docPaths = paths.filter(isDocument);
  if (codePaths.length === 0 && !forceFull) {
    const checks = [
      language,
      publicContent,
      conflictMarker,
      ['node', 'scripts/doc-refs-gate.mjs'],
      ['node', 'scripts/doc-retired-terms-gate.mjs'],
    ];
    checks.push(['node', 'scripts/doc-reader-tests.mjs', ...docPaths]);
    return checks;
  }
  const required = [
    language,
    publicContent,
    conflictMarker,
    ['node', 'scripts/doc-refs-gate.mjs'],
    ['node', 'scripts/doc-retired-terms-gate.mjs'],
    ['node', 'scripts/journal-newline-gate.mjs'],
    ['node', 'scripts/ui-debt-gate.mjs'],
    ['node', 'scripts/flake-ledger.mjs'],
    ['node', 'scripts/test-integrity-gate.mjs'],
    ['node', 'scripts/regression-test-ledger.mjs'],
    ['node', 'scripts/product-surface-gate.mjs'],
    ['node', 'scripts/ui-drift-gate.mjs'],
    ['node', 'scripts/ui-page-style-gate.mjs'],
    ['node', 'scripts/test-tmp-ratchet-gate.mjs'],
    ['node', 'scripts/packaged-journey-gate.mjs'],
    ['node', 'scripts/visual-baseline-gate.mjs'],
    ['node', 'scripts/import-cycle-gate.mjs'],
    ['node', 'scripts/dead-runtime-exports-gate.mjs'],
    ['pnpm', 'lint'],
    ['pnpm', 'typecheck'],
    ['pnpm', 'spec:parse'],
    ['node', 'scripts/e2e-affected.mjs', '--check-coverage'],
    ['node', '--test', 'scripts/probe-reach.test.mjs'],
    ['node', '--test', 'scripts/escape-trace.test.mjs'],
    ['node', '--test', 'scripts/review-escapes.test.mjs'],
    ...(docPaths.length ? [['node', 'scripts/doc-reader-tests.mjs', ...docPaths]] : []),
  ];
  const opsSelftests = paths.some((path) => OPS_SELFTEST_PATHS.test(path));
  const local = [
    ...required,
    ...localOnly,
    ...(opsSelftests ||
    paths.some(
      (path) =>
        path === '.github/workflows/ci.yml' ||
        path === 'apps/web/playwright.config.ts' ||
        path === 'apps/web/e2e/port-holder-guard.ts' ||
        selfTests.some(
          (selfTest) => path === selfTest || path === selfTest.replace(/\.test\.mjs$/, '.mjs'),
        ) ||
        /^scripts\/(prepush|heavy-slots|owned-process|spawn-ownership|english-only-gate|public-content|scrub-git-env|doc-reader-tests)/.test(
          path,
        ),
    )
      ? [selfTest]
      : []),
    ...(opsSelftests ? [['node', '.claude/skills/verify-cairn/scripts/vp-selftest.mjs']] : []),
    ...(paths.some((path) => DRIZZLE_CHANGE.test(path))
      ? [
          ['pnpm', '--filter', '@xiechimon/cairn', 'db:check'],
          ['pnpm', '--filter', '@xiechimon/cairn', 'db:generate'],
          ['node', 'scripts/drizzle-drift-gate.mjs'],
        ]
      : []),
  ];
  return mode === 'ci'
    ? required
    : [
        ...local,
        ...workflowTestSteps()
          .filter(({ workflow, tests }) =>
            paths.some(
              (path) =>
                path === workflow ||
                tests.some(
                  (test) => path === test || path === test.replace(/\.test\.mjs$/, '.mjs'),
                ),
            ),
          )
          .filter(({ tests }) => !tests.some((test) => test in ciOnlyTestSteps))
          .map(({ tests }) => ['node', '--test', ...tests])
          .filter((step) => !local.some((args) => args.join(' ') === step.join(' '))),
        ...advisory,
      ];
}

export const NODE_TEST_TIMEOUT_MS = 300_000;
const STEP_TIMED_OUT = 124;
export const NODE_TEST_STEP_TIMEOUT_MS = 15 * 60_000;

function scrubPlanChildEnv(env) {
  const clean = scrubGitEnv({ ...env });
  for (const key of Object.keys(clean)) {
    if (key.startsWith('CI_FAILED_ONLY_')) delete clean[key];
  }
  return clean;
}

export function runPlan(
  plan,
  {
    cwd,
    env,
    exit = (code) => process.exit(code),
    testTimeoutMs = NODE_TEST_TIMEOUT_MS,
    stepTimeoutMs = NODE_TEST_STEP_TIMEOUT_MS,
    stepKey = 'prepush-ci',
  },
) {
  const ctx = contextFromEnv(env);
  const tracking = Boolean(ctx.currDir);
  const prevState = tracking ? readPrevState(ctx) : null;
  const prevPassed = new Set(prevState?.steps?.[stepKey]?.passedChecks ?? []);
  const childEnv = scrubPlanChildEnv(env);
  const passedChecks = [];
  for (const step of plan) {
    const [command, ...commandArgs] = step;
    const stepId = step.join(' ');
    if (tracking && prevPassed.has(stepId)) {
      console.log(`[prepush][failed-only] skipping passed check: ${stepId}`);
      passedChecks.push(stepId);
      continue;
    }
    console.log(`[prepush] ${command} ${commandArgs.join(' ')}`);
    const nodeTest = command === 'node' && commandArgs[0] === '--test';
    const result = nodeTest
      ? spawnSync(
          process.execPath,
          [
            OWNED_PROCESS_CLI,
            '--name',
            'prepush-node-test',
            '--timeout-ms',
            String(stepTimeoutMs),
            '--',
            command,
            '--test',
            '--test-force-exit',
            `--test-timeout=${testTimeoutMs}`,
            ...commandArgs.slice(1),
          ],
          { cwd, stdio: 'inherit', env: childEnv },
        )
      : spawnSync(command, commandArgs, {
          cwd,
          stdio: 'inherit',
          env: childEnv,
        });
    if (nodeTest && result.status === STEP_TIMED_OUT) {
      console.error(
        `[prepush] ${command} ${commandArgs.join(' ')} did not exit within ${stepTimeoutMs / 60_000} min; killed its process group`,
      );
      if (tracking) {
        recordStepState({
          ...ctx,
          stepKey,
          outcome: { status: 'failed', failedCheck: stepId, passedChecks },
        });
      }
      exit(1);
      return;
    }
    if (result.status !== 0) {
      if (tracking) {
        recordStepState({
          ...ctx,
          stepKey,
          outcome: { status: 'failed', failedCheck: stepId, passedChecks },
        });
      }
      exit(result.status ?? 1);
      return;
    }
    passedChecks.push(stepId);
  }
  if (tracking) {
    recordStepState({
      ...ctx,
      stepKey,
      outcome: { status: 'passed', passedChecks },
    });
  }
}

export function changedPaths(base = process.env.PREPUSH_BASE_SHA || 'origin/main') {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const strictBase = (configured) => {
    const resolved = mergeBase(root, configured);
    if (!resolved) throw new Error(`no merge-base between HEAD and ${configured}`);
    return resolved;
  };
  if (base === 'origin/main') {
    const fetch = spawnSync('git', ['fetch', 'origin', 'main'], { cwd: root });
    if (fetch.status !== 0)
      console.error(
        `[prepush] git fetch origin main failed (exit ${fetch.status ?? 1}); using local origin/main, which may be stale`,
      );
  }
  const ancestor = /^0{40}$/.test(base) ? null : strictBase(base);
  return [
    ...new Set(
      [
        ...(ancestor === null
          ? git(['ls-files', '-z'])
          : git(['diff', '--no-renames', '--name-only', '-z', ancestor, 'HEAD'])
        ).split('\0'),
        ...git(['diff', '--no-renames', '--name-only', '-z', 'HEAD']).split('\0'),
        ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
      ].filter(Boolean),
    ),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2);
  const classifiers = {
    '--has-code': hasCode,
    '--has-sidecar': hasSidecar,
    '--needs-gates': (paths) => needsGates(paths, testsRead),
  };
  const modes = ['--ci', '--advisory', '--e2e-shard', '--self-test', ...Object.keys(classifiers)];
  if (
    args.length > 0 &&
    (!modes.includes(args[0]) || args.length !== (args[0] === '--e2e-shard' ? 2 : 1))
  ) {
    console.error(
      'Usage: pnpm prepush [--ci | --advisory | --e2e-shard i/n | --self-test | --has-code | --has-sidecar | --needs-gates]',
    );
    process.exit(2);
  }
  if (args[0] === '--e2e-shard' && !/^([1-9]\d*)\/([1-9]\d*)$/.test(args[1] ?? '')) process.exit(2);
  if (args[0] in classifiers) {
    try {
      console.log(classifiers[args[0]](changedPaths()));
    } catch {
      console.log(true);
    }
    process.exit(0);
  }
  const plan =
    args[0] === '--e2e-shard'
      ? [['node', 'scripts/e2e-full-shard.mjs', `--shard=${args[1]}`]]
      : args[0] === '--self-test'
        ? [selfTest]
        : prepushPlan(
            changedPaths(),
            args[0]?.slice(2) ?? 'local',
            process.env.PREPUSH_FORCE_FULL === 'true',
          );
  const lease = await acquireSlot({ label: 'prepush' });
  if (lease !== null) Object.assign(process.env, leaseEnv(lease));
  runPlan(plan, {
    cwd: root,
    env: process.env,
    stepKey: args[0] === '--self-test' ? 'prepush-self-test' : 'prepush-ci',
  });
  console.log(`[prepush] PASS (${plan.length} checks)`);
}
