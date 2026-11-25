#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const VITEST_TEST_FILE = /^(?:apps|packages|integration)\/.*\.test\.(?:ts|tsx|mts)$/;
const NODE_TEST_FILE = /^scripts\/.*\.test\.mjs$/;
const PRODUCT_RUNTIME_FILE =
  /^(?:apps\/(?:server|web|daemon|desktop)\/(?:src|drizzle)\/|packages\/shared\/src\/)/;
const TEST_HARNESS_FILE =
  /^(?:apps\/web\/src\/fixtures\/|(?:apps|packages)\/[^/]+\/(?:test|e2e)\/|integration\/test\/)/;

export function isFixSubject(subject) {
  return /^fix(?:\(|:|\s|$)/.test(subject.trim());
}

export function isVitestTestFile(path) {
  return VITEST_TEST_FILE.test(path);
}

export function isNodeTestFile(path) {
  return NODE_TEST_FILE.test(path);
}

export function isProductRuntimeFile(path) {
  return PRODUCT_RUNTIME_FILE.test(path);
}

export function isTestHarnessFile(path) {
  return isVitestTestFile(path) || isNodeTestFile(path) || TEST_HARNESS_FILE.test(path);
}

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  }).trim();
}

function gitBuffer(cwd, args) {
  return execFileSync('git', args, { cwd, maxBuffer: 512 * 1024 * 1024 });
}

export function changedFilesForCommit(cwd, commit) {
  const raw = gitBuffer(cwd, [
    'diff',
    '--no-renames',
    '--name-status',
    '-z',
    `${commit}^`,
    commit,
  ]).toString('utf8');
  const parts = raw.split('\0').filter(Boolean);
  const changed = [];
  for (let index = 0; index < parts.length; index += 2) {
    changed.push({ status: parts[index], path: parts[index + 1] });
  }
  return changed;
}

export function regressionPlanForCommit(cwd, commit, mode = 'light') {
  const changed = changedFilesForCommit(cwd, commit);
  const live = changed.filter((file) => file.status === 'A' || file.status === 'M');
  const productFiles = changed.map((file) => file.path).filter(isProductRuntimeFile);
  const vitestAll = live.map((file) => file.path).filter(isVitestTestFile);
  const nodeAll = live.map((file) => file.path).filter(isNodeTestFile);
  const integration = (path) => path.startsWith('integration/');
  const vitestFiles =
    mode === 'integration'
      ? vitestAll.filter(integration)
      : vitestAll.filter((path) => !integration(path));
  const nodeFiles = mode === 'integration' ? [] : nodeAll;
  const overlayPaths = live.map((file) => file.path).filter(isTestHarnessFile);
  const totalTests = vitestAll.length + nodeAll.length;
  const scopedTests = vitestFiles.length + nodeFiles.length;
  return {
    commit,
    productFiles,
    vitestFiles,
    nodeFiles,
    overlayPaths,
    totalTests,
    scopedTests,
    delegated: totalTests > 0 && scopedTests === 0,
  };
}

function workspaceNodeModules(cwd) {
  const candidates = ['node_modules'];
  for (const top of ['apps', 'packages']) {
    const dir = join(cwd, top);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) candidates.push(`${top}/${name}/node_modules`);
  }
  candidates.push('integration/node_modules');
  return candidates.filter((path) => existsSync(join(cwd, path)));
}

export function linkDependencyDirs(cwd, tree) {
  for (const rel of workspaceNodeModules(cwd)) {
    const target = join(cwd, rel);
    const link = join(tree, rel);
    mkdirSync(dirname(link), { recursive: true });
    if (!existsSync(link)) symlinkSync(target, link, 'dir');
  }
}

export function materializeParentTree(cwd, commit, tree) {
  mkdirSync(tree, { recursive: true });
  const archive = gitBuffer(cwd, ['archive', '--format=tar', `${commit}^`]);
  const untar = spawnSync('tar', ['-xf', '-', '-C', tree], { input: archive, encoding: 'utf8' });
  if (untar.status !== 0) throw new Error(`git archive parent extraction failed: ${untar.stderr}`);
  const plan = regressionPlanForCommit(cwd, commit);
  for (const path of plan.overlayPaths) {
    let content;
    try {
      content = gitBuffer(cwd, ['show', `${commit}:${path}`]);
    } catch {
      continue;
    }
    const target = join(tree, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  linkDependencyDirs(cwd, tree);
  return git(cwd, ['rev-parse', `${commit}^`]);
}

function runCommand(command, args, cwd, timeoutMs) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    timeout: timeoutMs,
    env: {
      ...process.env,
      CAIRN_LOCAL_HEAVY: '1',
      CAIRN_TEST_TEMP_ROOT: process.env.CAIRN_TEST_TEMP_ROOT ?? tmpdir(),
    },
  });
  return result.status === 0;
}

export function executePlanInTree(tree, plan, mode = 'light') {
  const timeoutMs = mode === 'integration' ? 180_000 : 25_000;
  let ran = false;
  let passed = true;
  if (plan.vitestFiles.length > 0) {
    ran = true;
    passed =
      runCommand(
        'pnpm',
        ['exec', 'vitest', 'run', '--maxWorkers=1', ...plan.vitestFiles],
        tree,
        timeoutMs,
      ) && passed;
  }
  if (plan.nodeFiles.length > 0) {
    ran = true;
    passed = runCommand('node', ['--test', ...plan.nodeFiles], tree, timeoutMs) && passed;
  }
  return { ran, passed };
}

export function evaluateFixCommit(cwd, commit, mode = 'light', execute = executePlanInTree) {
  const subject = git(cwd, ['show', '-s', '--format=%s', commit]);
  const plan = regressionPlanForCommit(cwd, commit, mode);
  if (plan.productFiles.length === 0)
    return { ok: true, commit, subject, skipped: 'no product runtime change' };
  if (plan.totalTests === 0) {
    return {
      ok: false,
      commit,
      subject,
      reason: 'fix commit changes product runtime files but adds or changes no test file',
      plan,
    };
  }
  if (plan.delegated)
    return {
      ok: true,
      commit,
      subject,
      skipped: `delegated to ${mode === 'light' ? 'integration' : 'light'}`,
    };
  const tree = mkdtempSync(join(tmpdir(), 'cairn-regression-parent-'));
  try {
    const parent = materializeParentTree(cwd, commit, tree);
    const outcome = execute(tree, plan, mode);
    return {
      ok: !outcome.passed,
      commit,
      parent,
      subject,
      parentPassed: outcome.passed,
      plan,
      reason: outcome.passed ? 'changed test files pass on the parent source' : null,
    };
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}

export function commitsInRange(cwd, base, head = 'HEAD') {
  const out = git(cwd, ['rev-list', '--no-merges', '--reverse', `${base}..${head}`]);
  return out === '' ? [] : out.split('\n');
}

export function evaluateRange({
  cwd,
  base,
  head = 'HEAD',
  mode = 'light',
  execute = executePlanInTree,
}) {
  const results = [];
  for (const commit of commitsInRange(cwd, base, head)) {
    const subject = git(cwd, ['show', '-s', '--format=%s', commit]);
    if (!isFixSubject(subject)) continue;
    results.push(evaluateFixCommit(cwd, commit, mode, execute));
  }
  return results;
}

function parseArgs(argv) {
  const opts = { mode: 'light', commit: null, force: false, base: null, head: 'HEAD' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') opts.mode = argv[++index];
    else if (arg === '--commit') opts.commit = argv[++index];
    else if (arg === '--force') opts.force = true;
    else if (arg === '--base') opts.base = argv[++index];
    else if (arg === '--head') opts.head = argv[++index];
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!['light', 'integration'].includes(opts.mode))
    throw new Error('--mode must be light or integration');
  return opts;
}

function report(result) {
  const short = result.commit.slice(0, 9);
  if (result.skipped) {
    console.log(`[regression-inversion] skip ${short} ${result.subject}: ${result.skipped}`);
    return;
  }
  if (result.ok) {
    console.log(
      `[regression-inversion] PASS ${short} ${result.subject}: changed tests do not pass on parent ${result.parent?.slice(0, 9)}`,
    );
    return;
  }
  const files = result.plan
    ? [...result.plan.vitestFiles, ...result.plan.nodeFiles].join(', ')
    : '';
  console.error(
    `[regression-inversion] FAIL ${short} ${result.subject}: ${result.reason}${files ? ` (${files})` : ''}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const cwd = REPO_ROOT;
    let results;
    if (opts.commit) {
      const subject = git(cwd, ['show', '-s', '--format=%s', opts.commit]);
      if (!opts.force && !isFixSubject(subject)) {
        console.log(
          `[regression-inversion] skip ${opts.commit.slice(0, 9)} ${subject}: subject does not start with fix`,
        );
        results = [];
      } else {
        results = [evaluateFixCommit(cwd, opts.commit, opts.mode)];
      }
    } else {
      const base =
        opts.base ?? process.env.REGRESSION_INVERSION_BASE_SHA ?? process.env.PREPUSH_BASE_SHA;
      if (!base || /^0{40}$/.test(base)) {
        console.log('[regression-inversion] skip: no merge-base for this checkout');
        results = [];
      } else {
        results = evaluateRange({ cwd, base, head: opts.head, mode: opts.mode });
      }
    }
    for (const result of results) report(result);
    if (results.length === 0)
      console.log(`[regression-inversion] PASS: no applicable fix commits (${opts.mode})`);
    process.exit(results.some((result) => !result.ok) ? 1 : 0);
  } catch (error) {
    console.error(
      `[regression-inversion] ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
}
