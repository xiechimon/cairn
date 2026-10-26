#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /(?:\.test|\.spec)\.[cm]?[jt]sx?$/;
const HELPER_DIR =
  /^(?:apps\/[^/]+\/test|packages\/[^/]+\/test|integration\/test|apps\/web\/e2e|integration\/eval)\//;
const EXEMPT = new Set(['scripts/test-tmpdir.mjs']);
const CREATOR = /\bmkdtemp(?:Sync)?\s*\(/g;
const SWEEP = 'scripts/tmpdir-sweep.mjs';
const SETUP = 'scripts/tmpdir-setup.mjs';
const PROJECT_CONFIGS = [
  'apps/daemon/vitest.config.ts',
  'apps/server/vitest.config.ts',
  'apps/web/vitest.config.ts',
  'integration/vitest.config.ts',
  'packages/shared/vitest.config.ts',
];

function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return null;
    throw err;
  }
}

export function isSwept(file) {
  if (EXEMPT.has(file) || file.split('/').includes('repo-seed')) return false;
  if (!SOURCE.test(file)) return false;
  return TEST_FILE.test(file) || HELPER_DIR.test(file);
}

export function sweepViolations(files, root = ROOT) {
  const violations = [];
  for (const file of files) {
    if (!isSwept(file)) continue;
    const text = readOrNull(join(root, file));
    if (text === null) continue;
    for (const match of text.matchAll(CREATOR)) {
      const line = text.slice(0, match.index).split('\n').length;
      violations.push({
        file,
        line,
        message: `${file}:${line} calls mkdtemp; use makeTestTempDir from scripts/test-tmpdir.mjs`,
      });
    }
  }
  return violations;
}

export function configViolations(root = ROOT) {
  const violations = [];
  const rootText = readOrNull(join(root, 'vitest.config.ts'));
  if (rootText === null || !rootText.includes(SWEEP)) {
    violations.push({
      file: 'vitest.config.ts',
      line: 1,
      message: 'vitest.config.ts does not run scripts/tmpdir-sweep.mjs',
    });
  }
  for (const file of PROJECT_CONFIGS) {
    const text = readOrNull(join(root, file));
    if (text === null || !text.includes(SETUP)) {
      violations.push({
        file,
        line: 1,
        message: `${file} does not load scripts/tmpdir-setup.mjs`,
      });
    }
  }
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  let tracked = [];
  try {
    tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter(Boolean);
  } catch (err) {
    console.error(`[tmpdir-sweep-gate] git ls-files failed: ${err.message}`);
    process.exit(2);
  }
  const files = tracked.filter((file) => isSwept(file));
  if (files.length === 0) {
    console.error('[tmpdir-sweep-gate] no test sources matched; the territory paths have moved');
    process.exit(2);
  }
  const violations = [...configViolations(), ...sweepViolations(files)];
  if (violations.length > 0) {
    console.error('[tmpdir-sweep-gate] test temp dirs must be removed when the test ends:');
    for (const violation of violations) console.error(`  ${violation.message}`);
    process.exit(1);
  }
  console.log(`[tmpdir-sweep-gate] PASS (${files.length} test files)`);
}
