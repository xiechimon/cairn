// 合并就绪闸（#1404）：闸的源码只依赖闸自己的源码。ADR 0021 D4 ④ 按路径认闸的源码
// （apps/server/src/services/merge-gate/**、packages/shared/src/records/merge-gate.ts、
// apps/daemon/src/merge-decision.ts），这些路径上的改动一律要人合。闸要是从别处
// import 了判定用的东西（比如 lib/github.ts 的 SHA 判定），只改那个文件的 PR 就能改掉
// 闸认什么、不认什么，路径判定却看不出它碰了闸，照样自动合并。
// 失败方式先行：merge-gate/ 下的模块从这几处之外 import（相对路径跳出 merge-gate/、
// 别的包、别的 node 内置以外的模块）；用动态 import() 或 require() 绕开静态检查；
// 解析器漏认某种写法（import type、export … from、只为副作用的 import、多行 import）
// 让检查形同虚设；目录读空了，检查对零个文件恒真。
// 只许三种来源：'@pacman/shared'（闸的词表与常量在 records/merge-gate.ts）、'node:*'、
// 留在 merge-gate/ 里的相对路径。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

const GATE_DIR = resolve(import.meta.dirname, '../src/services/merge-gate');

/** 一个模块里 import / export … from / 只为副作用的 import 的模块名；动态 import() 与
 * require() 记成 'dynamic:' 前缀（闸的源码里一律不许，见 AGENTS.md 的禁 inline import）。
 * 宁可多认（注释里的同形文字也认，检查只会更严），不可漏认。 */
function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/\bfrom\s*(['"])([^'"]+)\1/g)) found.push(m[2] as string);
  for (const m of source.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) found.push(m[2] as string);
  for (const m of source.matchAll(/\b(?:import|require)\s*\(/g)) found.push(`dynamic:${m[0]}`);
  return found;
}

function allowed(spec: string, file: string): boolean {
  if (spec === '@pacman/shared' || spec.startsWith('node:')) return true;
  if (!spec.startsWith('./') && !spec.startsWith('../')) return false;
  const target = resolve(dirname(file), spec);
  return target === GATE_DIR || target.startsWith(GATE_DIR + sep);
}

const gateFiles = (readdirSync(GATE_DIR, { recursive: true }) as string[])
  .filter((name) => /\.(?:ts|mts|cts|js|mjs|cjs)$/.test(name))
  .map((name) => join(GATE_DIR, name));

describe('merge-gate 源码只从闸自己的源码 import', () => {
  test('解析器认得每种写法（不然下面的检查形同虚设）', () => {
    const sample = [
      "import { a } from '../../lib/github.js';",
      "import type { B } from 'zod';",
      'import {\n  c,\n  d,\n} from "./x.js";',
      "export { e } from '../other/e.js';",
      "export * from 'node:fs';",
      "import './side-effect.js';",
      "const f = await import('../../lib/github.js');",
      "const g = require('x');",
    ].join('\n');
    expect(specifiers(sample)).toEqual([
      '../../lib/github.js',
      'zod',
      './x.js',
      '../other/e.js',
      'node:fs',
      './side-effect.js',
      'dynamic:import(',
      'dynamic:require(',
    ]);
    const file = join(GATE_DIR, 'readiness.ts');
    expect(allowed('@pacman/shared', file)).toBe(true);
    expect(allowed('node:crypto', file)).toBe(true);
    expect(allowed('./digest.js', file)).toBe(true);
    expect(allowed('../../lib/github.js', file)).toBe(false);
    expect(allowed('../merge-gate-extra/x.js', file)).toBe(false);
    expect(allowed('zod', file)).toBe(false);
    expect(allowed('@pacman/shared/src/brand.js', file)).toBe(false);
  });

  test('读到了闸的源码（不是对零个文件恒真）', () => {
    const names = gateFiles.map((f) => relative(GATE_DIR, f)).sort();
    expect(names).toEqual(expect.arrayContaining(['digest.ts', 'readiness.ts']));
  });

  test("每个模块只从 '@pacman/shared'、'node:*' 或 merge-gate/ 里的相对路径 import", () => {
    const outside = gateFiles.flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter((spec) => !allowed(spec, file))
        .map((spec) => `${relative(GATE_DIR, file)}: ${spec}`),
    );
    expect(outside).toEqual([]);
  });
});
