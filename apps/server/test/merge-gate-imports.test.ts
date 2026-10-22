// 合并就绪闸（#1404）：闸的源码只依赖闸自己的源码。ADR 0021 D4 ④ 按路径认闸的源码
// （apps/server/src/services/merge-gate/**、packages/shared/src/records/merge-gate.ts、
// apps/daemon/src/merge-decision.ts），这些路径上的改动一律要人合。闸要是从别处
// import 了判定用的东西（比如 lib/github.ts 的 SHA 判定），只改那个文件的 PR 就能改掉
// 闸认什么、不认什么，路径判定却看不出它碰了闸，照样自动合并。
// 失败方式先行：
// - merge-gate/ 下的模块从这几处之外 import：相对路径跳出 merge-gate/、别的包、
//   node:crypto 以外的内置模块（node:module、node:vm 之类能按路径加载别的文件）；
// - 绕开静态 import 加载代码：import()、require()、createRequire、import.meta、eval、
//   Function 构造、process（getBuiltinModule）、globalThis；
// - 从 '@pacman/shared' 这个总出口取 records/merge-gate.ts 以外的运行时值（总出口还带着
//   shared 的几十个别的模块，它们都可自动合并）；名字虽是 records 里的，总出口
//   （index.ts、records/index.ts，都不是闸的路径）却把它改指到别的模块；用命名空间 /
//   默认 import 让逐个名字的检查看不见；
// - merge-gate/ 里放一个指向别处的符号链接（任何扩展名），相对路径看着在里面，读的
//   却是外面的文件；records/merge-gate.ts 自己从 'zod' 以外的地方取值；
// - 解析器被注释或写法骗过（注释里的 import 字样、花括号里的 ;、import type、多行
//   import）；目录读空了，检查对零个文件恒真。
// 解析不用正则直接读源码：先用 esbuild 把每个模块转成 JS（去掉注释与只作类型用的
// import，import 语句按统一的格式重印），再从转出的代码里取模块名与名字。
// 这条测试防的是闸的源码直接依赖闸外的文件；闸的源码里有意写出的混淆加载本身就是
// 闸路径上的改动，要人合。'@pacman/shared' 的总出口在 import 时会运行 shared 的全部
// 模块，别的 shared 模块改全局（例如改原型）这里管不到，那是整个进程的完整性问题。

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as shared from '@pacman/shared';
import { transformSync } from 'esbuild';
import { describe, expect, test } from 'vitest';
import * as records from '../../../packages/shared/src/records/merge-gate.js';

const GATE_DIR = resolve(import.meta.dirname, '../src/services/merge-gate');
const RECORDS = resolve(import.meta.dirname, '../../../packages/shared/src/records/merge-gate.ts');
const NODE_BUILTINS = new Set(['node:crypto']);
const LOADERS =
  /\b(?:import|require)\s*\(|\bimport\.meta\b|\bcreateRequire\b|\beval\b|\bFunction\s*\(|\bprocess\b|\bglobalThis\b|\bgetBuiltinModule\b/g;

/** 转成 JS：注释、只作类型用的 import 与类型都去掉，import 语句由 esbuild 重印。 */
const toJs = (source: string) =>
  transformSync(source, { loader: 'ts', format: 'esm', legalComments: 'none' }).code;

/** 转出的 JS 里每条 import / export … from / 只为副作用的 import 的模块名，以及加载
 * 代码的其他写法（记成 'dynamic:' 前缀）。 */
function specifiers(js: string): string[] {
  const found: string[] = [];
  for (const m of js.matchAll(/\bfrom\s*(['"])([^'"]+)\1/g)) found.push(m[2] as string);
  for (const m of js.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) found.push(m[2] as string);
  for (const m of js.matchAll(LOADERS)) found.push(`dynamic:${m[0]}`);
  return found;
}

/** 转出的 JS 里从 '@pacman/shared' 取的名字（只作类型用的已被去掉）；命名空间、默认
 * import 与 export * 记成 'non-named:'。 */
function sharedNames(js: string): string[] {
  const names: string[] = [];
  for (const m of js.matchAll(/\b(?:import|export)\s+([^;]*?)\s*from\s*(['"])@pacman\/shared\2/g)) {
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
  return names;
}

function allowed(spec: string, file: string): boolean {
  if (spec === '@pacman/shared' || NODE_BUILTINS.has(spec)) return true;
  if (!spec.startsWith('./') && !spec.startsWith('../')) return false;
  const target = resolve(dirname(file), spec);
  return target === GATE_DIR || target.startsWith(GATE_DIR + sep);
}

const entries = (readdirSync(GATE_DIR, { recursive: true }) as string[]).map((name) =>
  join(GATE_DIR, name),
);
const gateFiles = entries.filter((f) => /\.(?:ts|mts|cts|js|mjs|cjs)$/.test(f));
const gateJs = gateFiles.map((file) => ({ file, js: toJs(readFileSync(file, 'utf8')) }));
const sharedValues = shared as unknown as Record<string, unknown>;
const recordValues = records as unknown as Record<string, unknown>;

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
        "import { evil /* ; */ } from '@pacman/shared';",
        "import { type T, good, other as alias } from '@pacman/shared';",
        "import * as all from '@pacman/shared';",
        'export const used = [a, c, d, evil, good, alias, all];',
        "const f = await import('../../lib/github.js');",
        "const g = require('x');",
        'const h = createRequire(import.meta.url);',
        "const i = eval('1') + new Function('return 1')() + process.pid + globalThis.x;",
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
        '@pacman/shared',
        '@pacman/shared',
        '@pacman/shared',
        '../other/e.js',
        'node:fs',
        './side-effect.js',
      ].sort(),
    );
    expect(new Set(specifiers(sample).filter((s) => s.startsWith('dynamic:')))).toEqual(
      new Set([
        'dynamic:import(',
        'dynamic:require(',
        'dynamic:createRequire',
        'dynamic:import.meta',
        'dynamic:eval',
        'dynamic:Function(',
        'dynamic:process',
        'dynamic:globalThis',
      ]),
    );
    expect(sharedNames(sample)).toEqual(['evil', 'good', 'other', 'non-named:* as all']);
    const file = join(GATE_DIR, 'readiness.ts');
    expect(allowed('@pacman/shared', file)).toBe(true);
    expect(allowed('node:crypto', file)).toBe(true);
    expect(allowed('node:module', file)).toBe(false);
    expect(allowed('./digest.js', file)).toBe(true);
    expect(allowed('../../lib/github.js', file)).toBe(false);
    expect(allowed('../merge-gate-extra/x.js', file)).toBe(false);
    expect(allowed('zod', file)).toBe(false);
  });

  test('读到了闸的源码（不是对零个文件恒真）', () => {
    const names = gateFiles.map((f) => relative(GATE_DIR, f)).sort();
    expect(names).toEqual(expect.arrayContaining(['digest.ts', 'readiness.ts']));
  });

  test("每个模块只从 '@pacman/shared'、node:crypto 或 merge-gate/ 里的相对路径 import，不另行加载代码", () => {
    const outside = gateJs.flatMap(({ file, js }) =>
      specifiers(js)
        .filter((spec) => !allowed(spec, file))
        .map((spec) => `${relative(GATE_DIR, file)}: ${spec}`),
    );
    expect(outside).toEqual([]);
  });

  test("从 '@pacman/shared' 取的运行时值就是 records/merge-gate.ts 导出的那一个", () => {
    const foreign = gateJs.flatMap(({ file, js }) =>
      sharedNames(js)
        .filter((name) => !(name in recordValues) || sharedValues[name] !== recordValues[name])
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
});
