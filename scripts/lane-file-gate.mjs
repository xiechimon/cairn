#!/usr/bin/env node
// Lane file gate (#1199): herdr lane threads draft PROGRESS.md / BLOCKED.md
// at the worktree root and the files keep riding PR branches into main —
// #1189 merged BLOCKED.md into main (c7a5a2d6), and #1153's branch carried
// PROGRESS.md into review (PR #1198, deleted by 701b5588). Written warnings
// did not hold; this gate makes the failure loud instead.
// #1203 adds plan.md: the pacman plan step's handoff file — the product now
// writes it outside the repo checkout (daemon PACMAN_HOME plans dir), so a
// root plan.md is always a leak. Two leaks already happened: kanban conv card
// #24 committed plan.md at the repo root (PR #1201 first version), and PR
// #1168 landed one on main.
//
// What counts as a violation: PROGRESS.md, BLOCKED.md, or plan.md tracked at
// the repository root. Root-anchored (git pathspec :(top)) and
// case-insensitive: same-named docs in subdirectories are unaffected, and a
// lowercase progress.md at the root would collide with PROGRESS.md on macOS's
// case-insensitive filesystem, so case variants fail the gate too.
//
// What it inspects — the tracked set, two legs:
//   Leg 1 (always)  `git ls-files` over root-anchored names: the tracked set
//                   of the tested tree. Covers the staged-but-uncommitted
//                   shape (git add -A swept it in), committed branch tips,
//                   and fresh checkout trees (index = HEAD there). Given a
//                   main that carries none of the three — which the removal
//                   of BLOCKED.md and plan.md in their respective PRs
//                   enforces — "tracked at root" is exactly the issue's
//                   `origin/main...HEAD --diff-filter=A` set.
//   Leg 2 (PR runs) with a base sha (--base flag or LANE_FILE_BASE_SHA,
//                   fetched in the ci.yml step the same way the #851
//                   ui-debt-gate takes UI_DEBT_BASE_SHA):
//                   `git diff --name-only --diff-filter=A <base> HEAD`,
//                   filtered to root-anchored names. Two-dot (tree-to-tree)
//                   rather than three-dot: identical for added-detection,
//                   and it needs no merge-base, so it works on the
//                   depth-1-fetched base.
//
// The remedy the failure prints: move lane process files under
// .herdr-project/<lane>/ — those paths are untracked by policy; delete
// plan.md — it is the pacman plan handoff, which lives outside the checkout.
//
// Usage:
//   node scripts/lane-file-gate.mjs                # leg 1
//   node scripts/lane-file-gate.mjs --base <sha>   # legs 1 + 2
//   LANE_FILE_BASE_SHA=<sha> node scripts/lane-file-gate.mjs  # same
//
// Exit codes: 0 = clean, 1 = violations, 2 = operational error (git
// plumbing failure; fail-closed, same stance as the drizzle chain guard).
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

// Root-anchored, case-insensitive filter over a newline list of paths.
function rootLaneFiles(list) {
  return list.split('\n').filter((p) => p.includes('/') === false && NAMES.has(p.toLowerCase()));
}

let violations = [];

try {
  // Leg 1: tracked set of the tested tree.
  const tracked = git(['ls-files', '-z', '--', ...PATHSPECS]);
  violations.push(
    ...tracked
      .split('\0')
      .filter((p) => p.length > 0 && NAMES.has(p.toLowerCase()))
      .map((p) => p),
  );
  const leg1Count = violations.length;
  console.log(`lane-file-gate leg 1 (tracked at repo root): ${leg1Count} hit(s)`);

  // Leg 2: added-only diff against the PR base sha.
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
console.error('  A root plan.md is a pacman plan-step handoff leak (#1203): the plan file');
console.error('  lives outside the repo checkout, so delete it — do not commit it.');
console.error('');
console.error('  .herdr-project/ is untracked by policy, and the root-anchored .gitignore');
console.error('  entries make plain `git add` refuse these names (issues #1199, #1203).');
process.exit(1);
