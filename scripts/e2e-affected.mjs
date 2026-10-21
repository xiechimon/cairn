#!/usr/bin/env node

// #693 affected-surface e2e selector. Development-period answer to "which
// e2e specs does my change touch": map changed paths to spec families,
// then run only those specs on the standard fixture-build config. The
// fixture build itself is sub-second (vite 8), so the quickness comes
// entirely from the selection — 617 tests in the full run vs a few dozen
// for a domain change — with full production-build fidelity, no separate
// quick-lane config, and no special cases: token-gate.spec.ts works the
// same way (its spawned server serves the dist the webServer just built).
//
// Families are the e2e/ filename prefixes; the source map below is
// deliberately over-inclusive, because a missed spec reads as a false
// green while an extra one only costs seconds. Cross-cutting paths fall
// back to the full suite, and CI stays the only exhaustive check — this
// tool is a signal, not the bar.
//
// Usage (from apps/web, or anywhere via the workspace filter):
//   pnpm --filter @pacman/web e2e:affected            # diff vs origin/main + working tree
//   pnpm --filter @pacman/web e2e:affected -- apps/web/src/chief/chief-drawer.tsx
//   node scripts/e2e-affected.mjs --dry-run -- <paths>  # print the plan only
//
// Port: the default playwright webServer binds E2E_PORT (8399) with
// reuseExistingServer — on a multi-lane machine that would silently test
// whichever lane's build answered first (#137). Affected runs default to
// their own lane port 8398: E2E_AFFECTED_PORT overrides it, an explicitly
// set E2E_PORT wins (a lane that picked a port did so deliberately).

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_DIR = join(REPO_ROOT, 'apps/web');
const E2E_DIR = join(WEB_DIR, 'e2e');
const PORT = process.env.E2E_PORT ?? process.env.E2E_AFFECTED_PORT ?? '8398';

// --- spec families -----------------------------------------------------------

const BOARD = [
  'board-',
  'card-',
  'chip-',
  'notify-',
  'newtask-',
  'footer-',
  'dead-',
  'shell-',
  'visual-',
  // #1423: the queued card has no 开始 (queued-action.spec also pins the detail head).
  'queued-action',
  // #1428: one ring per edge — the card and the notify banner are probed there.
  'elevation-',
];
const SIDEBAR = ['sidebar-', 'collapse-', 'visual-', 'theme-', 'user-menu-', 'avatar-', 'shell-'];
const DETAIL = [
  'detail-',
  'chat-',
  'transcript-',
  'diff-full-file',
  'plan-diff-full-file',
  'reject-',
  'merge-',
  'rerun-',
  'escape-',
  'spec-brief-',
  'spinner-',
  'chief-fab',
  'chief-stream-markdown',
  'composer-wire-reject',
  'user-menu-',
  // #1400: phase chip words (detail head, search rows, schedule cards,
  // project task rows). Each of those surfaces pulls it in.
  'phase-chip-words',
  // #1423: a queued task's detail head has no primary button.
  'queued-action',
  // #1428: one ring per edge — the user menu and the composer are probed there.
  'elevation-',
];
// #1428: one ring per edge — the chief window and the FAB are probed there.
const CHIEF = ['chief-', 'composer-wire-reject', 'elevation-'];
const AGENT = ['agent-', 'team-create-agent'];
const LIVE_SERVER = ['token-gate', 'live-server-'];
const OVERLAY = [
  'newtask-',
  'mention-',
  'token-gate',
  'overlay-',
  'escape-',
  'composer-wire-reject',
  'dead-',
  'dialog-',
  'project-settings-delete',
  'hotkeys',
  // #1446: the queued 停止 row lives in overlay/more-menu.tsx.
  'detail-queued-exit',
];
const OVERLAYS = ['chip-', 'hotkeys', 'search-', 'plan-diff-full-file', 'phase-chip-words'];
const PAGES = [
  'project-',
  'file-viewer',
  'github-issue-writeback',
  'segmented-',
  'dialog-',
  // #1037: the schedules page family (schedules-live.spec pins the form's
  // live face; src/pages/schedules-page.tsx edits must pull it in).
  'schedules-',
  'phase-chip-words',
];
const RESOURCES = [
  'machine-',
  'machines-',
  'provider-',
  'providers-',
  'secret-',
  'skills-',
  'title-',
  'segmented-',
  'dialog-',
];
const SECONDARY = ['title-', 'shell-', 'segmented-'];

// Exact-file rules win over directory prefixes (longest prefix wins among
// directories). Add a file rule when one file inside a directory feeds a
// different family than its siblings (the board/ sidebar pair, the
// routes/ page files).
const FILE_RULES = new Map([
  // src/board — the sidebar pair carries the shell-side family, not the board column family.
  ['apps/web/src/board/sidebar.tsx', SIDEBAR],
  ['apps/web/src/board/app-sidebar.tsx', SIDEBAR],
  // src/routes — one file per page family.
  ['apps/web/src/routes/board-page.tsx', BOARD],
  ['apps/web/src/routes/todo-detail-page.tsx', DETAIL],
  ['apps/web/src/routes/account-page.tsx', ['account-team-cleanse', 'user-menu-']],
  ['apps/web/src/routes/agent-detail-page.tsx', AGENT],
  ['apps/web/src/routes/agent-model-select.tsx', AGENT],
  ['apps/web/src/routes/api-key-create-dialog.tsx', ['user-menu-']],
  ['apps/web/src/routes/api-keys-page.tsx', ['user-menu-']],
  ['apps/web/src/routes/create-agent-dialog.tsx', AGENT],
  ['apps/web/src/routes/machine-authorize-page.tsx', ['machine-']],
  ['apps/web/src/routes/team-chart.tsx', ['team-', 'account-team-cleanse']],
  ['apps/web/src/routes/team-page.tsx', ['team-', 'account-team-cleanse']],
  // src/components — shared faces with their own consumers.
  [
    'apps/web/src/components/model-select-core.tsx',
    [...AGENT, 'chief-drawer-model', 'chief-settings'],
  ],
  [
    'apps/web/src/components/profile-card.tsx',
    ['avatar-', 'user-menu-', 'paper-', 'account-', ...AGENT],
  ],
  // Paper page patterns: every page that composes them, plus their own pins.
  [
    'apps/web/src/components/settings-list.tsx',
    ['paper-', 'account-', 'cds-settings', 'user-menu-', ...AGENT, ...PAGES],
  ],
  [
    'apps/web/src/components/empty-state.tsx',
    ['paper-', 'dead-buttons', 'title-band-clicks', 'user-menu-', ...RESOURCES, ...PAGES],
  ],
  ['apps/web/src/components/form-layout.tsx', ['paper-', 'account-', ...AGENT, ...PAGES]],
  ['apps/web/src/components/brand-marks.tsx', ['machines-', 'title-', 'brand-']],
  ['apps/web/e2e/live-server.ts', LIVE_SERVER],
  ['apps/web/e2e/live-server-tether.mjs', LIVE_SERVER],
  ['apps/web/e2e/live-server-spawner.ts', LIVE_SERVER],
]);

const DIR_RULES = [
  { prefix: 'apps/web/src/board/', specs: BOARD },
  { prefix: 'apps/web/src/chief/', specs: CHIEF },
  { prefix: 'apps/web/src/detail/', specs: DETAIL },
  { prefix: 'apps/web/src/overlay/', specs: OVERLAY },
  { prefix: 'apps/web/src/overlays/', specs: OVERLAYS },
  { prefix: 'apps/web/src/pages/', specs: PAGES },
  { prefix: 'apps/web/src/resources/', specs: RESOURCES },
  { prefix: 'apps/web/src/secondary/', specs: SECONDARY },
  { prefix: 'apps/web/src/pwa/', specs: ['notify-'] },
];

// Cross-cutting paths: consumed (or rendered) everywhere, so the honest
// affected surface is the full suite. Unmapped apps/web paths join this
// set (never silently skipped).
const FULL_PATH_PREFIXES = [
  'apps/web/src/ui/',
  'apps/web/src/styles/',
  'apps/web/src/i18n/',
  'apps/web/src/api/',
  'apps/web/src/fixtures/',
  'apps/web/src/icons/',
  'apps/web/src/App.tsx',
  'apps/web/src/main.tsx',
  'apps/web/src/theme.ts',
  'apps/web/src/phase.ts',
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  'apps/web/playwright.config.ts',
  'apps/web/package.json',
  'apps/web/tsconfig',
  'apps/web/e2e/evidence.ts',
  'apps/web/e2e/png.ts',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
];

// --- changed-path collection -------------------------------------------------

function git(args) {
  const res = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return res.status === 0 ? res.stdout : '';
}

function changedPaths(explicit) {
  if (explicit.length > 0) return { paths: explicit, source: 'explicit' };
  const paths = new Set();
  // Uncommitted (staged + unstaged + untracked), root-relative: run git
  // from the repo root so porcelain output needs no renormalizing.
  for (const line of git(['status', '--porcelain=v1']).split('\n')) {
    if (line === '') continue;
    const entry = line.slice(3).trim();
    // Renames arrive as "old -> new": both sides can carry effects.
    for (const side of entry.split(' -> ')) paths.add(side.trim());
  }
  // Committed on this branch since it left origin/main.
  const base = git(['merge-base', 'HEAD', 'origin/main']).trim();
  if (base !== '') {
    for (const p of git(['diff', '--name-only', `${base}..HEAD`]).split('\n')) {
      if (p !== '') paths.add(p);
    }
  }
  return { paths: [...paths], source: 'git (working tree + branch vs origin/main)' };
}

// --- selection ----------------------------------------------------------------

function classify(path) {
  if (path.startsWith('apps/web/e2e/') && path.endsWith('.spec.ts')) {
    return { specs: [path.slice('apps/web/e2e/'.length)], why: 'the spec itself' };
  }
  const fileRule = FILE_RULES.get(path);
  if (fileRule != null) return { specs: fileRule, why: 'file map' };
  const dirHits = DIR_RULES.filter((r) => path.startsWith(r.prefix));
  if (dirHits.length > 0) {
    const longest = dirHits.reduce((a, b) => (b.prefix.length > a.prefix.length ? b : a));
    return { specs: longest.specs, why: `area ${longest.prefix}` };
  }
  if (FULL_PATH_PREFIXES.some((p) => path === p || path.startsWith(p))) {
    return { specs: null, why: 'shared surface' };
  }
  if (path.startsWith('apps/web/')) return { specs: null, why: 'unmapped web path' };
  if (path.startsWith('apps/server/')) {
    return {
      specs: LIVE_SERVER,
      why: 'server surface (these specs spawn a real server; the stack layer is the real coverage)',
    };
  }
  return { specs: [], why: 'outside the web e2e surface' };
}

function listSpecs() {
  return readdirSync(E2E_DIR).filter((f) => f.endsWith('.spec.ts'));
}

function expand(prefixes, allSpecs) {
  const matched = new Set();
  for (const prefix of prefixes) {
    const hits = allSpecs.filter((f) => f.startsWith(prefix));
    if (hits.length === 0) {
      console.warn(
        `[e2e:affected] WARNING: spec prefix "${prefix}" matches nothing — the area map has rotted, fix scripts/e2e-affected.mjs`,
      );
    }
    for (const h of hits) matched.add(h);
  }
  return [...matched].sort();
}

// --- run ------------------------------------------------------------------------

function runPlaywright(specs, full) {
  // Quick lane pins 2 workers (E2E_AFFECTED_WORKERS overrides): at domain
  // scale throughput is irrelevant, and on a memory-pressured machine two
  // concurrent chromiums (vs the default 4 on an 8-core) halve the peak.
  // The full-suite fallback keeps playwright's default — its throughput
  // is the point.
  const args = ['exec', 'playwright', 'test', ...specs];
  if (!full) args.push('--workers', process.env.E2E_AFFECTED_WORKERS ?? '2');
  const res = spawnSync('pnpm', args, {
    cwd: WEB_DIR,
    stdio: 'inherit',
    env: { ...process.env, E2E_PORT: PORT },
  });
  process.exit(res.status ?? 1);
}

// --- main -----------------------------------------------------------------------

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const explicit = argv.filter((a) => !a.startsWith('--'));

const { paths, source } = changedPaths(explicit);
if (paths.length === 0) {
  console.log('[e2e:affected] no changed paths — nothing to run.');
  process.exit(0);
}

const allSpecs = listSpecs();
let full = false;
const picked = new Set();
const reasons = [];
for (const path of paths) {
  const { specs, why } = classify(path);
  // #1442: the axe sweep scans every main page in both themes, so any web
  // source change runs it — one rule here, not a copy in every family.
  const axe = specs !== null && path.startsWith('apps/web/src/');
  reasons.push(
    `  ${path} → ${specs === null ? 'FULL' : specs.length === 0 && !axe ? 'none' : why}${axe ? ' + a11y-axe' : ''}`,
  );
  if (specs === null) full = true;
  for (const s of specs ?? []) picked.add(s);
  if (axe) picked.add('a11y-axe');
}

const selection = full ? allSpecs : expand([...picked], allSpecs);
if (selection.length === 0) {
  console.log(`[e2e:affected] changed paths (${source}):`);
  console.log(reasons.join('\n'));
  console.log(
    '[e2e:affected] no web e2e surface touched — the stack layer (vitest integration) is the coverage for this change.',
  );
  process.exit(0);
}

console.log(`[e2e:affected] changed paths (${source}):`);
console.log(reasons.join('\n'));
console.log(
  `[e2e:affected] ${full ? `${selection.length}/${allSpecs.length} specs (full-suite fallback for shared surfaces)` : `${selection.length}/${allSpecs.length} specs`} on the standard fixture-build config, E2E_PORT=${PORT}`,
);
console.log(`  ${selection.join(' ')}`);

if (dryRun) process.exit(0);
runPlaywright(selection, full);
