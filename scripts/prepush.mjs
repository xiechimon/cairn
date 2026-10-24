import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export function prepushPlan(paths, mode = 'local') {
  if (paths.every((path) => /^(docs\/|.*\.md$|LICENSE$)/.test(path))) return [];
  const advisory = [['node', 'scripts/ui-dead-class-gate.mjs', '--compile']];
  if (mode === 'advisory') return advisory;
  const required = [
    ['node', 'scripts/ui-debt-gate.mjs'],
    ['node', 'scripts/ui-drift-gate.mjs'],
    ['pnpm', 'lint'],
    ['pnpm', 'typecheck'],
    ['pnpm', 'spec:parse'],
    ['node', 'scripts/e2e-affected.mjs', '--check-coverage'],
  ];
  const localOnly = [
    ['node', 'scripts/ci-job-structure-gate.mjs'],
    ['node', 'scripts/comment-discipline-gate.mjs'],
    ['node', 'scripts/single-use-helper-gate.mjs'],
    ['node', 'scripts/baseline-ratchet-gate.mjs'],
  ];
  return mode === 'ci'
    ? required
    : [
        ...required,
        ...localOnly,
        ['node', 'scripts/prepush-vitest.mjs'],
        ...advisory,
        ['pnpm', '--filter', '@cairn/web', 'e2e:affected', '--', ...paths],
      ];
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
  for (const [command, ...commandArgs] of plan) {
    console.log(`[prepush] ${command} ${commandArgs.join(' ')}`);
    const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(`[prepush] PASS (${plan.length} checks)`);
}
