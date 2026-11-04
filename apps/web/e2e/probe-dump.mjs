#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WEB_DIR = resolve(import.meta.dirname, '..');
const E2E_DIR = join(WEB_DIR, 'e2e');
const REPO_ROOT = resolve(WEB_DIR, '../..');
const INSTRUMENT = join(E2E_DIR, 'probe-dump-instrument.mjs');
const VITE_BIN = join(WEB_DIR, 'node_modules/vite/bin/vite.js');

const VISUAL_MATCHERS = new Set([
  'toBe',
  'toEqual',
  'toBeCloseTo',
  'toContain',
  'toMatch',
  'toBeGreaterThan',
  'toBeGreaterThanOrEqual',
  'toBeLessThan',
  'toBeLessThanOrEqual',
  'toHaveCSS',
]);

// Matchers that are inherently numeric/structural probes in this suite —
// their rows are visual regardless of value shape.
const ALWAYS_VISUAL_MATCHERS = new Set([
  'toEqual',
  'toBeCloseTo',
  'toBeGreaterThan',
  'toBeGreaterThanOrEqual',
  'toBeLessThan',
  'toBeLessThanOrEqual',
  'toHaveCSS',
]);

// Computed-style string values that are probe payloads, not text assertions.
const CSS_TOKENS = new Set([
  'absolute', 'relative', 'static', 'fixed', 'sticky',
  'none', 'auto', 'hidden', 'visible', 'scroll', 'clip',
  'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents',
  'bold', 'bolder', 'lighter', 'normal', 'italic', 'oblique',
  'pointer', 'default', 'text', 'move', 'grab', 'grabbing', 'not-allowed', 'crosshair',
  'ew-resize', 'ns-resize', 'col-resize', 'row-resize',
  'row', 'column', 'wrap', 'nowrap', 'center', 'start', 'end', 'stretch',
  'space-between', 'space-around', 'space-evenly',
  'uppercase', 'lowercase', 'capitalize', 'ellipsis',
  'solid', 'dashed', 'dotted', 'double', 'transparent', 'inherit', 'initial', 'unset',
  'cover', 'contain', 'middle', 'baseline', 'top', 'bottom', 'left', 'right',
  'underline', 'line-through', 'no-wrap', 'border-box', 'content-box', 'padding-box',
]);

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;
const PX_RE = /^-?[\d.]+(?:px|em|rem|%|s|ms|deg|fr|ch|vw|vh)$/;
// Perceptual / non-sRGB spaces cannot fold to rgb without a gamut transform,
// which the #411 contract forbids — these stay violations.
const FORBIDDEN_COLOR_RE = /^(?:oklch|oklab|lab|lch)\(/i;
// Chromium serializes some computed colors (custom-property tokens with
// alpha, wide-gamut values) as `color(<space> c1 c2 c3 / a)`. `color(srgb …)`
// is the rgb space in 0–1 fractions — losslessly foldable to rgba. Any other
// space (display-p3, rec2020, srgb-linear, …) is a violation.
const COLOR_FN_RE = /^color\(\s*([a-z0-9-]+)\s+([^)]+)\)$/i;

// --- CLI -----------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    specs: [],
    port: null,
    out: null,
    ndjson: null,
    skipRun: false,
    workers: '4',
    keepServer: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${a}`);
      return argv[i];
    };
    if (a === '--') continue; // npm-style separator, forwarded verbatim by pnpm (#953)
    if (a === '--specs') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts.specs.push(argv[++i]);
    } else if (a === '--port') opts.port = Number(next());
    else if (a === '--out') opts.out = next();
    else if (a === '--ndjson') opts.ndjson = next();
    else if (a === '--skip-run') opts.skipRun = true;
    else if (a === '--workers') opts.workers = next();
    else if (a === '--keep-server') opts.keepServer = true;
    else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else throw new Error(`unknown flag ${a}`);
  }
  return opts;
}

function usage() {
  process.stderr.write(
    [
      'usage: node e2e/probe-dump.mjs [--specs <name>...] [--port <n>] [--out <dir>]',
      '                               [--ndjson <path>] [--skip-run] [--workers <n>]',
      '                               [--keep-server]',
      '',
    ].join('\n'),
  );
}

// --- static enumeration ----------------------------------------------------------

/**
 * Blank out comments and string/template/regex contents, preserving offsets
 * and newlines, so call-site scanning never matches inside a comment or a
 * selector string. Template `${…}` interpolations stay code — probe
 * callbacks do build template strings from getComputedStyle reads
 * (checkbox-unified.spec.ts), and those are real call sites. Same length
 * and line structure as the input.
 */
function blankNonCode(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let prev = '';
  // Context stack: 'code' (also for interpolations, with a brace depth) and
  // 'template'. Interpolation braces nest; templates nest inside them.
  const stack = [{ ctx: 'code', depth: 0 }];
  const top = () => stack[stack.length - 1];
  const blank = (from, to) => {
    for (let j = from; j < to && j < n; j++) if (out[j] !== '\n') out[j] = ' ';
  };
  while (i < n) {
    const frame = top();
    const c = src[i];
    const c2 = src.slice(i, i + 2);

    if (frame.ctx === 'template') {
      if (c === '\\') {
        blank(i, i + 2);
        i += 2;
        continue;
      }
      if (c2 === '${') {
        stack.push({ ctx: 'code', depth: 0 });
        i += 2;
        continue;
      }
      if (c === '`') {
        stack.pop();
        out[i] = ' ';
        i++;
        prev = '`';
        continue;
      }
      out[i] = c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    // code / interpolation context
    if (c2 === '//') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c2 === '/*') {
      let j = i + 2;
      while (j < n && src.slice(j, j + 2) !== '*/') j++;
      blank(i, Math.min(n, j + 2));
      i = Math.min(n, j + 2);
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) {
          j++;
          break;
        }
        if (src[j] === '\n') break; // unterminated — bail
        j++;
      }
      blank(i, Math.min(j, n));
      i = j;
      prev = c;
      continue;
    }
    if (c === '`') {
      stack.push({ ctx: 'template', depth: 0 });
      out[i] = ' ';
      i++;
      continue;
    }
    if (frame.depth > 0 || stack.length > 1) {
      // Inside an interpolation: its closing brace returns to the template.
      if (c === '{') frame.depth++;
      else if (c === '}') {
        if (frame.depth === 0) {
          stack.pop();
          i++;
          continue;
        }
        frame.depth--;
      }
    }
    if (
      c === '/' &&
      (prev === '' || '=(,:[!&|?{};+-*%~^<>'.includes(prev) || /\s/.test(src[i - 1] ?? ''))
    ) {
      // Regex literal heuristic: only where an expression cannot precede.
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const rc = src[j];
        if (rc === '\\') {
          j += 2;
          continue;
        }
        if (rc === '[') inClass = true;
        else if (rc === ']') inClass = false;
        else if (rc === '\n') break;
        else if (rc === '/' && !inClass) {
          j++;
          while (j < n && /[gimsuyd]/.test(src[j])) j++;
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        blank(i, j);
        i = j;
        prev = '/';
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/** From the '(' at openIdx, return the offset just past its matching ')'. */
function scanBalanced(src, openIdx, cap = 20000) {
  let depth = 0;
  const end = Math.min(src.length, openIdx + cap);
  for (let j = openIdx; j < end; j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return end;
}

const PROBE_CALLBACK_SOURCE = /getComputedStyle|getBoundingClientRect/;

/**
 * Enumerate one spec's probe + assertion sites on comment/string-blanked
 * source. Kinds: 'style' (a getComputedStyle occurrence), 'box' (a
 * .boundingBox() call), 'css' (a .toHaveCSS() call), 'style-evaluate' (an
 * evaluate/evaluateAll/waitForFunction call whose callback reads computed
 * style or client geometry).
 */
function enumerateSpec(file, rawSource) {
  const src = blankNonCode(rawSource);
  const lineOf = (offset) => src.slice(0, offset).split('\n').length;
  const rawLines = rawSource.split('\n');
  const sites = [];

  const scan = (re, onMatch) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) != null) onMatch(m);
  };

  scan(/\bgetComputedStyle\s*\(/g, (m) => {
    sites.push({ file, line: lineOf(m.index), kind: 'style', api: 'getComputedStyle' });
  });
  scan(/\.boundingBox\s*\(/g, (m) => {
    sites.push({ file, line: lineOf(m.index), kind: 'box', api: 'boundingBox' });
  });
  scan(/\.toHaveCSS\s*\(/g, (m) => {
    sites.push({ file, line: lineOf(m.index), kind: 'css', api: 'toHaveCSS' });
  });
  scan(/\.(evaluate|evaluateAll|waitForFunction)\s*\(/g, (m) => {
    const open = m.index + m[0].length - 1;
    const close = scanBalanced(src, open);
    const body = src.slice(open, close);
    if (PROBE_CALLBACK_SOURCE.test(body)) {
      sites.push({ file, line: lineOf(m.index), kind: 'style-evaluate', api: m[1] });
    }
  });

  // Visual-matcher assertion sites: the baseline column's source anchors,
  // used for NOT-RUN detection and the source-context column.
  const assertionSites = [];
  scan(/\.([A-Za-z][A-Za-z0-9]*)\s*\(/g, (m) => {
    const matcher = m[1];
    if (!VISUAL_MATCHERS.has(matcher)) return;
    const back = src.slice(Math.max(0, m.index - 600), m.index);
    if (!/expect\b/.test(back)) return;
    const line = lineOf(m.index);
    assertionSites.push({
      file,
      line,
      matcher,
      negated: /\.not\s*$/.test(back),
      source: (rawLines[line - 1] ?? '').trim(),
    });
  });

  sites.sort((a, b) => a.line - b.line);
  assertionSites.sort((a, b) => a.line - b.line);
  return { file, sites, assertionSites };
}

function listSpecFiles(specFilters) {
  const all = readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort();
  if (specFilters.length === 0) return all;
  const picked = all.filter((f) =>
    specFilters.some((s) => f === s || f === `${s}.spec.ts` || f.includes(s)),
  );
  const unknown = specFilters.filter(
    (s) => !picked.some((f) => f === s || f === `${s}.spec.ts` || f.includes(s)),
  );
  if (unknown.length > 0) throw new Error(`--specs matched nothing for: ${unknown.join(', ')}`);
  return picked;
}

// --- value notation contract (#411) ------------------------------------------------

function parseHex(s) {
  const h = s.slice(1);
  if (h.length === 3 || h.length === 4) {
    return [...h].map((c) => Number.parseInt(c + c, 16));
  }
  if (h.length === 6 || h.length === 8) {
    const parts = [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
    if (h.length === 8) parts.push(Number.parseInt(h.slice(6, 8), 16) / 255);
    return parts;
  }
  return null;
}

/** Parse a `color()` component: a 0–1 float or a percentage → 0–1. */
function parseColorComponent(tok) {
  if (tok == null) return null;
  const t = tok.trim();
  if (t.endsWith('%')) {
    const p = Number.parseFloat(t);
    return Number.isNaN(p) ? null : p / 100;
  }
  const f = Number.parseFloat(t);
  return Number.isNaN(f) ? null : f;
}

/**
 * Parse `color(<space> c1 c2 c3 [/ a])`. Returns { space, rgb:[r,g,b], a }
 * with 0–255 channels when the space is srgb (lossless fold), else null for
 * the rgb payload (space named so the caller can flag non-srgb as violation).
 */
function parseColorFn(s) {
  const m = COLOR_FN_RE.exec(s);
  if (m == null) return null;
  const space = m[1].toLowerCase();
  const [compPart, alphaPart] = m[2].split('/');
  const comps = (compPart ?? '').trim().split(/\s+/).map(parseColorComponent);
  const a = alphaPart != null ? parseColorComponent(alphaPart) : 1;
  if (comps.length < 3 || comps.some((c) => c == null) || a == null) {
    return { space, rgb: null, a: null };
  }
  if (space !== 'srgb') return { space, rgb: null, a };
  return {
    space,
    rgb: [
      Math.round(comps[0] * 255),
      Math.round(comps[1] * 255),
      Math.round(comps[2] * 255),
    ],
    a,
  };
}

/**
 * Normalize one leaf value per the #411 contract. Returns
 * { display, color, violation, note }: display is the canonical rgb/hex form
 * for colors (hex and color(srgb) both fold to rgb so old/new compare in one
 * notation), px strings keep their unit. `note` records a non-canonical
 * source notation that was folded (re-pin should write the folded form);
 * `violation` names a notation the contract forbids and cannot fold
 * (oklch/lab/lch, color() in a non-sRGB space) — flagged, never converted.
 */
function normalizeValue(v) {
  if (typeof v === 'number') return { display: String(v), color: null, violation: null, note: null };
  if (typeof v !== 'string') {
    return { display: v == null ? String(v) : JSON.stringify(v), color: null, violation: null, note: null };
  }
  const s = v.trim();
  if (FORBIDDEN_COLOR_RE.test(s)) {
    return {
      display: s,
      color: null,
      violation: 'notation contract (#411): forbidden color space, expected rgb/hex',
      note: null,
    };
  }
  const cfn = parseColorFn(s);
  if (cfn != null) {
    if (cfn.rgb == null) {
      return {
        display: s,
        color: null,
        violation: `notation contract (#411): color(${cfn.space}) is not rgb/hex and not losslessly foldable`,
        note: null,
      };
    }
    const [r, g, b] = cfn.rgb;
    const a = cfn.a;
    const display = a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round4(a)})`;
    return {
      display,
      color: [r, g, b, a],
      violation: null,
      note: `color(srgb …) folded to ${display}; re-pin the spec to the rgb/hex form (#411)`,
    };
  }
  if (HEX_RE.test(s)) {
    const parts = parseHex(s);
    if (parts != null) {
      const [r, g, b, a] = parts;
      const display = a == null ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round4(a)})`;
      return { display, color: [r, g, b, a ?? 1], violation: null, note: null };
    }
  }
  const rgb = RGB_RE.exec(s);
  if (rgb != null) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    const a = rgb[4] == null ? 1 : Number(rgb[4]);
    const display = a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round4(a)})`;
    return { display, color: [r, g, b, a], violation: null, note: null };
  }
  return { display: s, color: null, violation: null, note: null };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function normalizeDeep(v) {
  if (Array.isArray(v)) return v.map(normalizeDeep);
  if (v != null && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = normalizeDeep(x);
    return out;
  }
  // Keep numbers as numbers so old/new render in identical notation (a
  // getBoundingClientRect box is {w:16,h:16}, not {w:"16",h:"16"}); fold
  // colors and pass other strings through normalizeValue.
  if (typeof v === 'number') return v;
  return normalizeValue(v).display;
}

function findViolation(...values) {
  for (const v of values) {
    const leaves = Array.isArray(v) ? v : [v];
    for (const leaf of leaves) {
      const viol = normalizeValue(leaf).violation;
      if (viol != null) return viol;
    }
  }
  return null;
}

/** Classify whether a row's values are visual probe payloads. */
function looksVisual(matcher, oldV, newV) {
  if (ALWAYS_VISUAL_MATCHERS.has(matcher)) return true;
  for (const v of [oldV, newV]) {
    const leaves = Array.isArray(v) ? v : [v];
    for (const leaf of leaves) {
      if (typeof leaf === 'number') return true;
      if (typeof leaf !== 'string') continue;
      const s = leaf.trim();
      if (RGB_RE.test(s) || HEX_RE.test(s) || PX_RE.test(s)) return true;
      if (CSS_TOKENS.has(s)) return true;
      if (/^\d+(\.\d+)?$/.test(s)) return true; // unitless numeric strings (fontWeight, zIndex)
      if (/rgba?\(/.test(s) || /#[0-9a-f]{3,8}/i.test(s)) return true; // regex literals over colors
    }
  }
  return false;
}

// --- records ------------------------------------------------------------------------

function readRecords(path) {
  if (!existsSync(path)) return [];
  const records = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A torn final line (worker killed mid-append) must not lose the dump.
    }
  }
  return records;
}

// --- row building ---------------------------------------------------------------------

function formatOld(matcher, e) {
  const args = Array.isArray(e) ? e : [e];
  const norm = (x) => normalizeValue(x).display;
  if (matcher === 'toHaveCSS') return `${norm(args[0])}: ${norm(args[1])}`;
  if (matcher === 'toBeCloseTo') {
    const precision = args[1] == null ? 2 : args[1];
    return `${norm(args[0])} ±${0.5 * 10 ** -precision}`;
  }
  if (matcher === 'toBeGreaterThanOrEqual') return `≥ ${norm(args[0])}`;
  if (matcher === 'toBeGreaterThan') return `> ${norm(args[0])}`;
  if (matcher === 'toBeLessThanOrEqual') return `≤ ${norm(args[0])}`;
  if (matcher === 'toBeLessThan') return `< ${norm(args[0])}`;
  if (args.length === 1) {
    const a0 = args[0];
    // Object baselines (toEqual on a probe box/face) go through normalizeDeep
    // so colors fold and numbers stay numbers — identical to formatNew.
    return a0 != null && typeof a0 === 'object' ? JSON.stringify(normalizeDeep(a0)) : norm(a0);
  }
  return JSON.stringify(args.map((a) => normalizeDeep(a)));
}

function formatNew(matcher, v) {
  if (v != null && typeof v === 'object') return JSON.stringify(normalizeDeep(v));
  return normalizeValue(v).display;
}

/** First notation note (folded color(srgb)) across a row's old/new leaves. */
function collectNote(...values) {
  for (const v of values) {
    const leaves = Array.isArray(v) ? v.flat(2) : [v];
    for (const leaf of leaves) {
      const note = normalizeValue(leaf).note;
      if (note != null) return note;
    }
  }
  return null;
}

/**
 * expect.poll(cb).toBe(x) hands the matcher the callback, not its result —
 * the measured value lives on the probe record from inside the poll body,
 * a few lines above the terminal matcher call. Take the nearest one within
 * the same test.
 */
function pollMeasured(rec, probeRecords) {
  let best = null;
  for (const p of probeRecords) {
    if (p.f !== rec.f || p.p === 'wait' || p.v == null) continue;
    if (rec.tt != null && p.tt != null && p.tt !== rec.tt) continue;
    if (p.l < rec.l - 15 || p.l > rec.l + 2) continue;
    if (best == null || p.l > best.l) best = p;
  }
  return best == null ? null : best.v;
}

/**
 * Best-effort baseline literal from a NOT-RUN assertion's source line: the
 * first matcher argument when it is a plain string/number literal. Returns
 * null for anything computed — the reviewer reads the spec line itself.
 */
function staticBaselineLiteral(matcher, sourceLine) {
  const re = new RegExp(
    `\\.${matcher}\\s*\\(\\s*(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`|(-?[\\d.]+))\\s*[,)]`,
  );
  const m = re.exec(sourceLine);
  if (m == null) return null;
  return m[1] ?? m[2] ?? m[3] ?? (m[4] != null ? Number(m[4]) : null);
}

function makeRow(site, rec, ctx) {
  let measured = rec.v;
  if (rec.m === 'toHaveCSS') {
    // v is the Locator identity; the received CSS arrives on the w channel.
    // On a pass, received == expected, so the expected value is the measure.
    const ws = ctx.cssReceived.get(`${rec.tt ?? ''}|${(rec.e ?? [])[0] ?? ''}`) ?? [];
    const w = ws.find((x) => x.r === 'fail') ?? ws[ws.length - 1];
    measured = w != null && w.v != null ? w.v : rec.r === 'pass' ? (rec.e ?? [])[1] : null;
  } else if (measured != null && typeof measured === 'object' && measured.__fn != null) {
    const polled = pollMeasured(rec, ctx.probeRecords);
    if (polled != null) measured = polled;
  }

  const violation = findViolation(rec.e, measured);
  const note = collectNote(rec.e, measured);
  let status;
  if (violation != null) status = 'VIOLATION';
  else if (rec.r === 'pass') status = rec.n === true ? 'KEPT (negated)' : 'KEPT';
  else if (rec.r === 'fail') status = 'DRIFT';
  else status = 'PENDING';

  return {
    file: site.file,
    line: site.line,
    matcher: rec.m,
    negated: rec.n === true,
    source: site.source || (ctx.sourceLines.get(site.file) ?? [])[site.line - 1]?.trim() || '',
    testTitle: rec.tt ?? null,
    old: formatOld(rec.m, rec.e),
    new: formatNew(rec.m, measured),
    status,
    violation,
    note,
    rawOld: rec.e ?? null,
    rawNew: measured ?? null,
  };
}

/**
 * Build comparison rows: static assertion sites are the backbone (source
 * order, NOT-RUN detection); runtime records supply baseline + measured +
 * status, joined on (file, line). Loop-generated duplicates (a themed test
 * running the same line per theme) each get a row.
 */
function buildRows(records, enumerations, sourceLines) {
  const probeRecords = records.filter((r) => r.k === 'p');
  const assertsByLine = new Map();
  for (const rec of records) {
    if (rec.k !== 'a' || rec.f == null || rec.l == null) continue;
    const key = `${rec.f}:${rec.l}`;
    const list = assertsByLine.get(key) ?? [];
    list.push(rec);
    assertsByLine.set(key, list);
  }
  const cssReceived = new Map();
  for (const rec of records) {
    if (rec.k !== 'w') continue;
    const key = `${rec.tt ?? ''}|${rec.prop ?? ''}`;
    const list = cssReceived.get(key) ?? [];
    list.push(rec);
    cssReceived.set(key, list);
  }
  const ctx = { probeRecords, cssReceived, sourceLines };

  const rows = [];
  const joinedKeys = new Set();
  for (const en of enumerations) {
    for (const site of en.assertionSites) {
      const key = `${site.file}:${site.line}`;
      const recs = assertsByLine.get(key);
      if (recs == null || recs.length === 0) {
        const literal = staticBaselineLiteral(site.matcher, site.source);
        rows.push({
          file: site.file,
          line: site.line,
          matcher: site.matcher,
          negated: site.negated,
          source: site.source,
          testTitle: null,
          old: literal != null ? normalizeValue(literal).display : '(see spec line)',
          new: null,
          status: 'NOT-RUN',
          violation: findViolation(literal),
          note: collectNote(literal),
          rawOld: literal,
          rawNew: null,
        });
        joinedKeys.add(key);
        continue;
      }
      joinedKeys.add(key);
      // Terminal records win over the 'pending' placeholder of web-first
      // matchers; one row per distinct test title (themed loops).
      const terminal = recs.filter((r) => r.r === 'pass' || r.r === 'fail');
      const pool = terminal.length > 0 ? terminal : recs;
      const byTitle = new Map();
      for (const r of pool) {
        const t = r.tt ?? '';
        const prev = byTitle.get(t);
        if (prev == null || (prev.r === 'fail' && r.r === 'pass')) byTitle.set(t, r);
        else if (prev.r !== 'fail' && r.r === 'fail') byTitle.set(t, r);
      }
      for (const rec of byTitle.values()) rows.push(makeRow(site, rec, ctx));
    }
  }
  // Runtime records with no static anchor (stack line vs scan line drift,
  // dynamically built assertions): keep them, source column from the file.
  for (const [key, recs] of assertsByLine) {
    if (joinedKeys.has(key)) continue;
    const rec = recs.find((r) => r.r === 'pass' || r.r === 'fail') ?? recs[recs.length - 1];
    const [file, lineStr] = [rec.f, rec.l];
    rows.push(
      makeRow(
        {
          file,
          line: Number(lineStr),
          source: (sourceLines.get(file) ?? [])[Number(lineStr) - 1]?.trim() ?? '',
        },
        rec,
        ctx,
      ),
    );
  }
  rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return rows;
}

// --- outputs ---------------------------------------------------------------------------

function countStatus(rows) {
  const counts = { kept: 0, drift: 0, notRun: 0, violation: 0, other: 0 };
  for (const r of rows) {
    if (r.status.startsWith('KEPT')) counts.kept++;
    else if (r.status === 'DRIFT') counts.drift++;
    else if (r.status === 'NOT-RUN') counts.notRun++;
    else if (r.status === 'VIOLATION') counts.violation++;
    else counts.other++;
  }
  return counts;
}

function escapeMd(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function cell(v) {
  if (v == null) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return escapeMd(s.length > 110 ? `${s.slice(0, 110)}…` : s);
}

function renderMarkdown(meta, coverage, rows) {
  const counts = countStatus(rows);
  const L = [];
  L.push('# Probe dump — old baseline → new measured (#921)');
  L.push('');
  L.push(`Run ${meta.date} · commit \`${meta.commit}\` · port ${meta.port} · playwright ${meta.playwrightVersion} · workers ${meta.workers}`);
  L.push('');
  L.push(`Specs: ${meta.specs.length === 0 ? 'all' : meta.specs.join(' ')} (${meta.specCount} files) · tests ${meta.testsPassed} passed / ${meta.testsFailed} failed`);
  L.push('');
  L.push('## Coverage');
  L.push('');
  L.push('Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).');
  L.push('');
  L.push('| probe surface | enumerated | collected |');
  L.push('| --- | --- | --- |');
  L.push(`| getComputedStyle occurrences (headline count) | ${coverage.styleOccurrences} | — (captured per evaluate call below) |`);
  L.push(`| probe-carrying evaluate/waitForFunction call sites | ${coverage.evaluateProbeSites} | ${coverage.collectedStyleSites} |`);
  L.push(`| .boundingBox() call sites | ${coverage.boxSites} | ${coverage.collectedBoxSites} |`);
  L.push(`| .toHaveCSS() call sites | ${coverage.cssSites} | ${coverage.collectedCssSites} |`);
  L.push(`| visual-matcher assertion sites | ${coverage.assertionSites} | ${coverage.joinedAssertionSites} joined |`);
  L.push('');
  L.push(`Comparison rows: ${rows.length} — KEPT ${counts.kept}, DRIFT ${counts.drift}, NOT-RUN ${counts.notRun}, VIOLATION ${counts.violation}, other ${counts.other}.`);
  L.push('');
  L.push(
    'Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.',
  );
  L.push('');

  const section = (list, title, note) => {
    if (list.length === 0) return;
    L.push(`## ${title} (${list.length})`);
    if (note != null) {
      L.push('');
      L.push(note);
    }
    L.push('');
    L.push('| spec | line | matcher | old baseline | new measured | note | test |');
    L.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of list) {
      L.push(
        `| ${r.file} | ${r.line} | ${r.negated ? `not.${r.matcher}` : r.matcher} | ${cell(r.old)} | ${cell(r.new)} | ${cell(r.note ?? r.violation)} | ${escapeMd(r.testTitle ?? '')} |`,
      );
    }
    L.push('');
  };

  section(
    rows.filter((r) => r.status === 'VIOLATION'),
    'VIOLATION — #411 notation contract breach',
  );
  section(
    rows.filter((r) => r.status === 'DRIFT'),
    'DRIFT — baseline no longer holds; classify each row',
    'Expected drift → re-pin the spec value to “new measured”. Suspected regression → fix the code, keep the baseline.',
  );
  section(
    rows.filter((r) => r.status === 'PENDING'),
    'PENDING — outcome unresolved at record time',
  );
  section(
    rows.filter((r) => r.status === 'NOT-RUN'),
    'NOT-RUN — no runtime record for this assertion site',
  );
  section(rows.filter((r) => r.status.startsWith('KEPT')), 'KEPT — baseline holds on this build');
  return L.join('\n');
}

// --- run orchestration -------------------------------------------------------------------

function portFree(port) {
  const res = spawnSync('lsof', ['-iTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return res.status !== 0;
}

function choosePort(explicit) {
  if (explicit != null && !Number.isNaN(explicit)) {
    if (!portFree(explicit)) {
      throw new Error(
        `port ${explicit} is occupied by another lane — refusing to run against it (never kill it; pick another with --port)`,
      );
    }
    return explicit;
  }
  const candidates = [
    process.env.E2E_PROBE_PORT != null && process.env.E2E_PROBE_PORT !== ''
      ? Number(process.env.E2E_PROBE_PORT)
      : null,
    process.env.E2E_PORT != null && process.env.E2E_PORT !== '' ? Number(process.env.E2E_PORT) : null,
    8397,
    ...Array.from({ length: 10 }, (_, i) => 8401 + i),
  ].filter((p) => p != null && !Number.isNaN(p));
  for (const p of candidates) if (portFree(p)) return p;
  throw new Error('no free port among candidates (8397, 8401-8410)');
}

/**
 * Env for child processes: proxies stripped (loopback 502s otherwise), lane
 * port pinned. ndjsonPath=null is for the vite build/preview processes — the
 * dump-file marker stays unset there so the inherited preload (if any) is
 * inert by its own guard; only the playwright run records.
 */
function baseEnv(port, ndjsonPath) {
  const env = { ...process.env };
  for (const k of [
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
  ]) {
    delete env[k];
  }
  env.NO_PROXY = 'localhost,127.0.0.1';
  env.E2E_PORT = String(port);
  if (ndjsonPath == null) delete env.CAIRN_PROBE_DUMP_FILE;
  else env.CAIRN_PROBE_DUMP_FILE = ndjsonPath;
  return env;
}

async function urlServing(url, timeoutMs = 1500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await urlServing(url, 2000)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

/** Build the fixture bundle and serve it, so NODE_OPTIONS never reaches vite. */
async function startStack(port, logFd) {
  const url = `http://127.0.0.1:${port}/app`;
  process.stdout.write('probe-dump: building fixture bundle…\n');
  const build = spawnSync(process.execPath, [VITE_BIN, 'build', '--mode', 'fixture'], {
    cwd: WEB_DIR,
    env: baseEnv(port, null),
    stdio: ['ignore', logFd, logFd],
  });
  if (build.status !== 0) throw new Error('fixture build failed (see probe-run.log)');
  const preview = spawn(process.execPath, [VITE_BIN, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: WEB_DIR,
    env: baseEnv(port, null),
    stdio: ['ignore', logFd, logFd],
  });
  preview.on('exit', (code, signal) => {
    // The tool SIGTERMs its own preview on teardown; that is expected, not a
    // crash. Only an unprompted non-zero exit is worth surfacing.
    if (preview.__killing) return;
    if (code !== 0 && code !== null) {
      process.stderr.write(
        `probe-dump: vite preview exited ${code}${signal != null ? ` (${signal})` : ''} (see probe-run.log)\n`,
      );
    }
  });
  await waitForUrl(url, 60_000, 'vite preview');
  process.stdout.write(`probe-dump: fixture stack serving on ${url}\n`);
  return preview;
}

function runPlaywright(specs, port, ndjsonPath, workers, logFd) {
  const args = ['exec', 'playwright', 'test', ...specs, `--workers=${workers}`, '--reporter=line'];
  process.stdout.write(
    `probe-dump: playwright test ${specs.length > 0 ? specs.join(' ') : '(all specs)'} on ${port}\n`,
  );
  const env = baseEnv(port, ndjsonPath);
  const importFlag = `--import ${INSTRUMENT}`;
  env.NODE_OPTIONS =
    env.NODE_OPTIONS != null && env.NODE_OPTIONS !== ''
      ? `${env.NODE_OPTIONS} ${importFlag}`
      : importFlag;
  const res = spawnSync('pnpm', args, {
    cwd: WEB_DIR,
    env,
    stdio: ['ignore', logFd, logFd],
  });
  return res.status ?? 1;
}

function parseRunStats(log) {
  const passed = /(\d+) passed/.exec(log);
  const failed = /(\d+) failed/.exec(log);
  return {
    testsPassed: passed != null ? Number(passed[1]) : 0,
    testsFailed: failed != null ? Number(failed[1]) : 0,
  };
}

// --- main ----------------------------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`probe-dump: ${err.message}\n`);
    usage();
    process.exit(2);
  }
  const require = createRequire(import.meta.url);
  const playwrightVersion = require('@playwright/test/package.json').version;
  const commit =
    spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .stdout?.trim() || 'unknown';

  const outDir =
    opts.out != null
      ? resolve(process.cwd(), opts.out)
      : join(tmpdir(), `probe-dump-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(outDir, { recursive: true });
  const ndjsonPath =
    opts.ndjson != null ? resolve(process.cwd(), opts.ndjson) : join(outDir, 'probe-records.ndjson');
  const logPath = join(outDir, 'probe-run.log');

  const specFiles = listSpecFiles(opts.specs);
  if (specFiles.length === 0) throw new Error('--specs matched no spec files');

  // Static enumeration + source lines (context column, NOT-RUN anchors).
  const enumerations = [];
  const sourceLines = new Map();
  const coverage = {
    styleOccurrences: 0,
    boxSites: 0,
    cssSites: 0,
    evaluateProbeSites: 0,
    assertionSites: 0,
  };
  for (const f of specFiles) {
    const raw = readFileSync(join(E2E_DIR, f), 'utf8');
    sourceLines.set(f, raw.split('\n'));
    const en = enumerateSpec(f, raw);
    enumerations.push(en);
    coverage.assertionSites += en.assertionSites.length;
    for (const s of en.sites) {
      if (s.kind === 'style') coverage.styleOccurrences++;
      else if (s.kind === 'box') coverage.boxSites++;
      else if (s.kind === 'css') coverage.cssSites++;
      else if (s.kind === 'style-evaluate') coverage.evaluateProbeSites++;
    }
  }

  let runStats = { testsPassed: 0, testsFailed: 0 };
  let port = 'skip-run';
  if (!opts.skipRun) {
    port = choosePort(opts.port);
    rmSync(ndjsonPath, { force: true });
    writeFileSync(logPath, '');
    const logFd = openSync(logPath, 'a');
    let preview = null;
    const killPreview = () => {
      if (preview != null) {
        preview.__killing = true;
        preview.kill('SIGTERM');
        preview = null;
      }
    };
    const exitKill = () => {
      if (!opts.keepServer) killPreview();
    };
    process.on('exit', exitKill);
    try {
      const stackUrl = `http://127.0.0.1:${port}/app`;
      if (await urlServing(stackUrl)) {
        process.stdout.write(`probe-dump: reusing existing stack on ${stackUrl}\n`);
      } else {
        preview = await startStack(port, logFd);
      }
      const status = runPlaywright(specFiles, port, ndjsonPath, opts.workers, logFd);
      runStats = parseRunStats(readFileSync(logPath, 'utf8'));
      process.stdout.write(
        `probe-dump: playwright exited ${status} — ${runStats.testsPassed} passed, ${runStats.testsFailed} failed\n`,
      );
      if (preview != null && opts.keepServer) {
        process.stdout.write(`probe-dump: preview left running on ${port} (--keep-server)\n`);
      } else {
        killPreview();
      }
    } finally {
      process.removeListener('exit', exitKill);
      if (!opts.keepServer) killPreview();
    }
  } else {
    process.stdout.write(`probe-dump: --skip-run, tabulating ${ndjsonPath}\n`);
  }

  const records = readRecords(ndjsonPath);
  const probeRecords = records.filter((r) => r.k === 'p');
  const assertRecords = records.filter((r) => r.k === 'a');
  const cssRecords = records.filter((r) => r.k === 'w');
  const distinct = (list) => new Set(list.map((r) => `${r.f}:${r.l}`)).size;
  coverage.collectedStyle = probeRecords.filter((r) => r.p === 'style').length;
  coverage.collectedBox = probeRecords.filter((r) => r.p === 'box').length;
  coverage.collectedWait = probeRecords.filter((r) => r.p === 'wait').length;
  coverage.collectedCss = cssRecords.length;
  coverage.collectedStyleSites = distinct(probeRecords.filter((r) => r.p === 'style'));
  coverage.collectedBoxSites = distinct(probeRecords.filter((r) => r.p === 'box'));
  // The k='w' (_expect) records run inside playwright's detached async retry
  // loop and carry no reliable spec line; count distinct toHaveCSS assertion
  // sites instead — the k='a' records are captured at the synchronous
  // .toHaveCSS() call, so their file:line is exact.
  coverage.collectedCssSites = distinct(assertRecords.filter((r) => r.m === 'toHaveCSS'));
  coverage.assertionRecords = assertRecords.length;

  const rows = buildRows(records, enumerations, sourceLines);
  coverage.joinedAssertionSites = rows.filter((r) => r.status !== 'NOT-RUN').length;
  // NOT-RUN rows have no runtime values to classify — fall back to the
  // matcher family and the source line's literal shape.
  const visualRows = rows.filter((r) =>
    r.status === 'NOT-RUN'
      ? ALWAYS_VISUAL_MATCHERS.has(r.matcher) || looksVisual(r.matcher, r.rawOld, r.source)
      : looksVisual(r.matcher, r.rawOld, r.rawNew),
  );

  const meta = {
    tool: 'probe-dump',
    ticket: 921,
    date: new Date().toISOString(),
    commit,
    port,
    specs: opts.specs,
    specCount: specFiles.length,
    playwrightVersion,
    workers: opts.skipRun ? 'skip-run' : opts.workers,
    ...runStats,
  };

  const dump = {
    meta,
    coverage,
    probeSites: enumerations.flatMap((e) => e.sites),
    probeValues: probeRecords,
    assertions: rows,
    webFirstCss: cssRecords,
  };
  writeFileSync(join(outDir, 'probe-dump.json'), `${JSON.stringify(dump, null, 2)}\n`);
  writeFileSync(join(outDir, 'probe-comparison.md'), renderMarkdown(meta, coverage, visualRows));

  const counts = countStatus(visualRows);
  process.stdout.write(
    [
      `probe-dump: enumerated — getComputedStyle ${coverage.styleOccurrences}, boundingBox ${coverage.boxSites}, toHaveCSS ${coverage.cssSites}, probe-evaluate ${coverage.evaluateProbeSites}, assertion sites ${coverage.assertionSites}`,
      `probe-dump: collected — style sites ${coverage.collectedStyleSites} (${coverage.collectedStyle} records), box sites ${coverage.collectedBoxSites} (${coverage.collectedBox} records), css ${coverage.collectedCss}, assertions ${coverage.assertionRecords}`,
      `probe-dump: visual rows ${visualRows.length} (all rows ${rows.length}) — KEPT ${counts.kept}, DRIFT ${counts.drift}, NOT-RUN ${counts.notRun}, VIOLATION ${counts.violation}, other ${counts.other}`,
      `probe-dump: wrote ${join(outDir, 'probe-dump.json')}`,
      `probe-dump: wrote ${join(outDir, 'probe-comparison.md')}`,
    ].join('\n'),
  );
}

main().catch((err) => {
  process.stderr.write(`probe-dump: ${err?.stack ?? err}\n`);
  process.exit(1);
});
