#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import {
  acquireSlot,
  leaseEnv,
  slotPortReport,
  writeSlotPlaywrightConfig,
} from './heavy-slots.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_DIR = join(REPO_ROOT, 'apps/web');
const E2E_DIR = join(WEB_DIR, 'e2e');
const E2E_PREFIX = 'apps/web/e2e/';
const PORT = process.env.E2E_PORT ?? process.env.E2E_AFFECTED_PORT ?? '8398';

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
  'queued-action',
  'elevation-',
  'cds-board',
  'paper-board-',
  'paper-card',
  'quota-wait-board',
  'ticket-cost',
  'accent-typo',
  'attachment-title',
  'branch-button',
  'empty-review-closeout',
  'info-card-report',
  'live-project-name',
  'shadcn-primitives',
  'storage-unavailable',
  'mobile-narrow',
  'focus-ring-clip',
  'chief-home-',
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
  'mobile-narrow',
];
const DETAIL = [
  'composer-tool-tips',
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
  'chief-home-',
  'chief-stream-markdown',
  'composer-wire-reject',
  'user-menu-',
  'phase-chip-words',
  'queued-action',
  'elevation-',
  'ticket-cost',
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
  'mobile-narrow',
];
const CHIEF = [
  'composer-tool-tips',
  'chief-',
  'composer-wire-reject',
  'elevation-',
  'attachment-strip',
  'page-scroll',
  'shadcn-primitives',
  'storage-unavailable',
  'z-ladder',
  'hotkeys-ready',
  'mobile-narrow',
];
const AGENT = [
  'agent-',
  'team-create-agent',
  'registry-focus-ring',
  'resource-back-spa',
  'chief-home-digest',
];
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
  'mobile-narrow',
];
const PAGES = [
  'project-',
  'file-viewer',
  'github-issue-writeback',
  'segmented-',
  'dialog-',
  'schedules-',
  'phase-chip-words',
  'accent-typo',
  'page-scroll',
  'registry-focus-ring',
  'resource-back-spa',
  'mobile-narrow',
];
const RESOURCES = [
  'machine-',
  'machines-',
  'agent-settings-row-label',
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

const FILE_RULES = new Map([
  ['apps/web/src/overlay/chip-popover.tsx', OVERLAYS],
  ['apps/web/src/overlay/gesture-machine.ts', [...OVERLAYS, 'chief-toggle-flash']],
  ['apps/web/src/overlay/hotkeys.ts', OVERLAYS],
  ['apps/web/src/overlay/plan-dropdown.tsx', OVERLAYS],
  ['apps/web/src/overlay/search-panel.tsx', OVERLAYS],
  ['apps/web/src/board/sidebar.tsx', SIDEBAR],
  ['apps/web/src/board/app-sidebar.tsx', SIDEBAR],
  ['apps/web/src/routes/board-page.tsx', BOARD],
  ['apps/web/src/routes/todo-detail-page.tsx', DETAIL],
  ['apps/web/src/routes/account-page.tsx', ['account-team-cleanse', 'user-menu-', 'cds-density']],
  ['apps/web/src/routes/agent-detail-page.tsx', AGENT],
  ['apps/web/src/routes/agent-model-select.tsx', AGENT],
  ['apps/web/src/routes/agent-fallback-models.tsx', AGENT],
  ['apps/web/src/routes/api-key-create-dialog.tsx', ['user-menu-', 'focus-ring-clip']],
  ['apps/web/src/routes/api-keys-page.tsx', ['user-menu-']],
  ['apps/web/src/routes/create-agent-dialog.tsx', AGENT],
  ['apps/web/src/routes/machine-authorize-page.tsx', ['machine-']],
  ['apps/web/src/routes/team-chart.tsx', ['team-', 'account-team-cleanse']],
  ['apps/web/src/routes/team-page.tsx', ['team-', 'account-team-cleanse']],
  [
    'apps/web/src/components/model-select-core.tsx',
    [...AGENT, 'chief-drawer-model', 'chief-settings'],
  ],
  [
    'apps/web/src/components/profile-card.tsx',
    ['avatar-', 'user-menu-', 'paper-', 'account-', ...AGENT],
  ],
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
  ['apps/web/vitest.config.ts', []],
  ['apps/web/e2e/chief-home-mock.ts', ['chief-home-']],
  ['apps/web/e2e/live-server.ts', LIVE_SERVER],
  ['apps/web/e2e/live-server-tether.mjs', LIVE_SERVER],
  ['apps/web/e2e/live-server-spawner.ts', LIVE_SERVER],
]);

const DIR_RULES = [
  { prefix: 'apps/web/src/board/', specs: BOARD },
  { prefix: 'apps/web/src/chief/', specs: CHIEF },
  { prefix: 'apps/web/src/detail/', specs: DETAIL },
  { prefix: 'apps/web/src/overlay/', specs: OVERLAY },
  { prefix: 'apps/web/src/pages/', specs: PAGES },
  { prefix: 'apps/web/src/resources/', specs: RESOURCES },
  { prefix: 'apps/web/src/secondary/', specs: SECONDARY },
  { prefix: 'apps/web/src/pwa/', specs: ['notify-'] },
  { prefix: 'apps/web/test/', specs: [] },
];

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

function git(args) {
  const res = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return res.status === 0 ? res.stdout : '';
}

function changedPaths(explicit) {
  if (explicit.length > 0) return { paths: explicit, source: 'explicit' };
  const paths = new Set();
  for (const line of git(['status', '--porcelain=v1']).split('\n')) {
    if (line === '') continue;
    const entry = line.slice(3).trim();
    for (const side of entry.split(' -> ')) paths.add(side.trim());
  }
  const base = git(['merge-base', 'HEAD', 'origin/main']).trim();
  if (base !== '') {
    for (const p of git(['diff', '--name-only', `${base}..HEAD`]).split('\n')) {
      if (p !== '') paths.add(p);
    }
  }
  return { paths: [...paths], source: 'git (working tree + branch vs origin/main)' };
}

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

function runPlaywright(specs, full) {
  const args = ['exec', 'playwright', 'test'];
  const env = { ...leaseEnv(lease), E2E_PORT: PORT };
  if (lease !== null) {
    const conflict = slotPortReport({ slot: lease.slot });
    if (conflict !== null) {
      console.error(conflict);
      process.exit(1);
    }
    const slotRun = writeSlotPlaywrightConfig({
      slot: lease.slot,
      env: process.env,
      webDir: WEB_DIR,
    });
    args.push('--config', slotRun.path);
    env.E2E_PORT = String(slotRun.port);
    env.E2E_DIST_DIR = slotRun.distDir;
    console.log(
      `[e2e:affected] slot ${lease.slot}: E2E_PORT=${slotRun.port}, build output ${slotRun.distDir}`,
    );
  }
  args.push(...specs);
  if (!full) args.push('--workers', process.env.E2E_AFFECTED_WORKERS ?? '2');
  const res = spawnSync('pnpm', args, {
    cwd: WEB_DIR,
    stdio: 'inherit',
    env,
  });
  process.exit(res.status ?? 1);
}

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
const lease = await acquireSlot();
runPlaywright(selection, full);
