#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const [file, probe] = process.argv.slice(2);

const REQUIRED_CHECKS = {
  'new-task': ['row', 'api', 'db'],
};

const fail = (reason) => {
  console.error(`[live-verify] ${reason}`);
  process.exit(1);
};

if (file === undefined || probe === undefined) {
  fail('usage: require-verify-evidence.mjs <result.json> <probe>');
}

let result;
try {
  result = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  fail(`no evidence result at ${file}`);
}

if (result.probe !== probe) {
  fail(`the evidence probe is ${JSON.stringify(result.probe)}, expected ${JSON.stringify(probe)}`);
}
if (!Array.isArray(result.checks) || result.checks.length === 0) {
  fail('the evidence holds no assertions');
}
const required = REQUIRED_CHECKS[probe] ?? [];
const present = new Set(result.checks.map((entry) => entry.id));
const absent = required.filter((id) => !present.has(id));
if (absent.length > 0) {
  fail(`the evidence lacks the required ${absent.join(', ')} assertion(s)`);
}
const failed = result.checks.filter((entry) => entry.ok !== true);
if (result.ok !== true || failed.length > 0) {
  fail(`${failed.length} assertion(s) failed: ${failed.map((entry) => entry.label).join('; ')}`);
}
console.log(`[live-verify] ${result.checks.length} assertions passed for ${probe}`);
