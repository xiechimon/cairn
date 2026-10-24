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
//   pnpm --filter @cairn/web e2e:affected            # diff vs origin/main + working tree
//   pnpm --filter @cairn/web e2e:affected -- apps/web/src/chief/chief-drawer.tsx
//   node scripts/e2e-affected.mjs --dry-run -- <paths>  # print the plan only
//
// Port: the default playwright webServer binds E2E_PORT (8399) with
// reuseExistingServer — on a multi-lane machine that would silently test
// whichever lane's build answered first (#137). Affected runs default to
// their own lane port 8398: E2E_AFFECTED_PORT overrides it, an explicitly
// set E2E_PORT wins (a lane that picked a port did so deliberately).

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_DIR = join(REPO_ROOT, 'apps/web');
const E2E_DIR = join(WEB_DIR, 'e2e');
const E2E_PREFIX = 'apps/web/e2e/';
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
  'cds-board',
  'paper-board-',
  'paper-card',
  'quota-wait-board',
  'accent-typo',
  'attachment-title',
  'branch-button',
  'empty-review-closeout',
  'info-card-report',
  'live-project-name',
  'shadcn-primitives',
  'storage-unavailable',
];
const SIDEBAR = [
  'sidebar-',
  'collapse-',
  'visual-',
  'theme-',
  'user-menu-',
  'avatar-',
  'shell-',
  'accent-typo',
  'attachment-strip',
  'attachment-title',
  'cds-sidebar',
  'composer-paste',
  'live-project-name',
  'registry-focus-ring',
  'shadcn-primitives',
  'storage-unavailable',
];
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
  'accent-typo',
  'attachment-strip',
  'branch-button',
  'cds-composer',
  'cds-dialogs',
  'cds-transcript',
  'checkbox-unified',
  'composer-inline-mention',
  'composer-paste',
  'composer-slash',
  'diff-word-highlight',
  'empty-review-closeout',
  'info-card-report',
  'live-agent-model-line',
  'live-project-name',
  'persona-verify',
  'registry-focus-ring',
  'review-reject',
  'skill-inject',
  'spec-flow',
  'thinking-row-truncate',
  'hotkeys-ready',
];
// #1428: one ring per edge — the chief window and the FAB are probed there.
const CHIEF = [
  'chief-',
  'composer-wire-reject',
  'elevation-',
  'attachment-strip',
  'page-scroll',
  'shadcn-primitives',
  'storage-unavailable',
  'z-ladder',
  'hotkeys-ready',
];
const AGENT = ['agent-', 'team-create-agent', 'registry-focus-ring', 'resource-back-spa'];
const LIVE_SERVER = ['token-gate', 'live-server-', 'agent-fallback-models'];
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
  'accent-typo',
  'attachment-strip',
  'attachment-title',
  'composer-inline-mention',
  'composer-paste',
  'composer-slash',
  'live-project-name',
  'review-reject',
  'storage-unavailable',
  'z-ladder',
];
const OVERLAYS = [
  'chip-',
  'hotkeys',
  'search-',
  'plan-diff-full-file',
  'phase-chip-words',
  'cds-dialogs',
  'diff-word-highlight',
  'live-agent-model-line',
  'live-project-name',
  'shadcn-primitives',
];
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
  'accent-typo',
  'page-scroll',
  'registry-focus-ring',
  'resource-back-spa',
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
  'checkbox-unified',
  'registry-focus-ring',
  'resource-back-spa',
  'skill-import',
];
const SHARED_SURFACE_ONLY = ['cds-motion', 'color-freeze', 'fixture-mode-chip'];
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
  ['apps/web/src/routes/account-page.tsx', ['account-team-cleanse', 'user-menu-', 'cds-density']],
  ['apps/web/src/routes/agent-detail-page.tsx', AGENT],
  ['apps/web/src/routes/agent-model-select.tsx', AGENT],
  ['apps/web/src/routes/agent-fallback-models.tsx', AGENT],
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
  // #1455: vitest-only config (includes test/**/*.test.ts); not in the e2e build.
  ['apps/web/vitest.config.ts', []],
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
  // #1455: the web unit-test layer. vitest-only, never in the fixture build
  // playwright serves, and nothing under e2e/ imports from it: no spec is
  // affected. `pnpm exec vitest run --changed origin/main` covers it.
  { prefix: 'apps/web/test/', specs: [] },
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
  if (path.startsWith(E2E_PREFIX) && path.endsWith('.spec.ts')) {
    return { specs: [path.slice(E2E_PREFIX.length)], why: 'the spec itself' };
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
  if (path.startsWith(E2E_PREFIX)) {
    const { specs, why } = importingSpecs(path);
    return { specs: specs.length > 0 ? specs : null, why };
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

// #1463: a non-spec module under e2e/ (helpers.ts and the like) affects the
// specs that import it, directly or through other e2e modules (spec →
// helpers.ts → the file). The scan only narrows, and only where every mention
// of the file is a static relative import between top-level e2e modules.
// Anything else runs the full suite (specs: []): a file that is not a
// top-level module, a mention that is not an import (a spawn path, a read, a
// template literal), a chain that reaches a full-fallback file or a
// subdirectory, a name playwright.config.ts mentions, or no spec found.
let e2eSources = null;
function importingSpecs(path) {
  e2eSources ??= {
    texts: new Map(
      readdirSync(E2E_DIR, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(?:[cm]?js|tsx?)$/.test(entry.name))
        .map((entry) => {
          const file = join(entry.parentPath, entry.name);
          return [relative(E2E_DIR, file), readFileSync(file, 'utf8')];
        }),
    ),
    // What runs or configures the suite from outside e2e/.
    config: ['playwright.config.ts', 'package.json']
      .map((file) => readFileSync(join(WEB_DIR, file), 'utf8'))
      .join('\n'),
  };
  const { texts, config } = e2eSources;
  const count = (text, re) => text.match(re)?.length ?? 0;
  const specs = new Set();
  const seen = new Set([path.slice(E2E_PREFIX.length)]);
  const queue = [...seen];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!/^[^/]+\.(?:ts|mjs|js)$/.test(file))
      return { specs: [], why: `${file} is not a top-level e2e module` };
    if (FULL_PATH_PREFIXES.some((prefix) => (E2E_PREFIX + file).startsWith(prefix)))
      return { specs: [], why: `reaches ${file}` };
    for (const mapped of FILE_RULES.get(E2E_PREFIX + file) ?? []) specs.add(mapped);
    const stem = file.replace(/\.[^.]+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mention = new RegExp(`["'\`/}]${stem}(\\.[A-Za-z0-9]+)?([?#][^"'\`]*)?["'\`]`, 'gi');
    const imported = new RegExp(
      `(?:from|import)\\s*\\(?\\s*["']\\./${stem}(\\.(?:js|ts|mjs))?["']`,
      'gi',
    );
    if (count(config, mention) > 0)
      return { specs: [], why: `the playwright config or package.json names ${file}` };
    for (const [other, text] of texts) {
      if (other === file) continue;
      const mentions = count(text, mention);
      if (mentions === 0) continue;
      if (count(text, imported) < mentions)
        return { specs: [], why: `${other} names ${file} outside an import` };
      if (seen.has(other)) continue;
      seen.add(other);
      if (other.endsWith('.spec.ts')) specs.add(other);
      queue.push(other);
    }
  }
  const n = specs.size;
  return n > 0
    ? { specs: [...specs].sort(), why: `imported by ${n} spec${n === 1 ? '' : 's'}` }
    : { specs: [], why: 'no spec imports it' };
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

if (argv.includes('--check-coverage')) {
  const prefixes = [...FILE_RULES.values(), ...DIR_RULES.map((rule) => rule.specs)].flat();
  prefixes.push('a11y-axe', ...SHARED_SURFACE_ONLY);
  const specNames = (explicit.length > 0 ? explicit : listSpecs()).map((path) => basename(path));
  const notSpecs = specNames.filter((name) => !name.endsWith('.spec.ts'));
  const missing = specNames.filter(
    (name) => name.endsWith('.spec.ts') && !prefixes.some((prefix) => name.startsWith(prefix)),
  );
  for (const name of notSpecs)
    console.log(`[e2e:affected] ${name}: not an e2e spec file (expected *.spec.ts)`);
  for (const name of missing)
    console.log(`[e2e:affected] ${E2E_PREFIX}${name}: no family table entry reaches this spec`);
  console.log(`[e2e:affected] coverage: ${missing.length} uncovered spec(s)`);
  process.exit(missing.length + notSpecs.length > 0 ? 1 : 0);
}

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
    `  ${path} → ${specs === null ? `FULL (${why})` : specs.length === 0 && !axe ? 'none' : why}${axe ? ' + a11y-axe' : ''}`,
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
    '[e2e:affected] no web e2e surface touched — vitest (`pnpm exec vitest run --changed origin/main`) and CI cover this change.',
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
