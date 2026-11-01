#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_SRC = join(REPO_ROOT, 'apps/web/src');

const EXEMPT = [
  /^design\//,
  /^components\/ui\//,
  /^fixtures\//,
  /^icons\//,
  /^i18n\//,
  /^components\/brand-marks\.tsx$/,
  /^components\/status-glyph\.tsx$/,
  /\.test\.tsx?$/,
];

const COLOR_UTILITY =
  '(?:text|bg|border|border-[trblxyse]|ring|ring-offset|fill|stroke|from|to|via|outline|divide|decoration|shadow|accent|caret|placeholder)';
const PALETTE =
  '(?:red|green|blue|yellow|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)';

const CSS_NAMED_COLORS = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
];
const NAMED = `(?:${CSS_NAMED_COLORS.join('|')})`;
const COLOR_IN_VALUE = new RegExp(
  `#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\\(|\\b${NAMED}\\b`,
  'i',
);
const COLOR_PROPS =
  '(?:fill|stroke|stopColor|color|caretColor|accentColor|background\\w*|border\\w*|outline\\w*|boxShadow|textShadow)';
const TYPE_PROPS = '(?:fontSize|fontWeight|lineHeight|fontFamily|letterSpacing)';

export function withoutTokens(value) {
  let previous;
  let current = value;
  do {
    previous = current;
    current = current.replace(/var\([^()]*\)/g, '');
  } while (current !== previous);
  return current;
}

export const RULES = [
  {
    id: 'palette-color',
    message:
      'Tailwind palette colour; use a theme token such as text-(--text-secondary) or bg-card',
    pattern: new RegExp(
      `(?<![\\w-])(?:[\\w-]+:)*${COLOR_UTILITY}-${PALETTE}(?:-\\d{2,3})?(?:\\/\\d+)?(?![\\w-])`,
      'g',
    ),
  },
  {
    id: 'arbitrary-color',
    message: 'arbitrary colour value; add a token to styles/shadcn.css and use it',
    pattern: new RegExp(
      `(?<![\\w-])(?:[\\w-]+:)*${COLOR_UTILITY}-\\[(?:#|rgba?\\(|hsla?\\(|oklch\\(|oklab\\(|color-mix\\(|color:|${NAMED}\\])`,
      'gi',
    ),
  },
  {
    id: 'color-literal',
    message: 'colour literal in a style or SVG attribute; use var(--token) or currentColor',
    pattern: new RegExp(
      `(?<![\\w-])["']?${COLOR_PROPS}["']?\\s*[=:]\\s*\\{?\\s*(["'\`])((?:(?!\\1)[^\\\\])*)\\1`,
      'g',
    ),
    accept: (match) => COLOR_IN_VALUE.test(withoutTokens(match[2] ?? '')),
  },
  {
    id: 'inline-type',
    message: 'type set in an inline style; use the text-* scale keys',
    pattern: new RegExp(`(?<![\\w-])["']?${TYPE_PROPS}["']?\\s*:\\s*(?:-?[\\d.]|["'\`])`, 'g'),
  },
];

const CANARY = [
  ['className="text-red-500"', 'palette-color'],
  ['className="hover:bg-white/10"', 'palette-color'],
  ['className="border-t-zinc-200"', 'palette-color'],
  ['className="bg-[#fff]"', 'arbitrary-color'],
  ['className="text-[color-mix(in_oklch,var(--a),white_5%)]"', 'arbitrary-color'],
  ['<path fill="#D97757" />', 'color-literal'],
  ["style={{ color: '#333' }}", 'color-literal'],
  ['style={{ fontSize: 13 }}', 'inline-type'],
  ['style={{\n  marginTop: 4,\n  fontWeight: 600 }}', 'inline-type'],
  ['className="bg-[red] text-[blue]"', 'arbitrary-color'],
  ['style={{ color: "red" }}', 'color-literal'],
  ["style={{ border: '1px solid #fff' }}", 'color-literal'],
  ['style={ { fontSize: 13 } }', 'inline-type'],
  ['const title = { fontWeight: 600 };', 'inline-type'],
  ['style={{ "fontSize": 13 }}', 'inline-type'],
  ["style={{ border: '1px solid red' }}", 'color-literal'],
  ['className="bg-[rebeccapurple]"', 'arbitrary-color'],
  ['style={{ color: "rebeccapurple" }}', 'color-literal'],
  ['style={{ color: "color-mix(in oklab, var(--tile), red)" }}', 'color-literal'],
  ['const x: { fontSize: number } = value;', null],
  ["style={{ background: 'var(--white-ish)' }}", null],
  ["style={{ borderColor: 'transparent' }}", null],
  ['className="text-(--text-secondary) bg-card text-ui"', null],
  ['<Button color="secondary" />', null],
  ['<path fill="none" stroke="currentColor" />', null],
  ["style={{ border: '1px solid var(--border)' }}", null],
  ['style={{ borderColor: `color-mix(in oklab, var(--tile) 55%, transparent)` }}', null],
  ['className="shadow-[none]"', null],
  ['className="text-red-ink"', null],
  ['style={{ color: tag.color }}', null],
  ["style={{ background: 'var(--project-tile-3)' }}", null],
  ['sourceRef: "xiechimon/cairn#1182"', null],
  ['className="bg-[var(--card)]"', null],
];

export function scanSource(source) {
  const hits = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      if (rule.accept != null && !rule.accept(match)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      hits.push({ rule: rule.id, line, text: match[0].split('\n')[0] });
    }
  }
  return hits;
}

export function selfCheck() {
  const wrong = [];
  for (const [sample, expected] of CANARY) {
    const rules = scanSource(sample).map((hit) => hit.rule);
    const ok = expected === null ? rules.length === 0 : rules.includes(expected);
    if (!ok)
      wrong.push(
        `${JSON.stringify(sample)} expected ${expected ?? 'no hit'}, got ${rules.join(', ') || 'no hit'}`,
      );
  }
  return wrong;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(?:ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

export function scanTree(root = WEB_SRC) {
  const findings = [];
  for (const file of walk(root)) {
    const rel = relative(root, file);
    if (EXEMPT.some((re) => re.test(rel))) continue;
    for (const hit of scanSource(readFileSync(file, 'utf8'))) findings.push({ file: rel, ...hit });
  }
  return findings;
}

function main() {
  const broken = selfCheck();
  if (broken.length > 0) {
    for (const line of broken) console.error(`[ui-page-style-gate] matcher self-check: ${line}`);
    process.exit(1);
  }
  const findings = scanTree();
  const messages = Object.fromEntries(RULES.map((rule) => [rule.id, rule.message]));
  for (const f of findings)
    console.error(
      `[ui-page-style-gate] apps/web/src/${f.file}:${f.line} ${f.rule}: ${f.text} (${messages[f.rule]})`,
    );
  if (findings.length > 0) {
    console.error(`[ui-page-style-gate] FAIL: ${findings.length} hard-coded style site(s)`);
    process.exit(1);
  }
  console.log(
    '[ui-page-style-gate] PASS: no palette colours, arbitrary colours, colour literals or inline type outside the gallery, registry, icons and fixtures',
  );
}

if (process.argv[1] === import.meta.filename) main();
