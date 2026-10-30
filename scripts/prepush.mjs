import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { acquireSlot, leaseEnv } from './heavy-slots.mjs';
import { scrubGitEnv } from './scrub-git-env.mjs';

const root = resolve(import.meta.dirname, '..');

export const prepushModules = [
  'scripts/prepush.mjs',
  'scripts/heavy-slots.mjs',
  'scripts/english-only-gate.mjs',
  'scripts/scrub-git-env.mjs',
];

export const ciOnlyScripts = {
  'scripts/css-mechanism-gate.mjs': 'greps the apps/web/dist build the CI e2e step writes',
};

export const ciOnlyTestSteps = {
  'scripts/ops/backup-server-db.test.mjs':
    'needs GNU rsync 3.x and the rrsync script the ops-backup-test job downloads',
};

export const selfTests = [
  'scripts/prepush.test.mjs',
  'scripts/heavy-slots.test.mjs',
  'scripts/english-only-gate.test.mjs',
  'scripts/doc-reader-tests.test.mjs',
  'scripts/epic-done.test.mjs',
  'scripts/agent-rules.test.mjs',
];

const selfTest = ['node', '--test', ...selfTests];

export const localOnly = [
  ['node', 'scripts/comment-discipline-gate.mjs'],
  ['node', 'scripts/ui-registry-gate.mjs'],
  ['node', 'scripts/ui-consumer-shape-gate.mjs'],
  ['node', 'scripts/lint-warning-cap.mjs'],
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
  const codePaths = paths.filter((path) => hasCode([path]));
  const docPaths = paths.filter(isDocument);
  if (codePaths.length === 0 && !forceFull) {
    const checks = [language];
    checks.push(['node', 'scripts/doc-reader-tests.mjs', ...docPaths]);
    return checks;
  }
  const required = [
    language,
    ['node', 'scripts/ui-debt-gate.mjs'],
    ['node', 'scripts/ui-drift-gate.mjs'],
    ['python3', 'scripts/pr-evidence-archive.test.py'],
    ['pnpm', 'lint'],
    ['pnpm', 'typecheck'],
    ['pnpm', 'spec:parse'],
    ['node', 'scripts/e2e-affected.mjs', '--check-coverage'],
    ['node', '--test', 'docs/verify/1542/reach.test.mjs'],
    ['node', '--test', 'scripts/escape-trace.test.mjs'],
    ['node', 'scripts/escape-trace.mjs', 'validate-cases', 'integration/eval/review/cases'],
    ['node', '--test', 'scripts/review-escapes.test.mjs'],
    ['node', '--test', 'scripts/escape-eval-loop.test.mjs'],
    ['python3', 'scripts/pr-evidence-gate.test.py'],
    ...(docPaths.length ? [['node', 'scripts/doc-reader-tests.mjs', ...docPaths]] : []),
  ];
  return mode === 'ci'
    ? required
    : [
        ...required,
        ...localOnly,
        ...(paths.some(
          (path) =>
            path === '.github/workflows/ci.yml' ||
            selfTests.some(
              (selfTest) => path === selfTest || path === selfTest.replace(/\.test\.mjs$/, '.mjs'),
            ) ||
            /^scripts\/(prepush|heavy-slots|english-only-gate|scrub-git-env|doc-reader-tests)/.test(
              path,
            ),
        )
          ? [selfTest]
          : []),
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
          .filter((step) => !required.some((args) => args.join(' ') === step.join(' '))),
        ...advisory,
      ];
}

export function runPlan(plan, { cwd, env, exit = (code) => process.exit(code) }) {
  for (const step of plan) {
    const [command, ...commandArgs] = step;
    console.log(`[prepush] ${command} ${commandArgs.join(' ')}`);
    const result = spawnSync(command, commandArgs, {
      cwd,
      stdio: 'inherit',
      env: scrubGitEnv({ ...env }),
    });
    if (result.status !== 0) {
      exit(result.status ?? 1);
      return;
    }
  }
}

export function changedPaths(base = process.env.PREPUSH_BASE_SHA || 'origin/main') {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  if (base === 'origin/main') {
    const fetch = spawnSync('git', ['fetch', 'origin', 'main'], { cwd: root });
    if (fetch.status !== 0)
      console.error(
        `[prepush] git fetch origin main failed (exit ${fetch.status ?? 1}); using local origin/main, which may be stale`,
      );
  }
  const ancestor = /^0{40}$/.test(base) ? null : git(['merge-base', 'HEAD', base]).trim();
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
  const modes = ['--ci', '--advisory', '--e2e-shard', '--self-test', '--has-code'];
  if (
    args.length > 0 &&
    (!modes.includes(args[0]) || args.length !== (args[0] === '--e2e-shard' ? 2 : 1))
  ) {
    console.error(
      'Usage: pnpm prepush [--ci | --advisory | --e2e-shard N/4 | --self-test | --has-code]',
    );
    process.exit(2);
  }
  if (args[0] === '--e2e-shard' && !/^[1-4]\/4$/.test(args[1] ?? '')) process.exit(2);
  if (args[0] === '--has-code') {
    try {
      console.log(hasCode(changedPaths()));
    } catch {
      console.log(true);
    }
    process.exit(0);
  }
  const plan =
    args[0] === '--e2e-shard'
      ? [['pnpm', '--filter', '@cairn/web', 'e2e', `--shard=${args[1]}`]]
      : args[0] === '--self-test'
        ? [selfTest]
        : prepushPlan(
            changedPaths(),
            args[0]?.slice(2) ?? 'local',
            process.env.PREPUSH_FORCE_FULL === 'true',
          );
  const lease = plan.some((step) => step.includes('e2e')) ? await acquireSlot() : null;
  runPlan(plan, { cwd: root, env: leaseEnv(lease) });
  console.log(`[prepush] PASS (${plan.length} checks)`);
}
