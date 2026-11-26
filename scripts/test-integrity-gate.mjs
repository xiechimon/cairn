#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeBase } from './diff-base.mjs';
import { changedFilesForCommit, commitsInRange } from './regression-inversion-gate.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const TEST_FILE = /^(?:apps|packages|integration|scripts)\/.*\.(?:test|spec)\.(?:ts|tsx|mts|mjs)$/;
const ASSERTION = /(?:\bexpect\s*\(|\bassert(?:\.[\w$]+)?\s*\()/;
const WEAK_ASSERTIONS = /\.(?:toBeVisible|toBeAttached|toExist)\s*\(/;
const REMOVAL_REASON = /^test-removal-reason:\s*\S+/im;
const WEAKENING_REASON = /^test-weakening-reason:\s*\S+/im;

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function isIntegrityTestFile(path) {
  return TEST_FILE.test(path);
}

function assertionLines(lines) {
  return lines.filter((line) => ASSERTION.test(line));
}

export function analyzeTestDiff(diff) {
  const removed = [];
  const added = [];
  for (const line of diff.split('\n')) {
    if ((line.startsWith('---') || line.startsWith('+++')) && !line.startsWith('++++')) continue;
    if (line.startsWith('-')) removed.push(line.slice(1));
    else if (line.startsWith('+')) added.push(line.slice(1));
  }
  const removedAssertions = assertionLines(removed);
  const addedAssertions = assertionLines(added);
  const removedStrong = removedAssertions.filter((line) => !WEAK_ASSERTIONS.test(line));
  const addedWeak = addedAssertions.filter((line) => WEAK_ASSERTIONS.test(line));
  return {
    removedAssertions: removedAssertions.length,
    addedAssertions: addedAssertions.length,
    removedStrong: removedStrong.length,
    addedWeak: addedWeak.length,
    netAssertionLoss: removedAssertions.length > addedAssertions.length,
    weakenedToVisibility: removedStrong.length > 0 && addedWeak.length > 0,
    examples: {
      removed: removedAssertions[0]?.trim() ?? null,
      weak: addedWeak[0]?.trim() ?? null,
    },
  };
}

export function evaluateTestIntegrityCommit(cwd, commit) {
  const message = git(cwd, ['show', '-s', '--format=%B', commit]);
  const subject = message.split('\n', 1)[0];
  const allowsRemoval = REMOVAL_REASON.test(message);
  const allowsWeakening = WEAKENING_REASON.test(message);
  const violations = [];
  for (const file of changedFilesForCommit(cwd, commit).filter((item) =>
    isIntegrityTestFile(item.path),
  )) {
    if (file.status === 'D') {
      if (!allowsRemoval) {
        violations.push({
          path: file.path,
          kind: 'deleted-test-file',
          detail: 'test file deleted without test-removal-reason',
        });
      }
      continue;
    }
    if (file.status !== 'M') continue;
    const diff = git(cwd, [
      'diff',
      '--no-renames',
      '--unified=0',
      `${commit}^`,
      commit,
      '--',
      file.path,
    ]);
    const analysis = analyzeTestDiff(diff);
    if (analysis.netAssertionLoss && !allowsWeakening) {
      violations.push({
        path: file.path,
        kind: 'assertions-removed',
        detail: `${analysis.removedAssertions} assertion line(s) removed vs ${analysis.addedAssertions} added without test-weakening-reason`,
        example: analysis.examples.removed,
      });
    }
    if (analysis.weakenedToVisibility && !allowsWeakening) {
      violations.push({
        path: file.path,
        kind: 'assertion-weakened-to-visibility',
        detail:
          'behavior assertion removed while visibility/existence assertion added without test-weakening-reason',
        example: analysis.examples.removed,
        replacement: analysis.examples.weak,
      });
    }
  }
  return { commit, subject, ok: violations.length === 0, violations };
}

export function evaluateTestIntegrityRange({ cwd, base, head = 'HEAD' }) {
  return commitsInRange(cwd, base, head).map((commit) => evaluateTestIntegrityCommit(cwd, commit));
}

function integrityBase(cwd, configured) {
  if (configured && !/^0{40}$/.test(configured)) return configured;
  const fallback = mergeBase(cwd, 'origin/main');
  if (!fallback) throw new Error('no merge-base with origin/main; fetch it or pass --base <sha>');
  return fallback;
}

function parseArgs(argv) {
  const opts = { commit: null, base: null, head: 'HEAD' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--commit') opts.commit = argv[++index];
    else if (arg === '--base') opts.base = argv[++index];
    else if (arg === '--head') opts.head = argv[++index];
    else throw new Error(`unknown argument ${arg}`);
  }
  return opts;
}

function report(result) {
  const short = result.commit.slice(0, 9);
  if (result.ok) {
    console.log(`[test-integrity] PASS ${short} ${result.subject}`);
    return;
  }
  for (const violation of result.violations) {
    const example = violation.example ? `; removed: ${violation.example}` : '';
    const replacement = violation.replacement ? `; added: ${violation.replacement}` : '';
    console.error(
      `[test-integrity] FAIL ${short} ${violation.kind} ${violation.path}: ${violation.detail}${example}${replacement}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const cwd = REPO_ROOT;
    let results;
    if (opts.commit) {
      results = [evaluateTestIntegrityCommit(cwd, opts.commit)];
    } else {
      const base = integrityBase(
        cwd,
        opts.base ?? process.env.TEST_INTEGRITY_BASE_SHA ?? process.env.PREPUSH_BASE_SHA,
      );
      results = evaluateTestIntegrityRange({ cwd, base, head: opts.head });
    }
    for (const result of results) report(result);
    if (results.length === 0) console.log('[test-integrity] PASS: no commits in range');
    process.exit(results.some((result) => !result.ok) ? 1 : 0);
  } catch (error) {
    console.error(
      `[test-integrity] ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
}
