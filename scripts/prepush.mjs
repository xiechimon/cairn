import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
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
  'scripts/issue-label-gate.mjs': 'reads issue labels through the GitHub token',
  'scripts/feature-map-staleness-gate.mjs': 'advisory job that never blocks a merge',
};

export const selfTests = [
  'scripts/prepush.test.mjs',
  'scripts/heavy-slots.test.mjs',
  'scripts/english-only-gate.test.mjs',
];

export const localOnly = [
  ['node', 'scripts/ci-job-structure-gate.mjs'],
  ['node', 'scripts/comment-discipline-gate.mjs'],
  ['node', 'scripts/single-use-helper-gate.mjs'],
  ['node', 'scripts/baseline-ratchet-gate.mjs'],
  ['node', 'scripts/test-spawn-gate.mjs'],
  ['node', 'scripts/pr-evidence-workflow-gate.mjs'],
  ['node', 'scripts/ui-registry-gate.mjs'],
  ['node', 'scripts/ui-consumer-shape-gate.mjs'],
  ['node', 'scripts/pr-gate-selfcheck.mjs'],
];

const DOCS = /^(docs\/|.*\.md$|LICENSE$)/;

export function prepushPlan(paths, mode = 'local') {
  const advisory = [['node', 'scripts/ui-dead-class-gate.mjs', '--compile']];
  if (mode === 'advisory') return advisory;
  const language = ['node', 'scripts/english-only-gate.mjs'];
  const codePaths = paths.filter((path) => !DOCS.test(path));
  if (codePaths.length === 0) return [language];
  const required = [
    language,
    ['node', 'scripts/ui-debt-gate.mjs'],
    ['node', 'scripts/ui-drift-gate.mjs'],
    ['pnpm', 'lint'],
    ['pnpm', 'typecheck'],
    ['pnpm', 'spec:parse'],
    ['node', 'scripts/e2e-affected.mjs', '--check-coverage'],
    ['node', '--test', 'docs/verify/1542/reach.test.mjs'],
  ];
  return mode === 'ci'
    ? required
    : [
        ...required,
        ...localOnly,
        ...(paths.some((path) =>
          /^scripts\/(prepush|heavy-slots|english-only-gate|scrub-git-env)/.test(path),
        )
          ? [['node', '--test', ...selfTests]]
          : []),
        ['node', 'scripts/prepush-vitest.mjs'],
        ...(paths.some((path) => path.startsWith('apps/web/'))
          ? [['pnpm', '--filter', '@cairn/web', 'test']]
          : []),
        ...advisory,
        ['pnpm', '--filter', '@cairn/web', 'e2e:affected', '--', ...codePaths],
      ];
}

export function runPlan(plan, { cwd, env }) {
  for (const [command, ...commandArgs] of plan) {
    console.log(`[prepush] ${command} ${commandArgs.join(' ')}`);
    const result = spawnSync(command, commandArgs, {
      cwd,
      stdio: 'inherit',
      env: scrubGitEnv({ ...env }),
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
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
          : git(['diff', '--name-only', '-z', ancestor, 'HEAD'])
        ).split('\0'),
        ...git(['diff', '--name-only', '-z', 'HEAD']).split('\0'),
        ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
      ].filter(Boolean),
    ),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2);
  const modes = ['--ci', '--advisory', '--e2e-shard'];
  if (
    args.length > 0 &&
    (!modes.includes(args[0]) || args.length !== (args[0] === '--e2e-shard' ? 2 : 1))
  ) {
    console.error('Usage: pnpm prepush [--ci | --advisory | --e2e-shard N/4]');
    process.exit(2);
  }
  if (args[0] === '--e2e-shard' && !/^[1-4]\/4$/.test(args[1] ?? '')) process.exit(2);
  const plan =
    args[0] === '--e2e-shard'
      ? [['pnpm', '--filter', '@cairn/web', 'e2e', `--shard=${args[1]}`]]
      : prepushPlan(changedPaths(), args[0]?.slice(2) ?? 'local');
  const lease = plan.length > 0 ? await acquireSlot() : null;
  runPlan(plan, { cwd: root, env: leaseEnv(lease) });
  console.log(`[prepush] PASS (${plan.length} checks)`);
}
