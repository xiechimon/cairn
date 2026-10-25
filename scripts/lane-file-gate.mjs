#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const NAMES = new Set(['progress.md', 'blocked.md', 'plan.md']);
const PATHSPECS = ['progress.md', 'blocked.md', 'plan.md'].map((n) => `:(top,icase)${n}`);

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
const baseSha = args.base || process.env.LANE_FILE_BASE_SHA || '';

function rootLaneFiles(list) {
  return list.split('\n').filter((p) => p.includes('/') === false && NAMES.has(p.toLowerCase()));
}

const violations = [];

try {
  const tracked = git(['ls-files', '-z', '--', ...PATHSPECS]);
  violations.push(
    ...tracked
      .split('\0')
      .filter((p) => p.length > 0 && NAMES.has(p.toLowerCase()))
      .map((p) => p),
  );
  const leg1Count = violations.length;
  console.log(`lane-file-gate leg 1 (tracked at repo root): ${leg1Count} hit(s)`);

  if (baseSha) {
    const added = git(['diff', '--name-only', '--diff-filter=A', baseSha, 'HEAD']);
    const leg2Hits = rootLaneFiles(added);
    violations.push(...leg2Hits);
    console.log(
      `lane-file-gate leg 2 (added vs base ${baseSha.slice(0, 12)}): ${leg2Hits.length} hit(s)`,
    );
  } else {
    console.log('lane-file-gate leg 2: skipped (no base sha; local run or push event)');
  }
} catch (e) {
  console.error(`lane-file-gate: git plumbing failure: ${String(e.message).slice(0, 300)}`);
  process.exit(2);
}

if (violations.length === 0) {
  console.log('lane-file-gate: OK (no lane process files tracked at the repository root)');
  process.exit(0);
}

const unique = [...new Set(violations)];
console.error(
  `lane-file-gate: lane process file(s) tracked at the repository root: ${unique.join(', ')}`,
);
console.error('');
console.error('  Lane threads draft PROGRESS.md / BLOCKED.md at the worktree root; they must');
console.error('  not ride PR branches into main (#1189, #1198). Move them under your lane');
console.error('  folder instead, e.g.:');
console.error('');
console.error('    .herdr-project/<lane>/PROGRESS.md');
console.error('');
console.error('  A root plan.md is a cairn plan-step handoff leak (#1203): the plan file');
console.error('  lives outside the repo checkout, so delete it — do not commit it.');
console.error('');
console.error('  .herdr-project/ is untracked by policy, and the root-anchored .gitignore');
console.error('  entries make plain `git add` refuse these names (issues #1199, #1203).');
process.exit(1);
