#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const BASELINE_REL = 'scripts/test-tmp-baseline.json';
const TEST_SOURCE =
  /^(?:apps\/[^/]+\/test\/|apps\/web\/e2e\/|integration\/|packages\/[^/]+\/test\/).*\.(?:[cm]?[jt]sx?)$|^scripts\/.*\.test\.[cm]?[jt]sx?$/;
const EXEMPT = new Set(['scripts/test-tmpdir.mjs', 'scripts/test-tmp-ratchet-gate.mjs']);
const MKDTEMP = '(?:mkdtemp|mkdtempSync)';

function aliasesOf(source) {
  const aliases = new Set();
  const named = new RegExp(`\\b${MKDTEMP}\\s+as\\s+([A-Za-z_$][\\w$]*)`, 'g');
  for (const match of source.matchAll(named)) aliases.add(match[1]);
  const destructured = new RegExp(`\\b${MKDTEMP}\\s*:\\s*([A-Za-z_$][\\w$]*)`, 'g');
  for (const match of source.matchAll(destructured)) aliases.add(match[1]);
  return aliases;
}

export function countRawAllocations(source) {
  const lines = source
    .split('\n')
    .filter((line) => !/^\s*(?:import\b|export\b.*\bfrom\b)/.test(line));
  const body = lines.join('\n');
  const direct = new RegExp(`\\b${MKDTEMP}\\s*\\(`, 'g');
  let count = [...body.matchAll(direct)].length;
  for (const alias of aliasesOf(source)) {
    const escaped = alias.replace(/\$/g, '\\$');
    count += [...body.matchAll(new RegExp(`(?<![\\w$.])${escaped}\\s*\\(`, 'g'))].length;
  }
  return count;
}

export function compareToBaseline(current, baseline) {
  const violations = [];
  for (const [file, count] of Object.entries(current)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) {
      violations.push({ file, count, allowed });
    }
  }
  return violations;
}

export function shrunk(current, baseline) {
  const next = {};
  for (const [file, allowed] of Object.entries(baseline)) {
    const count = current[file] ?? 0;
    if (count > 0) next[file] = Math.min(count, allowed);
  }
  return next;
}

function trackedTestSources(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return out
    .split('\0')
    .filter((path) => path !== '' && TEST_SOURCE.test(path) && !EXEMPT.has(path));
}

export function scan(root = REPO_ROOT) {
  const current = {};
  for (const path of trackedTestSources(root)) {
    let source;
    try {
      source = readFileSync(join(root, path), 'utf8');
    } catch {
      continue;
    }
    const count = countRawAllocations(source);
    if (count > 0) current[path] = count;
  }
  return current;
}

function main() {
  const rootFlag = process.argv.indexOf('--root');
  const root = rootFlag === -1 ? REPO_ROOT : resolve(process.argv[rootFlag + 1] ?? '');
  const baselinePath = join(root, BASELINE_REL);
  const current = scan(root);
  if (process.argv.includes('--init')) {
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`test-tmp-ratchet: wrote ${Object.keys(current).length} files to ${BASELINE_REL}`);
    return 0;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (process.argv.includes('--shrink')) {
    writeFileSync(baselinePath, `${JSON.stringify(shrunk(current, baseline), null, 2)}\n`);
    return 0;
  }
  const violations = compareToBaseline(current, baseline);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(
        `FAIL ${v.file}: ${v.count} raw mkdtemp call(s), baseline allows ${v.allowed}; allocate through scripts/test-tmpdir.mjs (makeTestTempDir / releaseTestTempDir)`,
      );
    }
    return 1;
  }
  const total = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(
    `test-tmp-ratchet: PASS ${total} raw mkdtemp call(s) in ${Object.keys(current).length} file(s), none above baseline`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
