import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as shared from '@cairn/shared';
import { transformSync } from 'esbuild';
import { describe, expect, test } from 'vitest';
import * as records from '../../../packages/shared/src/records/merge-gate.js';

const GATE_DIR = resolve(import.meta.dirname, '../src/services/merge-gate');
const RECORDS = resolve(import.meta.dirname, '../../../packages/shared/src/records/merge-gate.ts');
const NODE_BUILTINS = new Set(['node:crypto']);
const LOADERS =
  /\b(?:import|require)\s*\(|\bimport\.meta\b|\bcreateRequire\b|\beval\b|\bFunction\b|\bconstructor\b|\bprocess\b|\bglobalThis\b/g;
const LOADER: Record<string, 'ts' | 'tsx' | 'js' | 'jsx'> = {
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'jsx',
};
const CODE_FILE = new RegExp(`\\.(?:${Object.keys(LOADER).join('|')})$`);

const toJs = (source: string, file = 'x.ts') =>
  transformSync(source, {
    loader: LOADER[file.split('.').pop() ?? ''] ?? 'ts',
    format: 'esm',
    legalComments: 'none',
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  }).code;

function specifiers(js: string): string[] {
  const found: string[] = [];
  const out = js.split('');
  let i = 0;
  const blank = (end: string, interp = false) => {
    i += 1;
    while (i < out.length) {
      if (out[i] === '\\') {
        out[i] = ' ';
        if (i + 1 < out.length) out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (out[i] === end) {
        i += 1;
        return;
      }
      if (interp && out[i] === '$' && out[i + 1] === '{') {
        i += 2;
        let depth = 0;
        while (i < out.length) {
          const c = out[i];
          if (c === '}' && depth === 0) break;
          if (c === "'" || c === '"') {
            blank(c);
            continue;
          }
          if (c === '`') {
            blank('`', true);
            continue;
          }
          if (c === '{') depth += 1;
          else if (c === '}') depth -= 1;
          i += 1;
        }
        if (out[i] === '}') i += 1;
        continue;
      }
      out[i] = ' ';
      i += 1;
    }
  };
  while (i < out.length) {
    const c = out[i];
    if (c === "'" || c === '"') blank(c);
    else if (c === '`') blank('`', true);
    else i += 1;
  }
  const blanked = out.join('');
  for (const m of js.matchAll(/\bfrom\s*(['"])([^'"]+)\1/g)) found.push(m[2] as string);
  for (const m of js.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) found.push(m[2] as string);
  for (const m of blanked.matchAll(LOADERS)) found.push(`dynamic:${m[0]}`);
  return found;
}

function sharedNames(js: string): string[] {
  const names: string[] = [];
  let parsed = 0;
  for (const m of js.matchAll(
    /^(?:import|export)\s+(\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)\s*from\s*(['"])@cairn\/shared(?:\/merge-gate)?\2/gm,
  )) {
    parsed += 1;
    const clause = (m[1] as string).trim();
    const braces = /^\{([^}]*)\}$/.exec(clause);
    if (braces === null) {
      names.push(`non-named:${clause}`);
      continue;
    }
    for (const item of (braces[1] as string).split(',')) {
      const name = item.trim();
      if (name !== '') names.push(name.split(/\s+as\s+/)[0] as string);
    }
  }
  const statements = [...js.matchAll(/\bfrom\s*(['"])@cairn\/shared(?:\/merge-gate)?\1/g)].length;
  if (statements !== parsed) names.push(`non-named:${statements - parsed} unparsed`);
  return names;
}

function allowed(spec: string, file: string): boolean {
  if (spec === '@cairn/shared/merge-gate' || NODE_BUILTINS.has(spec)) return true;
  if (!spec.startsWith('./') && !spec.startsWith('../')) return false;
  const target = resolve(dirname(file), spec);
  return target === GATE_DIR || target.startsWith(GATE_DIR + sep);
}

const entries = (readdirSync(GATE_DIR, { recursive: true }) as string[]).map((name) =>
  join(GATE_DIR, name),
);
const gateFiles = entries.filter((f) => CODE_FILE.test(f));
const gateJs = gateFiles.map((file) => ({ file, js: toJs(readFileSync(file, 'utf8'), file) }));
const sharedValues = shared as unknown as Record<string, unknown>;
const recordValues = records as unknown as Record<string, unknown>;
const foreignName = (name: string) =>
  !(name in recordValues) || sharedValues[name] !== recordValues[name];

function deepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (value instanceof Map || value instanceof Set || ArrayBuffer.isView(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

describe('merge-gate sources import only from the gate own sources', () => {
  test('the parser recognizes every form; comments and ; inside braces do not fool it', () => {
    const sample = toJs(
      [
        "import { a } from '../../lib/github.js';",
        "import type { B } from 'zod';",
        'import {\n  c, // c; d\n  d,\n} from "./x.js";',
        "export { e } from '../other/e.js';",
        "export * from 'node:fs';",
        "import './side-effect.js';",
        "import { createRequire } from 'node:module';",
        '// 闸只 import type 的东西',
        "import { evil /* ; */ } from '@cairn/shared';",
        "import { type T, good, other as alias } from '@cairn/shared';",
        "import * as all from '@cairn/shared';",
        'export const used = [a, c, d, evil, good, alias, all];',
        "const f = await import('../../lib/github.js');",
        "const g = require('x');",
        'const h = createRequire(import.meta.url);',
        "const i = eval('1') + new Function('return 1')() + process.pid + globalThis.x;",
        'const F = Function;',
        "const G = (() => {}).constructor('return 1');",
        "import { unused } from '../../lib/unused.js';",
        "import {} from '../../lib/empty.js';",
      ].join('\n'),
    );
    expect(
      specifiers(sample)
        .filter((s) => !s.startsWith('dynamic:'))
        .sort(),
    ).toEqual(
      [
        '../../lib/github.js',
        './x.js',
        'node:module',
        '@cairn/shared',
        '@cairn/shared',
        '@cairn/shared',
        '../other/e.js',
        'node:fs',
        './side-effect.js',
        '../../lib/unused.js',
        '../../lib/empty.js',
      ].sort(),
    );
    expect(new Set(specifiers(sample).filter((s) => s.startsWith('dynamic:')))).toEqual(
      new Set([
        'dynamic:import(',
        'dynamic:require(',
        'dynamic:createRequire',
        'dynamic:import.meta',
        'dynamic:eval',
        'dynamic:Function',
        'dynamic:constructor',
        'dynamic:process',
        'dynamic:globalThis',
      ]),
    );
    expect(sharedNames(sample)).toEqual(['evil', 'good', 'other', 'non-named:* as all']);
    expect(sharedNames(toJs("import * as ñ from '@cairn/shared';\nexport const v = ñ;"))).toEqual([
      'non-named:1 unparsed',
    ]);
    expect(
      sharedNames(
        toJs(
          "export function f() {}\nimport { MERGE_BLOCKERS } from '@cairn/shared';\nf(MERGE_BLOCKERS);",
        ),
      ),
    ).toEqual(['MERGE_BLOCKERS']);
    expect(
      specifiers(toJs("export const C = () => <b/>;\nimport { x } from '../y.js';", 'h.tsx')),
    ).toContain('../y.js');
    expect(foreignName('phaseSchema')).toBe(true);
    expect(foreignName('MERGE_BLOCKERS')).toBe(false);
    const file = join(GATE_DIR, 'readiness.ts');
    expect(allowed('@cairn/shared', file)).toBe(false);
    expect(allowed('@cairn/shared/merge-gate', file)).toBe(true);
    expect(allowed('node:crypto', file)).toBe(true);
    expect(allowed('node:module', file)).toBe(false);
    expect(allowed('./digest.js', file)).toBe(true);
    expect(allowed('../../lib/github.js', file)).toBe(false);
    expect(allowed('../merge-gate-extra/x.js', file)).toBe(false);
    expect(allowed('zod', file)).toBe(false);
    expect(allowed('@cairn/shared/src/brand.js', file)).toBe(false);
    expect(specifiers(toJs("export const p = 'integration/eval/chief-dispatch';"))).toEqual([]);
    expect(specifiers(toJs('export const evaluate = 1;'))).toEqual([]);
    expect(specifiers(toJs("const e = eval; e('1');"))).toEqual(['dynamic:eval']);
    expect(specifiers(toJs("(0, eval)('1');"))).toEqual(['dynamic:eval']);
    expect(specifiers(toJs("const x = eval('1');"))).toEqual(['dynamic:eval']);
    expect(specifiers(toJs('const p = "./x.js";\nconst f = await import(p);'))).toContain(
      'dynamic:import(',
    );
    expect(specifiers(toJs("const f = new Function('return 1');"))).toEqual(
      expect.arrayContaining(['dynamic:Function']),
    );
  });

  test('runtime imports do not go through the shared barrel', () => {
    const outside = gateJs.flatMap(({ file, js }) =>
      specifiers(js)
        .filter((spec) => spec === '@cairn/shared')
        .map((spec) => `${relative(GATE_DIR, file)}: ${spec}`),
    );
    expect(outside).toEqual([]);
  });

  test('the gate sources were actually read (not vacuously true over zero files)', () => {
    const names = gateFiles.map((f) => relative(GATE_DIR, f)).sort();
    expect(names).toEqual(expect.arrayContaining(['digest.ts', 'readiness.ts']));
  });

  test("each module imports only from '@cairn/shared', node:crypto or relative paths inside merge-gate/, loading no other code", () => {
    const outside = gateJs.flatMap(({ file, js }) =>
      specifiers(js)
        .filter((spec) => !allowed(spec, file))
        .map((spec) => `${relative(GATE_DIR, file)}: ${spec}`),
    );
    expect(outside).toEqual([]);
  });

  test("runtime values taken from '@cairn/shared' are exactly the ones records/merge-gate.ts exports", () => {
    const foreign = gateJs.flatMap(({ file, js }) =>
      sharedNames(js)
        .filter(foreignName)
        .map((name) => `${relative(GATE_DIR, file)}: ${name}`),
    );
    expect(foreign).toEqual([]);
    expect(gateJs.flatMap(({ js }) => sharedNames(js))).toContain('MERGE_BLOCKERS');
  });

  test('no symlink inside merge-gate/ points elsewhere (any extension, directories included)', () => {
    const real = realpathSync(GATE_DIR);
    const escaping = entries.filter((f) => !realpathSync(f).startsWith(real + sep));
    expect(escaping.map((f) => relative(GATE_DIR, f))).toEqual([]);
  });

  test("records/merge-gate.ts imports only from 'zod', loading no other code", () => {
    expect(specifiers(toJs(readFileSync(RECORDS, 'utf8')))).toEqual(['zod']);
  });

  test('arrays and objects exported by records/merge-gate.ts are frozen (other shared modules cannot alter the gate lists and caps)', () => {
    const thawed = Object.entries(recordValues)
      .filter(([, value]) => !deepFrozen(value))
      .map(([name]) => name);
    expect(thawed).toEqual([]);
    expect(Array.isArray(recordValues.PROTECTED_PATH_GLOBS)).toBe(true);
    expect(deepFrozen(Object.freeze([Object.freeze({ a: [] })]))).toBe(false);
    expect(deepFrozen(Object.freeze([Object.freeze({ a: Object.freeze([]) })]))).toBe(true);
    expect(deepFrozen(Object.freeze(Object.assign(Object.create(null), { a: [] })))).toBe(false);
    expect(deepFrozen(Object.freeze(new Set(['**'])))).toBe(false);
  });
});
