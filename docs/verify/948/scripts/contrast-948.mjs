#!/usr/bin/env node

// #948 better-colors in-domain measurement (acceptance template v2 item 3, no
// estimating): the overlay/ domain. With per-face CSS cleared, every
// "foreground x actually-rendered base" pair on the domain is computed one by
// one under WCAG 2.x contrast — the kind identity colors of chips/tiles (the
// slot mapping in mention-chip.ts, the provisional canon per #948) are
// composited over the real base as a color-mix 15%/18% tint before measuring;
// text pairs 4.5:1, non-text (icons/status dots) 3:1. Single token source =
// apps/web/src/styles/shadcn.css (the current canon after the #915 value flip),
// computed once per theme.
//
// Output: docs/verify/948/contrast-948.md (human-readable table) + contrast.json
// (machine-readable).
// Ruling: pairs that FAIL are swapped to a consumer-face slot reference per
// ruling 2 in #908 comment-6001887439 (token values stay frozen); rerun this
// script to zero FAILs after the swap.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../..');
// Two token sources: tokens.css (non-color layer + some semantic slots) +
// shadcn.css (the semantic-slot canon). Each file has a :root (dark default)
// and a .light (light) block; shadcn.css loads later and overrides same-name
// slots, so the merge order = tokens first, shadcn second.
const SOURCES = ['tokens.css', 'shadcn.css'].map((f) =>
  readFileSync(resolve(ROOT, 'apps/web/src/styles', f), 'utf8'),
);

/** Parse one theme block (`:root` = dark default, `.light` = light), merged across both sources. */
function parseBlock(selectorRe) {
  const tokens = new Map();
  for (const src of SOURCES) {
    let cursor = 0;
    for (;;) {
      const start = src.slice(cursor).search(selectorRe);
      if (start < 0) break;
      const abs = cursor + start;
      const open = src.indexOf('{', abs);
      let depth = 0;
      let end = open;
      for (let i = open; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const body = src.slice(open + 1, end);
      for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        tokens.set(m[1], m[2].trim());
      }
      cursor = end + 1;
    }
  }
  return tokens;
}

const DARK = parseBlock(/^:root\s*\{/m);
const LIGHT = parseBlock(/^\.light\s*\{/m);

/** Resolve a token value to [r,g,b,a] (supports #hex / rgb() / var() chains). */
function resolveColor(raw, tokens, depth = 0) {
  if (depth > 10) throw new Error(`var chain too deep: ${raw}`);
  const v = raw.trim();
  const varMatch = v.match(/^var\((--[\w-]+)\)$/);
  if (varMatch) {
    const next = tokens.get(varMatch[1]);
    if (next === undefined) throw new Error(`undefined token ${varMatch[1]}`);
    return resolveColor(next, tokens, depth + 1);
  }
  const hex = v.match(/^#([\da-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const hex3 = v.match(/^#([\da-f]{3})$/i);
  if (hex3) {
    const [r, g, b] = hex3[1].split('').map((c) => Number.parseInt(c + c, 16));
    return [r, g, b, 1];
  }
  const rgb = v.match(/^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/);
  if (rgb) {
    const a =
      rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number.parseFloat(rgb[4]) / 100 : Number.parseFloat(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), a];
  }
  // color-mix(in srgb, var(--x) N%, transparent) = x taken at N% alpha (rendering equivalent).
  const mixAlpha = v.match(
    /^color-mix\(in srgb,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*transparent\)$/,
  );
  if (mixAlpha) {
    const base = resolveColor(tokens.get(mixAlpha[1]), tokens, depth + 1);
    return [base[0], base[1], base[2], Number.parseFloat(mixAlpha[2]) / 100];
  }
  // color-mix(in srgb, var(--x) N%, var(--y)) = x pressed onto y at N% (opaque composite).
  const mixOver = v.match(
    /^color-mix\(in srgb,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*var\((--[\w-]+)\)\)$/,
  );
  if (mixOver) {
    const fg = resolveColor(tokens.get(mixOver[1]), tokens, depth + 1);
    const over = resolveColor(tokens.get(mixOver[3]), tokens, depth + 1);
    const mixed = composite(fg, Number.parseFloat(mixOver[2]) / 100, over);
    return [mixed[0], mixed[1], mixed[2], 1];
  }
  throw new Error(`unparsable color: ${v}`);
}

/** Alpha composite: fg pressed onto over at alpha (rendering equivalent of color-mix / rgba bases). */
function composite(fg, alpha, over) {
  return [0, 1, 2].map((i) => fg[i] * alpha + over[i] * (1 - alpha));
}

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Chip face color = solid sealed slot pair (the provisional canon mapping from the mention-chip.ts header note). */
const CHIP_PAIRS = {
  todo: ['--spot-text-on-tint', '--spot-soft'],
  agent: ['--chip-done-fg', '--chip-done-bg'],
  project: ['--tile-orange-fg', '--tile-orange-bg'],
  machine: ['--col-dot-building', '--chip-idle-bg'],
  skill: ['--chip-idle-fg', '--chip-idle-bg'],
  file: ['--chip-idle-fg', '--chip-idle-bg'],
};

/** Tile glyph ink slots (18% tint base, non-text 3:1). */
const KIND_SLOTS = {
  todo: '--spot-text-on-tint',
  skill: '--chip-idle-fg',
  agent: '--col-dot-done',
  project: '--tile-orange-fg',
  machine: '--col-dot-building',
};

const rows = [];

function measure(label, theme, tokens, fgTok, bgTokOrComputed, threshold, kind, note = '') {
  const fg = resolveColor(tokens.get(fgTok), tokens);
  const bg = Array.isArray(bgTokOrComputed)
    ? bgTokOrComputed
    : resolveColor(tokens.get(bgTokOrComputed), tokens);
  const r = ratio(fg.slice(0, 3), bg);
  rows.push({
    label,
    theme,
    fg: fgTok,
    bg: Array.isArray(bgTokOrComputed) ? 'composite' : bgTokOrComputed,
    ratio: Number(r.toFixed(2)),
    threshold,
    pass: r >= threshold,
    kind,
    note,
  });
  return r;
}

for (const [theme, tokens] of [
  ['dark', DARK],
  ['light', LIGHT],
]) {
  // A. mention-chip text pairs: solid sealed slot pairs (independent of the rendered base).
  for (const [kindName, [fgSlot, bgSlot]] of Object.entries(CHIP_PAIRS)) {
    measure(`mention-chip ${kindName}`, theme, tokens, fgSlot, bgSlot, 4.5, 'chip-text');
  }
  // B. picker icon tiles: glyph on 18% tint over popover-bg (non-text 3:1).
  for (const [kindName, slot] of Object.entries(KIND_SLOTS)) {
    if (kindName === 'file') continue; // the tile family has only five kinds
    const fg = resolveColor(tokens.get(slot), tokens);
    const bg = composite(fg, 0.18, resolveColor(tokens.get('--popover-bg'), tokens));
    const r = ratio(fg.slice(0, 3), bg);
    rows.push({
      label: `mention-icon ${kindName}`,
      theme,
      fg: slot,
      bg: '18% tint over --popover-bg',
      ratio: Number(r.toFixed(2)),
      threshold: 3,
      pass: r >= 3,
      kind: 'icon-glyph',
    });
  }
  // C. in-domain text/icon pairs (slot references read directly, no tint).
  measure('insert button brand glyph', theme, tokens, '--card-button', '--popover-bg', 4.5, 'text');
  measure('delete row ink', theme, tokens, '--stop', '--popover-bg', 4.5, 'text');
  {
    // delete row hover: danger-soft 14% tint over popover-bg
    const fg = resolveColor(tokens.get('--stop'), tokens);
    const soft = resolveColor(tokens.get('--danger-soft'), tokens);
    const bg = composite(soft, soft[3], resolveColor(tokens.get('--popover-bg'), tokens));
    const r = ratio(fg.slice(0, 3), bg);
    rows.push({
      label: 'delete row hover (danger-soft tint)',
      theme,
      fg: '--stop',
      bg: '--danger-soft over --popover-bg',
      ratio: Number(r.toFixed(2)),
      threshold: 4.5,
      pass: r >= 4.5,
      kind: 'text',
    });
  }
  measure('menu icon ink', theme, tokens, '--menu-icon', '--popover-bg', 3, 'icon');
  measure('body ink on popover', theme, tokens, '--text-primary', '--popover-bg', 4.5, 'text');
  measure('secondary ink on surface', theme, tokens, '--text-secondary', '--surface', 4.5, 'text');
  measure('tertiary ink on popover', theme, tokens, '--text-tertiary', '--popover-bg', 4.5, 'text');
  // Continue-editing button: the old --text-dim on dialog-bg measured 2.89:1 in
  // light — below even the 3:1 floor the canon keeps for itself (same disease as
  // the #943 notify-banner), so per ruling 2 in #908 it swaps to --muted-foreground.
  measure('continue-editing button ink on dialog', theme, tokens, '--muted-foreground', '--dialog-bg', 4.5, 'text');
  measure('search input ink on inset', theme, tokens, '--text-primary', '--surface-inset', 4.5, 'text');
  // D. veil badge: --text-on-veil on a 55% black veil — worst base = white (image bytes arbitrary).
  {
    const fg = resolveColor(tokens.get('--text-on-veil'), tokens);
    const bg = composite([0, 0, 0], 0.55, [255, 255, 255]);
    const r = ratio(fg.slice(0, 3), bg);
    rows.push({
      label: 'in-flight badge on black veil 55% (worst base=white)',
      theme,
      fg: '--text-on-veil',
      bg: 'rgb(0 0 0 / 0.55) over white',
      ratio: Number(r.toFixed(2)),
      threshold: 4.5,
      pass: r >= 4.5,
      kind: 'text',
    });
  }
  // E. machine status dots (non-text 3:1, on the machine chip's --surface base).
  measure('machine dot online', theme, tokens, '--col-dot-done', '--surface', 3, 'dot');
  measure('machine dot offline', theme, tokens, '--col-dot-idle', '--surface', 3, 'dot');
  // F. project avatar glyph (11px/9px text 4.5).
  measure('project avatar glyph', theme, tokens, '--project-avatar-fg', '--project-avatar-bg', 4.5, 'text');
}

// —— output ————————————————————————————————————————————————
const fails = rows.filter((r) => !r.pass);
let md = `# #948 overlay/ domain contrast measurement (better-colors, acceptance template v2 item 3)

- Tool: \`docs/verify/948/scripts/contrast-948.mjs\` (this directory, rerunnable)
- Single token source: \`apps/web/src/styles/shadcn.css\` (current canon after the #915 value flip)
- Algorithm: WCAG 2.x relative luminance; tint bases = alpha-composited (color-mix rendering equivalent) then measured
- Thresholds: text 4.5:1 (12px/13px regular weight), large text 3:1, non-text (icons/status dots) 3:1
- Pairs: ${rows.length} (dark ${rows.length / 2} / light ${rows.length / 2})
- **FAIL: ${fails.length}**

| Pair | Theme | Foreground slot | Actual base | Measured | Threshold | Result |
| --- | --- | --- | --- | --- | --- | --- |
`;
for (const r of rows) {
  md += `| ${r.label} | ${r.theme} | \`${r.fg}\` | ${r.bg} | ${r.ratio}:1 | ${r.threshold} | ${r.pass ? 'PASS' : '**FAIL**'} |\n`;
}
if (fails.length > 0) {
  md += `\nFAIL handling (ruling 2 in #908): swap the consumer-face slot reference and rerun this script; token values do not move.\n`;
} else {
  md += `\nAll pairs pass the thresholds; the kind identity-color slot mapping (mention-chip.ts header note) is confirmed by measurement.\n`;
}
const out = resolve(import.meta.dirname, '..');
writeFileSync(resolve(out, 'contrast-948.md'), md);
writeFileSync(resolve(out, 'contrast.json'), `${JSON.stringify({ generatedBy: 'contrast-948.mjs', rows }, null, 2)}\n`);
console.log(`rows=${rows.length} fails=${fails.length}`);
for (const f of fails) console.log(`FAIL [${f.theme}] ${f.label}: ${f.ratio}:1 < ${f.threshold} (${f.fg} on ${f.bg})`);
