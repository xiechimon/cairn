import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { acquireSlot, leaseEnv, slotPortReport } from './heavy-slots.mjs';
import { interceptEventsForGate, loadLedger } from './lessons-ledger-gate.mjs';
import { scrubGitEnv } from './scrub-git-env.mjs';

const root = resolve(import.meta.dirname, '..');

export const prepushModules = [
  'scripts/prepush.mjs',
  'scripts/heavy-slots.mjs',
  'scripts/english-only-gate.mjs',
  'scripts/lessons-ledger-gate.mjs',
  'scripts/scrub-git-env.mjs',
];

export const ciOnlyScripts = {
  'scripts/css-mechanism-gate.mjs': 'greps the apps/web/dist build the CI e2e step writes',
  'scripts/issue-label-gate.mjs': 'reads issue labels through the GitHub token',
  'scripts/feature-map-staleness-gate.mjs': 'advisory job that never blocks a merge',
  'scripts/npm-command-gate.mjs': 'verifies package names against the npm registry (network)',
  'scripts/check-closing-keyword.mjs': 'reads the PR event payload (GITHUB_EVENT_PATH)',
  'scripts/baseline-owner-gate.mjs':
    'reads the PR event payload and issue labels through the GitHub token',
};

export const selfTests = [
  'scripts/prepush.test.mjs',
  'scripts/heavy-slots.test.mjs',
  'scripts/english-only-gate.test.mjs',
  'scripts/doc-reader-tests.test.mjs',
  'scripts/lessons-ledger-gate.test.mjs',
  'scripts/recording-gate.test.mjs',
  'scripts/lessons-weekly.test.mjs',
  'scripts/epic-done.test.mjs',
  'scripts/agent-rules.test.mjs',
];

const selfTest = ['node', '--test', ...selfTests];

export const localOnly = [
  ['node', 'scripts/ci-job-structure-gate.mjs'],
  ['node', 'scripts/feature-map-staleness-gate.mjs'],
  ['node', 'scripts/comment-discipline-gate.mjs'],
  ['node', 'scripts/single-use-helper-gate.mjs'],
  ['node', 'scripts/baseline-ratchet-gate.mjs'],
  ['node', 'scripts/test-spawn-gate.mjs'],
  ['node', 'scripts/pr-evidence-workflow-gate.mjs'],
  ['node', 'scripts/ui-registry-gate.mjs'],
  ['node', 'scripts/ui-consumer-shape-gate.mjs'],
  ['node', 'scripts/pr-gate-selfcheck.mjs'],
  ['node', 'scripts/funding-yml-gate.mjs'],
  ['node', 'scripts/lane-file-gate.mjs'],
  ['node', 'scripts/lint-warning-cap.mjs'],
];

const DOCS = /^(docs\/|.*\.md$|LICENSE$)/;

export function prepushPlan(paths, mode = 'local') {
  const advisory = [['node', 'scripts/ui-dead-class-gate.mjs', '--compile']];
  if (mode === 'advisory') return advisory;
  const language = ['node', 'scripts/english-only-gate.mjs'];
  const ledgerGate = ['node', 'scripts/lessons-ledger-gate.mjs'];
  const codePaths = paths.filter((path) => !DOCS.test(path));
  const docPaths = paths.filter((path) => DOCS.test(path));
  if (codePaths.length === 0) {
    const checks = [language];
    if (paths.some((path) => path === 'docs/lessons.md' || path.startsWith('docs/lessons/')))
      checks.push(ledgerGate);
    if (mode !== 'ci') checks.push(['node', 'scripts/doc-reader-tests.mjs', ...docPaths]);
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
    ['node', 'scripts/recording-gate.mjs'],
    ['node', 'scripts/e2e-affected.mjs', '--check-coverage'],
    ['node', '--test', 'docs/verify/1542/reach.test.mjs'],
    ['node', '--test', 'scripts/escape-trace.test.mjs'],
    ['node', 'scripts/escape-trace.mjs', 'validate-cases', 'integration/eval/review/cases'],
    ['node', '--test', 'scripts/review-escapes.test.mjs'],
    ['node', '--test', 'scripts/escape-eval-loop.test.mjs'],
    ledgerGate,
    ['python3', 'scripts/pr-evidence-gate.test.py'],
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
            /^scripts\/(prepush|heavy-slots|english-only-gate|lessons-ledger-gate|recording-gate|scrub-git-env|doc-reader-tests)/.test(
              path,
            ),
        )
          ? [selfTest]
          : []),
        ['node', 'scripts/prepush-vitest.mjs'],
        ...(docPaths.length ? [['node', 'scripts/doc-reader-tests.mjs', ...docPaths]] : []),
        ...(paths.some((path) => path.startsWith('apps/web/'))
          ? [['pnpm', '--filter', '@cairn/web', 'test']]
          : []),
        ...advisory,
        ['pnpm', '--filter', '@cairn/web', 'e2e:affected', '--', ...codePaths],
      ];
}

const GATE_SCRIPTS = /^scripts\/[a-z0-9-]+-gate\.mjs$/;

export function gateOf(step) {
  const [, script] = step;
  return typeof script === 'string' && GATE_SCRIPTS.test(script) ? script : null;
}

export function branchName(root, env) {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  return (
    env.CAIRN_BRANCH ||
    (result.status === 0 ? (result.stdout ?? '').trim() : '') ||
    env.GITHUB_HEAD_REF ||
    env.GITHUB_REF_NAME ||
    'detached'
  );
}

export function gateLogPath(env) {
  const raw = env.CAIRN_GATE_LOG;
  if (raw === undefined || raw === '' || raw === '0' || raw === 'false') return null;
  return resolve(
    raw === '1' || raw === 'true' ? join(tmpdir(), 'cairn-gate-reds/gate-log.jsonl') : raw,
  );
}

export function ledgerDisabled(root, env) {
  const flag = env.CAIRN_LESSONS_LEDGER;
  if (flag === '0' || flag === 'false') return true;
  return !existsSync(join(root, 'docs/lessons'));
}

export function recordInterception({ root, gate, env }) {
  const log = gateLogPath(env);
  if (log === null || ledgerDisabled(root, env)) return 0;
  const events = interceptEventsForGate(loadLedger(root), gate, {
    repo: env.CAIRN_REPO ?? 'xiechimon/cairn',
    branch: branchName(root, env),
  });
  if (events.length === 0) return 0;
  mkdirSync(dirname(log), { recursive: true });
  appendFileSync(log, events.map((event) => `${JSON.stringify(event)}\n`).join(''));
  return events.length;
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
      const gate = gateOf(step);
      if (gate !== null) {
        const recorded = recordInterception({ root: cwd, gate, env });
        console.log(`[prepush] ${gate} blocked the push; recorded ${recorded} intercepts`);
      }
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
  const modes = ['--ci', '--advisory', '--e2e-shard', '--self-test'];
  if (
    args.length > 0 &&
    (!modes.includes(args[0]) || args.length !== (args[0] === '--e2e-shard' ? 2 : 1))
  ) {
    console.error('Usage: pnpm prepush [--ci | --advisory | --e2e-shard N/4 | --self-test]');
    process.exit(2);
  }
  if (args[0] === '--e2e-shard' && !/^[1-4]\/4$/.test(args[1] ?? '')) process.exit(2);
  const plan =
    args[0] === '--e2e-shard'
      ? [['pnpm', '--filter', '@cairn/web', 'e2e', `--shard=${args[1]}`]]
      : args[0] === '--self-test'
        ? [selfTest]
        : prepushPlan(changedPaths(), args[0]?.slice(2) ?? 'local');
  const lease = plan.length > 0 ? await acquireSlot() : null;
  if (lease !== null && plan.some((step) => step.includes('e2e:affected'))) {
    const conflict = slotPortReport({ slot: lease.slot });
    if (conflict !== null) {
      console.error(conflict);
      process.exit(1);
    }
  }
  runPlan(plan, { cwd: root, env: leaseEnv(lease) });
  console.log(`[prepush] PASS (${plan.length} checks)`);
}
