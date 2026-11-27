#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeBase } from './diff-base.mjs';
import {
  changedFilesForCommit,
  commitsInRange,
  isProductRuntimeFile,
  isTestHarnessFile,
} from './regression-inversion-gate.mjs';

const FEAT = /^feat(?:\(|:|\s|$)/;
const EXEMPT =
  /^(?:fix|test|docs|chore|ci|ops|refactor|style|perf|security)(?:\(|:|\s|$)|^Revert\s/;
const STATE_PROTO =
  /^(?:apps\/server\/(?:drizzle\/|src\/db\/schema\.ts$)|packages\/shared\/src\/protocol\/)/;
const PLAN_PATH = /^docs\/design\/[a-z0-9][a-z0-9._-]*\.md$/i;
const RESERVED = /^docs\/design\/(?:README|tested-sha-landing|preflight-ci-verification)\.md$/i;
const PLACEHOLDER =
  /^(?:todo|tbd)(?:\b|$)|^(?:n\/?a|none|placeholder|pending|later|\.\.\.|-|<[^>]+>)$/i;

const git = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: 'pipe',
  }).trim();

const isHollow = (text, min = 8) => {
  const s = text.replace(/^[\s`"'*-]+|[\s`"'*-]+$/g, '').trim();
  return s.length < min || PLACEHOLDER.test(s);
};

export function classifyCommit(subject, files) {
  const product = files
    .map((f) => f.path)
    .filter((p) => isProductRuntimeFile(p) && !isTestHarnessFile(p));
  if (FEAT.test(subject.trim()) && product.length > 0)
    return { required: true, reason: 'feat commit touches product runtime files' };
  if (!EXEMPT.test(subject.trim()) && product.some((p) => STATE_PROTO.test(p)))
    return { required: true, reason: 'persisted-state or protocol change' };
  return {
    required: false,
    reason: product.length ? 'tier-0 change' : 'no product runtime change',
  };
}

export const isValidPlanPath = (p) =>
  typeof p === 'string' && !p.includes('..') && PLAN_PATH.test(p) && !RESERVED.test(p);

function scanPlan(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections = new Map();
  let [fence, cur, revAt, revEnd] = [null, null, -1, lines.length];
  for (let i = 0; i < lines.length; i += 1) {
    const mark = /^\s*(```|~~~)/.exec(lines[i])?.[1];
    if (mark) fence = fence === null ? mark : fence === mark ? null : fence;
    else if (fence === null) {
      const h = /^##\s+(.+?)\s*$/.exec(lines[i]);
      if (h) {
        if (revAt === -1 && /^review$/i.test(h[1])) revAt = i;
        else if (revAt !== -1 && revEnd === lines.length) revEnd = i;
        cur = [];
        sections.set(h[1].toLowerCase(), cur);
        continue;
      }
    }
    if (cur && fence === null && !mark) cur.push(lines[i]);
  }
  const body = `${(revAt === -1 ? lines : lines.slice(0, revAt)).join('\n').trimEnd()}\n`;
  const review = revAt === -1 ? null : lines.slice(revAt + 1, revEnd).join('\n');
  return { sections, body, review };
}

export const computePlanHash = (content) =>
  createHash('sha256').update(scanPlan(content).body, 'utf8').digest('hex');

export function validatePlanContent(content) {
  const errors = [];
  const { sections, body, review } = scanPlan(content);
  const expectedHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const list = (key, rx) => (sections.get(key) ?? []).map((l) => rx.exec(l)?.[1]).filter(Boolean);
  if (isHollow((sections.get('user scenario') ?? []).join(' '), 40))
    errors.push('User scenario must be a concrete >=40-char scenario');
  const scope = list('scope', /^\s*\d+\.\s+(.+)$/);
  if (scope.length === 0 || scope.some((x) => isHollow(x, 10)))
    errors.push('Scope must contain numbered rows with concrete behavior');
  const edges = (sections.get('edge cases') ?? [])
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'));
  const badRow = (r) => {
    const c = r.replace(/^\||\|$/g, '').split('|');
    return c.length < 3 || c.slice(0, 3).some((x) => isHollow(x, 8));
  };
  if (edges.length < 4 || !/^\|[\s:-]+(?:\|[\s:-]+)+\|?$/.test(edges[1]))
    errors.push('Edge cases table must have at least 2 concrete rows');
  else if (edges.slice(2).some(badRow))
    errors.push('Every Edge cases row must fill edge case, user behavior, and proving test');
  const out = list('out of scope', /^\s*[-*]\s+(.+)$/);
  if (out.length === 0 || out.some((x) => isHollow(x, 8)))
    errors.push('Out of scope must list at least one concrete bullet item');
  if (review === null) errors.push('Missing ## Review section');
  else {
    const field = (n) => new RegExp(`^\\s*-\\s*${n}:\\s*(.+)$`, 'im').exec(review)?.[1] ?? '';
    if (field('Verdict').trim().toUpperCase() !== 'PASS')
      errors.push('## Review must record Verdict: PASS');
    const hm = /^([0-9a-f]{64})$/i.exec(field('Plan-SHA256').trim());
    if (!hm) errors.push('## Review missing 64-char Plan-SHA256');
    else if (hm[1].toLowerCase() !== expectedHash)
      errors.push(`Plan-SHA256 mismatch (expected ${expectedHash})`);
    if (isHollow(field('Reviewer'), 3)) errors.push('## Review must name Reviewer');
    if (isHollow(field('Findings'), 5)) errors.push('## Review must summarize Findings');
  }
  return { ok: errors.length === 0, errors, expectedHash };
}

export function evaluatePlanCommit(cwd, commit, contentRef = commit) {
  const msg = git(cwd, ['show', '-s', '--format=%B', commit]);
  const subject = msg.split('\n', 1)[0];
  const fail = (reason) => ({ ok: false, commit, subject, reason });
  const { required, reason } = classifyCommit(subject, changedFilesForCommit(cwd, commit));
  if (!required) return { ok: true, commit, subject, skipped: reason };
  const planPath = /^Plan:\s*(\S+)\s*$/im.exec(msg)?.[1] ?? null;
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
  const { ok, errors } = validatePlanContent(planText);
  return { ok, commit, subject, planPath, reason: ok ? null : errors.join('; ') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const argv = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--hash', '--check-file', '--commit', '--base', '--head'].includes(argv[i]))
        throw new Error(`unknown argument ${argv[i]}`);
      if (i + 1 >= argv.length) throw new Error(`missing value for ${argv[i]}`);
      opts[argv[i].slice(2)] = argv[i + 1];
    }
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
      ? [evaluatePlanCommit(cwd, opts.commit, opts.commit)]
      : commitsInRange(cwd, base, head).map((c) => evaluatePlanCommit(cwd, c, head));
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
