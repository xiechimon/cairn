#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const PASSAGE_CLI = join(ROOT, 'scripts', 'ops', 'agent-passage.mjs');

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'health';
const outIdx = args.indexOf('--out');
const evidenceDir =
  outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : process.env.VERIFY_EVIDENCE_DIR;

const forwardArgs = [PASSAGE_CLI, command];
if (!args.includes('--target')) {
  forwardArgs.push('--target', 'local');
}
if (evidenceDir && outIdx === -1) {
  forwardArgs.push('--out', evidenceDir);
}
forwardArgs.push(...args);

const res = spawnSync(process.execPath, forwardArgs, {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
});

if (res.error) {
  console.error(res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
