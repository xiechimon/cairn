#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { stripCodeComments as stripJsxComments } from './ui-normalize.mjs';
import { shadowFindings } from './ui-shadow-rules.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_SRC = join(REPO_ROOT, 'apps/web/src');
const rel = (p) => relative(WEB_SRC, p);

const HEX_SOURCE = join(WEB_SRC, 'styles/shadcn.css');
const HEX_ALLOWLIST = [];
const INPUT_MARKER = 'deliberate-native';
const INPUT_MARKER_WINDOW_LINES = 12;
const INPUT_PRIMITIVE_FILES = new Set(['components/ui/input.tsx']);

const failures = [];

function walk(dir, extension, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, extension, out);
    else if (path.endsWith(extension)) out.push(path);
  }
  return out;
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '\n');
}

const cssFiles = walk(WEB_SRC, '.css');

const BTN_RE = /\.btn(?![\w-])|\.btn--[\w-]+/;
for (const file of cssFiles) {
  const text = stripCssComments(readFileSync(file, 'utf8'));
  text.split('\n').forEach((line, i) => {
    const m = line.match(BTN_RE);
    if (m) failures.push(`G1 ${rel(file)}:${i + 1}: live \`${m[0]}\` selector (${line.trim()})`);
  });
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
for (const file of cssFiles) {
  if (file === HEX_SOURCE) continue;
  const text = stripCssComments(readFileSync(file, 'utf8'));
  text.split('\n').forEach((line, i) => {
    if (!HEX_RE.test(line)) return;
    const allowed = HEX_ALLOWLIST.some(
      (a) => join(WEB_SRC, a.file) === file && line.includes(a.selector),
    );
    if (!allowed) {
      const lines = text.split('\n');
      let inside = false;
      for (let j = i; j >= 0 && i - j < 12; j--) {
        if (
          HEX_ALLOWLIST.some((a) => join(WEB_SRC, a.file) === file && lines[j].includes(a.selector))
        ) {
          inside = true;
          break;
        }
        if (j < i && lines[j].includes('}')) break;
      }
      if (!inside)
        failures.push(
          `G2 ${rel(file)}:${i + 1}: hex literal outside token source (${line.trim()})`,
        );
    }
  });
}

for (const file of cssFiles) {
  const text = stripCssComments(readFileSync(file, 'utf8'));
  text.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*\.chip--([a-z]+)\b/);
    if (m) {
      failures.push(
        `G3 ${rel(file)}:${i + 1}: .chip--${m[1]} selector defined — canonical chip is components/ui/status-chip.tsx (data-tone + token utilities)`,
      );
    }
  });
}

const INPUT_RE = /<input(?![A-Za-z0-9-])/;
const tsxFiles = walk(WEB_SRC, '.tsx');
let inputSites = 0;
let deliberateInputs = 0;
for (const file of tsxFiles) {
  const relPath = rel(file);
  if (INPUT_PRIMITIVE_FILES.has(relPath)) continue;
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const clean = stripJsxComments(raw).split('\n');
  for (let i = 0; i < clean.length; i++) {
    if (!INPUT_RE.test(clean[i])) continue;
    inputSites++;
    const windowStart = Math.max(0, i - INPUT_MARKER_WINDOW_LINES);
    const hasMarker = lines.slice(windowStart, i + 1).some((l) => l.includes(INPUT_MARKER));
    if (hasMarker) deliberateInputs++;
    else
      failures.push(
        `G4 ${relPath}:${i + 1}: bare <input> without \`${INPUT_MARKER}\` — migrate to components/ui/input.tsx or annotate the reason`,
      );
  }
}

const UI_PRIMITIVES_PREFIX = 'components/ui/';
const G5_ARBITRARY_COLOR_RE = /\[(?:#|rgb|hsl|oklch)/i;
const G5_RAW_SCALE_RE =
  /\b(?:bg|text|border|ring|fill|stroke)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|slate|zinc|neutral|stone)-\d{2,3}\b/;
let uiFilesScanned = 0;
for (const file of tsxFiles) {
  const relPath = rel(file);
  if (!relPath.startsWith(UI_PRIMITIVES_PREFIX)) continue;
  uiFilesScanned++;
  const clean = stripJsxComments(readFileSync(file, 'utf8')).split('\n');
  clean.forEach((line, i) => {
    const m = line.match(G5_ARBITRARY_COLOR_RE) || line.match(G5_RAW_SCALE_RE);
    if (m)
      failures.push(
        `G5 ${relPath}:${i + 1}: raw color \`${m[0]}\` in components/ui — colors go through semantic token slots (map #980 zero-skin); arbitrary values are for non-color geometry only (${line.trim()})`,
      );
  });
}

const CONSUMER_LEDGER = join(REPO_ROOT, 'scripts/ui-consumer-registry.json');
const BRAND_SLOTS = 'card-button|focus-ring';
const G6_TS_RE = new RegExp(
  `(?:text|fill|stroke)-\\(--(?:${BRAND_SLOTS})\\)|(?:text|fill|stroke)-\\[var\\(--(?:${BRAND_SLOTS})\\)\\]|\\[color:var\\(--(?:${BRAND_SLOTS})\\)\\]`,
);
const G6_CSS_RE = new RegExp(`color:\\s*var\\(--(?:${BRAND_SLOTS})\\)`);
const G6_ROLES = new Set(['selection-mark', 'indicator', 'badge-glyph', 'action-link']);
let brandInkHits = 0;
let brandInkEntries = [];
try {
  const ledger = JSON.parse(readFileSync(CONSUMER_LEDGER, 'utf8'));
  brandInkEntries = ledger.brandInkText;
  if (!Array.isArray(brandInkEntries)) throw new Error('brandInkText must be an array');
  for (const entry of brandInkEntries) {
    for (const field of ['file', 'anchor', 'role', 'reason', 'contrast']) {
      if (typeof entry[field] !== 'string' || entry[field] === '') {
        throw new Error(`entry ${entry.file} (${entry.anchor}): missing ${field}`);
      }
    }
    if (!G6_ROLES.has(entry.role))
      throw new Error(`entry ${entry.file}: unknown role ${entry.role}`);
  }
} catch (err) {
  console.error(`[ui-drift-gate] FATAL: G6 cannot use ${rel(CONSUMER_LEDGER)}: ${err.message}`);
  process.exit(2);
}
const g6Files = [...walk(WEB_SRC, '.tsx'), ...walk(WEB_SRC, '.ts')];
const matchedEntries = new Set();
for (const file of g6Files) {
  const relPath = rel(file);
  if (relPath.startsWith(UI_PRIMITIVES_PREFIX)) continue;
  const ledgerPath = `apps/web/src/${relPath}`;
  const clean = stripJsxComments(readFileSync(file, 'utf8')).split('\n');
  clean.forEach((line, i) => {
    if (!G6_TS_RE.test(line)) return;
    brandInkHits++;
    const covering = brandInkEntries.filter(
      (entry) => entry.file === ledgerPath && line.includes(entry.anchor),
    );
    if (covering.length > 0) {
      for (const entry of covering) matchedEntries.add(`${entry.file}\u0000${entry.anchor}`);
    } else {
      failures.push(
        `G6 ${relPath}:${i + 1}: brand ink in a text role without a ledger entry — brand slots are spot emphasis only (#987/#1055): move it to the text tiers / --primary / registry link tier, or register the spot role with reason + contrast in scripts/ui-consumer-registry.json (${line.trim().slice(0, 140)})`,
      );
    }
  });
}
for (const file of cssFiles) {
  const relPath = rel(file);
  const ledgerPath = `apps/web/src/${relPath}`;
  const text = stripCssComments(readFileSync(file, 'utf8'));
  text.split('\n').forEach((line, i) => {
    if (!G6_CSS_RE.test(line)) return;
    brandInkHits++;
    const covering = brandInkEntries.filter(
      (entry) => entry.file === ledgerPath && line.includes(entry.anchor),
    );
    if (covering.length > 0) {
      for (const entry of covering) matchedEntries.add(`${entry.file}\u0000${entry.anchor}`);
    } else
      failures.push(
        `G6 ${relPath}:${i + 1}: brand ink as a CSS color without a ledger entry (#987/#1055): ${line.trim().slice(0, 140)}`,
      );
  });
}
for (const entry of brandInkEntries) {
  if (!matchedEntries.has(`${entry.file}\u0000${entry.anchor}`)) {
    failures.push(
      `G6 STALE ${entry.file} (${entry.anchor}): ledger entry matches no brand-ink text line — drop or re-anchor it in the same PR.`,
    );
  }
}

const SEGMENTED_ALLOWLIST = new Map([
  [
    'components/segmented.tsx',
    'owns the one segmented face: SegmentedTabs wraps the registry Tabs, SegmentedRadio writes the radiogroup/radio roles',
  ],
]);
const TABS_IMPORT_RE = /from\s+['"][^'"]*\/ui\/tabs(?:\.js)?['"]/;
const SEGMENT_ROLE_RE = /\brole=\{?\s*['"](tab|tablist|radio|radiogroup)['"]/;
let segmentedFiles = 0;
for (const file of [...walk(WEB_SRC, '.tsx'), ...walk(WEB_SRC, '.ts')]) {
  const relPath = rel(file);
  if (relPath === 'components/ui/tabs.tsx') continue;
  const clean = stripJsxComments(readFileSync(file, 'utf8')).split('\n');
  let hit = false;
  clean.forEach((line, i) => {
    const imp = TABS_IMPORT_RE.test(line);
    const role = line.match(SEGMENT_ROLE_RE);
    if (!imp && role === null) return;
    hit = true;
    if (SEGMENTED_ALLOWLIST.has(relPath)) return;
    failures.push(
      imp
        ? `G7 ${relPath}:${i + 1}: registry Tabs imported outside components/segmented.tsx — use SegmentedTabs (view switch) or SegmentedRadio (value picker) (${line.trim()})`
        : `G7 ${relPath}:${i + 1}: hand-written role="${role[1]}" — segmented controls come from components/segmented.tsx (SegmentedTabs / SegmentedRadio) (${line.trim()})`,
    );
  });
  if (hit) segmentedFiles++;
}
for (const owner of SEGMENTED_ALLOWLIST.keys()) {
  if (!existsSync(join(WEB_SRC, owner)))
    failures.push(`G7 STALE allowlist entry ${owner}: file is gone — drop or re-point it.`);
}

const STATE_SHADOW_ALLOWLIST = new Map();
const stateShadowAllowed = new Set();
for (const file of [...cssFiles, ...tsxFiles, ...walk(WEB_SRC, '.ts')]) {
  for (const finding of shadowFindings(readFileSync(file, 'utf8'))) {
    const allowKey = `${rel(file)} ${finding.text}`;
    if (STATE_SHADOW_ALLOWLIST.has(allowKey)) {
      stateShadowAllowed.add(allowKey);
      continue;
    }
    failures.push(
      `G8 ${rel(file)}:${finding.line}: state shadow or box-shadow transition (${finding.text}); remove it or add deliberate-shadow with a reason on the preceding line`,
    );
  }
}

for (const allowKey of STATE_SHADOW_ALLOWLIST.keys()) {
  if (!stateShadowAllowed.has(allowKey))
    failures.push(
      `G8 STALE allowlist entry ${allowKey}: no such state shadow — drop or re-point it.`,
    );
}

const allTsFiles = [...tsxFiles, ...walk(WEB_SRC, '.ts')];

function checkPatternGuard({ code, files, pattern, skip, allowlist, message }) {
  const allowMatched = new Set();
  for (const file of files) {
    const relPath = rel(file);
    if (skip(relPath)) continue;
    const clean = stripJsxComments(readFileSync(file, 'utf8')).split('\n');
    clean.forEach((line, i) => {
      if (!pattern.test(line)) return;
      if (allowlist.has(relPath)) {
        allowMatched.add(relPath);
        return;
      }
      failures.push(`${code} ${relPath}:${i + 1}: ${message} (${line.trim().slice(0, 120)})`);
    });
  }
  for (const allowedPath of allowlist.keys()) {
    if (!allowMatched.has(allowedPath)) {
      failures.push(
        `${code} STALE allowlist entry ${allowedPath}: no matching site — drop it from ui-drift-gate.mjs.`,
      );
    }
  }
}

checkPatternGuard({
  code: 'G9',
  files: tsxFiles,
  pattern: /<hr(?![A-Za-z0-9-])/,
  skip: (relPath) => relPath === 'components/ui/separator.tsx',
  allowlist: new Map([
    [
      'components/side-panel.tsx',
      'interactive ARIA window-splitter handle (aria-orientation="vertical", tabIndex=0, pointer drag)',
    ],
  ]),
  message: 'bare <hr> — use Separator from components/ui/separator.tsx',
});

checkPatternGuard({
  code: 'G10',
  files: allTsFiles,
  pattern: /\.writeText\(/,
  skip: (relPath) => relPath === 'lib/clipboard.ts',
  allowlist: new Map([
    ['detail/transcript.tsx', 'active-lane file; migrate to lib/clipboard.ts when lane lands'],
  ]),
  message: 'direct .writeText( — route clipboard writes through lib/clipboard.ts or CopyIconButton',
});

checkPatternGuard({
  code: 'G11',
  files: allTsFiles,
  pattern: /from\s+['"][^'"]*\/components\/ui\/card(?:\.js)?['"]/,
  skip: (relPath) => relPath.startsWith('design/') || relPath.startsWith(UI_PRIMITIVES_PREFIX),
  allowlist: new Map([
    ['board/local-provider-import.tsx', 'legacy ui/card visual site awaiting owner design pass'],
    ['routes/machine-authorize-page.tsx', 'legacy ui/card visual site awaiting owner design pass'],
    ['routes/remote-access-page.tsx', 'legacy ui/card visual site awaiting owner design pass'],
  ]),
  message:
    'components/ui/card import — INVENTORY forbids ui/card as a visual primitive; use ListCard, SettingsCard, or per-face classes',
});

checkPatternGuard({
  code: 'G12',
  files: allTsFiles,
  pattern: /from\s+['"][^'"]*\/components\/ui\/dialog(?:\.js)?['"]/,
  skip: (relPath) => relPath === 'components/ui/dialog-shell.tsx' || relPath.startsWith('design/'),
  allowlist: new Map([
    ['board/app-sidebar.tsx', 'full-height mobile drawer sheet over Dialog primitive'],
    ['board/file-lightbox.tsx', 'full-bleed media lightbox over Dialog primitive'],
    ['chief/research-report.tsx', 'DialogTitle helper beside DialogShell'],
    ['overlay/route-dialog.tsx', 'DialogClose/DialogTitle helpers beside DialogShell'],
  ]),
  message:
    'direct components/ui/dialog import — use DialogShell from components/ui/dialog-shell.tsx',
});

checkPatternGuard({
  code: 'G13',
  files: allTsFiles,
  pattern: /\banimate-spin\b/,
  skip: (relPath) => relPath.startsWith(UI_PRIMITIVES_PREFIX) || relPath.startsWith('design/'),
  allowlist: new Map([
    ['components/status-glyph.tsx', 'canonical working status glyph rotation'],
    ['detail/chat-markdown.tsx', 'legacy task-card CSS spinner awaiting owner design pass'],
    ['resources/upstream-model-picker.tsx', 'active-lane picker refresh button spin'],
  ]),
  message: 'hand-rolled animate-spin — use components/ui/spinner.tsx or StatusGlyph',
});

checkPatternGuard({
  code: 'G14',
  files: tsxFiles,
  pattern: /(?<!\[)\brole=\{?\s*['"]listbox['"]/,
  skip: (relPath) => relPath === 'components/filter-picker.tsx' || relPath.startsWith('design/'),
  allowlist: new Map([
    [
      'components/settings/settings-search.tsx',
      'legacy listbox combobox awaiting FilterPicker migration',
    ],
    ['overlay/mention-inline.tsx', 'inline editor mention popover listbox'],
  ]),
  message: 'hand-written role="listbox" — compose from components/filter-picker.tsx',
});

checkPatternGuard({
  code: 'G15',
  files: tsxFiles,
  pattern: /(?<!\[)\brole=\{?\s*['"]dialog['"]/,
  skip: (relPath) => relPath.startsWith(UI_PRIMITIVES_PREFIX) || relPath.startsWith('design/'),
  allowlist: new Map([
    [
      'board/computer-screen-dialog.tsx',
      'viewportRoot full-bleed VNC viewer dialog over DialogShell',
    ],
    ['chief/selection-reply.tsx', 'active-lane floating selection toolbar'],
    ['overlay/search-panel.tsx', 'viewportRoot command palette over DialogShell'],
  ]),
  message: 'hand-written role="dialog" — use DialogShell, AlertDialogShell, or Popover',
});

if (failures.length === 0) {
  console.log(
    `[ui-drift-gate] PASS: no live .btn selectors, no hex escapes, no .chip--* redefinitions (${cssFiles.length} css files scanned); ${inputSites} bare <input> site(s), ${deliberateInputs} deliberate-native; no raw color in ${uiFilesScanned} components/ui file(s); ${brandInkHits} brand-ink text-role line(s), all registered (${brandInkEntries.length} ledger entries); segmented roles and registry Tabs only in ${[...SEGMENTED_ALLOWLIST.keys()].join(', ')} (${segmentedFiles} file(s) touch them).`,
  );
  process.exit(0);
}
for (const f of failures) console.log(`[ui-drift-gate] ${f}`);
console.log(`[ui-drift-gate] FAIL: ${failures.length} drift site(s).`);
process.exit(1);
