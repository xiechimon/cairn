import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface BenchOracle {
  files: Record<string, string>;
  command: readonly string[];
}

export interface BenchDecoy {
  file: string;
}

export interface BenchTask {
  id: string;
  tags: readonly string[];
  implFile: string;
  prompt: string;
  seedFiles: Record<string, string>;
  oracle: BenchOracle;
  decoy?: BenchDecoy;
}

function promptFor(spec: string): string {
  return [
    spec,
    '',
    'Repository rules: plain Node.js ESM (.mjs), no external packages, no package.json.',
    'Implement the exports in the files named above; you may add helper files if needed.',
    'You may run `node <file>` to check your work. There are no tests in the repository.',
  ].join('\n');
}

function stub(exportLine: string): string {
  return `${exportLine} {\n  throw new Error('not implemented');\n}\n`;
}

function stubClass(exportLine: string): string {
  return `${exportLine} {\n  constructor() {\n    throw new Error('not implemented');\n  }\n}\n`;
}

const notImplemented = (name: string): string =>
  `export function ${name}() {\n  throw new Error('not implemented');\n}\n`;

const assertPrelude = (importLine: string): string[] => [
  "import assert from 'node:assert/strict';",
  importLine,
];

const oracleScript = (lines: string[]): string => `${lines.join('\n')}\n`;

function oracleFor(importLine: string, assertions: string[], name: string): BenchOracle {
  return {
    files: {
      [name]: oracleScript([
        ...assertPrelude(importLine),
        ...assertions,
        `console.log('${name} ok');`,
      ]),
    },
    command: ['node', name],
  };
}

const slugifyTask: BenchTask = {
  id: 'slugify',
  tags: ['text'],
  implFile: 'lib/slug.mjs',
  prompt: promptFor(
    [
      'Implement `slugify(value)` in `lib/slug.mjs`. It turns a string into a URL slug.',
      '',
      'Rules:',
      '- Lowercase the input.',
      '- Replace every run of characters that are not ASCII letters or digits with a single `-`.',
      '- Trim leading and trailing `-`.',
      '- A string with no letters or digits returns the empty string.',
      '',
      'Examples: `Hello, World!` becomes `hello-world`; `  Multiple   Spaces  ` becomes `multiple-spaces`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/slug.mjs': stub('export function slugify(value)'),
    'vendor/slug.mjs':
      "const NON_ALPHANUMERIC = /[^a-z0-9]+/g;\nconst EDGE_HYPHENS = /^-+|-+$/g;\nexport function slugify(value) {\n  const lowered = value.toLowerCase();\n  const collapsed = lowered.replace(NON_ALPHANUMERIC, '-');\n  const trimmed = collapsed.replace(EDGE_HYPHENS, '');\n  return trimmed;\n}\n",
  },
  oracle: oracleFor(
    "import { slugify } from './lib/slug.mjs';",
    [
      "assert.equal(slugify('Hello, World!'), 'hello-world');",
      "assert.equal(slugify('  Multiple   Spaces  '), 'multiple-spaces');",
      "assert.equal(slugify('C++ & C#'), 'c-c');",
      "assert.equal(slugify('already-slug'), 'already-slug');",
      "assert.equal(slugify('!!!'), '');",
      "assert.equal(slugify('Tabs\\tand\\nnewlines'), 'tabs-and-newlines');",
    ],
    'oracle.check.mjs',
  ),
  decoy: { file: 'vendor/slug.mjs' },
};

const durationTask: BenchTask = {
  id: 'iso8601-duration',
  tags: ['parsing'],
  implFile: 'lib/duration.mjs',
  prompt: promptFor(
    [
      'Implement `parseDuration(text)` in `lib/duration.mjs`. It parses an ISO 8601 duration and returns the total seconds, or `null` when the input is invalid.',
      '',
      'Grammar (uppercase letters only):',
      '- `P` starts the duration.',
      '- Optionally a day count: one or more digits followed by `D`.',
      '- Optionally `T` followed by any of: an hour count with `H`, a minute count with `M`, a second count with `S` (in that order, each optional).',
      '- At least one component (a `D` part or one component after `T`) must be present. `T` must be followed by at least one component.',
      '- Counts are integers of one or more digits; no signs, no decimals.',
      '',
      'Examples: `PT1H30M` is 5400; `P2DT3H` is 183600; `PT0S` is 0; `P1D` is 86400; `PT1M30S` is 90.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/duration.mjs': stub('export function parseDuration(text)'),
  },
  oracle: oracleFor(
    "import { parseDuration } from './lib/duration.mjs';",
    [
      "assert.equal(parseDuration('PT1H30M'), 5400);",
      "assert.equal(parseDuration('P2DT3H'), 183600);",
      "assert.equal(parseDuration('PT0S'), 0);",
      "assert.equal(parseDuration('P1D'), 86400);",
      "assert.equal(parseDuration('PT1M30S'), 90);",
      "assert.equal(parseDuration('PT1H1M1S'), 3661);",
      "assert.equal(parseDuration('PT'), null);",
      "assert.equal(parseDuration('P'), null);",
      "assert.equal(parseDuration('1H'), null);",
      "assert.equal(parseDuration('pt1h'), null);",
      "assert.equal(parseDuration('PT1.5H'), null);",
      "assert.equal(parseDuration('P1DT'), null);",
      "assert.equal(parseDuration(''), null);",
    ],
    'oracle.check.mjs',
  ),
};

const lruTask: BenchTask = {
  id: 'lru-cache',
  tags: ['data-structure'],
  implFile: 'lib/lru-cache.mjs',
  prompt: promptFor(
    [
      'Implement the class `LruCache` in `lib/lru-cache.mjs`.',
      '',
      'API:',
      '- `new LruCache(capacity)`: capacity is a positive integer, otherwise throw `Error`.',
      '- `get(key)`: returns the stored value or `undefined`; a successful get refreshes recency.',
      '- `put(key, value)`: inserts or updates; refreshes recency; when inserting a new key would exceed capacity, evict the least recently used entry first.',
      '- `has(key)`: returns a boolean and does not refresh recency.',
      '- `keys()`: returns the keys ordered most recent first.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/lru-cache.mjs': stubClass('export class LruCache'),
  },
  oracle: oracleFor(
    "import { LruCache } from './lib/lru-cache.mjs';",
    [
      'assert.throws(() => new LruCache(0));',
      'assert.throws(() => new LruCache(1.5));',
      'const c = new LruCache(2);',
      "c.put('a', 1);",
      "c.put('b', 2);",
      "assert.equal(c.get('a'), 1);",
      "assert.equal(c.get('missing'), undefined);",
      "assert.equal(c.has('b'), true);",
      "c.put('c', 3);",
      "assert.equal(c.has('b'), false);",
      "assert.deepEqual(c.keys(), ['c', 'a']);",
      "c.put('a', 9);",
      "c.put('d', 4);",
      "assert.equal(c.has('c'), false);",
      "assert.equal(c.get('a'), 9);",
    ],
    'oracle.check.mjs',
  ),
};

const csvTask: BenchTask = {
  id: 'csv-fields',
  tags: ['parsing'],
  implFile: 'lib/csv.mjs',
  prompt: promptFor(
    [
      'Implement `splitCsvLine(line)` in `lib/csv.mjs`. It splits one CSV line into fields and returns the array, or `null` when the line is malformed.',
      '',
      'Rules:',
      '- Fields are separated by commas.',
      '- A field whose first character is `"` is quoted: it runs to the matching closing `"`, may contain commas, and `""` inside quotes is a literal `"`.',
      '- A quote character inside an unquoted field makes the line malformed.',
      '- An unterminated quoted field makes the line malformed.',
      '- Spaces are part of the field; nothing is trimmed.',
      '',
      'Examples: `a,"b,c",d` becomes `["a", "b,c", "d"]`; `"say ""hi""",x` becomes `[\'say "hi"\', "x"]`; the empty string becomes `[""]`; `a,` becomes `["a", ""]`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/csv.mjs': stub('export function splitCsvLine(line)'),
  },
  oracle: oracleFor(
    "import { splitCsvLine } from './lib/csv.mjs';",
    [
      "assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);",
      "assert.deepEqual(splitCsvLine('a,\"b,c\",d'), ['a', 'b,c', 'd']);",
      'assert.deepEqual(splitCsvLine(\'"say ""hi""",x\'), [\'say "hi"\', \'x\']);',
      "assert.deepEqual(splitCsvLine(''), ['']);",
      "assert.deepEqual(splitCsvLine('a,'), ['a', '']);",
      "assert.equal(splitCsvLine('a,\"b'), null);",
      "assert.equal(splitCsvLine('a\"b,c'), null);",
      'assert.equal(splitCsvLine(\' "a"\'), null);',
    ],
    'oracle.check.mjs',
  ),
};

const overlapTask: BenchTask = {
  id: 'date-overlap',
  tags: ['dates'],
  implFile: 'lib/overlap.mjs',
  prompt: promptFor(
    [
      'Implement `overlapDays(aStart, aEnd, bStart, bEnd)` in `lib/overlap.mjs`. It returns how many whole days two date intervals overlap.',
      '',
      'Rules:',
      '- Dates are `YYYY-MM-DD` strings; treat them as UTC calendar days.',
      '- Each interval is half-open: `[start, end)`, so an interval covers `start` up to but not including `end`.',
      '- The result is never negative: disjoint intervals return 0.',
      '',
      'Examples: `2026-01-01` to `2026-01-05` vs `2026-01-04` to `2026-01-10` overlap 1 day; `2026-01-01` to `2026-01-05` vs `2026-01-05` to `2026-01-10` overlap 0 days; identical `2026-03-01` to `2026-03-04` intervals overlap 3 days.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/overlap.mjs': stub('export function overlapDays(aStart, aEnd, bStart, bEnd)'),
  },
  oracle: oracleFor(
    "import { overlapDays } from './lib/overlap.mjs';",
    [
      "assert.equal(overlapDays('2026-01-01', '2026-01-05', '2026-01-04', '2026-01-10'), 1);",
      "assert.equal(overlapDays('2026-01-01', '2026-01-05', '2026-01-05', '2026-01-10'), 0);",
      "assert.equal(overlapDays('2026-01-01', '2026-01-10', '2026-02-01', '2026-02-05'), 0);",
      "assert.equal(overlapDays('2026-01-01', '2026-01-10', '2026-01-03', '2026-01-05'), 2);",
      "assert.equal(overlapDays('2026-03-01', '2026-03-04', '2026-03-01', '2026-03-04'), 3);",
      "assert.equal(overlapDays('2028-02-28', '2028-03-01', '2028-02-29', '2028-03-01'), 1);",
    ],
    'oracle.check.mjs',
  ),
};

const romanTask: BenchTask = {
  id: 'roman-numerals',
  tags: ['parsing'],
  implFile: 'lib/roman.mjs',
  prompt: promptFor(
    [
      'Implement `romanToInt(s)` in `lib/roman.mjs`. It converts a Roman numeral to its integer value, or returns `null` when the input is not a valid canonical numeral.',
      '',
      'A valid numeral uses the symbols `M`, `D`, `C`, `L`, `X`, `V`, `I` and:',
      '- the only subtractive pairs are `IV`, `IX`, `XL`, `XC`, `CD`, `CM`;',
      '- `I`, `X`, `C`, `M` may repeat at most three times in a row;',
      '- `V`, `L`, `D` never repeat;',
      '- values are non-increasing except for the allowed subtractive pairs.',
      '',
      'Anything else (lowercase, empty, unknown symbols, `IIII`, `VV`, `IIV`, `VX`) returns `null`.',
      'Examples: `III` is 3; `IV` is 4; `LVIII` is 58; `MCMXCIV` is 1994; `MMMCMXCIX` is 3999.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/roman.mjs': stub('export function romanToInt(s)'),
    'vendor/roman.mjs':
      "const CANONICAL_NUMERAL = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;\nconst ROMAN_VALUES = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };\nexport function romanToInt(s) {\n  if (typeof s !== 'string' || s.length === 0 || !CANONICAL_NUMERAL.test(s)) return null;\n  let total = 0;\n  for (let i = 0; i < s.length; i++) {\n    const cur = ROMAN_VALUES[s[i]] ?? 0;\n    const next = ROMAN_VALUES[s[i + 1]] ?? 0;\n    if (next > cur) {\n      total += next - cur;\n      i += 1;\n    } else {\n      total += cur;\n    }\n  }\n  return total;\n}\n",
  },
  oracle: oracleFor(
    "import { romanToInt } from './lib/roman.mjs';",
    [
      "assert.equal(romanToInt('III'), 3);",
      "assert.equal(romanToInt('IV'), 4);",
      "assert.equal(romanToInt('IX'), 9);",
      "assert.equal(romanToInt('LVIII'), 58);",
      "assert.equal(romanToInt('MCMXCIV'), 1994);",
      "assert.equal(romanToInt('MMMCMXCIX'), 3999);",
      "assert.equal(romanToInt('IIII'), null);",
      "assert.equal(romanToInt('VV'), null);",
      "assert.equal(romanToInt('IIV'), null);",
      "assert.equal(romanToInt('VX'), null);",
      "assert.equal(romanToInt('abc'), null);",
      "assert.equal(romanToInt(''), null);",
      "assert.equal(romanToInt('i'), null);",
      "assert.equal(romanToInt('MMMM'), null);",
    ],
    'oracle.check.mjs',
  ),
  decoy: { file: 'vendor/roman.mjs' },
};

const templateTask: BenchTask = {
  id: 'render-template',
  tags: ['text'],
  implFile: 'lib/template.mjs',
  prompt: promptFor(
    [
      'Implement `render(template, vars)` in `lib/template.mjs`. It substitutes `{{key}}` placeholders.',
      '',
      'Rules:',
      '- A placeholder is `{{` + a key matching `[A-Za-z0-9_]+` + optionally `|filter` + `}}`, with no spaces inside.',
      '- The value is `String(vars[key])`; a missing key renders as the empty string.',
      '- Filters: `upper` uppercases the value, `lower` lowercases it, any other filter leaves the value unchanged.',
      '- Anything that is not a well-formed placeholder stays in the output literally.',
      '',
      'Examples: `Hi {{name}}` with `{name: "Ada"}` becomes `Hi Ada`; `{{a|upper}} {{a|lower}}` with `{a: "Ada"}` becomes `ADA ada`; `{{ name }}` stays `{{ name }}`; `{{{x}}}` with `{x: "1"}` becomes `{1}`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/template.mjs': stub('export function render(template, vars)'),
  },
  oracle: oracleFor(
    "import { render } from './lib/template.mjs';",
    [
      "assert.equal(render('Hi {{name}}', { name: 'Ada' }), 'Hi Ada');",
      "assert.equal(render('{{missing}}', {}), '');",
      "assert.equal(render('{{a|upper}} {{a|lower}}', { a: 'Ada' }), 'ADA ada');",
      "assert.equal(render('{{ name }}', {}), '{{ name }}');",
      "assert.equal(render('{{{x}}}', { x: '1' }), '{1}');",
      "assert.equal(render('{{a|weird}}', { a: 'q' }), 'q');",
      "assert.equal(render('{{n}}', { n: 7 }), '7');",
      "assert.equal(render('no placeholders', {}), 'no placeholders');",
    ],
    'oracle.check.mjs',
  ),
};

const wrapTask: BenchTask = {
  id: 'word-wrap',
  tags: ['text'],
  implFile: 'lib/wrap.mjs',
  prompt: promptFor(
    [
      'Implement `wrapText(text, width)` in `lib/wrap.mjs`. It greedily wraps text to a maximum line width.',
      '',
      'Rules:',
      '- `width` must be an integer of at least 1, otherwise throw `RangeError`.',
      '- Existing newlines are preserved: every line between them is wrapped independently.',
      '- Within a line, words are the non-empty pieces split on runs of spaces; output joins words with a single space.',
      '- Keep adding words to the current line while the joined length fits within `width`; otherwise start a new line.',
      '- The first word of a line is always placed, even when it alone is longer than `width`.',
      '- An empty line stays empty.',
      '',
      'Examples: `wrapText("a b c", 4)` is `"a b\\nc"`; `wrapText("a b c", 5)` is `"a b c"`; `wrapText("aaaaaaaa b", 3)` is `"aaaaaaaa\\nb"`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/wrap.mjs': stub('export function wrapText(text, width)'),
  },
  oracle: oracleFor(
    "import { wrapText } from './lib/wrap.mjs';",
    [
      "assert.equal(wrapText('a b c', 4), 'a b\\nc');",
      "assert.equal(wrapText('a b c', 5), 'a b c');",
      "assert.equal(wrapText('aa bb cc', 4), 'aa\\nbb\\ncc');",
      "assert.equal(wrapText('aaaaaaaa b', 3), 'aaaaaaaa\\nb');",
      "assert.equal(wrapText('one two three', 20), 'one two three');",
      "assert.equal(wrapText('a\\nbb ccc', 3), 'a\\nbb\\nccc');",
      "assert.equal(wrapText('', 4), '');",
      "assert.equal(wrapText('  spaced   out  ', 8), 'spaced\\nout');",
      "assert.throws(() => wrapText('a b', 0), RangeError);",
      "assert.throws(() => wrapText('a b', 1.5), RangeError);",
    ],
    'oracle.check.mjs',
  ),
};

const intervalsTask: BenchTask = {
  id: 'merge-intervals',
  tags: ['data-structure'],
  implFile: 'lib/intervals.mjs',
  prompt: promptFor(
    [
      'Implement `mergeIntervals(intervals)` in `lib/intervals.mjs`. It merges overlapping or touching numeric intervals.',
      '',
      'Rules:',
      '- Input is an array of `[start, end]` pairs of numbers with `start <= end`; a pair with `start > end` throws `RangeError`.',
      '- Intervals whose start equals another interval\u2019s end touch and merge.',
      '- The result is sorted by start and contains the merged intervals.',
      '- An empty input returns an empty array.',
      '',
      'Examples: `[[1,3],[2,6],[8,10]]` becomes `[[1,6],[8,10]]`; `[[1,3],[3,5]]` becomes `[[1,5]]`; `[[5,6],[1,2]]` becomes `[[1,2],[5,6]]`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/intervals.mjs': stub('export function mergeIntervals(intervals)'),
    'vendor/intervals.mjs':
      'export function mergeIntervals(intervals) {\n  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);\n  const merged = [];\n  for (const pair of sorted) {\n    if (pair[0] > pair[1]) throw new RangeError("inverted interval " + pair[0] + ".." + pair[1]);\n    const last = merged[merged.length - 1];\n    if (last !== undefined && pair[0] <= last[1]) {\n      last[1] = Math.max(last[1], pair[1]);\n      continue;\n    }\n    merged.push([pair[0], pair[1]]);\n  }\n  return merged;\n}\n',
  },
  oracle: oracleFor(
    "import { mergeIntervals } from './lib/intervals.mjs';",
    [
      'assert.deepEqual(mergeIntervals([[1,3],[2,6],[8,10]]), [[1,6],[8,10]]);',
      'assert.deepEqual(mergeIntervals([[1,3],[3,5]]), [[1,5]]);',
      'assert.deepEqual(mergeIntervals([[5,6],[1,2]]), [[1,2],[5,6]]);',
      'assert.deepEqual(mergeIntervals([]), []);',
      'assert.deepEqual(mergeIntervals([[1,1],[1,1]]), [[1,1]]);',
      'assert.deepEqual(mergeIntervals([[1,2],[4,6],[3,5]]), [[1,2],[3,6]]);',
      'assert.throws(() => mergeIntervals([[3,1]]), RangeError);',
    ],
    'oracle.check.mjs',
  ),
  decoy: { file: 'vendor/intervals.mjs' },
};

const modeTask: BenchTask = {
  id: 'parse-mode',
  tags: ['parsing'],
  implFile: 'lib/mode.mjs',
  prompt: promptFor(
    [
      'Implement `parseModeString(s)` in `lib/mode.mjs`. It converts a Unix permission string to its numeric value, or returns `null` when invalid.',
      '',
      'Rules:',
      '- The string is exactly 9 characters: user, group and other triples in that order.',
      '- Each triple is `r`, then `w`, then `x`; each position holds its permission letter or `-`.',
      '- Any other character, wrong letter at a position, or wrong length returns `null`.',
      '- The value is the octal permission number: `rwx` is 7, `rw-` is 6, `r-x` is 5, and so on per triple.',
      '',
      'Examples: `rwxr-xr-x` is 0o755; `rw-r--r--` is 0o644; `---------` is 0.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/mode.mjs': stub('export function parseModeString(s)'),
  },
  oracle: oracleFor(
    "import { parseModeString } from './lib/mode.mjs';",
    [
      "assert.equal(parseModeString('rwxr-xr-x'), 0o755);",
      "assert.equal(parseModeString('rw-r--r--'), 0o644);",
      "assert.equal(parseModeString('---------'), 0);",
      "assert.equal(parseModeString('rwxrwxrwx'), 0o777);",
      "assert.equal(parseModeString('rwxr-xr-a'), null);",
      "assert.equal(parseModeString('xwr-xwr-x'), null);",
      "assert.equal(parseModeString('rwx'), null);",
      "assert.equal(parseModeString(''), null);",
    ],
    'oracle.check.mjs',
  ),
};

const topoTask: BenchTask = {
  id: 'topo-sort',
  tags: ['data-structure'],
  implFile: 'lib/topo.mjs',
  prompt: promptFor(
    [
      'Implement `topoSort(nodes, edges)` in `lib/topo.mjs`. It topologically sorts node names.',
      '',
      'Rules:',
      '- `nodes` is an array of unique strings; a duplicate throws `Error`.',
      '- `edges` is an array of `[before, after]` pairs; an edge naming an unknown node throws `Error`.',
      '- The result lists every node so that each `before` precedes its `after`.',
      '- Whenever several nodes are available, pick the lexicographically smallest first.',
      '- A cycle returns `null`.',
      '',
      'Examples: `topoSort(["b","a","c"], [["b","c"],["a","c"]])` is `["a","b","c"]`; `topoSort(["a","b"], [["b","a"]])` is `["b","a"]`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/topo.mjs': stub('export function topoSort(nodes, edges)'),
  },
  oracle: oracleFor(
    "import { topoSort } from './lib/topo.mjs';",
    [
      "assert.deepEqual(topoSort(['b','a','c'], [['b','c'],['a','c']]), ['a','b','c']);",
      "assert.deepEqual(topoSort(['a','b'], [['b','a']]), ['b','a']);",
      "assert.deepEqual(topoSort(['a','b','c'], [['b','a'],['c','a']]), ['b','c','a']);",
      "assert.equal(topoSort(['a','b'], [['a','b'],['b','a']]), null);",
      "assert.deepEqual(topoSort(['a'], []), ['a']);",
      'assert.deepEqual(topoSort([], []), []);',
      "assert.throws(() => topoSort(['a','a'], []));",
      "assert.throws(() => topoSort(['a'], [['a','z']]));",
    ],
    'oracle.check.mjs',
  ),
};

const jsonPathTask: BenchTask = {
  id: 'json-path',
  tags: ['parsing'],
  implFile: 'lib/json-path.mjs',
  prompt: promptFor(
    [
      'Implement `getPath(obj, path)` in `lib/json-path.mjs`. It reads a nested value by path.',
      '',
      'Path grammar:',
      '- Dot-separated identifiers: `a.b.c`.',
      '- Array access appends `[n]` with a non-negative integer index: `a.b[0].c`.',
      '- Returns the value at the path, or `undefined` when any step is missing.',
      '- Indexing a non-array value with `[n]` yields `undefined`.',
      '- A malformed path returns `null`: empty string, empty segment, leading or trailing dot, `[` without `]`, a non-numeric or negative index.',
      '',
      'Examples: `getPath({a:{b:[{c:7}]}}, "a.b[0].c")` is 7; `getPath({}, "a")` is `undefined`; `getPath({a:{b:1}}, "a..b")` is `null`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/json-path.mjs': stub('export function getPath(obj, path)'),
  },
  oracle: oracleFor(
    "import { getPath } from './lib/json-path.mjs';",
    [
      "assert.equal(getPath({ a: { b: [{ c: 7 }] } }, 'a.b[0].c'), 7);",
      "assert.equal(getPath({ a: 1 }, 'a'), 1);",
      "assert.equal(getPath({}, 'a'), undefined);",
      "assert.equal(getPath({ a: [1, 2] }, 'a[1]'), 2);",
      "assert.equal(getPath({ a: [1, 2] }, 'a[2]'), undefined);",
      "assert.equal(getPath({ a: { b: 1 } }, 'a.b.c'), undefined);",
      "assert.equal(getPath({ a: {} }, 'a[0]'), undefined);",
      "assert.equal(getPath({ a: { b: 1 } }, 'a..b'), null);",
      "assert.equal(getPath({ a: { b: 1 } }, '.a'), null);",
      "assert.equal(getPath({ a: { b: 1 } }, 'a.'), null);",
      "assert.equal(getPath({ a: { b: 1 } }, ''), null);",
      "assert.equal(getPath({ a: { b: 1 } }, 'a[-1]'), null);",
      "assert.equal(getPath({ a: { b: 1 } }, 'a[x]'), null);",
      "assert.equal(getPath({ a: { b: 1 } }, 'a[b'), null);",
    ],
    'oracle.check.mjs',
  ),
};

const arrayDiffTask: BenchTask = {
  id: 'array-diff',
  tags: ['data-structure'],
  implFile: 'lib/array-diff.mjs',
  prompt: promptFor(
    [
      'Implement `diffArrays(oldArr, newArr)` in `lib/array-diff.mjs`. It compares two arrays as multisets.',
      '',
      'Rules:',
      '- Return `{ added, removed }`.',
      '- An item that occurs more often in the new array than in the old one appears in `added` with the difference in count; likewise for `removed`.',
      '- `added` keeps the occurrence order of the new array; `removed` keeps the occurrence order of the old array.',
      '',
      'Example: `diffArrays([1,2,2,3], [2,3,3,4])` is `{ added: [3, 4], removed: [1, 2] }`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/array-diff.mjs': stub('export function diffArrays(oldArr, newArr)'),
  },
  oracle: oracleFor(
    "import { diffArrays } from './lib/array-diff.mjs';",
    [
      'assert.deepEqual(diffArrays([1,2,2,3], [2,3,3,4]), { added: [3,4], removed: [1,2] });',
      'assert.deepEqual(diffArrays([], [1,1]), { added: [1,1], removed: [] });',
      'assert.deepEqual(diffArrays([1,1], []), { added: [], removed: [1,1] });',
      "assert.deepEqual(diffArrays(['a','b'], ['b','a']), { added: [], removed: [] });",
      'assert.deepEqual(diffArrays([1,2,3], [1,2,3]), { added: [], removed: [] });',
    ],
    'oracle.check.mjs',
  ),
};

const rleTask: BenchTask = {
  id: 'run-length',
  tags: ['text'],
  implFile: 'lib/rle.mjs',
  prompt: promptFor(
    [
      'Implement `rleEncode(text)` in `lib/rle.mjs` and `rleDecode(pairs)` in `lib/rle-decode.mjs`, a run-length codec.',
      '',
      'Rules:',
      '- `rleEncode("")` is `[]`; otherwise the output is an array of `[character, count]` pairs for each maximal run, in order.',
      '- `rleDecode([])` is the empty string; it concatenates each pair\u2019s character `count` times.',
      '- A count that is not a positive integer throws `RangeError`.',
      '- Decoding the encoding of any string returns the original string.',
      '',
      'Example: `rleEncode("aaabb")` is `[["a", 3], ["b", 2]]` and `rleDecode([["a", 3], ["b", 2]])` is `"aaabb"`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/rle.mjs': stub('export function rleEncode(text)'),
    'lib/rle-decode.mjs': stub('export function rleDecode(pairs)'),
  },
  oracle: oracleFor(
    "import { rleEncode } from './lib/rle.mjs';\nimport { rleDecode } from './lib/rle-decode.mjs';",
    [
      "assert.deepEqual(rleEncode('aaabb'), [['a', 3], ['b', 2]]);",
      "assert.deepEqual(rleEncode(''), []);",
      "assert.deepEqual(rleEncode('abc'), [['a', 1], ['b', 1], ['c', 1]]);",
      "assert.equal(rleDecode([['a', 3], ['b', 2]]), 'aaabb');",
      "assert.equal(rleDecode([]), '');",
      "assert.equal(rleDecode(rleEncode('mississippi')), 'mississippi');",
      "assert.throws(() => rleDecode([['a', 0]]), RangeError);",
      "assert.throws(() => rleDecode([['a', 1.5]]), RangeError);",
    ],
    'oracle.check.mjs',
  ),
};

const dayOfYearTask: BenchTask = {
  id: 'day-of-year',
  tags: ['dates'],
  implFile: 'lib/day-of-year.mjs',
  prompt: promptFor(
    [
      'Implement `dayOfYear(dateText)` in `lib/day-of-year.mjs` and `isLeapYear(year)` in `lib/leap.mjs`.',
      '',
      'Rules:',
      '- `isLeapYear(year)`: divisible by 4, except exact centuries unless divisible by 400.',
      '- `dayOfYear(dateText)`: `dateText` is a `YYYY-MM-DD` string with a four-digit year, month 01-12 and a day valid for that month (leap-aware). Returns the 1-based day of year, or `null` for any other input.',
      '',
      'Examples: `dayOfYear("2026-01-01")` is 1; `dayOfYear("2026-12-31")` is 365; `dayOfYear("2028-12-31")` is 366; `dayOfYear("2026-02-29")` is `null` because 2026 is not a leap year.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/day-of-year.mjs': notImplemented('dayOfYear'),
    'lib/leap.mjs': stub('export function isLeapYear(year)'),
  },
  oracle: oracleFor(
    "import { dayOfYear } from './lib/day-of-year.mjs';\nimport { isLeapYear } from './lib/leap.mjs';",
    [
      'assert.equal(isLeapYear(2028), true);',
      'assert.equal(isLeapYear(2029), false);',
      'assert.equal(isLeapYear(1900), false);',
      'assert.equal(isLeapYear(2000), true);',
      "assert.equal(dayOfYear('2026-01-01'), 1);",
      "assert.equal(dayOfYear('2026-12-31'), 365);",
      "assert.equal(dayOfYear('2028-12-31'), 366);",
      "assert.equal(dayOfYear('2028-02-29'), 60);",
      "assert.equal(dayOfYear('2026-02-29'), null);",
      "assert.equal(dayOfYear('2026-02-30'), null);",
      "assert.equal(dayOfYear('2026-13-01'), null);",
      "assert.equal(dayOfYear('2026-1-1'), null);",
      "assert.equal(dayOfYear('26-01-01'), null);",
    ],
    'oracle.check.mjs',
  ),
};

const splitBillTask: BenchTask = {
  id: 'split-bill',
  tags: ['numbers'],
  implFile: 'lib/split-bill.mjs',
  prompt: promptFor(
    [
      'Implement `splitBill(totalCents, people)` in `lib/split-bill.mjs`. It splits an amount in cents across people without losing a cent.',
      '',
      'Rules:',
      '- `totalCents` is an integer of at least 0 and `people` an integer of at least 1; anything else throws `RangeError`.',
      '- Everyone gets `Math.floor(totalCents / people)` cents.',
      '- The first `totalCents % people` people get one extra cent.',
      '- The result sums back to exactly `totalCents`.',
      '',
      'Examples: `splitBill(1001, 4)` is `[251, 250, 250, 250]`; `splitBill(7, 3)` is `[3, 2, 2]`; `splitBill(2, 5)` is `[1, 1, 0, 0, 0]`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/split-bill.mjs': stub('export function splitBill(totalCents, people)'),
  },
  oracle: oracleFor(
    "import { splitBill } from './lib/split-bill.mjs';",
    [
      'assert.deepEqual(splitBill(1000, 4), [250, 250, 250, 250]);',
      'assert.deepEqual(splitBill(1001, 4), [251, 250, 250, 250]);',
      'assert.deepEqual(splitBill(7, 3), [3, 2, 2]);',
      'assert.deepEqual(splitBill(0, 3), [0, 0, 0]);',
      'assert.deepEqual(splitBill(2, 5), [1, 1, 0, 0, 0]);',
      'assert.equal(splitBill(101, 4).reduce((a, b) => a + b, 0), 101);',
      'assert.throws(() => splitBill(-1, 3), RangeError);',
      'assert.throws(() => splitBill(10, 0), RangeError);',
      'assert.throws(() => splitBill(10.5, 2), RangeError);',
    ],
    'oracle.check.mjs',
  ),
};

const priorityQueueTask: BenchTask = {
  id: 'priority-queue',
  tags: ['data-structure'],
  implFile: 'lib/priority-queue.mjs',
  prompt: promptFor(
    [
      'Implement the class `MinPriorityQueue` in `lib/priority-queue.mjs`.',
      '',
      'API:',
      '- `push(value, priority)`: `priority` must be a number and not `NaN`, otherwise throw `TypeError`.',
      '- `pop()`: removes and returns the value with the smallest priority; among equal priorities, the value pushed first wins. An empty queue throws `Error`.',
      '- `peek()`: like `pop()` but keeps the entry; an empty queue throws `Error`.',
      '- `size`: getter for the number of entries.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/priority-queue.mjs': stubClass('export class MinPriorityQueue'),
  },
  oracle: oracleFor(
    "import { MinPriorityQueue } from './lib/priority-queue.mjs';",
    [
      'const q = new MinPriorityQueue();',
      "q.push('a', 2);",
      "q.push('b', 1);",
      "q.push('c', 3);",
      'assert.equal(q.size, 3);',
      "assert.equal(q.peek(), 'b');",
      'assert.equal(q.size, 3);',
      "assert.equal(q.pop(), 'b');",
      "assert.equal(q.pop(), 'a');",
      "assert.equal(q.pop(), 'c');",
      'assert.throws(() => q.pop());',
      'assert.throws(() => q.peek());',
      'const tie = new MinPriorityQueue();',
      "tie.push('x', 1);",
      "tie.push('y', 1);",
      "tie.push('z', 1);",
      "assert.equal(tie.pop(), 'x');",
      "assert.equal(tie.pop(), 'y');",
      "assert.equal(tie.pop(), 'z');",
      "assert.throws(() => tie.push('n', Number.NaN), TypeError);",
    ],
    'oracle.check.mjs',
  ),
};

const outlineTask: BenchTask = {
  id: 'markdown-outline',
  tags: ['text'],
  implFile: 'lib/outline.mjs',
  prompt: promptFor(
    [
      'Implement `outline(markdown)` in `lib/outline.mjs`. It extracts ATX headings.',
      '',
      'Rules:',
      '- A heading line starts with 1 to 6 `#` characters followed by one space; up to 3 leading spaces are allowed.',
      '- The result is an array of `{ level, text }`; `text` is the heading text trimmed.',
      '- Seven or more `#` characters, a missing space after the `#` run, or 4 leading spaces make the line a non-heading.',
      '- Headings inside fenced code blocks do not count: a fence line starts with ``` or `~~~` (up to 3 leading spaces); the fence ends at the next line starting with the same marker. An unclosed fence hides the rest of the input.',
      '',
      'Example: for `"# Title\\n\\n## Sub"` the result is `[{level: 1, text: "Title"}, {level: 2, text: "Sub"}]`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/outline.mjs': stub('export function outline(markdown)'),
  },
  oracle: oracleFor(
    "import { outline } from './lib/outline.mjs';",
    [
      "assert.deepEqual(outline('# Title'), [{ level: 1, text: 'Title' }]);",
      "assert.deepEqual(outline('### Deep'), [{ level: 3, text: 'Deep' }]);",
      "assert.deepEqual(outline('####### Seven'), []);",
      "assert.deepEqual(outline('#NoSpace'), []);",
      "assert.deepEqual(outline('    # Four'), []);",
      "assert.deepEqual(outline('  # Two'), [{ level: 1, text: 'Two' }]);",
      "assert.deepEqual(outline('# A\\n```\\n# Hidden\\n```\\n# B'), [{ level: 1, text: 'A' }, { level: 1, text: 'B' }]);",
      "assert.deepEqual(outline('# A\\n~~~\\n# Hidden\\n~~~\\n# B'), [{ level: 1, text: 'A' }, { level: 1, text: 'B' }]);",
      "assert.deepEqual(outline('# A\\n```\\n# B'), [{ level: 1, text: 'A' }]);",
      "assert.deepEqual(outline(''), []);",
    ],
    'oracle.check.mjs',
  ),
};

const isbnTask: BenchTask = {
  id: 'isbn',
  tags: ['parsing'],
  implFile: 'lib/isbn.mjs',
  prompt: promptFor(
    [
      'Implement `isValidIsbn10(s)` in `lib/isbn.mjs` and `isValidIsbn13(s)` in `lib/isbn13.mjs`.',
      '',
      'Rules:',
      '- Hyphens and spaces are stripped before checking; they may appear anywhere between characters.',
      '- ISBN-10: exactly 10 characters after stripping; the first 9 are digits, the last is a digit or uppercase `X` (value 10). Valid when the weighted sum `digit * (10 - position)` for positions 0 to 9 is divisible by 11.',
      '- ISBN-13: exactly 13 digits after stripping. Valid when the sum of digits with weights alternating 1, 3, 1, 3, ... starting at 1 is divisible by 10.',
      '- Anything else returns false.',
      '',
      'Examples: `0306406152` and `0-306-40615-2` are valid ISBN-10; `043942089X` is valid ISBN-10; `9780306406157` and `978-0-306-40615-7` are valid ISBN-13.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/isbn.mjs': notImplemented('isValidIsbn10'),
    'lib/isbn13.mjs': stub('export function isValidIsbn13(s)'),
  },
  oracle: oracleFor(
    "import { isValidIsbn10 } from './lib/isbn.mjs';\nimport { isValidIsbn13 } from './lib/isbn13.mjs';",
    [
      "assert.equal(isValidIsbn10('0306406152'), true);",
      "assert.equal(isValidIsbn10('0-306-40615-2'), true);",
      "assert.equal(isValidIsbn10('043942089X'), true);",
      "assert.equal(isValidIsbn10('0306406151'), false);",
      "assert.equal(isValidIsbn10('030640615'), false);",
      "assert.equal(isValidIsbn10('0306406152X'), false);",
      "assert.equal(isValidIsbn13('9780306406157'), true);",
      "assert.equal(isValidIsbn13('978-0-306-40615-7'), true);",
      "assert.equal(isValidIsbn13('9780306406158'), false);",
      "assert.equal(isValidIsbn13('97803064061'), false);",
    ],
    'oracle.check.mjs',
  ),
};

const pluralTask: BenchTask = {
  id: 'pluralize',
  tags: ['text'],
  implFile: 'lib/plural.mjs',
  prompt: promptFor(
    [
      'Implement `pluralize(word, count, pluralForm)` in `lib/plural.mjs`. The third argument is optional.',
      '',
      'Rules, applied in order:',
      '- `count === 1` returns `word` unchanged.',
      '- When `pluralForm` is given, return it.',
      '- Irregulars (matched on the lowercase word): `child` becomes `children`, `person` becomes `people`, `goose` becomes `geese`, `mouse` becomes `mice`, `foot` becomes `feet`, `tooth` becomes `teeth`.',
      '- A word ending in `s`, `x`, `z`, `ch` or `sh` gets `es` appended.',
      '- A word ending in a consonant followed by `y` drops the `y` and gets `ies`; a vowel followed by `y` just gets `s`.',
      '- Every other word gets `s` appended.',
      '',
      'Examples: `pluralize("baby", 2)` is `"babies"`; `pluralize("day", 2)` is `"days"`; `pluralize("cat", 2, "kittens")` is `"kittens"`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/plural.mjs': stub('export function pluralize(word, count, pluralForm)'),
    'vendor/plural.mjs':
      'const IRREGULAR_FORMS = new Map([\n  ["child", "children"],\n  ["person", "people"],\n  ["goose", "geese"],\n  ["mouse", "mice"],\n  ["foot", "feet"],\n  ["tooth", "teeth"],\n]);\nconst SUFFIX_ES = /(?:s|x|z|ch|sh)$/;\nconst CONSONANT_Y = /[^aeiou]y$/;\nexport function pluralize(word, count, pluralForm) {\n  if (count === 1) return word;\n  if (pluralForm !== undefined) return pluralForm;\n  const irregular = IRREGULAR_FORMS.get(word.toLowerCase());\n  if (irregular !== undefined) return irregular;\n  if (SUFFIX_ES.test(word)) return word + "es";\n  if (CONSONANT_Y.test(word)) return word.slice(0, -1) + "ies";\n  return word + "s";\n}\n',
  },
  oracle: oracleFor(
    "import { pluralize } from './lib/plural.mjs';",
    [
      "assert.equal(pluralize('cat', 1), 'cat');",
      "assert.equal(pluralize('cat', 2), 'cats');",
      "assert.equal(pluralize('box', 2), 'boxes');",
      "assert.equal(pluralize('church', 3), 'churches');",
      "assert.equal(pluralize('baby', 2), 'babies');",
      "assert.equal(pluralize('day', 2), 'days');",
      "assert.equal(pluralize('child', 2), 'children');",
      "assert.equal(pluralize('person', 4), 'people');",
      "assert.equal(pluralize('mouse', 2), 'mice');",
      "assert.equal(pluralize('goose', 2), 'geese');",
      "assert.equal(pluralize('foot', 2), 'feet');",
      "assert.equal(pluralize('tooth', 2), 'teeth');",
      "assert.equal(pluralize('cat', 2, 'kittens'), 'kittens');",
      "assert.equal(pluralize('cat', 1, 'kittens'), 'cat');",
    ],
    'oracle.check.mjs',
  ),
  decoy: { file: 'vendor/plural.mjs' },
};

const transposeTask: BenchTask = {
  id: 'matrix-transpose',
  tags: ['data-structure'],
  implFile: 'lib/transpose.mjs',
  prompt: promptFor(
    [
      'Implement `transpose(matrix)` in `lib/transpose.mjs`. It transposes a square or rectangular matrix.',
      '',
      'Rules:',
      '- The input is an array of rows, each an array of numbers.',
      '- Every row must have the same length; a ragged matrix throws `Error`.',
      '- An empty matrix (no rows) returns an empty array.',
      '- The result has `row length` rows of `matrix length` columns: `result[c][r]` is `matrix[r][c]`.',
      '',
      'Example: `transpose([[1, 2], [3, 4], [5, 6]])` is `[[1, 3, 5], [2, 4, 6]]`.',
    ].join('\n'),
  ),
  seedFiles: {
    'lib/transpose.mjs': stub('export function transpose(matrix)'),
  },
  oracle: oracleFor(
    "import { transpose } from './lib/transpose.mjs';",
    [
      'assert.deepEqual(transpose([[1, 2], [3, 4], [5, 6]]), [[1, 3, 5], [2, 4, 6]]);',
      'assert.deepEqual(transpose([[1]]), [[1]]);',
      'assert.deepEqual(transpose([[1, 2]]), [[1], [2]]);',
      'assert.deepEqual(transpose([]), []);',
      'assert.deepEqual(transpose(transpose([[1, 2, 3], [4, 5, 6]])), [[1, 2, 3], [4, 5, 6]]);',
      'assert.throws(() => transpose([[1, 2], [3]]));',
    ],
    'oracle.check.mjs',
  ),
};

export const CAIRN_BENCH_TASKS: readonly BenchTask[] = [
  slugifyTask,
  durationTask,
  lruTask,
  csvTask,
  overlapTask,
  romanTask,
  templateTask,
  wrapTask,
  intervalsTask,
  modeTask,
  topoTask,
  jsonPathTask,
  arrayDiffTask,
  rleTask,
  dayOfYearTask,
  splitBillTask,
  priorityQueueTask,
  outlineTask,
  isbnTask,
  pluralTask,
  transposeTask,
];

export function seedWorkdir(workdir: string, task: BenchTask): void {
  for (const [path, content] of Object.entries(task.seedFiles)) {
    const target = join(workdir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function safeRelative(path: string): boolean {
  return (
    path !== '' && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..')
  );
}

export function benchTaskProblems(task: BenchTask): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(task.id)) problems.push(`id '${task.id}' is not kebab-case`);
  if (task.tags.length === 0) problems.push('no tags');
  for (const tag of task.tags) {
    if (!/^[a-z0-9-]+$/.test(tag)) problems.push(`tag '${tag}' is not kebab-case`);
  }
  if (!safeRelative(task.implFile))
    problems.push(`implFile '${task.implFile}' is not a safe relative path`);
  if (task.prompt.trim() === '') problems.push('empty prompt');
  if (!task.prompt.includes(task.implFile)) problems.push('prompt does not name implFile');
  const seedPaths = Object.keys(task.seedFiles);
  if (seedPaths.length === 0) problems.push('no seed files');
  for (const path of seedPaths) {
    if (!safeRelative(path)) problems.push(`seed file '${path}' is not a safe relative path`);
  }
  if (!(task.implFile in task.seedFiles))
    problems.push(`implFile '${task.implFile}' is not seeded`);
  if ((task.seedFiles[task.implFile] ?? '').trim() === '') problems.push('implFile seed is empty');
  const oraclePaths = Object.keys(task.oracle.files);
  if (oraclePaths.length === 0) problems.push('no oracle files');
  for (const path of oraclePaths) {
    if (!safeRelative(path)) problems.push(`oracle file '${path}' is not a safe relative path`);
  }
  for (const path of oraclePaths) {
    if (path in task.seedFiles) problems.push(`oracle file '${path}' overwrites a seed file`);
  }
  const command = task.oracle.command;
  const entry = command[1];
  if (command.length < 2 || command[0] !== 'node' || entry === undefined || entry === '') {
    problems.push('oracle command must be node <file>');
  } else if (!(entry in task.oracle.files)) {
    problems.push('oracle command does not name an oracle file');
  }
  const decoy = task.decoy;
  if (decoy !== undefined) {
    if (!safeRelative(decoy.file))
      problems.push(`decoy '${decoy.file}' is not a safe relative path`);
    if (!(decoy.file in task.seedFiles)) problems.push(`decoy '${decoy.file}' is not seeded`);
    if (decoy.file === task.implFile) problems.push('decoy equals implFile');
    if ((task.seedFiles[decoy.file] ?? '').trim() === '') problems.push('decoy seed is empty');
  }
  return problems;
}
