#!/usr/bin/env node

// Dead class-name gate (#1036). When #950 retired chief.css it left the
// class names behind in TSX: names that match zero rules in any living
// stylesheet. Nothing errors, no CI turns red, the layout just silently
// collapses (#1033 avatar, #1034 transcript row were the two caught by a
// human eye). This gate makes the defect class machine-visible: extract
// every class token the app can put on the DOM, diff against the living
// selector universe, and red-flag any token that matches zero rules and
// carries no selector reference anywhere in the test corpus.
//
// Living selector universe (both halves are required — either alone leaks):
//   compiled CSS   Tailwind only generates rules for utilities it finds in
//                  the source scan, so any token that is a valid utility is
//                  alive by construction. The compiled sheet is taken from
//                  an existing apps/web/dist (--dist / auto-detected) or,
//                  with no dist, compiled on the spot through
//                  @tailwindcss/postcss (~0.5s, needs node_modules).
//   source CSS     every `.name` selector and `@utility name` in
//                  apps/web/src/**/*.css — the hand-written carrier layer
//                  (styles/app.css @utility blocks, shadcn.css, motion.css).
//
// Extraction surface (where a class token can be born):
//   A  JSX attributes `class` / `className` / any `*ClassName` prop —
//      string literals, template quasis, and literals inside balanced
//      expression containers (cn(...), ternaries, &&, ??).
//   B  `*_CLS` / `*_CLASS` / `*_CLASSES` constant initializers — the
//      recipe-constant pattern (chief/recipes.ts, resources/parts.tsx)
//      whose values reach the DOM through className references.
//   C  class-list-shaped string literals ANYWHERE else — consts like
//      `quoteSkin` that reach className through `${…}` interpolation,
//      invisible to A and B. Qualifying shape: >= 2 all-lowercase ASCII
//      tokens, >= 50% of them living selectors, >= 1 dead. The ratio floor
//      keeps SVG path data and route strings out; the lowercase rule keeps
//      prose out ('Clear {name} filter'); src/i18n/* dictionary files are
//      skipped wholesale — translation values never render as classes.
//   Not extracted, deliberately:
//     - comparison/enum operands (`variant === 'link'`, `case 'chart'`,
//       `status.includes('open')`) — lookup keys and state values, never
//       rendered as classes;
//     - object-literal keys, and brace-nested literals that do not look
//       like class lists (no space/hyphen) — keeps cva({variant:'link'})
//       lookups out while cva class values stay in;
//     - variant-lookup call values (`buttonVariants({ size: 'icon-sm' })`)
//       whose literal is a key harvested from a cva config — lookup keys,
//       not rendered classes (#1178; a bogus value like 'nope-x' is not in
//       the key set and is still extracted);
//     - tokens touching a template interpolation (`chief-${kind}`) — the
//       runtime name is unknowable statically;
//     - non-ASCII tokens and tokens with backslashes — CSS class names in
//       this repo are ASCII; this keeps regex-class constants
//       (`DEFAULT_BOUNDARY_CLASS = '\\s。、？！'`) and prose out;
//     - Tailwind structural markers `group`, `peer`, `group/name`,
//       `peer/name`, `@container/name` — zero rules BY DESIGN (they are
//       variant targets, not stylesheet subjects);
//     - files frozen pristine in scripts/ui-registry.json — vendored
//       upstream code, hash-pinned by ui-registry-gate; its class
//       vocabulary belongs to the upstream contract (adapters and deviated
//       files ARE scanned — the repo owns those).
//   cva strings are pure utilities under drift-gate G5 anyway, and
//   utilities cannot be dead: Tailwind generates from the same corpus this
//   gate reads.
//
// Parsing note: hand-rolled lexer (stripComments + scanContainer below),
// NOT ui-normalize's stripCodeComments — that one is a hash-normalizer with
// a `{/*…*/}` regex that, run over a plain .ts spec, once swallowed 84% of
// the file (measured) and hid real selectors. This lexer is string-,
// template- and regex-literal aware, preserves line numbers, and the
// fail-closed token floor below catches any future lexer regression that
// would shrink the scan silently.
//
// Dispositions for a zero-rule name (the ticket's three choices):
//   selector-exempt  referenced in CSS-selector form (`.name`,
//                    `[class*=name]`, toHaveClass) inside a string/regex
//                    literal of the test corpus (apps/web/e2e,
//                    apps/web/test, integration/test, scripts/,
//                    .claude/skills/verify-pacman/scripts) or inside a src
//                    DOM-selector API call (querySelector/closest/matches).
//                    The index is rebuilt every run, so this ledger cannot
//                    go stale.
//   manual-exempt    EXEMPTIONS below, each with a reason; an entry whose
//                    name stops occurring in the scan turns the gate red
//                    (stale ledger — same stance as ui-drift-gate G6).
//   DEAD (red)       zero rules AND zero references: silent dead weight —
//                    delete the token or reconnect it to the post-#950
//                    primitive (chief/recipes.ts, components/chat live-row).
//
// Fail-closed housekeeping: an empty source scan, a token count under the
// floor, a too-small selector universe, or an unusable compiled sheet all
// exit 2 — a broken gate must never pass silently (same stance as
// ui-debt-gate D4).
//
// Usage:
//   node scripts/ui-dead-class-gate.mjs             # dist if present, else compile
//   node scripts/ui-dead-class-gate.mjs --dist <dir># force a built dist to read
//   node scripts/ui-dead-class-gate.mjs --compile   # force fresh postcss compile
//   node scripts/ui-dead-class-gate.mjs --audit     # print the FULL zero-hit
//                                                   # inventory with dispositions
//
// Exit codes: 0 = every rendered class token matches a living rule or carries
// a disposition, 1 = dead classes or stale exemptions found, 2 = operational
// error (missing deps, no dist and no compile, empty/shrunken scan).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_DIR = join(REPO_ROOT, 'apps/web');
const SRC_DIR = join(WEB_DIR, 'src');
const DIST_DIR = join(WEB_DIR, 'dist');
const rel = (p) => relative(REPO_ROOT, p);

// Fail-closed floor: the 2026-10-09 tree yields ~6.4k class-token
// occurrences; a lexer regression that starts swallowing code would shrink
// the scan silently, so anything under half the measured count is an
// operational error, not a pass.
const TOKEN_COUNT_FLOOR = 3000;

// Zero-rule names kept on purpose WITHOUT a code-level selector reference.
// Every entry needs a reason; the gate reds out an entry whose class stops
// occurring in the scan (stale ledger).
const EXEMPTIONS = [
  {
    name: 'chief-msg',
    reason:
      'e2e row anchor kept by #1033: specs address rows through the same-named chief-msg testid; the skin lives on the MSG_ROW_CLS utilities rendered beside the name.',
  },
  {
    name: 'chat-text',
    reason:
      'e2e body-text anchor kept by #1034: chat-type-measure.spec.ts documents the probe migration off the `.chat-text` rule text; the name stays as the transcript body hook, skin lives on inline utilities.',
  },
  {
    name: 'doc-code',
    reason:
      'CODE_SKIN map key in detail/segments.tsx: codeClassName selects the chip skin (CODE_SKIN[codeClassName]) and seeds the <key>--link variant; the rendered class is the chip identity hook, the skin lives on the map value utilities.',
  },
];

// ---------------------------------------------------------------------------
// lexer: comment stripping + string/template scanning
// ---------------------------------------------------------------------------

/** Strip comments, preserving offsets and line numbers (comment bodies
 *  become spaces, their newlines survive). String, template and regex
 *  literals are copied verbatim — a `//` inside `'http://x'` or /a\/\/b/
 *  is not a comment. JSX text is not lexed (apostrophes/URLs in raw JSX
 *  text could confuse the code-mode lexer); this repo renders copy through
 *  t('…') string literals, so the exposure is negligible and the token
 *  floor below bounds the damage. */
function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  // last non-whitespace char emitted in code mode — drives regex detection
  let prev = '';
  const regexAllowed = () => prev === '' || '(,=:[!&|?{};+-*%^~<>'.includes(prev) || prev === '}';
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      // regex literal: copy verbatim; '[' starts a class where '/' is inert
      out += c;
      i++;
      let inClass = false;
      for (; i < n; i++) {
        const r = text[i];
        out += r;
        if (r === '\\') {
          i++;
          if (i < n) out += text[i];
          continue;
        }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
        else if (r === '\n') break; // unterminated — not a regex after all
      }
      i++; // flags
      while (i < n && /[a-z]/.test(text[i])) {
        out += text[i];
        i++;
      }
      prev = '/';
      continue;
    }
    if (c === '"' || c === "'") {
      out += c;
      i++;
      for (; i < n; i++) {
        out += text[i];
        if (text[i] === '\\') {
          i++;
          if (i < n) out += text[i];
          continue;
        }
        if (text[i] === c) {
          i++;
          break;
        }
        if (text[i] === '\n') break; // unterminated
      }
      prev = c;
      continue;
    }
    if (c === '`') {
      // template literal: copy, recursing into code mode at ${ … }
      out += c;
      i++;
      for (; i < n; i++) {
        const t = text[i];
        if (t === '\\') {
          out += t;
          i++;
          if (i < n) out += text[i];
          continue;
        }
        if (t === '`') {
          out += t;
          i++;
          break;
        }
        if (t === '$' && text[i + 1] === '{') {
          out += '${';
          i += 2;
          let depth = 1;
          // code mode inside the interpolation, strings/templates nested
          for (; i < n && depth > 0; i++) {
            const d = text[i];
            if (d === '{') depth++;
            else if (d === '}') {
              depth--;
              if (depth === 0) {
                out += d;
                break;
              }
            } else if (d === '"' || d === "'" || d === '`') {
              // nested literal — consume it whole via a recursive trick:
              // reuse the outer loop by slicing is expensive; inline scanner:
              const q = d;
              out += d;
              i++;
              if (q === '`') {
                let td = 0;
                for (; i < n; i++) {
                  const e = text[i];
                  out += e;
                  if (e === '\\') {
                    i++;
                    if (i < n) out += text[i];
                    continue;
                  }
                  if (e === '$' && text[i + 1] === '{') td++;
                  else if (e === '`' && td === 0) break;
                }
              } else {
                for (; i < n; i++) {
                  const e = text[i];
                  out += e;
                  if (e === '\\') {
                    i++;
                    if (i < n) out += text[i];
                    continue;
                  }
                  if (e === q) break;
                  if (e === '\n') break;
                }
              }
              continue;
            }
            out += d;
          }
          continue;
        }
        out += t;
      }
      prev = '`';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/** Index of the closing quote for a quoted string starting at `start`. */
function skipQuoted(text, start) {
  const q = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === q) return i;
  }
  return text.length - 1;
}

/** A literal is a comparison/enum operand, not a class list, when the code
 *  just before it is a comparison operator, a `case` keyword, or a
 *  membership-probe call (`includes('x')`). */
function isComparisonOperand(text, index) {
  const before = text.slice(Math.max(0, index - 24), index);
  if (/(?:===|!==|==|!=)\s*$/.test(before)) return true;
  if (/(?:^|[^\w.])case\s+$/.test(before)) return true;
  if (/\.(?:includes|startsWith|endsWith|indexOf)\(\s*$/.test(before)) return true;
  return false;
}

/** Scan a template literal starting at the backtick `start`. Each quasi
 *  becomes one entry; a quasi whose edge touches an interpolation marks
 *  that edge dynamic so half-built tokens (`chief-${kind}`) are skipped.
 *  Strings inside the interpolated expression are collected too. */
function scanTemplate(text, start, braceDepth) {
  const quasis = [];
  let i = start + 1;
  let quasiStart = i;
  let leadingDynamic = false;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') {
      const value = text.slice(quasiStart, i);
      if (value.trim())
        quasis.push({
          value,
          index: quasiStart,
          braceDepth,
          leadingDynamic,
          trailingDynamic: false,
        });
      return { strings: quasis, end: i + 1 };
    }
    if (c === '$' && text[i + 1] === '{') {
      const value = text.slice(quasiStart, i);
      const trailingDynamic = value.length > 0 && !/\s$/.test(value);
      if (value.trim())
        quasis.push({ value, index: quasiStart, braceDepth, leadingDynamic, trailingDynamic });
      const inner = scanContainer(text, i + 1, braceDepth);
      quasis.push(...inner.strings);
      i = inner.end;
      quasiStart = i;
      const rest = text.slice(i);
      leadingDynamic = rest.length > 0 && !/^\s/.test(rest) && rest[0] !== '`';
      continue;
    }
    i++;
  }
  return { strings: quasis, end: text.length };
}

/** Walk an expression region opening at `start`. Handles a bare quoted
 *  string, a template literal, or a brace/paren container; returns every
 *  string literal / template quasi inside with {value, index, braceDepth,
 *  leadingDynamic, trailingDynamic, isKey, isComparison} and the index just
 *  past the construct. `braceDepth` counts object-literal braces opened
 *  inside the region (the container's own brace does not count). */
function scanContainer(text, start, baseBraceDepth = 0) {
  const opener = text[start];
  if (opener === '"' || opener === "'") {
    const end = skipQuoted(text, start);
    return {
      strings: [
        {
          value: text.slice(start + 1, end),
          index: start,
          braceDepth: baseBraceDepth,
          leadingDynamic: false,
          trailingDynamic: false,
          isKey: /^\s*:/.test(text.slice(end + 1)),
          isComparison: isComparisonOperand(text, start),
        },
      ],
      end: end + 1,
    };
  }
  if (opener === '`') return scanTemplate(text, start, baseBraceDepth);

  const out = [];
  const stack = [];
  let braceDepth = baseBraceDepth;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      if (stack.length > 0) braceDepth++;
      stack.push('{');
    } else if (c === '(' || c === '[') {
      stack.push(c);
    } else if (c === '}' || c === ')' || c === ']') {
      const top = stack.pop();
      if (top === '{') braceDepth--;
      if (c === '}' && stack.length === 0) return { strings: out, end: i + 1 };
    } else if (c === '"' || c === "'") {
      const end = skipQuoted(text, i);
      out.push({
        value: text.slice(i + 1, end),
        index: i,
        braceDepth,
        leadingDynamic: false,
        trailingDynamic: false,
        isKey: /^\s*:/.test(text.slice(end + 1)),
        isComparison: isComparisonOperand(text, i),
      });
      i = end;
    } else if (c === '`') {
      const t = scanTemplate(text, i, braceDepth);
      out.push(...t.strings);
      i = t.end - 1;
    }
  }
  return { strings: out, end: text.length };
}

// ---------------------------------------------------------------------------
// class-token extraction (contexts A + B + C)
// ---------------------------------------------------------------------------

/** Harvest every cva variant-lookup key in the repo (#1178). A lookup call
 *  like `buttonVariants({ variant: 'ghost', size: 'icon-sm' })` passes
 *  hyphenated strings that are config keys, not class lists; the shape test
 *  below (space/hyphen = class-like) cannot tell them apart from real dead
 *  tokens. The keys live in the config object of `cva(base, { variants: {
 *  size: { 'icon-sm': 'size-7 …' } } })` — mostly inside pristine registry
 *  files, which this pass reads for keys only (data, not class vocabulary;
 *  the pristine skip protects token extraction, and buildReferenceIndex
 *  already reads other non-src corpora). Keys are single tokens: no
 *  whitespace, one value per variant property. Configs referenced through
 *  an identifier (`cva(base, config)`) yield no keys — fail-open to the
 *  pre-#1178 behavior; every cva config in this repo is inline. */
function collectVariantKeys() {
  const keys = new Set();
  for (const file of walkFiles(SRC_DIR, ['.ts', '.tsx'])) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/\bcva\s*\(/g)) {
      // walk to the config object: skip whitespace, the base string/template
      // argument, whitespace, the comma, whitespace — then expect `{`
      let i = m.index + m[0].length;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] === '"' || text[i] === "'") i = skipQuoted(text, i) + 1;
      else if (text[i] === '`') i = scanTemplate(text, i, 0).end;
      else continue; // non-literal base (cn(...) build, identifier) — bail
      while (i < text.length && /[\s,]/.test(text[i])) i++;
      if (text[i] !== '{') continue;
      // scanContainer from the config `{`: its own brace does not count, so
      // keys of the objects nested under `variants:` sit at braceDepth >= 2
      const { strings } = scanContainer(text, i);
      for (const lit of strings) {
        if (lit.isKey && lit.braceDepth >= 2 && !/\s/.test(lit.value)) keys.add(lit.value);
      }
    }
  }
  return keys;
}

/** Start index of every string literal inside a `*Variants(…)` argument
 *  object whose value is a harvested variant key — the lookup occurrences
 *  extraction must skip (#1178). Index-keyed, so the skip is precise to the
 *  exact call site; bogus values (`size: 'nope-x'`) are not in the key set
 *  and stay extracted, keeping real dead-class detection intact. */
function lookupSkipIndexes(text, variantKeys) {
  const skips = new Set();
  for (const m of text.matchAll(/\b[A-Za-z0-9_$]*Variants\s*\(/g)) {
    let start = m.index + m[0].length;
    while (start < text.length && /\s/.test(text[start])) start++;
    if (text[start] !== '{') continue; // not a lookup-object call site
    const { strings } = scanContainer(text, start);
    for (const lit of strings) {
      if (lit.isKey) continue;
      if (!/\s/.test(lit.value) && variantKeys.has(lit.value)) skips.add(lit.index);
    }
  }
  return skips;
}

/** A literal inside object braces counts as a class list only when it looks
 *  like one (space or hyphen) and is not an object key. */
function braceLiteralIsClassLike(lit) {
  if (lit.isKey) return false;
  return /[\s-]/.test(lit.value.trim());
}

// ASCII-only, no backslash, first char not a digit, at least one letter:
// keeps CJK regex-class constants, prose, and SVG path data (`M18 6 6 18`,
// `0.5`) out — an unescaped class name can never start with a digit in CSS,
// and decimals from compiled values must not pass as tokens.
const TOKEN_SHAPE_RE = /^(?=.*[a-zA-Z])[a-zA-Z_*[@-][a-zA-Z0-9_:./[\](),%!@#*+'=~^&{}$?|-]*$/;
// Tailwind structural markers match zero rules by design (variant targets).
const MARKER_RE = /^(?:group|peer)(?:\/[a-zA-Z0-9_-]+)?$|^@container(?:\/[a-zA-Z0-9_-]+)?$/;

function tokenize(raw, lit) {
  const tokens = [];
  const parts = raw.split(/\s+/).filter((p) => p.length > 0);
  for (let idx = 0; idx < parts.length; idx++) {
    if (idx === 0 && lit.leadingDynamic) continue;
    if (idx === parts.length - 1 && lit.trailingDynamic) continue;
    tokens.push(parts[idx]);
  }
  return tokens;
}

const CLASS_ATTR_RE = /\b(?:class|className|[A-Za-z][A-Za-z0-9_$]*ClassName)\s*=\s*/g;
const CLS_CONST_RE = /\b(?:const|let)\s+[A-Za-z0-9_$]+_(?:CLS|CLASSES|CLASS)\s*=\s*/g;

// Context C: class-list-shaped literals OUTSIDE the naming conventions —
// `const quoteSkin = 'chat-para--quote border-l-4 …'` flows into className
// through `${quoteSkin}`, invisible to A and B. Heuristic: a plain string
// literal with >= 2 ASCII-shaped tokens of which >= 50% are living selectors
// and at least one is not. The living-ratio test is what keeps SVG path data
// (`'M3 8l4-4 …'` — zero living tokens), i18n prose and route strings out.
const ANY_STRING_RE = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/** Extract {token, index} class candidates from one comment-stripped file.
 *  `live` is the living-selector set — context C needs it for the ratio
 *  heuristic, so extraction runs after the selector universe is built.
 *  Pass contextC:false for pure dictionary-data files (src/i18n/*): their
 *  literals are translation values, never rendered as class attributes.
 *  `lookupSkips` (optional, #1178) is a set of literal start indexes that
 *  hold cva variant-lookup keys (`buttonVariants({ size: 'icon-sm' })`) —
 *  config keys, not class lists. */
function extractFromFile(text, live, { contextC = true, lookupSkips } = {}) {
  const found = [];
  const seen = new Set();
  const pushToken = (tok, index) => {
    const key = `${tok}@${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ token: tok, index });
  };
  const consume = (strings) => {
    for (const lit of strings) {
      if (lit.isComparison) continue;
      if (lookupSkips?.has(lit.index)) continue;
      if (lit.braceDepth > 0 && !braceLiteralIsClassLike(lit)) continue;
      for (const tok of tokenize(lit.value, lit)) {
        if (!TOKEN_SHAPE_RE.test(tok)) continue;
        if (MARKER_RE.test(tok)) continue;
        pushToken(tok, lit.index);
      }
    }
  };

  // Context A: JSX class attributes.
  for (const m of text.matchAll(CLASS_ATTR_RE)) {
    const start = m.index + m[0].length;
    const { strings } = scanContainer(text, start);
    consume(strings);
  }

  // Context B: *_CLS recipe constants — expression runs to the top-level ';'.
  for (const m of text.matchAll(CLS_CONST_RE)) {
    let start = m.index + m[0].length;
    while (start < text.length && /\s/.test(text[start])) start++;
    let depth = 0;
    let end = start;
    for (; end < text.length; end++) {
      const ch = text[end];
      if (ch === '"' || ch === "'") {
        end = skipQuoted(text, end);
        continue;
      }
      if (ch === '`') {
        end = scanTemplate(text, end, 0).end - 1;
        continue;
      }
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (ch === ';' && depth === 0) break;
    }
    const expr = text.slice(start, end);
    const { strings } = scanContainer(`(${expr})`, 0);
    for (const lit of strings) {
      // the wrapper paren shifts every index by 1
      const mapped = { ...lit, index: start + lit.index - 1 };
      if (mapped.isComparison) continue;
      if (lookupSkips?.has(mapped.index)) continue;
      if (mapped.braceDepth > 0 && !braceLiteralIsClassLike(mapped)) continue;
      for (const tok of tokenize(lit.value, lit)) {
        if (!TOKEN_SHAPE_RE.test(tok)) continue;
        if (MARKER_RE.test(tok)) continue;
        pushToken(tok, mapped.index);
      }
    }
  }

  // Context C: class-list-shaped literals outside the conventions (see
  // ANY_STRING_RE note above). Deduplication against A/B happens in pushToken.
  if (contextC) {
    for (const m of text.matchAll(ANY_STRING_RE)) {
      if (isComparisonOperand(text, m.index)) continue;
      if (/^\s*:/.test(text.slice(m.index + m[0].length))) continue; // object key
      const toks = m[2]
        .split(/\s+/)
        .filter((t) => t && TOKEN_SHAPE_RE.test(t) && !MARKER_RE.test(t));
      if (toks.length < 2) continue;
      // class lists are lowercase; an uppercase token means prose (i18n
      // 'Clear {name} filter') — the whole literal is out of scope
      if (toks.some((t) => /[A-Z]/.test(t))) continue;
      let liveN = 0;
      let deadN = 0;
      for (const t of toks) {
        if (live.has(t)) liveN++;
        else deadN++;
      }
      if (deadN === 0 || liveN / toks.length < 0.5) continue;
      for (const t of toks) pushToken(t, m.index + 1);
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// selector-reference index (the self-maintaining exemption ledger)
// ---------------------------------------------------------------------------

/** Class names a string references in CSS-selector form. */
function selectorNamesInString(s) {
  const names = [];
  for (const m of s.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) names.push(m[1]);
  for (const m of s.matchAll(/\[class[\^~*|$]?=["']?([a-zA-Z][a-zA-Z0-9_-]*)/g)) names.push(m[1]);
  return names;
}

/** Every string-literal content in a comment-stripped file, plus the bodies
 *  of regex literals passed to toHaveClass(...). */
function* stringLiterals(text) {
  const re = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:[^`\\]|\\.)*)`/g;
  for (const m of text.matchAll(re)) yield m[2] ?? m[3] ?? '';
  for (const m of text.matchAll(/toHaveClass\(\s*\/([^/\n]+)\/[a-z]*\s*\)/g)) {
    for (const alt of m[1].split('|')) yield alt;
  }
}

const DOM_SELECTOR_API_RE =
  /(?:querySelector|querySelectorAll|closest|matches)\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;

function buildReferenceIndex(srcTexts) {
  const refs = new Map(); // name -> first reference site description
  const add = (name, site) => {
    if (!refs.has(name)) refs.set(name, site);
  };

  // Test corpus: any selector-shaped name inside a string/regex literal.
  // The verify-pacman driver scripts are live tooling (re-run against the
  // real app on every verification round), so their selectors pin class
  // names exactly like e2e specs do. docs/verify/** is NOT here on purpose:
  // archived one-shot evidence pinned to its PR sha, not a live consumer.
  const corpusDirs = [
    [join(WEB_DIR, 'e2e'), ['.ts', '.tsx', '.mjs', '.js']],
    [join(WEB_DIR, 'test'), ['.ts', '.tsx']],
    [join(REPO_ROOT, 'integration/test'), ['.ts', '.tsx']],
    [join(REPO_ROOT, 'scripts'), ['.mjs', '.js']],
    [join(REPO_ROOT, '.claude/skills/verify-pacman/scripts'), ['.mjs', '.js']],
  ];
  for (const [dir, exts] of corpusDirs) {
    for (const f of walkFiles(dir, exts)) {
      if (f.endsWith('ui-dead-class-gate.mjs')) continue; // the gate's own prose
      const text = stripComments(readFileSync(f, 'utf8'));
      for (const s of stringLiterals(text)) {
        for (const name of selectorNamesInString(s)) add(name, rel(f));
      }
    }
  }

  // src itself: only explicit DOM-selector APIs count (querySelector & co) —
  // a bare `.foo` in app code is property access, not a selector.
  for (const [f, text] of srcTexts) {
    for (const m of text.matchAll(DOM_SELECTOR_API_RE)) {
      for (const name of selectorNamesInString(m[2])) {
        add(name, `${rel(f)} (DOM selector API)`);
      }
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// living selector universe
// ---------------------------------------------------------------------------

function extractSelectors(css) {
  const out = new Set();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // One capture around a repeated atom: `.text-\(--x\)`, `.-ml-\[260px\]`,
  // `.\*\*\:data-\[slot\=kbd\]\:isolate` all unescape back to source tokens.
  for (const m of body.matchAll(/\.((?:\\[\s\S]|[\w-])+)/g)) {
    out.add(m[1].replace(/\\([\s\S])/g, '$1'));
  }
  for (const m of body.matchAll(/@utility\s+([a-zA-Z0-9_-]+)/g)) out.add(m[1]);
  for (const m of body.matchAll(/@custom-variant\s+([a-zA-Z0-9_-]+)/g)) out.add(m[1]);
  return out;
}

function readDistCss(distDir) {
  const assets = join(distDir, 'assets');
  if (!existsSync(assets)) return null;
  const files = readdirSync(assets).filter((f) => f.endsWith('.css'));
  if (files.length === 0) return null;
  return files.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
}

async function compileCss() {
  const webRequire = createRequire(join(WEB_DIR, 'package.json'));
  let postcss;
  let tailwind;
  try {
    postcss = webRequire('postcss');
    tailwind = webRequire('@tailwindcss/postcss');
  } catch {
    return null;
  }
  const cssFile = join(SRC_DIR, 'styles/app.css');
  const input = readFileSync(cssFile, 'utf8');
  const prevCwd = process.cwd();
  process.chdir(WEB_DIR);
  try {
    const result = await postcss([tailwind()]).process(input, { from: cssFile });
    return result.css;
  } finally {
    process.chdir(prevCwd);
  }
}

function sourceCssSelectors() {
  const live = new Set();
  for (const f of walkFiles(SRC_DIR, ['.css'])) {
    for (const sel of extractSelectors(readFileSync(f, 'utf8'))) live.add(sel);
  }
  return live;
}

// ---------------------------------------------------------------------------
// source walk / registry
// ---------------------------------------------------------------------------

function* walkFiles(dir, exts) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walkFiles(p, exts);
    else if (exts.some((e) => entry.endsWith(e))) yield p;
  }
}

function pristineRegistryFiles() {
  const path = join(REPO_ROOT, 'scripts/ui-registry.json');
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  const out = new Set();
  for (const [name, entry] of Object.entries(registry.files)) {
    if (entry.status === 'pristine') out.add(join(SRC_DIR, 'components/ui', name));
  }
  return out;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dist: null, compile: false, audit: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') args.dist = resolve(argv[++i] ?? '');
    else if (argv[i] === '--compile') args.compile = true;
    else if (argv[i] === '--audit') args.audit = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: node scripts/ui-dead-class-gate.mjs [--dist <dir>] [--compile] [--audit]');
    return 0;
  }

  // 1. living universe: source CSS + compiled CSS
  const live = sourceCssSelectors();
  let compiled = null;
  let compiledFrom = null;
  if (!args.compile) {
    const distDir = args.dist ?? DIST_DIR;
    compiled = readDistCss(distDir);
    if (compiled) compiledFrom = rel(distDir);
  }
  if (!compiled) {
    compiled = await compileCss();
    compiledFrom = compiled ? 'postcss compile (apps/web/src/styles/app.css)' : null;
  }
  if (!compiled) {
    console.error(
      'ui-dead-class-gate: no compiled CSS — apps/web/dist absent and @tailwindcss/postcss unresolvable.\n' +
        'Run `pnpm install` (compile mode) or `pnpm --filter @pacman/web build` (dist mode) first.',
    );
    return 2;
  }
  for (const sel of extractSelectors(compiled)) live.add(sel);

  // 2. extraction over src (pristine registry files skipped)
  const pristine = pristineRegistryFiles();
  const variantKeys = collectVariantKeys();
  const occurrences = new Map(); // token -> [{file,line}]
  const srcTexts = [];
  let tokenCount = 0;
  let scannedFiles = 0;
  let skippedPristine = 0;
  for (const file of walkFiles(SRC_DIR, ['.ts', '.tsx'])) {
    if (pristine.has(file)) {
      skippedPristine++;
      continue;
    }
    scannedFiles++;
    const text = stripComments(readFileSync(file, 'utf8'));
    srcTexts.push([file, text]);
    const inI18n = file.startsWith(join(SRC_DIR, 'i18n'));
    const lookupSkips = lookupSkipIndexes(text, variantKeys);
    for (const { token, index } of extractFromFile(text, live, {
      contextC: !inI18n,
      lookupSkips,
    })) {
      tokenCount++;
      if (live.has(token)) continue;
      if (!occurrences.has(token)) occurrences.set(token, []);
      const sites = occurrences.get(token);
      const site = { file: rel(file), line: lineOf(text, index) };
      // contexts A/B and C can both land on the same literal — one site entry
      if (!sites.some((s) => s.file === site.file && s.line === site.line)) sites.push(site);
    }
  }

  // 3. selector-reference index over tests/probes/scripts + src DOM APIs
  const refs = buildReferenceIndex(srcTexts);

  // 4. fail-closed sanity
  if (
    scannedFiles === 0 ||
    tokenCount < TOKEN_COUNT_FLOOR ||
    live.size < 100 ||
    compiled.length < 50_000
  ) {
    console.error(
      `ui-dead-class-gate: sanity failed — files=${scannedFiles} tokens=${tokenCount} (floor ${TOKEN_COUNT_FLOOR}) selectors=${live.size} compiledBytes=${compiled.length}`,
    );
    return 2;
  }

  // 5. dispositions
  const manual = new Map(EXEMPTIONS.map((e) => [e.name, e.reason]));
  const dead = [];
  const selectorExempt = [];
  const manualExempt = [];
  for (const [name, sites] of [...occurrences].sort()) {
    if (manual.has(name)) manualExempt.push([name, sites]);
    else if (refs.has(name)) selectorExempt.push([name, sites]);
    else dead.push([name, sites]);
  }
  const staleExemptions = [...manual.keys()].filter((name) => !occurrences.has(name)).sort();

  // 6. report
  console.log(`ui-dead-class-gate: selector universe from ${compiledFrom} + apps/web/src/**/*.css`);
  console.log(
    `scanned ${scannedFiles} files (${skippedPristine} pristine registry files skipped), ` +
      `${tokenCount} class-token occurrences, ${live.size} living selectors`,
  );
  console.log(
    `zero-rule names: ${occurrences.size} — selector-exempt ${selectorExempt.length}, ` +
      `manual-exempt ${manualExempt.length}, DEAD ${dead.length}`,
  );

  if (args.audit) {
    console.log('\n== FULL zero-hit inventory (ticket evidence, #1036) ==');
    console.log(
      `\n-- selector-exempt (${selectorExempt.length}): referenced as a CSS selector in the test corpus`,
    );
    for (const [name, sites] of selectorExempt) {
      console.log(`  .${name}  [ref: ${refs.get(name)}]`);
      for (const s of sites) console.log(`      ${s.file}:${s.line}`);
    }
    console.log(`\n-- manual-exempt (${manualExempt.length})`);
    for (const [name, sites] of manualExempt) {
      console.log(`  .${name}  [${manual.get(name)}]`);
      for (const s of sites) console.log(`      ${s.file}:${s.line}`);
    }
    console.log(`\n-- DEAD (${dead.length}): zero rules AND zero references — delete or reconnect`);
    for (const [name, sites] of dead) {
      console.log(`  .${name}`);
      for (const s of sites) console.log(`      ${s.file}:${s.line}`);
    }
  }

  let bad = false;
  if (dead.length > 0) {
    bad = true;
    console.error(
      `\nDEAD CLASSES — rendered by the app, matching zero rules, referenced nowhere (${dead.length}):`,
    );
    for (const [name, sites] of dead) {
      console.error(`  .${name}`);
      for (const s of sites) console.error(`      ${s.file}:${s.line}`);
    }
    console.error(
      '\nEach site needs one of: delete the token, reconnect it to the post-#950\n' +
        'primitive (chief/recipes.ts, components/chat live-row), or add an EXEMPTIONS\n' +
        'entry with a reason. New styles are not the fix — #950 retired per-face CSS.',
    );
  }
  if (staleExemptions.length > 0) {
    bad = true;
    console.error(
      `\nSTALE EXEMPTIONS — no occurrence in the scan any more (${staleExemptions.length}):`,
    );
    for (const name of staleExemptions) console.error(`  .${name}  (${manual.get(name)})`);
    console.error('Remove the entry; the ledger must not outlive its justification.');
  }
  if (!bad)
    console.log('OK — every rendered class token matches a living rule or carries a disposition.');
  return bad ? 1 : 0;
}

// Importable by maintenance tooling (the #1036 cleanup codemod reused the
// exact extraction path so the deletions match the flags one-for-one); the
// gate itself only runs when executed directly.
export { extractFromFile, MARKER_RE, scanContainer, stripComments, TOKEN_SHAPE_RE };

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exit(await main());
}
