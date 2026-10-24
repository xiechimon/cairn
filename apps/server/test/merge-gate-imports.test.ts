// 合并就绪闸（#1404）：闸的源码只依赖闸自己的源码。ADR 0021 D4 ④ 按路径认闸的源码
// （apps/server/src/services/merge-gate/**、packages/shared/src/records/merge-gate.ts、
// apps/daemon/src/merge-decision.ts），这些路径上的改动一律要人合。闸要是从别处
// import 了判定用的东西（比如 lib/github.ts 的 SHA 判定），只改那个文件的 PR 就能改掉
// 闸认什么、不认什么，路径判定却看不出它碰了闸，照样自动合并。
// 失败方式先行：
// - merge-gate/ 下的模块从这几处之外 import：相对路径跳出 merge-gate/、别的包、
//   node:crypto 以外的内置模块（node:module、node:vm 之类能按路径加载别的文件）；
// - 绕开静态 import 加载代码：import()、require()、createRequire、import.meta、eval、
//   Function（构造、借名，或经 .constructor 取到）、process、globalThis；只写不用的
//   import 照样会加载外面的模块（运行时按 verbatimModuleSyntax 保留它）；漏查
//   .tsx / .jsx 模块；
// - 从 '@cairn/shared' 这个总出口取 records/merge-gate.ts 以外的运行时值（总出口还带着
//   shared 的几十个别的模块，它们都可自动合并）；名字虽是 records 里的，总出口
//   （index.ts、records/index.ts，都不是闸的路径）却把它改指到别的模块；用命名空间 /
//   默认 import 让逐个名字的检查看不见；
// - merge-gate/ 里放一个指向别处的符号链接（任何扩展名），相对路径看着在里面，读的
//   却是外面的文件；records/merge-gate.ts 自己从 'zod' 以外的地方取值；
// - 总出口 import 时运行的别的 shared 模块（可自动合并）改写 records 导出的数组与对象
//   （清空保护清单、往可自动合并集里加 '**'、改上限），值还是同一个，内容却变了；
// - 解析器被注释或写法骗过（注释里的 import 字样、花括号里的 ;、import type、多行
//   import）；目录读空了，检查对零个文件恒真。
// 解析不用正则直接读源码：先用 esbuild 把每个模块转成 JS（去掉注释与只作类型用的
// import，按 verbatimModuleSyntax 保留没用到的 import，import 语句按统一的格式重印），
// 再从转出的代码里取模块名与名字。正则也扫字符串字面量，文案里出现同形文字时会多报
// （严的一侧）。
// 这条测试防的是闸的源码直接依赖闸外的文件；闸的源码里有意写出的混淆加载本身就是
// 闸路径上的改动，要人合。'@cairn/shared' 的总出口在 import 时会运行 shared 的全部
// 模块，别的 shared 模块改全局（例如改原型）这里管不到，那是整个进程的完整性问题。

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

/** 转成 JS：注释、只作类型用的 import 与类型都去掉，没用到的 import 留着（运行时按
 * verbatimModuleSyntax 也留着），import 语句由 esbuild 重印。 */
const toJs = (source: string, file = 'x.ts') =>
  transformSync(source, {
    loader: LOADER[file.split('.').pop() ?? ''] ?? 'ts',
    format: 'esm',
    legalComments: 'none',
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  }).code;

/** 转出的 JS 里每条 import / export … from / 只为副作用的 import 的模块名，以及加载
 * 代码的其他写法（记成 'dynamic:' 前缀）。 */
function specifiers(js: string): string[] {
  const found: string[] = [];
  for (const m of js.matchAll(/\bfrom\s*(['"])([^'"]+)\1/g)) found.push(m[2] as string);
  for (const m of js.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) found.push(m[2] as string);
  for (const m of js.matchAll(LOADERS)) found.push(`dynamic:${m[0]}`);
  return found;
}

/** 转出的 JS 里从 '@cairn/shared' 取的名字（只作类型用的已被去掉）；命名空间、默认
 * import 与 export * 记成 'non-named:'。 */
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
  // 没被上面的形状认出的 '@cairn/shared' 语句（例如 esbuild 把非 ASCII 的名字印成
  // \uXXXX）一律记下，不让它悄悄漏过；只为副作用的 import 不带名字，不算。
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
/** 不是 records/merge-gate.ts 导出的那一个值（不在 records 里，或总出口改指了别处）。 */
const foreignName = (name: string) =>
  !(name in recordValues) || sharedValues[name] !== recordValues[name];

/** 数组与普通对象，连同其中的数组与普通对象，都冻住了吗（zod schema 之类的类实例不算）。 */
function deepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  // 冻不住内容的容器（Map、Set、类型化数组）一律算没冻住
  if (value instanceof Map || value instanceof Set || ArrayBuffer.isView(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

describe('merge-gate 源码只从闸自己的源码 import', () => {
  test('解析认得每种写法，注释与花括号里的 ; 骗不过它', () => {
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
    // esbuild 把非 ASCII 的名字印成 \uXXXX：形状认不出也要记下
    expect(sharedNames(toJs("import * as ñ from '@cairn/shared';\nexport const v = ñ;"))).toEqual([
      'non-named:1 unparsed',
    ]);
    // 前一句没有分号（esbuild 重印的函数声明）时，名字不被吞进前一句
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
  });

  test('运行时导入不经过 shared 总出口', () => {
    const outside = gateJs.flatMap(({ file, js }) =>
      specifiers(js)
        .filter((spec) => spec === '@cairn/shared')
        .map((spec) => `${relative(GATE_DIR, file)}: ${spec}`),
    );
    expect(outside).toEqual([]);
  });

  test('读到了闸的源码（不是对零个文件恒真）', () => {
    const names = gateFiles.map((f) => relative(GATE_DIR, f)).sort();
    expect(names).toEqual(expect.arrayContaining(['digest.ts', 'readiness.ts']));
  });

  test("每个模块只从 '@cairn/shared'、node:crypto 或 merge-gate/ 里的相对路径 import，不另行加载代码", () => {
    const outside = gateJs.flatMap(({ file, js }) =>
      specifiers(js)
        .filter((spec) => !allowed(spec, file))
        .map((spec) => `${relative(GATE_DIR, file)}: ${spec}`),
    );
    expect(outside).toEqual([]);
  });

  test("从 '@cairn/shared' 取的运行时值就是 records/merge-gate.ts 导出的那一个", () => {
    const foreign = gateJs.flatMap(({ file, js }) =>
      sharedNames(js)
        .filter(foreignName)
        .map((name) => `${relative(GATE_DIR, file)}: ${name}`),
    );
    expect(foreign).toEqual([]);
    // 检查确实看到了名字（不是解析落空恒真）
    expect(gateJs.flatMap(({ js }) => sharedNames(js))).toContain('MERGE_BLOCKERS');
  });

  test('merge-gate/ 里没有指向别处的符号链接（任何扩展名，目录也算）', () => {
    const real = realpathSync(GATE_DIR);
    const escaping = entries.filter((f) => !realpathSync(f).startsWith(real + sep));
    expect(escaping.map((f) => relative(GATE_DIR, f))).toEqual([]);
  });

  test("records/merge-gate.ts 只从 'zod' import，不另行加载代码", () => {
    expect(specifiers(toJs(readFileSync(RECORDS, 'utf8')))).toEqual(['zod']);
  });

  test('records/merge-gate.ts 导出的数组与对象都冻住了（别的 shared 模块改不了闸的清单与上限）', () => {
    const thawed = Object.entries(recordValues)
      .filter(([, value]) => !deepFrozen(value))
      .map(([name]) => name);
    expect(thawed).toEqual([]);
    // 检查确实看到了数据常量（不是全被当成类实例跳过）
    expect(Array.isArray(recordValues.PROTECTED_PATH_GLOBS)).toBe(true);
    expect(deepFrozen(Object.freeze([Object.freeze({ a: [] })]))).toBe(false);
    expect(deepFrozen(Object.freeze([Object.freeze({ a: Object.freeze([]) })]))).toBe(true);
    expect(deepFrozen(Object.freeze(Object.assign(Object.create(null), { a: [] })))).toBe(false);
    expect(deepFrozen(Object.freeze(new Set(['**'])))).toBe(false);
  });
});
