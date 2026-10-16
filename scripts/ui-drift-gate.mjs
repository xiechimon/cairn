#!/usr/bin/env node

// Drift gate: one style, one implementation. Every UI face that has been
// consolidated into `apps/web/src/components/ui/*` (or the styles/ token
// single-source) must not grow a second implementation in domain CSS or JSX.
//
// What this checks (all source-only, no build needed):
//   G1  No live `.btn` / `.btn--*` selectors. The old button skins were
//       retired by the A3/A4/A5/A6收编 + #574 re-key: components/ui/Button
//       no longer renders a `btn` class, so any such selector is dead on
//       arrival. (Old values survive only inside CSS comments as migration
//       notes — comments are stripped before matching.)
//   G2  No hex color literals in declaration lines outside the token source
//       (`styles/shadcn.css` holds the values by design; `tokens.css` holds
//       aliases). Hex inside comments is stripped, not flagged.
//   G3  No `.chip--*` selector is defined anywhere. The canonical five-state
//       chip is components/ui/status-chip.tsx (data-tone + --chip-* token
//       utilities, spec/22 5.2); the old ui/chip.css primitive retired with
//       the src/ui/ directory (#952). Any `.chip--` rule reappearing in a
//       stylesheet is a second implementation of the canon.
//   G4  Every bare `<input` in apps/web/src either lives in an Input
//       primitive itself or carries a `deliberate-native` marker comment
//       within the 12 lines above it (#855, parent #851). Text-like inputs
//       migrate to components/ui/input.tsx; deliberate-native sites (hidden
//       file triggers, tri-state checkboxes, custom-switch a11y layers)
//       document their reason at the site instead.
//   G5  No raw color in components/ui/*.tsx (#989, map #980 zero-skin):
//       arbitrary color values (`[#…]`, `[rgb…]`, `[hsl…]`, `[oklch…]`) and
//       raw palette-scale classes (`bg-red-500` family, all 22 Tailwind hue
//       names) are red. Colors go through the semantic token slots;
//       arbitrary VALUES stay legal for non-color geometry
//       (`brightness-[1.07]`, `translate-x-[calc(100%-2px)]`), and the token
//       shorthand (`bg-(--card-button)`) is not a bracket form at all.
//   G6  Brand ink is spot emphasis only (#1055, #987): every consumer-point
//       TEXT-role use of the brand slots (--card-button / --focus-ring as
//       text-(…), text-[var(…)], fill-/stroke- utilities, the arbitrary
//       property form [color:var(…)], or a CSS `color:` declaration) must
//       carry an entry in scripts/ui-consumer-registry.json
//       (brandInkText section: {file, anchor, role, reason, contrast}, role
//       in selection-mark | indicator | badge-glyph | action-link; the last
//       is the board card's accent text link, DESIGN.md 按钮). Body/label/link/button
//       text ink goes through the text tiers, --primary or the registry link
//       tier (#1006 R4) — a canonical slot used in the wrong role is exactly
//       the defect class G2-style hex scans cannot see. Solid-fill uses
//       (bg-(--card-button), the slot's canonical role) are not policed.
//       Entries with no matching line are red too (stale ledger).
//
// The former single-site exception is closed: #854 minted `--text-on-veil`
// (styles/shadcn.css, both theme mirrors) for the white text over the
// theme-invariant black veil, and `overlay/attachment-strip.css` consumes it.
// No escape is allowlisted any more — HEX_ALLOWLIST stays as the mechanism so
// that any future exception has to name its file + selector explicitly.
//
// Usage: node scripts/ui-drift-gate.mjs
// Exit 0 when all gates hold; exit 1 otherwise, listing the offending sites.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
// G4/G5 comment stripping lives in ui-normalize.mjs — one implementation,
// shared with the registry gate's hash pipeline (#989). It used to be a local
// copy here; the copy is how the missing-`m`-flag bug (column-0 `//` lines
// after the first surviving stripping) existed in two places at once.
import { stripCodeComments as stripJsxComments } from './ui-normalize.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_SRC = join(REPO_ROOT, 'apps/web/src');
const rel = (p) => relative(WEB_SRC, p);

// G2: the only file allowed to hold color values.
const HEX_SOURCE = join(WEB_SRC, 'styles/shadcn.css');
// G2-ALLOW: file-relative + selector + reason. Empty since #854: every color
// value lives in the token source again (see header).
const HEX_ALLOWLIST = [];
// G3: the canonical chip lives in status-chip.tsx utilities — no CSS may
// define `.chip--*` selectors any more (ui/chip.css retired, #952).
// G4: bare `<input>` marker discipline.
const INPUT_MARKER = 'deliberate-native';
const INPUT_MARKER_WINDOW_LINES = 12;
// Files that ARE the primitive: bare <input> is the implementation there.
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

// G1-G3 scan stylesheets, where only CSS block comments exist.
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '\n');
}

const cssFiles = walk(WEB_SRC, '.css');

// --- G1: dead .btn selectors -------------------------------------------------
const BTN_RE = /\.btn(?![\w-])|\.btn--[\w-]+/;
for (const file of cssFiles) {
  const text = stripCssComments(readFileSync(file, 'utf8'));
  text.split('\n').forEach((line, i) => {
    const m = line.match(BTN_RE);
    if (m) failures.push(`G1 ${rel(file)}:${i + 1}: live \`${m[0]}\` selector (${line.trim()})`);
  });
}

// --- G2: hex escapes ---------------------------------------------------------
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
for (const file of cssFiles) {
  if (file === HEX_SOURCE) continue;
  const text = stripCssComments(readFileSync(file, 'utf8'));
  text.split('\n').forEach((line, i) => {
    if (!HEX_RE.test(line)) return;
    const allowed = HEX_ALLOWLIST.some(
      (a) => join(WEB_SRC, a.file) === file && line.includes(a.selector),
    );
    // Allowlist matches the selector definition line; the declaration lines
    // under it are covered by tracking the block below.
    if (!allowed) {
      // Check whether this line sits inside an allowlisted rule block.
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

// --- G3: no `.chip--*` selector definitions anywhere --------------------------
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

// --- G4: bare <input> sites (input facet, #855) ------------------------------
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
    // Bare <input followed by whitespace, newline, /, or > — never <Input
    // (capital I fails the lowercase match) nor a longer tag like <inputish.
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

// --- G5: raw color in components/ui (#989, map #980 zero-skin) ----------------
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

// --- G6: brand ink in a text role must be a registered spot (#1055, #987) ----
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
  // A broken ledger is an operational error, not a drift finding — same
  // severity split as registry-gate S6 / debt-gate D4 / the shape gate's
  // fatal(): exit 2, never a silent pass-through.
  console.error(`[ui-drift-gate] FATAL: G6 cannot use ${rel(CONSUMER_LEDGER)}: ${err.message}`);
  process.exit(2);
}
const g6Files = [...walk(WEB_SRC, '.tsx'), ...walk(WEB_SRC, '.ts')];
const matchedEntries = new Set();
for (const file of g6Files) {
  const relPath = rel(file);
  if (relPath.startsWith(UI_PRIMITIVES_PREFIX)) continue;
  // The consumer ledger keys entries by repo-relative path (scripts/ scope
  // style, same as ui-registry.json); rel() here is web-src-relative.
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

// --- verdict -----------------------------------------------------------------
if (failures.length === 0) {
  console.log(
    `[ui-drift-gate] PASS: no live .btn selectors, no hex escapes, no .chip--* redefinitions (${cssFiles.length} css files scanned); ${inputSites} bare <input> site(s), ${deliberateInputs} deliberate-native; no raw color in ${uiFilesScanned} components/ui file(s); ${brandInkHits} brand-ink text-role line(s), all registered (${brandInkEntries.length} ledger entries).`,
  );
  process.exit(0);
}
for (const f of failures) console.log(`[ui-drift-gate] ${f}`);
console.log(`[ui-drift-gate] FAIL: ${failures.length} drift site(s). See header for gate intent.`);
process.exit(1);
