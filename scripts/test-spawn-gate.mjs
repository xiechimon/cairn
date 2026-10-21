#!/usr/bin/env node
// Test spawn gate: test code must not start processes through a package
// manager. `corepack` / `pnpm` / `npx` / `npm` / `yarn` resolve to corepack's
// node shim, which exits on SIGTERM without forwarding it, so `child.kill()`
// reaches only the shim and the real process tree is reparented to PID 1.
//
// Flagged: async `spawn` / `exec` / `execFile` whose literal command is one
// of those, in tracked files under apps/web/e2e, apps/*/test,
// packages/*/test and integration. The Sync variants block until the whole
// child exits and are allowed. A command held in a variable is out of reach
// here and stays a review concern.
//
// Fix: spawn `process.execPath` with `--import tsx` (integration/test/
// crash-recover.test.ts), or boot servers through apps/web/e2e/live-server.ts.
//
// Exit codes: 0 = clean, 1 = violations, 2 = operational error (git failure,
// or the territories matched no files, which would make a pass vacuous).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const TERRITORY = /^(apps\/web\/e2e|apps\/[^/]+\/test|packages\/[^/]+\/test|integration)\//;
const SOURCE = /\.[cm]?[jt]sx?$/;
const SHIM_SPAWN = /\b(spawn|exec|execFile)\(\s*(['"`])(corepack|pnpm|npx|npm|yarn)(?=['"`\s])/g;

let files;
try {
  files = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((f) => TERRITORY.test(f) && SOURCE.test(f));
} catch (err) {
  console.error(`[test-spawn-gate] git ls-files failed: ${err.message}`);
  process.exit(2);
}
if (files.length === 0) {
  console.error('[test-spawn-gate] no test sources matched; the territory paths have moved');
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
  for (const match of text.matchAll(SHIM_SPAWN)) {
    const line = text.slice(0, match.index).split('\n').length;
    violations.push(`${file}:${line}  ${match[1]}('${match[3]}', ...)`);
  }
}

if (violations.length > 0) {
  console.error('[test-spawn-gate] test code starts processes through a package-manager shim:');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    "  The shim swallows SIGTERM, so the real process outlives its test. Spawn process.execPath with '--import tsx' instead, or use apps/web/e2e/live-server.ts for servers.",
  );
  process.exit(1);
}
console.log(`[test-spawn-gate] PASS: ${files.length} test sources, no package-manager spawns.`);
