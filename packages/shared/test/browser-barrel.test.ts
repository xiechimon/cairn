import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { isPlainFolderExcluded } from '../src/index.js';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const REL_SPECIFIER_RE =
  /(?:export|import)(?!\s+type\b)\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
const NODE_BUILTIN_RE = /(?:export|import)(?!\s+type\b)\s+[^'"]*?from\s+['"]node:[^'"]+['"]/;

function resolveTsFile(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, '.ts'));
  if (existsSync(base) && statSync(base).isFile()) return base;
  const tsPath = `${base}.ts`;
  if (existsSync(tsPath) && statSync(tsPath).isFile()) return tsPath;
  const indexPath = resolve(dirname(fromFile), spec, 'index.ts');
  if (existsSync(indexPath) && statSync(indexPath).isFile()) return indexPath;
  return null;
}

function collectBarrelGraph(entryFile: string): string[] {
  const visited = new Set<string>();
  const queue = [entryFile];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(REL_SPECIFIER_RE)) {
      const spec = match[1];
      if (spec === undefined) continue;
      const target = resolveTsFile(file, spec);
      if (target !== null) queue.push(target);
    }
  }
  return [...visited];
}

describe('@cairn/shared browser-safe root barrel', () => {
  test('exposes pure plain-folder helpers without pulling any node:* builtins into src/index.ts', () => {
    expect(isPlainFolderExcluded('node_modules/a.js', false)).toBe(true);
    const graph = collectBarrelGraph(resolve(SRC_DIR, 'index.ts'));
    const offenders = graph.filter((file) => NODE_BUILTIN_RE.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
