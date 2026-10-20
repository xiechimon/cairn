#!/usr/bin/env node
// verify-pacman registry gate (#1402): one driver per feature case, found
// through .claude/skills/verify-pacman/vp-registry.json and run by vp.mjs.
// Before the registry, every lane wrote its own drive-<ticket>.mjs: 99
// scripts, 51 of them mentioned in no feature file, so the next session
// could not find the driver that already existed and wrote another one.
// The registry lists them now; this gate keeps the list complete and stops
// new ticket-numbered drivers.
//
// Violations:
//   Leg 1 (always)  a .mjs file under scripts/ that the registry does not
//                   list (neither as a case script nor under "support"), a
//                   registered script path that does not exist, or a
//                   registry that does not parse.
//   Leg 2 (PR runs) with a base sha (--base or VERIFY_REGISTRY_BASE_SHA,
//                   fetched in ci.yml the way lane-file-gate takes its
//                   base): a script ADDED under scripts/ whose name starts
//                   with drive-<digits>. Existing ones are not touched;
//                   register a new case under its feature instead.
//
// Usage:
//   node scripts/verify-registry-gate.mjs
//   node scripts/verify-registry-gate.mjs --base <sha>
//   VERIFY_REGISTRY_BASE_SHA=<sha> node scripts/verify-registry-gate.mjs
//
// Exit codes: 0 = clean, 1 = violations, 2 = operational error (git
// plumbing failure; fail-closed, same stance as lane-file-gate).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SKILL = '.claude/skills/verify-pacman';
const SCRIPTS = `${SKILL}/scripts`;
const REGISTRY = `${SKILL}/vp-registry.json`;
const TICKET_NAMED = /^drive-\d/;

function git(args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') {
      out.base = argv[i + 1];
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const baseSha = args.base || process.env.VERIFY_REGISTRY_BASE_SHA || '';
const violations = [];

// Leg 1: registry completeness and existence.
let registry;
try {
  registry = JSON.parse(readFileSync(join(REPO_ROOT, REGISTRY), 'utf8'));
} catch (e) {
  violations.push(`${REGISTRY} does not parse: ${String(e.message).slice(0, 200)}`);
}

if (registry !== undefined) {
  const registered = new Set(Object.keys(registry.support ?? {}));
  for (const [feature, entry] of Object.entries(registry.features ?? {})) {
    for (const [name, c] of Object.entries(entry.cases ?? {})) {
      if (typeof c.script !== 'string') {
        violations.push(`${feature}/${name}: no script`);
        continue;
      }
      if (!existsSync(join(REPO_ROOT, c.script))) {
        violations.push(`${feature}/${name}: registered script is missing: ${c.script}`);
      }
      if (posix.dirname(c.script) === SCRIPTS) registered.add(posix.basename(c.script));
    }
  }
  const onDisk = readdirSync(join(REPO_ROOT, SCRIPTS)).filter((f) => f.endsWith('.mjs'));
  const unregistered = onDisk.filter((f) => !registered.has(f));
  for (const f of unregistered) {
    violations.push(`${SCRIPTS}/${f} is not in ${REGISTRY}`);
  }
  console.log(
    `verify-registry-gate leg 1: ${onDisk.length} script(s) on disk, ${unregistered.length} unregistered`,
  );
}

// Leg 2: no new ticket-numbered drivers.
if (baseSha) {
  let added;
  try {
    added = git(['diff', '--name-only', '--diff-filter=A', baseSha, 'HEAD', '--', SCRIPTS]);
  } catch (e) {
    console.error(`verify-registry-gate: git plumbing failure: ${String(e.message).slice(0, 300)}`);
    process.exit(2);
  }
  const hits = added
    .split('\n')
    .filter((p) => p.length > 0 && TICKET_NAMED.test(posix.basename(p)));
  for (const p of hits) {
    violations.push(`${p} is a new ticket-numbered driver`);
  }
  console.log(
    `verify-registry-gate leg 2 (added vs base ${baseSha.slice(0, 12)}): ${hits.length} hit(s)`,
  );
} else {
  console.log('verify-registry-gate leg 2: skipped (no base sha; local run or push event)');
}

if (violations.length === 0) {
  console.log('verify-registry-gate: OK');
  process.exit(0);
}

for (const v of violations) console.error(`verify-registry-gate: ${v}`);
console.error('');
console.error('Fix: register the script under its feature in vp-registry.json (or under "support"');
console.error(
  'when it is not a driver), name new drivers by what they verify instead of the ticket,',
);
console.error(
  'and run them through `node .claude/skills/verify-pacman/scripts/vp.mjs drive <feature> <case>`.',
);
process.exit(1);
