#!/usr/bin/env node

import { execFileSync, spawn as spawnChild, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, posix, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { mergeBase } from '../diff-base.mjs';
import { hasCode, needsGates, prepushPlan, testsRead } from '../prepush.mjs';
import { scrubGitEnv } from '../scrub-git-env.mjs';
import { heavyRunAuthorized } from '../test-admission.mjs';

const SECRET_SCAN_STEP = ['node', 'scripts/ops/secret-scan.mjs'];
const REVERT_GUARD_STEP = ['node', 'scripts/ops/revert-guard.mjs'];
const CHEAP_CHECKS_FLAG = '--cheap-checks';
const CHEAP_CHECKS_STEP = ['node', 'scripts/ops/preflight-fast-gate.mjs', CHEAP_CHECKS_FLAG];
const COULD_NOT_RUN = 2;
const STATIC_REGRESSION_STEP = [
  'node',
  'scripts/regression-inversion-gate.mjs',
  '--mode',
  'static',
];
const CHECK_SCRIPT = /(?:-gate|-ledger)\.[cm]?[jt]s(?: |$)| --check[\w-]*(?: |$)/;
const WRAPPER = /(?:ci-failed-only|test-temp-run)\.mjs.*? -- /;
const RETRY = /\bbash scripts\/ci-retry\.sh +/g;
const INVOCATION =
  /(?<=^|[\s(;&|'"])(?:(node|pnpm) +|(?=(?:\.\/)?scripts\/\S+\.sh\b))([^;&|)'"]*(?:"[^"]*"[^;&|)'"]*)*)/g;

const SKIPPED = {
  'scripts/import-cycle-gate.mjs': '2.0 s in CI',
  'scripts/dead-runtime-exports-gate.mjs': '1.0 s in CI',
  'scripts/regression-inversion-gate.mjs': 'runs tests',
  'scripts/css-mechanism-gate.mjs': 'reads a web build',
  'scripts/doc-reader-tests.mjs': 'runs vitest',
  'scripts/prepush.mjs': 'classifies the diff',
  'scripts/ops/ci-reuse-verified.mjs': 'asks GitHub which run to reuse',
  'scripts/ops/install-gitleaks.mjs': 'installs gitleaks',
  '.claude/skills/verify-cairn/scripts/vp-selftest.mjs': 'self-test, 48 s in CI',
  'eval/install-devin.mjs': 'model eval',
  'eval/run.ts': 'model eval',
  'eval/compare.ts': 'model eval',
  'scripts/pack-smoke.sh': 'builds the package',
  'pnpm install': 'setup',
  'pnpm lint': 'its own fast-gate step',
  'pnpm typecheck': 'its own fast-gate step',
  'pnpm spec:parse': '13 s in CI',
  'pnpm prepush --self-test': 'self-tests',
  'pnpm prepush --e2e-shard': 'browser tests',
  'pnpm test': 'test suite',
  'pnpm e2e:affected': 'browser tests',
  'pnpm exec': 'web build',
  'pnpm db:check': '2 s in CI',
  'pnpm db:generate': 'rewrites files',
};
const SKIPPED_INLINE = new Set([
  'Aggregate check parts',
  'Aggregate the e2e tier',
  'Conflict markers',
  'Install fish and zsh for the login shell tests',
  'Verify module files are tidy',
  'Format',
  'Test',
  'Vet',
  'Build all targets',
  'Restore Devin CLI credentials',
  'Exam source selection (base checkout wins when it has eval/)',
  'Baseline arm requires the suite on the merge base',
  'Comment score diff on the candidate commit',
  'Gate on the verdict',
]);

function invocations(run) {
  return run
    .replace(/\\\n/g, ' ')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .flatMap((line) => [
      ...line
        .replace(new RegExp(`^.*${WRAPPER.source}`), '')
        .replace(RETRY, '')
        .matchAll(INVOCATION),
    ])
    .map(([, tool = 'sh', rest]) => [tool, ...rest.trim().split(/\s+/)]);
}

function classify([tool, ...args]) {
  if (tool === 'node') {
    if (args.includes('--test')) return {};
    const at = args.findIndex((arg) => /\.[cm]?[jt]s$/.test(arg));
    if (at < 0) return { unknown: true };
    const script = args[at].replace(/^\.\//, '');
    if (SKIPPED[script]) return { skip: script };
    const flags = args.slice(at + 1).filter((arg) => !/^[<>$\d]/.test(arg));
    const step = ['node', script, ...flags];
    return CHECK_SCRIPT.test(step.join(' ')) ? { check: step } : { unknown: true };
  }
  if (tool === 'sh') {
    const script = args[0].replace(/^\.\//, '');
    return SKIPPED[script] ? { skip: script } : { unknown: true };
  }
  const words = args[0] === '--filter' ? args.slice(2) : args;
  const key = [`pnpm ${words[0]} ${words[1]}`, `pnpm ${words[0]}`].find((name) => SKIPPED[name]);
  return key ? { skip: key } : { unknown: true };
}

function holds(condition, outputs) {
  return String(condition ?? 'always()')
    .replace(/^\$\{\{|\}\}$/g, '')
    .split('&&')
    .map((term) => {
      if (/^\s*(?:!cancelled|always)\(\)\s*$/.test(term)) return true;
      const match = /^\s*needs\.changes\.outputs\.([\w-]+) (!=|==) '(\w+)'\s*$/.exec(term);
      if (!match || !(match[1] in outputs)) throw new Error(`unsupported condition ${term.trim()}`);
      return (outputs[match[1]] === match[3]) === (match[2] === '==');
    })
    .every(Boolean);
}

function readWorkflow(workflow, paths) {
  const checks = new Map();
  const unclassified = [];
  const skipped = new Set();
  const outputs = {
    'reused-sha': '',
    'has-code': String(hasCode(paths)),
    'gates-needed': String(needsGates(paths, testsRead)),
  };
  for (const job of Object.values(parse(workflow).jobs)) {
    for (const step of job.steps ?? []) {
      if (!step.run) continue;
      const found = invocations(step.run);
      const fail = (why) => unclassified.push(`${step.name ?? step.run}: ${why}`);
      if (found.length === 0 && !SKIPPED_INLINE.has(step.name)) fail('inline shell');
      const visit = (command) => {
        if (command.join(' ') === 'pnpm prepush --ci') {
          for (const inner of prepushPlan(paths, 'ci')) visit(inner);
          return;
        }
        const { check, skip, unknown } = classify(command);
        if (skip) skipped.add(skip);
        if (unknown) fail(command.join(' '));
        if (!check || step['continue-on-error'] || job['continue-on-error']) return;
        try {
          const applies = [job.if, step.if].map((condition) => holds(condition, outputs));
          if (applies.every(Boolean)) checks.set(check.join(' '), check);
        } catch (error) {
          fail(error.message);
        }
      };
      for (const command of found) visit(command);
    }
  }
  return { checks: [...checks.values()], unclassified, skipped };
}

export function ciChecks(workflow, paths) {
  const { checks, unclassified } = readWorkflow(workflow, paths);
  return { checks, unclassified };
}

export function staleSkips(workflow) {
  const { skipped } = readWorkflow(workflow, ['apps/server/src/app.ts', 'docs/spec/a.md']);
  return Object.keys(SKIPPED).filter((key) => !skipped.has(key));
}

function runStep([command, ...args], { cwd, env }) {
  return new Promise((done) => {
    const chunks = [];
    const options = { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5 * 60_000 };
    const child = spawnChild(command, args, options);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    const finish = (status, extra = '') =>
      done({ status, output: `${Buffer.concat(chunks).toString('utf8')}${extra}` });
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (status) => finish(status));
  });
}

function selectChecks(cwd) {
  const workflow = readFileSync(resolve(cwd, '.github/workflows/ci.yml'), 'utf8');
  return ciChecks(workflow, committedPaths(cwd));
}

export async function runCheapChecks({
  cwd,
  env = process.env,
  resolveBase = () => mergeBase(cwd, 'origin/main'),
  select = selectChecks,
  run = runStep,
  log = console.log,
}) {
  const base = resolveBase();
  const { checks, unclassified } = base ? select(cwd) : { checks: [], unclassified: [] };
  if (checks.length === 0 || unclassified.length > 0) {
    const why = base
      ? unclassified.join('\n') || 'CI selects no check'
      : 'no merge-base with origin/main';
    log(`[cheap-checks] could not run: ${why}`);
    return COULD_NOT_RUN;
  }
  const childEnv = scrubGitEnv(
    Object.fromEntries(Object.entries(env).filter(([key]) => !/_BASE_(?:SHA|REF)$/.test(key))),
  );
  childEnv.PREPUSH_BASE_SHA = base;
  const queue = [...checks];
  const results = [];
  const worker = async () => {
    for (let step = queue.shift(); step; step = queue.shift()) {
      results.push({ step, ...(await run(step, { cwd, env: childEnv })) });
    }
  };
  const started = Date.now();
  await Promise.all(Array.from({ length: availableParallelism() }, worker));
  const failed = results.filter((result) => result.status !== 0);
  for (const { step, status, output } of failed) {
    log(`[cheap-checks] FAIL (exit ${status ?? 'none'}) ${step.join(' ')}\n${output.trimEnd()}`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  log(`[cheap-checks] ${results.length - failed.length}/${results.length} passed in ${seconds}s`);
  if (failed.length === 0) return 0;
  return failed.every((result) => result.status === 1) ? 1 : COULD_NOT_RUN;
}

const PACKAGE_ORDER = [
  '@cairn/shared',
  '@xiechimon/cairn',
  '@cairn/web',
  '@xiechimon/cairn-cli',
  '@cairn/desktop',
  '@cairn/integration',
];
const ALL_PACKAGES = new Set(PACKAGE_ORDER);
const PACKAGE_SCOPES = [
  ['packages/shared/', new Set(PACKAGE_ORDER)],
  ['apps/server/', new Set(['@xiechimon/cairn', '@cairn/integration'])],
  ['apps/web/', new Set(['@cairn/web'])],
  ['apps/daemon/', new Set(['@xiechimon/cairn-cli', '@cairn/integration'])],
  ['apps/desktop/', new Set(['@cairn/desktop'])],
  ['integration/', new Set(['@cairn/integration'])],
];
const ROOT_WIDE_INPUTS = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']);

export function typecheckPackagesForPaths(paths) {
  const selected = new Set();
  for (const path of paths) {
    if (ROOT_WIDE_INPUTS.has(path)) {
      for (const name of ALL_PACKAGES) selected.add(name);
      continue;
    }
    for (const [prefix, packages] of PACKAGE_SCOPES) {
      if (!path.startsWith(prefix)) continue;
      for (const name of packages) selected.add(name);
      break;
    }
  }
  return PACKAGE_ORDER.filter((name) => selected.has(name));
}

const CI_SCHEDULING_TEST_STEP = [
  'node',
  '--test',
  'scripts/ops/merge-queue-invariants.test.mjs',
  'scripts/ops/ci-capacity-gate.test.mjs',
  'scripts/ops/push-queue.test.mjs',
  'scripts/ops/speculative-queue.test.mjs',
  'scripts/workflow-concurrency.test.mjs',
  'scripts/workflow-scalars.test.mjs',
  'scripts/ci-tiers.test.mjs',
];

function touchesCiScheduling(paths) {
  return paths.some(
    (path) =>
      path === '.github/workflows/ci.yml' ||
      path.startsWith('scripts/ops/') ||
      path.startsWith('scripts/workflow-') ||
      path === 'scripts/ci-tiers.test.mjs',
  );
}

export function ciSchedulingGateSteps(paths) {
  if (!touchesCiScheduling(paths)) return [];
  return [['node', 'scripts/ops/ci-capacity-gate.mjs'], CI_SCHEDULING_TEST_STEP];
}

export function fastGatePlan(paths, lastFailedTests = []) {
  const plan = [
    ['pnpm', 'lint'],
    ...ciSchedulingGateSteps(paths),
    ...typecheckPackagesForPaths(paths).map((name) => ['pnpm', '--filter', name, 'typecheck']),
    ['pnpm', 'test:changed'],
  ];
  if (lastFailedTests.length > 0) {
    plan.unshift(['pnpm', 'exec', 'vitest', 'run', ...lastFailedTests]);
  }
  return [SECRET_SCAN_STEP, REVERT_GUARD_STEP, CHEAP_CHECKS_STEP, STATIC_REGRESSION_STEP, ...plan];
}

export function lastFailedCachePath(cwd, gitExec = git) {
  try {
    const gitDir = gitExec(['rev-parse', '--git-dir'], cwd);
    return resolve(cwd, gitDir, 'cairn-fast-gate-last-failed.json');
  } catch {
    return null;
  }
}

export function readLastFailedTests(cachePath, cwd, exists = existsSync) {
  if (!cachePath || !exists(cachePath)) return [];
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (!Array.isArray(data?.failedTests)) return [];
    return data.failedTests.filter(
      (file) => typeof file === 'string' && file.length > 0 && exists(resolve(cwd, file)),
    );
  } catch {
    return [];
  }
}

export function extractFailedTestFiles(reportPath, cwd) {
  try {
    const parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
    const out = new Set();
    for (const suite of parsed?.testResults ?? []) {
      if (suite?.status !== 'failed' || typeof suite?.name !== 'string') continue;
      const rel = relative(cwd, suite.name).split('\\').join(posix.sep);
      if (rel && !rel.startsWith('..') && existsSync(resolve(cwd, rel))) {
        out.add(rel);
      }
    }
    return [...out].sort();
  } catch {
    return [];
  }
}

export function parseGateWrapper(wrapper = '') {
  return wrapper.trim().split(/\s+/).filter(Boolean);
}

function shellQuote(arg) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function fastGateShellCommand(plan) {
  return plan.map((step) => step.map(shellQuote).join(' ')).join(' && ');
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function committedPaths(cwd) {
  const base = git(['merge-base', 'origin/main', 'HEAD'], cwd);
  return git(['diff', '--no-renames', '--name-only', base, 'HEAD'], cwd)
    .split('\n')
    .filter(Boolean);
}

export function exactTreeError(cwd) {
  const status = git(['status', '--porcelain'], cwd);
  if (status === '') return null;
  return 'the worktree does not exactly match HEAD; commit or remove the uncommitted files so the gate tests the tree that preflight pushes';
}

export function runFastGate({
  cwd,
  wrapper = process.env.CAIRN_PREFLIGHT_GATE_WRAPPER ?? '',
  env: gateEnv = process.env,
  spawn = spawnSync,
  log = console.log,
  checkTree = exactTreeError,
  listPaths = committedPaths,
  lastFailedTests,
  cachePath = lastFailedCachePath(cwd),
}) {
  const dirty = checkTree(cwd);
  if (dirty !== null) return { ok: false, error: dirty };
  const cachedFailed =
    lastFailedTests ?? (wrapper.trim() ? [] : readLastFailedTests(cachePath, cwd));
  const resolvedFailed =
    cachedFailed.length > 1 && !heavyRunAuthorized(gateEnv) ? [] : cachedFailed;
  const plan = fastGatePlan(listPaths(cwd), resolvedFailed);
  const wrapperTokens = parseGateWrapper(wrapper);
  if (wrapperTokens.length > 0) {
    const [wrapperCommand, ...wrapperArgs] = wrapperTokens;
    const shellCommand = fastGateShellCommand(plan);
    const args = [...wrapperArgs, 'sh', '-c', shellCommand];
    log(`[preflight-fast-gate] ${wrapperCommand} ${args.join(' ')}`);
    const result = spawn(wrapperCommand, args, { cwd, stdio: 'inherit' });
    if (result.status !== 0) {
      return {
        ok: false,
        error: `${wrapperCommand} failed on the exact HEAD tree; fix it before preflight pushes`,
        status: result.status ?? 1,
      };
    }
    const dirtyAfter = checkTree(cwd);
    if (dirtyAfter !== null) return { ok: false, error: dirtyAfter };
    return { ok: true, plan, wrapped: true };
  }
  const reportPath = cachePath ? `${cachePath}.report.json` : null;
  for (const [command, ...args] of plan) {
    log(`[preflight-fast-gate] ${command} ${args.join(' ')}`);
    const isTestChanged = command === 'pnpm' && args[0] === 'test:changed' && reportPath !== null;
    const env = isTestChanged
      ? { ...process.env, CAIRN_TEST_CHANGED_JSON_OUT: reportPath }
      : undefined;
    if (isTestChanged) {
      mkdirSync(dirname(reportPath), { recursive: true });
      rmSync(reportPath, { force: true });
    }
    const result = spawn(
      command,
      args,
      env ? { cwd, stdio: 'inherit', env } : { cwd, stdio: 'inherit' },
    );
    if (result.status !== 0) {
      if (isTestChanged && cachePath && reportPath && existsSync(reportPath)) {
        const failed = extractFailedTestFiles(reportPath, cwd);
        rmSync(reportPath, { force: true });
        if (failed.length > 0) {
          writeFileSync(cachePath, JSON.stringify({ failedTests: failed }));
        }
      }
      return {
        ok: false,
        error: `${command} ${args.join(' ')} failed on the exact HEAD tree; fix it before preflight pushes`,
        status: result.status ?? 1,
      };
    }
    if (isTestChanged && reportPath) rmSync(reportPath, { force: true });
  }
  if (cachePath) rmSync(cachePath, { force: true });
  const dirtyAfter = checkTree(cwd);
  if (dirtyAfter !== null) return { ok: false, error: dirtyAfter };
  return { ok: true, plan, wrapped: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === CHEAP_CHECKS_FLAG) {
    process.exitCode = await runCheapChecks({ cwd: process.cwd() });
  } else {
    const result = runFastGate({ cwd: process.cwd() });
    if (!result.ok) {
      console.error(`[preflight-fast-gate] ${result.error}`);
      process.exit(result.status ?? 1);
    }
    console.log('[preflight-fast-gate] PASS');
  }
}
