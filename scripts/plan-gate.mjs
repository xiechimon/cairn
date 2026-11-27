#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeBase } from './diff-base.mjs';
import {
  computePlanHash,
  extractPlanTrailer,
  extractProvingTestPaths,
  isTier1Commit,
  isValidPlanPath,
  normalizeModelId,
  parseSliceStatus,
  validatePlanContent,
} from './plan-spec.mjs';
import {
  changedFilesForCommit,
  checkPlanProvingTestsAtCommit,
  commitsInRange,
  evaluatePlanInversionCommit,
  executePlanInTree,
  isProductRuntimeFile,
  isTestHarnessFile,
} from './regression-inversion-gate.mjs';

export {
  computePlanHash,
  extractProvingTestPaths,
  isValidPlanPath,
  normalizeModelId,
  parseSliceStatus,
  validatePlanContent,
};

const git = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: 'pipe',
  }).trim();

export function classifyCommit(subject, files) {
  const product = files
    .map((f) => f.path)
    .filter((p) => isProductRuntimeFile(p) && !isTestHarnessFile(p));
  return isTier1Commit(subject, product);
}

export function evaluatePlanCommit(
  cwd,
  commit,
  contentRef = commit,
  { mode = 'static', execute = executePlanInTree } = {},
) {
  const msg = git(cwd, ['show', '-s', '--format=%B', commit]);
  const subject = msg.split('\n', 1)[0];
  const fail = (reason) => ({ ok: false, commit, subject, reason });
  const changed = changedFilesForCommit(cwd, commit);
  const { required, reason } = classifyCommit(subject, changed);
  if (!required) return { ok: true, commit, subject, skipped: reason };
  const planPath = extractPlanTrailer(msg);
  if (!planPath)
    return fail(`${reason}; add Plan: docs/design/<slug>.md trailer (see docs/ops/plan-gate.md)`);
  if (!isValidPlanPath(planPath))
    return fail(`invalid plan path "${planPath}"; must be docs/design/<slug>.md`);
  let planText;
  try {
    planText = git(cwd, ['show', `${contentRef}:${planPath}`]);
  } catch {
    return fail(`plan file "${planPath}" not found at ${contentRef.slice(0, 9)}`);
  }
  const validation = validatePlanContent(planText);
  const errors = [...validation.errors];
  const check = checkPlanProvingTestsAtCommit(cwd, commit, changed, validation.edgeCases);
  errors.push(...check.errors);
  if (errors.length > 0) return { ok: false, commit, subject, planPath, reason: errors.join('; ') };
  if (mode !== 'static') {
    const inv = evaluatePlanInversionCommit(cwd, commit, mode, execute, contentRef);
    if (!inv.ok) return { ok: false, commit, subject, planPath, reason: inv.reason };
  }
  return { ok: true, commit, subject, planPath, reason: null };
}

export function evaluatePlanRange({
  cwd,
  base,
  head = 'HEAD',
  mode = 'static',
  execute = executePlanInTree,
}) {
  const results = commitsInRange(cwd, base, head).map((commit) =>
    evaluatePlanCommit(cwd, commit, commit, { mode, execute }),
  );
  const referencedPlans = [...new Set(results.map((r) => r.planPath).filter(Boolean))];
  for (const planPath of referencedPlans) {
    let headText;
    try {
      headText = git(cwd, ['show', `${head}:${planPath}`]);
    } catch {
      results.push({
        ok: false,
        commit: head,
        subject: `plan check at ${head.slice(0, 9)}`,
        planPath,
        reason: `plan file "${planPath}" not found at ${head.slice(0, 9)}`,
      });
      continue;
    }
    const { ok, errors } = validatePlanContent(headText);
    if (!ok) {
      results.push({
        ok: false,
        commit: head,
        subject: `plan check at ${head.slice(0, 9)}`,
        planPath,
        reason: errors.join('; '),
      });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const argv = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--hash', '--check-file', '--commit', '--base', '--head', '--mode'].includes(argv[i]))
        throw new Error(`unknown argument ${argv[i]}`);
      if (i + 1 >= argv.length) throw new Error(`missing value for ${argv[i]}`);
      opts[argv[i].slice(2)] = argv[i + 1];
    }
    const mode = opts.mode ?? 'static';
    if (!['static', 'light', 'integration'].includes(mode))
      throw new Error('--mode must be static, light or integration');
    const cwd = process.cwd();
    const read = (p) => readFileSync(resolve(cwd, p), 'utf8');
    if (opts.hash) {
      console.log(computePlanHash(read(opts.hash)));
      process.exit(0);
    }
    if (opts['check-file']) {
      const { ok, errors, expectedHash } = validatePlanContent(read(opts['check-file']));
      console.log(
        `[plan-gate] ${ok ? 'PASS' : 'FAIL'} ${opts['check-file']}: ${ok ? expectedHash : errors.join('; ')}`,
      );
      process.exit(ok ? 0 : 1);
    }
    const cfg = opts.base ?? process.env.PLAN_GATE_BASE_SHA ?? process.env.PREPUSH_BASE_SHA ?? '';
    const base = opts.commit
      ? null
      : mergeBase(cwd, cfg && !/^0{40}$/.test(cfg) ? cfg : 'origin/main');
    if (!opts.commit && !base) throw new Error('no merge-base with origin/main');
    const head = opts.head ?? 'HEAD';
    const results = opts.commit
      ? [evaluatePlanCommit(cwd, opts.commit, opts.commit, { mode })]
      : evaluatePlanRange({ cwd, base, head, mode });
    for (const r of results)
      console[r.ok ? 'log' : 'error'](
        `[plan-gate] ${r.skipped ? 'skip' : r.ok ? 'PASS' : 'FAIL'} ${r.commit.slice(0, 9)} ${r.subject}: ${r.skipped ?? (r.ok ? r.planPath : r.reason)}`,
      );
    if (results.length === 0) console.log('[plan-gate] PASS: no commits in range');
    process.exit(results.some((r) => !r.ok) ? 1 : 0);
  } catch (error) {
    console.error(`[plan-gate] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
