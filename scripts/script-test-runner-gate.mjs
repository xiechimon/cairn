#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SCRIPT_TEST = /^scripts\/[^/]+\.test\.mjs$/;
const VITEST_IMPORT = /\b(?:from|import)\s*\(?\s*['"]vitest['"]/g;

let files;
try {
  files = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((file) => SCRIPT_TEST.test(file));
} catch (err) {
  console.error(`[script-test-runner-gate] git ls-files failed: ${err.message}`);
  process.exit(2);
}
if (files.length === 0) {
  console.error('[script-test-runner-gate] no script tests matched; scripts/*.test.mjs has moved');
  process.exit(2);
}

const violations = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(join(REPO_ROOT, file), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') continue;
    throw err;
  }
  for (const match of text.matchAll(VITEST_IMPORT)) {
    const line = text.slice(0, match.index).split('\n').length;
    violations.push(`${file}:${line}  ${match[0]}`);
  }
}

if (violations.length > 0) {
  console.error(
    '[script-test-runner-gate] script tests import vitest, but no vitest project covers scripts/ and node --test cannot run them:',
  );
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    '  Write scripts/*.test.mjs with node:test and node:assert/strict, as in scripts/evidence-prune.test.mjs.',
  );
  process.exit(1);
}
console.log(`[script-test-runner-gate] PASS: ${files.length} script tests, no vitest imports.`);
