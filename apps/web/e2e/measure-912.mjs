// #912 token-scale canon measurement tool.
//
// Migrated out of the retired #909 prototype sandbox
// (library/t-0909/scripts/measure-912.mjs) by #953, per the docs/spec/22
// appendix rule: when the sandbox retires, this tool moves to the permanent
// e2e tool face (probe-dump.mjs's level). The palette canon moved with it:
// apps/web/e2e/palette-c.css is the frozen byte-identical copy of the #909
// version-C palette (sha1 beb289f69aa1a8aeb8b66f1f3c097ed186e7d3e3, ==
// c.css @ 7340d0ab == the main landing at 144698cb). The rest of the sandbox
// (gen-palettes.mjs, A/B drafts, reports) stays reachable through main's
// history at 144698cb; nothing else was carried.
//
// Parses the frozen palette canon (palette-c.css), the live shadcn slot file
// (apps/web/src/styles/shadcn.css) and its non-color sibling
// (apps/web/src/styles/tokens.css), resolves every custom property through
// var() chains and color-mix(), then:
//
//   1. diffs the slot-name sets — on the sealed (post-#915/#952) tree the
//      expected reading is `unchanged` across the board plus the two toggle
//      slots `retired`; a flip/new/other-retired entry is drift to explain,
//   2. measures a WCAG 2.1 luminance ratio for every slot's canonical role
//      pair against the canon palette values.
//
// Contrast math is byte-identical to the #909 gen-palettes.mjs canon:
// sRGB relative luminance + (Lhi+0.05)/(Llo+0.05). Translucent overlays are
// composited over their real base before measuring. No value is estimated.
//
// Run: node apps/web/e2e/measure-912.mjs [--out <dir>]
//        [--palette <file-in-this-dir>] [--variant <key>]
//      Defaults: out = cwd, palette = palette-c.css, variant = c — the sealed
//      #912 canon, default behavior unchanged. #988 (palette reselect) adds
//      the parameterization: point the tool at a new frozen canon copy
//      (palette-<x>.css, `:root[data-variant="<x>"]` selector shape) to
//      measure the reselected palette at full scale before/while it lands.
// Output: token-scale-912.json / token-scale-912-tables.md /
// token-scale-912-fragment.md under <dir>.
// Note: docs/spec/22 §1.5–1.8 froze the #912-era tables in place; post-seal
// re-runs are evidence artifacts (docs/verify/<ticket>/), not re-splices.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // repo root (apps/web/e2e → root)
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx >= 0 && process.argv[outIdx + 1] ? process.argv[outIdx + 1] : process.cwd();
mkdirSync(outDir, { recursive: true });
function argOf(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const paletteFile = argOf('--palette', 'palette-c.css');
const variantKey = argOf('--variant', 'c');
const cCss = readFileSync(join(here, paletteFile), 'utf8');
const shadcnCss = readFileSync(join(root, 'apps', 'web', 'src', 'styles', 'shadcn.css'), 'utf8');
const tokensCss = readFileSync(join(root, 'apps', 'web', 'src', 'styles', 'tokens.css'), 'utf8');

/* ------------------------------------------------------------------ */
/* CSS custom-property block parsing                                   */
/* ------------------------------------------------------------------ */

// Grab the `NAME { ... }` body whose selector matches `sel`.
function block(css, sel) {
  const i = css.indexOf(sel);
  if (i < 0) throw new Error(`selector not found: ${sel}`);
  const open = css.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, j);
    }
  }
  throw new Error(`unbalanced block: ${sel}`);
}

// Parse `--name: value;` declarations out of a block body, stripping comments.
function decls(body) {
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(clean))) out[m[1]] = m[2].trim();
  return out;
}

const cDark = decls(block(cCss, `:root[data-variant="${variantKey}"] {`));
const cLight = {
  ...cDark,
  ...decls(block(cCss, `:root[data-variant="${variantKey}"].light {`)),
};
const sDark = { ...decls(block(tokensCss, ':root {')), ...decls(block(shadcnCss, ':root {')) };
const sLight = {
  ...sDark,
  ...decls(block(tokensCss, '.light {')),
  ...decls(block(shadcnCss, '.light {')),
};

/* ------------------------------------------------------------------ */
/* Color model: {r,g,b,a} with a in [0,1]                              */
/* ------------------------------------------------------------------ */

function hexToColor(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
}

function parseColor(str) {
  const s = str.trim();
  if (s.startsWith('#')) return hexToColor(s);
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\/\s,]+/).filter((x) => x.length);
    const [r, g, b] = parts.slice(0, 3).map((v) => Number.parseFloat(v));
    const a = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
    return { r, g, b, a };
  }
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}

// Resolve a declaration value to a color, following var() chains and
// color-mix(in srgb, A p%, B). Returns {r,g,b,a} or null if non-color.
function resolve(raw, scope, depth = 0) {
  if (raw == null || depth > 24) return null;
  const s = String(raw).trim();

  const mix = s.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/i);
  if (mix) {
    const pct = Number.parseFloat(mix[2]) / 100;
    const a = resolve(mix[1], scope, depth + 1);
    const b = resolve(mix[3], scope, depth + 1);
    if (!a || !b) return null;
    // If the mixed color carries its own alpha (e.g. `transparent`), fold it
    // into the mix weight the way the browser composites srgb color-mix.
    const aw = pct * a.a;
    const bw = (1 - pct) * b.a;
    const chan = (k) => (a[k] * aw + b[k] * bw) / (aw + bw || 1);
    return { r: chan('r'), g: chan('g'), b: chan('b'), a: aw + bw };
  }

  const v = s.match(/^var\((--[\w-]+)\)$/);
  if (v) return resolve(scope[v[1]], scope, depth + 1);

  return parseColor(s);
}

function lum({ r, g, b }) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
}

// Composite a possibly-translucent fg over an opaque base.
function over(fg, base) {
  const a = fg.a;
  return { r: fg.r * a + base.r * (1 - a), g: fg.g * a + base.g * (1 - a), b: fg.b * a + base.b * (1 - a), a: 1 };
}

// Quantize to 8-bit channels before measuring — the browser renders color-mix
// and alpha compositing to integer sRGB, and gen-palettes.mjs (the #909 canon)
// rounds via formatHex the same way. Keeps this tool byte-consistent with the
// palette report and with rendered pixels.
function q(c) {
  return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: c.a };
}

function css(c) {
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  if (c.a >= 0.999) return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  return `rgb(${r} ${g} ${b} / ${Number(c.a.toFixed(3))})`;
}

/* ------------------------------------------------------------------ */
/* Slot role pairs — each slot's canonical measured pair                */
/* fg/bg are token names; `over` composites a translucent fg onto base.  */
/* kind: text=4.5, ui=3, hairline=1.5, info=report-only                 */
/* ------------------------------------------------------------------ */

const THRESH = { text: 4.5, ui: 3, hairline: 1.5, info: 0 };

// [slot, fgToken, bgToken, kind, note]
// slot = the row this measurement is attached to in the mapping table.
const PAIRS = [
  // official semantic slots
  ['background', '--foreground', '--background', 'text', 'body text on page bg'],
  ['foreground', '--foreground', '--background', 'text', 'body text on page bg'],
  ['card', '--card-foreground', '--card', 'text', 'body text on card'],
  ['card-foreground', '--card-foreground', '--card', 'text', 'card label'],
  ['popover', '--popover-foreground', '--popover', 'text', 'body text on popover'],
  ['popover-foreground', '--popover-foreground', '--popover', 'text', 'popover label'],
  ['primary', '--primary-foreground', '--primary', 'text', 'primary button label'],
  ['primary-foreground', '--primary-foreground', '--primary', 'text', 'primary button label'],
  ['secondary', '--secondary-foreground', '--secondary', 'text', 'secondary label'],
  ['secondary-foreground', '--secondary-foreground', '--secondary', 'text', 'secondary label'],
  ['muted', '--muted-foreground', '--muted', 'text', 'muted text on muted/code bg'],
  ['muted-foreground', '--muted-foreground', '--background', 'text', 'muted text on page bg'],
  ['accent', '--accent-foreground', '--accent', 'text', 'accent label'],
  ['accent-foreground', '--accent-foreground', '--accent', 'text', 'accent label'],
  ['destructive', '--destructive-foreground', '--destructive', 'text', 'destructive label'],
  ['destructive-foreground', '--destructive-foreground', '--destructive', 'text', 'destructive label'],
  ['border', '--border', '--background', 'info', 'soft hairline border on page bg (report-only)'],
  ['input', '--input', '--background', 'hairline', 'input edge (legible hairline) on page bg'],
  ['ring', '--ring', '--background', 'ui', 'focus ring neutral (UI) on page bg'],
  // repo supplement — surfaces & text tiers
  ['column', '--foreground', '--column', 'text', 'board column body text'],
  ['col-bg', '--foreground', '--col-bg', 'text', 'column body text'],
  ['col-head-text', '--col-head-text', '--col-bg', 'text', 'column header text'],
  ['sidebar-hover', '--sidebar-hover', '--surface', 'info', 'hover tint composited on surface'],
  ['sidebar-active', '--sidebar-active', '--surface', 'info', 'active tint composited on surface'],
  ['surface', '--foreground', '--surface', 'text', 'body text on surface'],
  ['surface-secondary', '--foreground', '--surface-secondary', 'text', 'body text on surface-2'],
  ['surface-tertiary', '--foreground', '--surface-tertiary', 'text', 'body text on surface-3'],
  ['surface-elevated', '--foreground', '--surface-elevated', 'text', 'body text on elevated'],
  ['surface-hover', '--foreground', '--surface-hover', 'text', 'body text on hover surface'],
  ['surface-press', '--foreground', '--surface-press', 'text', 'body text on press surface'],
  ['text-secondary', '--text-secondary', '--background', 'text', 'secondary text on page bg'],
  ['text-tertiary', '--text-tertiary', '--background', 'text', 'tertiary text on page bg'],
  ['text-dim', '--text-dim', '--background', 'ui', 'dim (decorative) on page bg'],
  ['border-default', '--border-default', '--background', 'info', 'soft default hairline on page bg (report-only)'],
  ['border-strong', '--border-strong', '--background', 'hairline', 'strong hairline on page bg'],
  // brand / focus
  ['card-button', '--text-on-accent', '--card-button', 'text', 'brand solid-fill label'],
  ['text-on-accent', '--text-on-accent', '--card-button', 'text', 'on-brand label'],
  ['focus-ring', '--focus-ring', '--background', 'ui', 'focus ring (UI) on page bg'],
  // column dots (graphical)
  ['col-dot-idle', '--col-dot-idle', '--background', 'ui', 'column dot idle (graphical)'],
  ['col-dot-confirm', '--col-dot-confirm', '--background', 'info', 'column dot confirm (decorative, label-carried)'],
  ['col-dot-building', '--col-dot-building', '--background', 'ui', 'column dot building (graphical)'],
  ['col-dot-done', '--col-dot-done', '--background', 'ui', 'column dot done (graphical)'],
  // badges
  ['badge-attention', '--badge-attention-fg', '--badge-attention', 'text', 'attention pill digit'],
  ['badge-attention-fg', '--badge-attention-fg', '--badge-attention', 'text', 'attention pill digit'],
  ['badge-done', '--badge-done', '--background', 'ui', 'done badge (graphical) on page bg'],
  ['badge-idle', '--badge-idle', '--background', 'ui', 'idle badge (graphical) on page bg'],
  // avatars
  ['project-avatar-bg', '--project-avatar-fg', '--project-avatar-bg', 'text', 'project initial avatar'],
  ['project-avatar-fg', '--project-avatar-fg', '--project-avatar-bg', 'text', 'project initial avatar'],
  ['agent-avatar-bg', '--foreground', '--agent-avatar-bg', 'text', 'agent avatar disc body text'],
  // chip five-state family
  ['chip-idle-bg', '--chip-idle-fg', '--chip-idle-bg', 'text', 'chip idle'],
  ['chip-idle-fg', '--chip-idle-fg', '--chip-idle-bg', 'text', 'chip idle'],
  ['chip-plan-bg', '--chip-plan-fg', '--chip-plan-bg', 'text', 'chip plan (spot tint)'],
  ['chip-plan-fg', '--chip-plan-fg', '--chip-plan-bg', 'text', 'chip plan (spot tint)'],
  ['chip-confirm-bg', '--chip-confirm-fg', '--chip-confirm-bg', 'text', 'chip confirm'],
  ['chip-confirm-fg', '--chip-confirm-fg', '--chip-confirm-bg', 'text', 'chip confirm'],
  ['chip-done-bg', '--chip-done-fg', '--chip-done-bg', 'text', 'chip done'],
  ['chip-done-fg', '--chip-done-fg', '--chip-done-bg', 'text', 'chip done'],
  ['chip-failed-bg', '--chip-failed-fg', '--chip-failed-bg', 'text', 'chip failed'],
  ['chip-failed-fg', '--chip-failed-fg', '--chip-failed-bg', 'text', 'chip failed'],
  ['fail-fg', '--fail-fg', '--card', 'text', 'fail message text on card'],
  // segmented control
  ['seg-active', '--foreground', '--seg-active', 'text', 'active segment label'],
  ['seg-hover', '--seg-hover', '--surface', 'info', 'segment hover tint on surface'],
  ['tab-chip-bg', '--foreground', '--tab-chip-bg', 'text', 'tab chip label'],
  // stop / diff
  ['stop', '--stop', '--background', 'ui', 'stop button red (UI) on page bg'],
  ['diff-add-bg', '--diff-add-fg', '--diff-add-bg', 'text', 'diff add stat'],
  ['diff-add-fg', '--diff-add-fg', '--diff-add-bg', 'text', 'diff add stat'],
  ['diff-del-bg', '--destructive', '--diff-del-bg', 'text', 'diff del stat (destructive on tint)'],
  // dialog / rows
  ['dialog-bg', '--foreground', '--dialog-bg', 'text', 'dialog body text'],
  ['dialog-box-bg', '--foreground', '--dialog-box-bg', 'text', 'dialog box body text'],
  ['dialog-row-bg', '--foreground', '--dialog-row-bg', 'text', 'dialog row body text'],
  ['dialog-ring', '--dialog-ring', '--dialog-bg', 'info', 'soft dialog row ring on dialog bg (report-only)'],
  ['range-chip-bg', '--foreground', '--range-chip-bg', 'text', 'range chip label'],
  ['range-chip-border', '--range-chip-border', '--range-chip-bg', 'info', 'soft range chip hairline (report-only)'],
  // toggle-track pair dropped: slots retired by #952 (the flag this pair
  // carried — "drop, not carry" — executed; see RETIRED_SLOTS below)
  // tiles
  ['tile-orange-bg', '--tile-orange-fg', '--tile-orange-bg', 'text', 'tile orange label'],
  ['tile-orange-fg', '--tile-orange-fg', '--tile-orange-bg', 'text', 'tile orange label'],
  ['tile-indigo-bg', '--tile-indigo-fg', '--tile-indigo-bg', 'text', 'tile indigo/spot label'],
  ['tile-indigo-fg', '--tile-indigo-fg', '--tile-indigo-bg', 'text', 'tile indigo/spot label'],
  ['tile-hero-bg', '--foreground', '--tile-hero-bg', 'text', 'tile hero body text'],
  ['pill-idle-bg', '--foreground', '--pill-idle-bg', 'text', 'idle pill label'],
  ['dash-border', '--dash-border', '--surface', 'info', 'soft dashed border on surface (report-only)'],
  // overlay batch
  ['row-selected', '--foreground', '--row-selected', 'text', 'selected row body text'],
  ['row-icon-bg', '--foreground', '--row-icon-bg', 'text', 'result icon tile body text'],
  ['overlay-divider', '--overlay-divider', '--popover', 'info', 'soft popover divider (report-only)'],
  ['overlay-select-indigo', '--spot-text-on-tint', '--overlay-select-indigo', 'text', 'select block (spot) label'],
  ['pick-selected-bg', '--pick-selected-fg', '--pick-selected-bg', 'text', 'model picker selected row label'],
  ['pick-selected-fg', '--pick-selected-fg', '--pick-selected-bg', 'text', 'model picker selected row label'],
  // chief
  ['chief-tab-bg', '--foreground', '--chief-tab-bg', 'text', 'chief strip body text'],
  ['chief-tab-active', '--foreground', '--chief-tab-active', 'text', 'chief active pill body text'],
  ['notify-icon-bg', '--card-button', '--notify-icon-bg', 'ui', 'bell glyph (spot) on disc (UI)'],
  ['menu-icon', '--menu-icon', '--popover', 'ui', 'menu row icon (UI) on popover'],
  // track-A family
  // toggle-knob pair dropped: slots retired by #952 (see RETIRED_SLOTS)
  ['overlay-scrim', '--overlay-scrim', '--background', 'info', 'scrim composited on page bg'],
  ['text-on-veil', '--text-on-veil', '--overlay-scrim', 'text', 'white text on black veil'],
  // P0 semantic slots
  ['spot-soft', '--spot-text-on-tint', '--spot-soft', 'text', 'selected-row text on spot tint'],
  ['accent-soft', '--accent-soft', '--surface', 'info', 'row hover tint composited on surface'],
  ['danger-soft', '--danger-soft', '--surface', 'info', 'danger row tint composited on surface'],
  ['spot-text-on-tint', '--spot-text-on-tint', '--spot-soft', 'text', 'text on spot tint'],
  ['spot-disabled', '--spot-disabled-fg', '--spot-disabled', 'info', 'disabled label (not AA-gated)'],
  ['spot-disabled-fg', '--spot-disabled-fg', '--spot-disabled', 'info', 'disabled label (not AA-gated)'],
  ['primary-disabled', '--spot-disabled-fg', '--primary-disabled', 'info', 'disabled primary label (not AA-gated)'],
  // drop-tint (drag & drop)
  ['drop-tint-border', '--drop-tint-border', '--column', 'ui', 'drop-target ring (UI) on column'],
  ['drop-tint-base', '--drop-tint-base', '--column', 'info', 'drop base tint on column'],
  ['drop-tint-hover', '--drop-tint-hover', '--column', 'info', 'drop hover tint on column'],
  // alias slots (measure against the aliased primary's role)
  ['surface-inset', '--foreground', '--surface-inset', 'text', 'alias of background — body text'],
  ['card-bg', '--card-foreground', '--card-bg', 'text', 'alias of card — body text'],
  ['popover-bg', '--popover-foreground', '--popover-bg', 'text', 'alias of popover — body text'],
  ['text-primary', '--text-primary', '--background', 'text', 'alias of foreground on page bg'],
  ['code-bg', '--foreground', '--code-bg', 'text', 'alias of muted — code body text'],
  ['danger', '--danger', '--background', 'ui', 'alias of destructive (UI) on page bg'],
  ['card-border', '--card-border', '--card', 'info', 'alias of border-default on card (report-only)'],
];

/* ------------------------------------------------------------------ */
/* Measure                                                            */
/* ------------------------------------------------------------------ */

function measure(mode) {
  const scope = mode === 'dark' ? cDark : cLight;
  const rows = [];
  for (const [slot, fgName, bgName, kind, note] of PAIRS) {
    const fgRaw = scope[fgName];
    const bgRaw = scope[bgName];
    let fg = resolve(fgRaw, scope);
    let bg = resolve(bgRaw, scope);
    if (!fg || !bg) {
      rows.push({ slot, kind, note, fg: fgName, bg: bgName, error: 'unresolved' });
      continue;
    }
    // Composite translucent layers onto their base before measuring.
    let composited = false;
    if (bg.a < 0.999) {
      // bg itself translucent (scrim/tint) — lay over page background.
      const page = resolve(scope['--background'], scope);
      bg = over(bg, page);
      composited = true;
    }
    if (fg.a < 0.999) {
      fg = over(fg, bg);
      composited = true;
    }
    const r = ratio(q(fg), q(bg));
    const th = THRESH[kind];
    rows.push({
      slot,
      kind,
      note,
      fg: fgName,
      bg: bgName,
      fgValue: css(fg),
      bgValue: css(bg),
      ratio: Number(r.toFixed(2)),
      threshold: th,
      composited,
      result: kind === 'info' ? 'report-only' : r >= th ? 'PASS' : 'FAIL',
    });
  }
  return rows;
}

// Resolve the full new (version-C) value of every slot for the value columns.
function values(mode) {
  const scope = mode === 'dark' ? cDark : cLight;
  const out = {};
  for (const name of Object.keys(scope)) {
    const c = resolve(scope[name], scope);
    out[name] = c ? css(c) : scope[name];
  }
  return out;
}

// Current live shadcn+tokens value of every slot (what #915 flips FROM).
function currentValues(mode) {
  const scope = mode === 'dark' ? sDark : sLight;
  const out = {};
  for (const name of Object.keys(scope)) {
    const c = resolve(scope[name], scope);
    out[name] = c ? css(c) : scope[name];
  }
  return out;
}

const result = {
  generatedBy: 'apps/web/e2e/measure-912.mjs (migrated from library/t-0909 by #953)',
  paletteCanon: `apps/web/e2e/${paletteFile} (variant "${variantKey}" frozen canon copy)`,
  slotFile: 'apps/web/src/styles/shadcn.css (+ tokens.css non-color)',
  modes: {},
};

// Slots retired for real: they remain in the frozen canon palette (which is
// name-complete at the pre-convergence universe), so the name-level diff would
// read them as "new" — force the honest status. Two retirement waves:
//   #952 — the toggle slots (consumers died with the per-face CSS D3 zeroed).
//   #1002 — the #987 §3 convergence: 7 dead slots (0 consumers) + 30 merged
//     slots (value-equal to an official/canonical slot, consumers repointed).
//     The merges were proven value-preserving (both modes, 0 divergence) before
//     execution, so retiring them changes no rendered color. PAIRS is NOT
//     pruned: it measures the frozen canon (still 109 slots) and the ticket
//     acceptance wants the 109-pair canon read reproduced; RETIRED_SLOTS is the
//     honest-status mechanism, per the #952 precedent.
const RETIRED_SLOTS = {
  '--toggle-track': 'retired by #952 (consumer .dlg-toggle died with detail/overlays.css; → shadcn Switch)',
  '--toggle-knob': 'retired by #952 (consumers .dlg-toggle-knob + secondary.css died; → shadcn Switch)',
  // #1002 dead slots (#987 §3.1–3.2, 0 consumers):
  '--destructive-foreground': 'retired by #1002 (#987 §3.1: official v4 set has no such slot, base-nova 0 consumers; destructive now text-destructive on tint)',
  '--col-bg': 'retired by #1002 (#987 §3.2: dead, 0 consumers; was var(--background))',
  '--col-head-text': 'retired by #1002 (#987 §3.2: dead, 0 consumers)',
  '--dialog-row-bg': 'retired by #1002 (#987 §3.2: dead, 0 consumers)',
  '--tile-indigo-bg': 'retired by #1002 (#987 §3.2: dead, 0 consumers; was var(--spot-soft))',
  '--tile-indigo-fg': 'retired by #1002 (#987 §3.2: dead, 0 consumers; was var(--spot-text-on-tint))',
  '--primary-disabled': 'retired by #1002 (#987 §3.2: dead, 0 consumers; was var(--spot-disabled))',
  // #1002 merged slots (#987 §3.3 A/B/C, value-equal → official/canonical):
  '--surface-inset': 'merged by #1002 into --background (#987 §3.3-A)',
  '--card-bg': 'merged by #1002 into --card (#987 §3.3-A)',
  '--popover-bg': 'merged by #1002 into --popover (#987 §3.3-A)',
  '--text-primary': 'merged by #1002 into --foreground (#987 §3.3-A)',
  '--code-bg': 'merged by #1002 into --muted (#987 §3.3-A)',
  '--danger': 'merged by #1002 into --destructive (#987 §3.3-A)',
  '--card-border': 'merged by #1002 into --border (#987 §3.3-A, via --border-default)',
  '--column': 'merged by #1002 into --background (#987 §3.3-B)',
  '--surface': 'merged by #1002 into --card (#987 §3.3-B)',
  '--surface-elevated': 'merged by #1002 into --card (#987 §3.3-B)',
  '--dialog-bg': 'merged by #1002 into --card (#987 §3.3-B)',
  '--dialog-box-bg': 'merged by #1002 into --card (#987 §3.3-B)',
  '--tab-chip-bg': 'merged by #1002 into --card (#987 §3.3-B)',
  '--surface-secondary': 'merged by #1002 into --secondary (#987 §3.3-B)',
  '--surface-hover': 'merged by #1002 into --secondary (#987 §3.3-B)',
  '--agent-avatar-bg': 'merged by #1002 into --secondary (#987 §3.3-B)',
  '--pill-idle-bg': 'merged by #1002 into --secondary (#987 §3.3-B)',
  '--row-selected': 'merged by #1002 into --secondary (#987 §3.3-B)',
  '--chief-tab-bg': 'merged by #1002 into --secondary (#987 §3.3-B)',
  '--range-chip-bg': 'merged by #1002 into --secondary (#987 §3.3-B)',
  '--border-default': 'merged by #1002 into --border (#987 §3.3-B)',
  '--overlay-divider': 'merged by #1002 into --border (#987 §3.3-B)',
  '--border-strong': 'merged by #1002 into --input (#987 §3.3-B)',
  '--dash-border': 'merged by #1002 into --input (#987 §3.3-B)',
  '--dialog-ring': 'merged by #1002 into --input (#987 §3.3-B)',
  '--range-chip-border': 'merged by #1002 into --input (#987 §3.3-B)',
  '--stop': 'merged by #1002 into --destructive (#987 §3.3-B)',
  '--overlay-select-indigo': 'merged by #1002 into --spot-soft (#987 §3.3-C)',
  '--pick-selected-bg': 'merged by #1002 into --spot-soft (#987 §3.3-C)',
  '--pick-selected-fg': 'merged by #1002 into --spot-text-on-tint (#987 §3.3-C)',
};

// Geometry / motion / font tokens are not color slots — keep them out of the
// color-slot universe on both sides so the flip/new/retired diff is clean.
const NONCOLOR =
  /^--(radius|radius-popover|edge-radius|edge-ring|edge-shadow|card-shadow|dialog-shadow|plate-shadow|drag-shadow|chief-shadow|pad-card|pad-page|row-h|font-|label-|title-|dur-|ease-|z-|board-col-min)/;
const isColor = (n) => n.startsWith('--') && !NONCOLOR.test(n);

for (const mode of ['dark', 'light']) {
  const cVals = values(mode);
  const sVals = currentValues(mode);
  // Slot universe = color names present in the live shadcn file.
  const sColorNames = Object.keys(sVals).filter(isColor);
  const status = {};
  for (const n of sColorNames) {
    if (!(n in cVals)) status[n] = 'retired';
    else if (cVals[n] === sVals[n]) status[n] = 'unchanged';
    else status[n] = 'flip';
  }
  for (const n of Object.keys(cVals)) {
    if (isColor(n) && !sColorNames.includes(n)) status[n] = 'new';
  }
  // Slots #952 actually dropped from the live files. They still exist in the
  // frozen canon palette, so the loops above would mislabel them "new".
  for (const n of Object.keys(RETIRED_SLOTS)) {
    if (n in cVals) status[n] = 'retired';
  }
  result.modes[mode] = {
    rows: measure(mode),
    newValues: cVals,
    currentValues: sVals,
    status,
  };
}

// Summary counts
const summary = {};
for (const mode of ['dark', 'light']) {
  const st = result.modes[mode].status;
  const c = { flip: 0, new: 0, retired: 0, unchanged: 0, 'retire-candidate': 0 };
  for (const v of Object.values(st)) c[v] = (c[v] || 0) + 1;
  const rows = result.modes[mode].rows;
  const pass = rows.filter((r) => r.result === 'PASS').length;
  const fail = rows.filter((r) => r.result === 'FAIL').length;
  const info = rows.filter((r) => r.result === 'report-only').length;
  // AA-gated = text (4.5) + UI/graphical (3). Hairline (1.5) and info
  // (report-only overlays/disabled) are excluded from the min-ratio headline.
  const gated = rows.filter((r) => r.kind === 'text' || r.kind === 'ui');
  const minGated = gated.reduce((m, r) => (r.ratio < m.ratio ? r : m), gated[0]);
  const hair = rows.filter((r) => r.kind === 'hairline');
  const minHair = hair.reduce((m, r) => (r.ratio < m.ratio ? r : m), hair[0]);
  summary[mode] = {
    slots: c,
    measured: rows.length,
    pass,
    fail,
    info,
    gated: gated.length,
    minGatedRatio: minGated.ratio,
    minGatedSlot: minGated.slot,
    minGatedNote: minGated.note,
    minHairlineRatio: minHair ? minHair.ratio : null,
    minHairlineSlot: minHair ? minHair.slot : null,
  };
}
result.summary = summary;

/* ------------------------------------------------------------------ */
/* Component-carrier pairs — the real shadcn components consume several */
/* slots at once; measure the rendered pair, not a single token.        */
/* ------------------------------------------------------------------ */

// shadcn Switch: track = data-unchecked:bg-input / data-checked:bg-primary;
// thumb = bg-background (light), dark:bg-foreground / dark:data-checked:
// bg-primary-foreground (dark). State signal = the track color flip.
const COMPONENTS = [
  { comp: 'Switch — unchecked (OFF)', light: ['--background', '--input'], dark: ['--foreground', '--input'], kind: 'ui', note: 'thumb on track; OFF track = --input (dark renders bg-input/80 over surface)' },
  { comp: 'Switch — checked (ON)', light: ['--background', '--primary'], dark: ['--primary-foreground', '--primary'], kind: 'ui', note: 'thumb on track' },
  { comp: 'Switch — track state flip', light: ['--input', '--primary'], dark: ['--input', '--primary'], kind: 'ui', note: 'OFF→ON track color = primary state carrier (WCAG 1.4.11)' },
  { comp: 'Input — border on page bg', light: ['--input', '--background'], dark: ['--input', '--background'], kind: 'hairline', note: 'field boundary hairline (state also carried by focus ring)' },
  { comp: 'Button brand — label on fill', light: ['--text-on-accent', '--card-button'], dark: ['--text-on-accent', '--card-button'], kind: 'text', note: 'brand solid-fill label' },
];

function measureComponents(mode) {
  const scope = mode === 'dark' ? cDark : cLight;
  return COMPONENTS.map((c) => {
    const [fgName, bgName] = c[mode];
    let fg = resolve(scope[fgName], scope);
    let bg = resolve(scope[bgName], scope);
    if (bg && bg.a < 0.999) bg = over(bg, resolve(scope['--background'], scope));
    if (fg && fg.a < 0.999 && bg) fg = over(fg, bg);
    const r = ratio(q(fg), q(bg));
    return {
      comp: c.comp,
      fg: fgName,
      bg: bgName,
      ratio: Number(r.toFixed(2)),
      threshold: THRESH[c.kind],
      note: c.note,
      result: r >= THRESH[c.kind] ? 'PASS' : 'below',
    };
  });
}

for (const mode of ['dark', 'light']) {
  result.modes[mode].retireReasons = RETIRED_SLOTS;
  result.modes[mode].components = measureComponents(mode);
}

writeFileSync(join(outDir, 'token-scale-912.json'), `${JSON.stringify(result, null, 2)}\n`);

// Console digest
console.log('=== #912 measurement digest ===');
for (const mode of ['dark', 'light']) {
  const s = summary[mode];
  console.log(
    `${mode}: slots flip=${s.slots.flip} new=${s.slots.new} retired=${s.slots.retired} unchanged=${s.slots.unchanged} | pairs=${s.measured} PASS=${s.pass} FAIL=${s.fail} report-only=${s.info} | min gated ratio ${s.minGatedRatio}:1 (${s.minGatedSlot})`,
  );
  const fails = result.modes[mode].rows.filter((r) => r.result === 'FAIL');
  for (const f of fails) console.log(`  FAIL ${f.slot}: ${f.fg} on ${f.bg} = ${f.ratio}:1 (need ${f.threshold})`);
}
console.log(`wrote ${join(outDir, 'token-scale-912.json')}`);

/* ------------------------------------------------------------------ */
/* Markdown table emission (consumed verbatim by docs/spec volume)     */
/* ------------------------------------------------------------------ */

const KIND_LABEL = { text: '4.5', ui: '3', hairline: '1.5', info: '—' };
const STATUS_ZH = { flip: '翻值', unchanged: '不变', new: '新增', retired: '退役', 'retire-candidate': '退役候选' };

function compTable(mode) {
  const rows = result.modes[mode].components;
  const lines = ['| 组件件面 | 角色对 (fg on bg) | 实测 | 阈值 | 结果 | 备注 |', '| --- | --- | --- | --- | --- | --- |'];
  for (const r of rows) {
    const res = r.result === 'PASS' ? 'PASS' : `below ${r.threshold}`;
    lines.push(`| ${r.comp} | \`${r.fg} on ${r.bg}\` | ${r.ratio}:1 | ${r.threshold} | ${res} | ${r.note} |`);
  }
  return lines.join('\n');
}

function tableFor(mode) {
  const { rows, newValues, currentValues, status } = result.modes[mode];
  const lines = [
    '| 槽位 | 状态 | 旧值 (shadcn 现行) | 新值 (c.css 定版) | 角色对 (fg on bg) | 实测 | 阈值 | 结果 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    const slot = r.slot;
    const st = status[`--${slot}`] || status[slot] || '—';
    const cur = currentValues[`--${slot}`] ?? '—';
    const nv = newValues[`--${slot}`] ?? '—';
    const pair = r.error ? '—' : `\`${r.fg} on ${r.bg}\``;
    const meas = r.error ? '—' : `${r.ratio}:1`;
    const th = KIND_LABEL[r.kind];
    const res = r.error ? '—' : r.result === 'PASS' ? 'PASS' : r.result === 'FAIL' ? '**FAIL**' : 'report-only';
    lines.push(`| \`--${slot}\` | ${STATUS_ZH[st] || st} | \`${cur}\` | \`${nv}\` | ${pair} | ${meas} | ${th} | ${res} |`);
  }
  return lines.join('\n');
}

const md = [
  '<!-- 本文件由 apps/web/e2e/measure-912.mjs 生成（#953 自 library/t-0909 随迁），勿手改。',
  '     取数源 = apps/web/e2e/palette-c.css（#909 定版色板冻结副本）+ apps/web/src/styles/{shadcn,tokens}.css；',
  '     对比度 = WCAG 2.1 亮度比，逐对实测。 -->',
  '',
  `# #912 色槽映射实测表（生成物）`,
  '',
  `汇总：dark flip=${summary.dark.slots.flip} unchanged=${summary.dark.slots.unchanged} new=${summary.dark.slots.new} retired=${summary.dark.slots.retired}；`,
  `light flip=${summary.light.slots.flip} unchanged=${summary.light.slots.unchanged} new=${summary.light.slots.new} retired=${summary.light.slots.retired}。`,
  `AA 门控对（text 4.5 / ui 3）：dark ${summary.dark.gated} 对全过，最低 ${summary.dark.minGatedRatio}:1（${summary.dark.minGatedSlot}）；`,
  `light ${summary.light.gated} 对全过，最低 ${summary.light.minGatedRatio}:1（${summary.light.minGatedSlot}）。report-only = 软发丝线 / 装饰点 / 失能态 / 半透明 tint（非 AA 门控）。`,
  '',
  '## 组件件面实测（真实 shadcn 件消费多槽，量渲染对）',
  '',
  '### 暗模 (dark)',
  '',
  compTable('dark'),
  '',
  '### 亮模 (light)',
  '',
  compTable('light'),
  '',
  '## 已退役（#952 唯一解冻窗执行；名字仍留在冻结色板正本里，live 已删）',
  '',
  ...Object.entries(result.modes.dark.retireReasons).map(([k, v]) => `- \`${k}\`：${v}`),
  '',
  '## 暗模 (dark) 逐槽',
  '',
  tableFor('dark'),
  '',
  '## 亮模 (light) 逐槽',
  '',
  tableFor('light'),
  '',
].join('\n');

writeFileSync(join(outDir, 'token-scale-912-tables.md'), `${md}\n`);
console.log(`wrote ${join(outDir, 'token-scale-912-tables.md')}`);

// Doc-embeddable fragment: sections only (no H1 / summary / generator comment).
// Historical: spliced verbatim into docs/spec/22 §1.5–1.8 by the #912 volume
// assembler. Those tables are frozen in place; post-seal re-runs archive this
// fragment as evidence (docs/verify/<ticket>/) instead of re-splicing.
const frag = [
  '### 1.5 组件件面实测（真实 shadcn 件消费多槽，量渲染对）',
  '',
  '#### 暗模 (dark)',
  '',
  compTable('dark'),
  '',
  '#### 亮模 (light)',
  '',
  compTable('light'),
  '',
  '### 1.6 已退役（#952 唯一解冻窗执行；名字仍留在冻结色板正本里，live 已删）',
  '',
  ...Object.entries(result.modes.dark.retireReasons).map(([k, v]) => `- \`${k}\`：${v}`),
  '',
  '### 1.7 暗模 (dark) 逐槽映射与实测',
  '',
  tableFor('dark'),
  '',
  '### 1.8 亮模 (light) 逐槽映射与实测',
  '',
  tableFor('light'),
  '',
].join('\n');
writeFileSync(join(outDir, 'token-scale-912-fragment.md'), `${frag}\n`);
console.log(`wrote ${join(outDir, 'token-scale-912-fragment.md')}`);
