#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_DIR = join(REPO_ROOT, 'apps/web');
const WEB_E2E_DIR = join(WEB_DIR, 'e2e');
const INTEGRATION_DIR = join(REPO_ROOT, 'integration');
const INTEGRATION_TEST_DIR = join(INTEGRATION_DIR, 'test');

const SPEC_FILE_RE = /\.(spec|test)\.[cm]?[jt]sx?$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') walk(path, out);
    } else if (SPEC_FILE_RE.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function run(cmd, args, cwd) {
  const started = Date.now();
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (res.error) {
    console.log(`[spec-parse-gate] FAIL: cannot spawn ${cmd}: ${res.error.message}`);
    process.exit(1);
  }
  return { res, seconds };
}

function dumpCaptured(output) {
  if (output.stdout) process.stdout.write(output.stdout);
  if (output.stderr) process.stderr.write(output.stderr);
}

const diskSpecs = walk(WEB_E2E_DIR);
if (diskSpecs.length === 0) {
  console.log(
    `[spec-parse-gate] FAIL: no spec files found under ${WEB_E2E_DIR} — ` +
      'either the directory moved (update this gate) or the checkout is broken.',
  );
  process.exit(1);
}

const web = run('pnpm', ['exec', 'playwright', 'test', '--list'], WEB_DIR);
if (web.res.status !== 0) {
  dumpCaptured(web.res);
  console.log(
    `[spec-parse-gate] FAIL: playwright could not collect apps/web/e2e (${web.seconds}s). ` +
      'The parser output above names the file and line.',
  );
  process.exit(1);
}

const total = /Total:\s+(\d+)\s+tests?\s+in\s+(\d+)\s+files?/.exec(web.res.stdout ?? '');
if (!total) {
  dumpCaptured(web.res);
  console.log(
    '[spec-parse-gate] FAIL: could not find the "Total: N tests in M files" ' +
      'summary in playwright --list output; the gate cannot prove coverage. ' +
      'Update the summary regex for the installed playwright version.',
  );
  process.exit(1);
}
const [collectedTests, collectedFiles] = [Number(total[1]), Number(total[2])];
if (collectedTests === 0 || collectedFiles !== diskSpecs.length) {
  const collected = new Set(
    (web.res.stdout ?? '')
      .split('\n')
      .map((line) => line.match(/^\s*(\S+\.(?:spec|test)\.[cm]?[jt]sx?):\d+:\d+\s+›/)?.[1])
      .filter(Boolean)
      .map((p) => p.replace(/^e2e\//, '')),
  );
  const missing = diskSpecs.map((p) => relative(WEB_E2E_DIR, p)).filter((p) => !collected.has(p));
  console.log(
    `[spec-parse-gate] FAIL: disk has ${diskSpecs.length} spec files but playwright ` +
      `collected ${collectedFiles} file(s) / ${collectedTests} test(s).`,
  );
  if (missing.length > 0) {
    console.log('[spec-parse-gate] spec files that collected zero tests:');
    for (const m of missing) console.log(`  ${m}`);
  }
  console.log(
    'A spec with no collected tests parses but registers nothing — ' +
      'broken test() calls, a stray top-level return, or testDir drift all look like this.',
  );
  process.exit(1);
}
console.log(
  `[spec-parse-gate] apps/web/e2e: ${collectedTests} tests in ${collectedFiles} files ` +
    `collected, disk count matches (${web.seconds}s)`,
);

const integrationSpecs = walk(INTEGRATION_TEST_DIR);
if (integrationSpecs.length === 0) {
  console.log(
    `[spec-parse-gate] FAIL: no test files found under ${INTEGRATION_TEST_DIR} — ` +
      'either the directory moved (update this gate) or the checkout is broken.',
  );
  process.exit(1);
}

const integ = run('pnpm', ['exec', 'tsc', '--noEmit'], INTEGRATION_DIR);
if (integ.res.status !== 0) {
  dumpCaptured(integ.res);
  console.log(
    `[spec-parse-gate] FAIL: integration tsc rejected the tree (${integ.seconds}s). ` +
      'TS1xxx errors above are parse failures with file:line.',
  );
  process.exit(1);
}
console.log(
  `[spec-parse-gate] integration/test: ${integrationSpecs.length} test files ` +
    `parsed clean by tsc (${integ.seconds}s)`,
);

console.log('[spec-parse-gate] PASS: every spec in apps/web/e2e and integration/test parses.');
process.exit(0);
