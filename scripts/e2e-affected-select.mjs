import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_DIR = join(REPO_ROOT, 'apps/web');
const E2E_DIR = join(WEB_DIR, 'e2e');
export const E2E_PREFIX = 'apps/web/e2e/';
export const DEPENDENCY_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml'];
const SNAPSHOT_DIR = /^apps\/web\/e2e\/([^/]+\.spec\.ts)-snapshots\//;

const BOARD = [
  'menu-keys',
  'board-',
  'chip-',
  'notify-',
  'home-composer',
  'footer-',
  'dead-',
  'shell-',
  'visual-',
  'queued-action',
  'elevation-',
  'paper-board-',
  'quota-wait-board',
  'ticket-cost',
  'accent-typo',
  'empty-review-closeout',
  'info-card-report',
  'live-project-name',
  'shadcn-primitives',
  'storage-unavailable',
  'mobile-narrow',
  'focus-ring-clip',
  'chief-home-',
  'chief-project-pick',
  'first-run-',
  'task-panel',
  'thread-route-override',
  'route-override-capabilities',
];
const SIDEBAR = [
  'activity-page',
  'search-syntax-palette',
  'menu-keys',
  'settings-',
  'sidebar-',
  'collapse-',
  'visual-',
  'theme-',
  'user-menu-',
  'avatar-',
  'shell-',
  'accent-typo',
  'attachment-strip',
  'cds-sidebar',
  'composer-paste',
  'live-project-name',
  'registry-focus-ring',
  'shadcn-primitives',
  'storage-unavailable',
  'mobile-narrow',
  'thread-snooze',
];
const DETAIL = [
  'menu-keys',
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
  'coordinator-entry',
  'chief-home-',
  'chief-project-pick',
  'chief-stream-markdown',
  'composer-wire-reject',
  'user-menu-',
  'phase-chip-words',
  'queued-action',
  'elevation-',
  'ticket-cost',
  'accent-typo',
  'attachment-strip',
  'avatar-spiral',
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
  'review-dialog-list',
  'registry-focus-ring',
  'review-reject',
  'spec-flow',
  'thinking-row-truncate',
  'hotkeys-ready',
  'mobile-narrow',
  'task-panel',
  'thread-route-override',
  'route-override-capabilities',
];
const CHIEF = [
  'composer-tool-tips',
  'chief-',
  'home-composer',
  'composer-wire-reject',
  'elevation-',
  'attachment-strip',
  'page-scroll',
  'shadcn-primitives',
  'storage-unavailable',
  'hotkeys-ready',
  'mobile-narrow',
  'task-panel',
];
const AGENT = [
  'menu-keys',
  'agent-',
  'team-create-agent',
  'registry-focus-ring',
  'task-panel',
  'chief-home-digest',
];
export const LIVE_SERVER = [
  'account-release-removal',
  'token-gate',
  'live-server-',
  'agent-fallback-models',
];
const OVERLAY = [
  'menu-keys',
  'home-composer',
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
  'composer-inline-mention',
  'composer-paste',
  'composer-slash',
  'live-project-name',
  'review-reject',
  'storage-unavailable',
  'thread-route-override',
  'route-override-capabilities',
];
const OVERLAYS = [
  'activity-page',
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
  'menu-keys',
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
  'mobile-narrow',
  'task-panel',
];
const RESOURCES = [
  'menu-keys',
  'settings-',
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
  'skill-import',
  'task-panel',
  'first-pr-report',
];
export const SHARED_SURFACE_ONLY = [
  'cds-motion',
  'motion-quiet',
  'button-press',
  'button-press-contrast',
  'color-freeze',
  'fixture-mode-chip',
  'orientation-variants',
];
const SECONDARY = ['title-', 'shell-', 'segmented-'];

export const FILE_RULES = new Map([
  ['apps/web/src/components/thread/pr-card.tsx', ['pr-card', 'thread-pr-panel']],
  ['apps/web/src/components/thread/pr-card-model.ts', ['pr-card', 'thread-pr-panel']],
  ['apps/web/src/components/thread/pr-link.tsx', ['thread-pr-panel']],
  ['apps/web/src/components/thread/pr-list.tsx', ['thread-pr-panel']],
  ['apps/web/src/components/thread/pr-panel-model.ts', ['thread-pr-panel']],
  ['apps/web/src/board/thread-pr-panel.tsx', ['thread-pr-panel']],
  ['apps/web/src/design/components-overlays.tsx', ['menu-keys', 'shadcn-primitives']],
  [
    'apps/web/src/components/menu-keys.tsx',
    ['menu-keys', 'detail-archive', 'thread-snooze', 'dead-buttons', 'hotkeys', 'sidebar-'],
  ],
  ['apps/web/src/components/key-hint.tsx', ['menu-keys', 'hotkeys', 'sidebar-', 'board-shell']],
  [
    'apps/web/src/components/shell/sidebar-nav-row.tsx',
    ['menu-keys', 'sidebar-', 'cds-sidebar', 'paper-sidebar'],
  ],
  ['apps/web/src/overlay/status-menu.tsx', [...OVERLAYS, ...DETAIL]],
  ['apps/web/src/overlay/gesture-machine.ts', OVERLAYS],
  ['apps/web/src/overlay/hotkeys.ts', OVERLAYS],
  ['apps/web/src/overlay/plan-dropdown.tsx', OVERLAYS],
  ['apps/web/src/overlay/search-panel.tsx', OVERLAYS],
  ['apps/web/src/board/sidebar.tsx', SIDEBAR],
  ['apps/web/src/routes/activity-page.tsx', ['activity-page', 'search-syntax-palette']],
  ['apps/web/src/board/app-sidebar.tsx', SIDEBAR],
  ['apps/web/src/routes/board-page.tsx', BOARD],
  ['apps/web/src/routes/todo-detail-page.tsx', DETAIL],
  [
    'apps/web/src/routes/account-page.tsx',
    ['account-', 'team-attribution-', 'user-menu-', 'cds-density', 'push-device-switch'],
  ],
  ['apps/web/src/routes/agent-model-select.tsx', AGENT],
  ['apps/web/src/routes/api-key-create-dialog.tsx', ['user-menu-', 'focus-ring-clip', 'api-key-']],
  ['apps/web/src/routes/api-keys-page.tsx', ['user-menu-', 'api-key-']],
  ['apps/web/src/routes/machine-authorize-page.tsx', ['machine-']],
  ['apps/web/src/components/model-select-core.tsx', [...AGENT, 'chief-settings']],
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
  [
    'apps/web/src/components/queued-capsules.tsx',
    ['detail-composer-queue-stop', 'chief-home-busy'],
  ],
  ['apps/web/vitest.config.ts', []],
  ['apps/web/DESIGN.md', ['texture-', 'a11y-axe', 'gallery-snapshots']],
  ['apps/web/COMPONENTS.md', []],
  ['apps/web/e2e/chief-home-mock.ts', ['chief-home-']],
  ['apps/web/e2e/demo-server.ts', ['demo-mode']],
  ['apps/web/e2e/live-server.ts', LIVE_SERVER],
  ['apps/web/e2e/live-server-tether.mjs', LIVE_SERVER],
  ['apps/web/e2e/live-server-spawner.ts', LIVE_SERVER],
]);

export const DIR_RULES = [
  { prefix: 'apps/web/src/search/', specs: ['activity-page', 'search-'] },
  { prefix: 'apps/web/src/board/', specs: BOARD },
  {
    prefix: 'apps/web/src/task-panel/',
    specs: [...BOARD, ...CHIEF, ...PAGES, ...RESOURCES, ...AGENT],
  },
  { prefix: 'apps/web/src/chief/', specs: CHIEF },
  { prefix: 'apps/web/src/detail/', specs: DETAIL },
  { prefix: 'apps/web/src/overlay/', specs: OVERLAY },
  { prefix: 'apps/web/src/pages/', specs: PAGES },
  { prefix: 'apps/web/src/resources/', specs: RESOURCES },
  { prefix: 'apps/web/src/settings/', specs: [...RESOURCES, ...SIDEBAR] },
  { prefix: 'apps/web/src/secondary/', specs: SECONDARY },
  { prefix: 'apps/web/src/pwa/', specs: ['notify-', 'push-device-switch'] },
  { prefix: 'apps/web/src/components/texture/', specs: ['texture-'] },
  { prefix: 'apps/web/src/design/', specs: ['texture-'] },
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
  'scripts/e2e-affected.mjs',
  'scripts/e2e-affected-select.mjs',
  'scripts/heavy-slots.mjs',
  'scripts/test-admission.mjs',
  'scripts/owned-process.mjs',
  'scripts/timed-partition.mjs',
];

function classify(path, dependencies, workspace) {
  if (path.startsWith(E2E_PREFIX) && path.endsWith('.spec.ts')) {
    return { specs: [path.slice(E2E_PREFIX.length)], why: 'the spec itself' };
  }
  if (DEPENDENCY_FILES.includes(path)) return dependencies();
  const snapshotOwner = path.match(SNAPSHOT_DIR)?.[1];
  if (snapshotOwner != null) return { specs: [snapshotOwner], why: 'a baseline of that spec' };
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
  return workspace()(path) ?? { specs: [], why: 'outside the web e2e surface' };
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

export function listSpecs() {
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

export function selectSpecs({ paths, allSpecs, dependencies, workspace }) {
  let impact = null;
  const dependencyImpact = () => {
    impact ??= dependencies();
    return impact;
  };
  let reach = null;
  const workspaceReach = () => {
    reach ??= workspace();
    return reach;
  };
  let full = false;
  const picked = new Set();
  const reasons = [];
  for (const path of paths) {
    const { specs, why } = classify(path, dependencyImpact, workspaceReach);
    const axe = specs !== null && path.startsWith('apps/web/src/');
    reasons.push(
      `  ${path} → ${specs === null ? `FULL (${why})` : specs.length === 0 && !axe ? `none (${why})` : why}${axe ? ' + a11y-axe + gallery-snapshots' : ''}`,
    );
    if (specs === null) full = true;
    for (const s of specs ?? []) picked.add(s);
    if (axe) {
      picked.add('a11y-axe');
      picked.add('gallery-snapshots');
    }
  }
  return { full, selection: full ? [...allSpecs].sort() : expand([...picked], allSpecs), reasons };
}

const WEB_IMPORTERS = ['.', 'apps/web'];
const SERVER_IMPORTERS = ['apps/server'];
const IMPORTER_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const SNAPSHOT_SECTIONS = ['dependencies', 'optionalDependencies'];
const CLOSURE_KEYS = new Set(['lockfileVersion', 'catalogs', 'importers', 'packages', 'snapshots']);
const LOCKFILE_RESOLVED_SETTINGS = new Set([
  'packages',
  'catalog',
  'catalogs',
  'overrides',
  'packageExtensions',
  'patchedDependencies',
  'peerDependencyRules',
  'allowedDeprecatedVersions',
  'minimumReleaseAge',
  'minimumReleaseAgeExclude',
]);
const BUILD_SETTINGS = new Set([
  'allowBuilds',
  'onlyBuiltDependencies',
  'ignoredBuiltDependencies',
  'neverBuiltDependencies',
]);

function unquote(scalar) {
  if (scalar.startsWith("'")) return scalar.slice(1, -1).replaceAll("''", "'");
  if (scalar.startsWith('"')) return JSON.parse(scalar);
  return scalar;
}

export function parseYamlDocuments(text) {
  const documents = [{}];
  let stack = [{ indent: -1, node: documents[0] }];
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trimEnd();
    if (line === '---') {
      documents.push({});
      stack = [{ indent: -1, node: documents.at(-1) }];
      continue;
    }
    const body = line.trimStart();
    if (body === '' || body.startsWith('#')) continue;
    const indent = line.length - body.length;
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).node;
    if (body.startsWith('- ')) {
      parent[`- ${unquote(body.slice(2).trim())}`] = true;
      continue;
    }
    const match = body.match(/^('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^'"\s:][^:]*?):(?:\s+(.*))?$/);
    if (match == null || /^[|>]/.test(match[2] ?? '')) {
      throw new Error(`line ${index + 1} is not a plain mapping entry`);
    }
    const key = unquote(match[1]);
    if (match[2] === undefined) {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = unquote(match[2]);
    }
  }
  return documents.filter((document) => Object.keys(document).length > 0);
}

function lockfileDocument(text) {
  const document = parseYamlDocuments(text).find((doc) => doc.importers?.['apps/web'] != null);
  if (document == null) throw new Error('pnpm-lock.yaml has no apps/web importer');
  return document;
}

function packageName(snapshotKey) {
  return snapshotKey.slice(0, snapshotKey.indexOf('@', 1));
}

function closure(lock, roots) {
  const importers = new Map();
  const snapshots = new Map();
  const visitSnapshot = (name, version) => {
    const key = [`${name}@${version}`, version].find((k) => lock.snapshots?.[k] !== undefined);
    if (key === undefined) throw new Error(`pnpm-lock.yaml has no snapshot for ${name}@${version}`);
    if (snapshots.has(key)) return;
    const snapshot = lock.snapshots[key];
    snapshots.set(key, [snapshot, lock.packages?.[key.replace(/\(.*$/, '')]]);
    for (const section of SNAPSHOT_SECTIONS) {
      for (const [dep, depVersion] of Object.entries(snapshot[section] ?? {})) {
        visitSnapshot(dep, depVersion);
      }
    }
  };
  const visitImporter = (path) => {
    if (importers.has(path)) return;
    const importer = lock.importers[path];
    if (importer == null) throw new Error(`pnpm-lock.yaml has no importer ${path}`);
    importers.set(path, importer);
    for (const section of IMPORTER_SECTIONS) {
      for (const [name, entry] of Object.entries(importer[section] ?? {})) {
        if (typeof entry?.version !== 'string')
          throw new Error(`${path} lists ${name} without a version`);
        if (entry.version.startsWith('link:'))
          visitImporter(posix.join(path, entry.version.slice(5)));
        else visitSnapshot(name, entry.version);
      }
    }
  };
  for (const root of roots) visitImporter(root);
  const sorted = (map) => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    fingerprint: JSON.stringify([sorted(importers), sorted(snapshots)]),
    importers: new Set(importers.keys()),
    names: new Set([...snapshots.keys()].map(packageName)),
  };
}

function changedBuildPackages(before, after) {
  const names = new Set();
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    if (LOCKFILE_RESOLVED_SETTINGS.has(key)) continue;
    if (!BUILD_SETTINGS.has(key)) throw new Error(`pnpm-workspace.yaml changes ${key}`);
    const [was, now] = [before[key], after[key]].map((value) => {
      if (value === undefined) return {};
      if (typeof value === 'object') return value;
      throw new Error(`pnpm-workspace.yaml writes ${key} inline`);
    });
    for (const entry of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (was[entry] === now[entry]) continue;
      names.add(entry.replace(/^- /, '').replace(/(?<=.)@.*$/, ''));
    }
  }
  return names;
}

export function dependencyImpact({ base, head }) {
  try {
    if (base.lockfile == null) throw new Error('the base pnpm-lock.yaml is unreadable');
    if (head.lockfile == null) throw new Error('pnpm-lock.yaml is missing');
    const was = lockfileDocument(base.lockfile);
    const now = lockfileDocument(head.lockfile);
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (!CLOSURE_KEYS.has(key) && JSON.stringify(was[key]) !== JSON.stringify(now[key])) {
        throw new Error(`pnpm-lock.yaml changes ${key}`);
      }
    }
    const builds = changedBuildPackages(
      parseYamlDocuments(base.workspace ?? '')[0] ?? {},
      parseYamlDocuments(head.workspace ?? '')[0] ?? {},
    );
    const touches = (roots) => {
      const [before, after] = [closure(was, roots), closure(now, roots)];
      if (before.fingerprint !== after.fingerprint) return 'resolves different packages';
      const built = [...builds].find((name) => after.names.has(name));
      return built === undefined ? null : `installs ${built}, whose build permission changed`;
    };
    const web = touches(WEB_IMPORTERS);
    if (web !== null) return { specs: null, why: `the web app or the root toolchain ${web}` };
    const server = touches(SERVER_IMPORTERS);
    if (server !== null) return { specs: LIVE_SERVER, why: `the live server ${server}` };
    return { specs: [], why: 'no package the web app or the live server installs changed' };
  } catch (error) {
    return { specs: null, why: `cannot compare dependencies: ${error.message}` };
  }
}

export function workspacePackages(lockfile) {
  try {
    if (lockfile == null) throw new Error('pnpm-lock.yaml is missing');
    const lock = lockfileDocument(lockfile);
    const packages = Object.keys(lock.importers)
      .filter((dir) => dir !== '.')
      .sort((a, b) => b.length - a.length);
    const web = closure(lock, WEB_IMPORTERS).importers;
    const server = closure(lock, SERVER_IMPORTERS).importers;
    return (path) => {
      const owner = packages.find((dir) => path.startsWith(`${dir}/`));
      if (owner === undefined) return null;
      if (web.has(owner)) {
        return {
          specs: null,
          why: `workspace package ${owner}, linked by the web app or the root`,
        };
      }
      if (server.has(owner)) {
        return { specs: LIVE_SERVER, why: `workspace package ${owner}, linked by the live server` };
      }
      return { specs: [], why: `workspace package ${owner}, which neither app links` };
    };
  } catch (error) {
    return () => ({ specs: null, why: `cannot read the workspace links: ${error.message}` });
  }
}
