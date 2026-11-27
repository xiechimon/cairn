#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeBase } from './diff-base.mjs';
import {
  extractPlanTrailer,
  isTier1Commit,
  isValidPlanPath,
  validatePlanContent,
} from './plan-spec.mjs';

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

export function missingPathsAtCommit(cwd, commit, paths) {
  if (paths.length === 0) return [];
  const raw = git(cwd, ['ls-tree', '-r', '--name-only', commit, '--', ...paths]);
  const present = new Set(raw === '' ? [] : raw.split('\n').filter(Boolean));
  return paths.filter((path) => !present.has(path));
}

export function regressionPlanForCommit(cwd, commit, mode = 'light', allowedTestPaths = null) {
  const changed = changedFilesForCommit(cwd, commit);
  const live = changed.filter((file) => file.status === 'A' || file.status === 'M');
  const productFiles = changed.map((file) => file.path).filter(isProductRuntimeFile);
  const allowed = allowedTestPaths === null ? null : new Set(allowedTestPaths);
  const allow = (path) => allowed === null || allowed.has(path);
  const vitestAll = live
    .map((file) => file.path)
    .filter((path) => isVitestTestFile(path) && allow(path));
  const nodeAll = live
    .map((file) => file.path)
    .filter((path) => isNodeTestFile(path) && allow(path));
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

function mirrorNodeModulesDir(repoRoot, srcDir, dstDir, tree, depth = 0) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcEntry = join(srcDir, entry);
    const dstEntry = join(dstDir, entry);
    let alreadyExists = false;
    try {
      lstatSync(dstEntry);
      alreadyExists = true;
    } catch {}
    if (alreadyExists) continue;
    const stat = lstatSync(srcEntry);
    if (stat.isSymbolicLink()) {
      const absTarget = resolve(srcDir, readlinkSync(srcEntry));
      const relTarget = relative(repoRoot, absTarget);
      const isWorkspacePkg =
        relTarget !== '' &&
        !relTarget.startsWith('..') &&
        !relTarget.split(/[\\/]/).includes('node_modules') &&
        existsSync(join(tree, relTarget));
      symlinkSync(isWorkspacePkg ? join(tree, relTarget) : absTarget, dstEntry);
      continue;
    }
    if (depth === 0 && entry.startsWith('@') && stat.isDirectory()) {
      mirrorNodeModulesDir(repoRoot, srcEntry, dstEntry, tree, 1);
      continue;
    }
    symlinkSync(srcEntry, dstEntry);
  }
}

export function linkDependencyDirs(cwd, tree) {
  const repoRoot = resolve(cwd);
  for (const rel of workspaceNodeModules(repoRoot)) {
    mirrorNodeModulesDir(repoRoot, join(repoRoot, rel), join(tree, rel), tree);
  }
}

function extractArchive(cwd, ref, tree) {
  mkdirSync(tree, { recursive: true });
  const archive = gitBuffer(cwd, ['archive', '--format=tar', ref]);
  const untar = spawnSync('tar', ['-xf', '-', '-C', tree], { input: archive, encoding: 'utf8' });
  if (untar.status !== 0) throw new Error(`git archive extraction failed: ${untar.stderr}`);
}

export function materializeParentTree(cwd, commit, tree) {
  extractArchive(cwd, `${commit}^`, tree);
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

export function materializeCommitTree(cwd, commit, tree) {
  extractArchive(cwd, commit, tree);
  linkDependencyDirs(cwd, tree);
}

function runCommand(command, args, cwd, timeoutMs) {
  const env = {
    ...process.env,
    CAIRN_LOCAL_HEAVY: '1',
    CAIRN_TEST_TEMP_ROOT: process.env.CAIRN_TEST_TEMP_ROOT ?? tmpdir(),
  };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    timeout: timeoutMs,
    env,
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

function runInversionAgainstParent(cwd, commit, subject, plan, mode, execute, failReason) {
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
      reason: outcome.passed ? failReason : null,
    };
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
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
  if (mode === 'static') return { ok: true, commit, subject, skipped: 'tests run in CI' };
  if (plan.delegated)
    return {
      ok: true,
      commit,
      subject,
      skipped: `delegated to ${mode === 'light' ? 'integration' : 'light'}`,
    };
  return runInversionAgainstParent(
    cwd,
    commit,
    subject,
    plan,
    mode,
    execute,
    'changed test files pass on the parent source',
  );
}

export function checkPlanProvingTestsAtCommit(cwd, commit, changed, edgeCases) {
  const errors = [];
  const missing = missingPathsAtCommit(cwd, commit, edgeCases.requiredTestPaths);
  if (missing.length > 0)
    errors.push(`missing proving test file(s) at ${commit.slice(0, 9)}: ${missing.join(', ')}`);
  if (edgeCases.hasSliceColumn && edgeCases.thisChangeTestPaths.length === 0)
    errors.push('at least one Edge cases row must be marked "this change" for a Tier 1 commit');
  const runnableThisChange = edgeCases.thisChangeTestPaths.filter(
    (path) => isVitestTestFile(path) || isNodeTestFile(path),
  );
  const liveTestPaths = new Set(
    changed
      .filter((file) => file.status === 'A' || file.status === 'M')
      .map((file) => file.path)
      .filter((path) => isVitestTestFile(path) || isNodeTestFile(path)),
  );
  const untouched = runnableThisChange.filter((path) => !liveTestPaths.has(path));
  if (edgeCases.thisChangeTestPaths.length > 0 && missing.length === 0) {
    if (runnableThisChange.length === 0) {
      errors.push(
        `no added or modified runnable proving test in commit ${commit.slice(0, 9)} for "this change" rows (${edgeCases.thisChangeTestPaths.join(', ')})`,
      );
    } else if (untouched.length > 0) {
      errors.push(
        `unmodified "this change" proving test file(s) in commit ${commit.slice(0, 9)}: ${untouched.join(', ')}`,
      );
    }
  }
  return { errors, missing, runnableThisChange, untouched };
}

export function evaluatePlanInversionCommit(
  cwd,
  commit,
  mode = 'light',
  execute = executePlanInTree,
  contentRef = commit,
) {
  const msg = git(cwd, ['show', '-s', '--format=%B', commit]);
  const subject = msg.split('\n', 1)[0];
  const changed = changedFilesForCommit(cwd, commit);
  const productFiles = changed
    .map((file) => file.path)
    .filter((path) => isProductRuntimeFile(path) && !isTestHarnessFile(path));
  const tier = isTier1Commit(subject, productFiles);
  if (!tier.required) return { ok: true, commit, subject, skipped: 'not a Tier 1 plan commit' };
  const planPath = extractPlanTrailer(msg);
  if (!planPath) {
    return {
      ok: false,
      commit,
      subject,
      reason: `${tier.reason}; missing Plan: docs/design/<slug>.md trailer`,
    };
  }
  if (!isValidPlanPath(planPath)) {
    return {
      ok: false,
      commit,
      subject,
      reason: `invalid plan path "${planPath}"; must be docs/design/<slug>.md`,
    };
  }
  let planText;
  try {
    planText = git(cwd, ['show', `${contentRef}:${planPath}`]);
  } catch {
    return {
      ok: false,
      commit,
      subject,
      reason: `plan file "${planPath}" not found at ${contentRef.slice(0, 9)}`,
    };
  }
  const { edgeCases } = validatePlanContent(planText);
  const check = checkPlanProvingTestsAtCommit(cwd, commit, changed, edgeCases);
  if (check.errors.length > 0) {
    return {
      ok: false,
      commit,
      subject,
      reason: check.errors.join('; '),
    };
  }
  if (!edgeCases.hasSliceColumn) {
    return {
      ok: false,
      commit,
      subject,
      reason: 'plan has no Edge cases row marked "this change"',
    };
  }
  const plan = regressionPlanForCommit(cwd, commit, mode, check.runnableThisChange);
  if (plan.totalTests === 0) {
    return {
      ok: false,
      commit,
      subject,
      reason: `no added or modified runnable proving test in commit ${commit.slice(0, 9)} for "this change" rows (${edgeCases.thisChangeTestPaths.join(', ')})`,
      plan,
    };
  }
  if (mode === 'static') return { ok: true, commit, subject, skipped: 'tests run in CI', plan };
  if (plan.delegated)
    return {
      ok: true,
      commit,
      subject,
      skipped: `delegated to ${mode === 'light' ? 'integration' : 'light'}`,
      plan,
    };
  const collect = (tree, phase, predicate) => {
    const matched = [];
    for (const file of plan.vitestFiles) {
      const outcome = execute(tree, { ...plan, vitestFiles: [file], nodeFiles: [] }, mode, phase);
      if (predicate(outcome)) matched.push(file);
    }
    for (const file of plan.nodeFiles) {
      const outcome = execute(tree, { ...plan, vitestFiles: [], nodeFiles: [file] }, mode, phase);
      if (predicate(outcome)) matched.push(file);
    }
    return matched;
  };
  const commitTree = mkdtempSync(join(tmpdir(), 'cairn-regression-commit-'));
  try {
    materializeCommitTree(cwd, commit, commitTree);
    const failedOnCommit = collect(commitTree, 'commit', (outcome) => !outcome.passed);
    if (failedOnCommit.length > 0) {
      return {
        ok: false,
        commit,
        subject,
        commitPassed: false,
        plan,
        reason: `proving test file(s) fail on the commit itself: ${failedOnCommit.join(', ')}`,
      };
    }
  } finally {
    rmSync(commitTree, { recursive: true, force: true });
  }
  const parentTree = mkdtempSync(join(tmpdir(), 'cairn-regression-parent-'));
  try {
    const parent = materializeParentTree(cwd, commit, parentTree);
    const passedOnParent = collect(parentTree, 'parent', (outcome) => outcome.passed);
    return {
      ok: passedOnParent.length === 0,
      commit,
      parent,
      subject,
      commitPassed: true,
      parentPassed: passedOnParent.length > 0,
      plan,
      reason:
        passedOnParent.length > 0
          ? `proving test file(s) pass on the parent source: ${passedOnParent.join(', ')}`
          : null,
    };
  } finally {
    rmSync(parentTree, { recursive: true, force: true });
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
    if (isFixSubject(subject)) {
      results.push(evaluateFixCommit(cwd, commit, mode, execute));
      continue;
    }
    const productFiles = changedFilesForCommit(cwd, commit)
      .map((file) => file.path)
      .filter((path) => isProductRuntimeFile(path) && !isTestHarnessFile(path));
    if (isTier1Commit(subject, productFiles).required) {
      results.push(evaluatePlanInversionCommit(cwd, commit, mode, execute, commit));
    }
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
  if (!['light', 'integration', 'static'].includes(opts.mode))
    throw new Error('--mode must be light, integration or static');
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
      const productFiles = changedFilesForCommit(cwd, opts.commit)
        .map((file) => file.path)
        .filter((path) => isProductRuntimeFile(path) && !isTestHarnessFile(path));
      if (isFixSubject(subject)) {
        results = [evaluateFixCommit(cwd, opts.commit, opts.mode)];
      } else if (isTier1Commit(subject, productFiles).required) {
        results = [
          evaluatePlanInversionCommit(cwd, opts.commit, opts.mode, executePlanInTree, opts.commit),
        ];
      } else if (opts.force) {
        results = [evaluateFixCommit(cwd, opts.commit, opts.mode)];
      } else {
        console.log(
          `[regression-inversion] skip ${opts.commit.slice(0, 9)} ${subject}: not a fix or Tier 1 plan commit`,
        );
        results = [];
      }
    } else if (opts.mode === 'static') {
      const base = opts.base ?? mergeBase(cwd, 'origin/main');
      if (!base) throw new Error('no merge-base with origin/main');
      results = evaluateRange({ cwd, base, head: opts.head, mode: opts.mode });
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
      console.log(`[regression-inversion] PASS: no applicable fix or plan commits (${opts.mode})`);
    process.exit(results.some((result) => !result.ok) ? 1 : 0);
  } catch (error) {
    console.error(
      `[regression-inversion] ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
}
