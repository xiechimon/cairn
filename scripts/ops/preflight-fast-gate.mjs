#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  return plan;
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
  spawn = spawnSync,
  log = console.log,
  checkTree = exactTreeError,
  listPaths = committedPaths,
  lastFailedTests,
  cachePath = lastFailedCachePath(cwd),
}) {
  const dirty = checkTree(cwd);
  if (dirty !== null) return { ok: false, error: dirty };
  const resolvedFailed =
    lastFailedTests ?? (wrapper.trim() ? [] : readLastFailedTests(cachePath, cwd));
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
  return { ok: true, plan, wrapped: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runFastGate({ cwd: process.cwd() });
  if (!result.ok) {
    console.error(`[preflight-fast-gate] ${result.error}`);
    process.exit(result.status ?? 1);
  }
  console.log('[preflight-fast-gate] PASS');
}
