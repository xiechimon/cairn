#!/usr/bin/env node
// Print the design-rule rows that apply to the given repo paths.
// Usage: node scripts/design-rules-for.mjs <path…>
//        node scripts/design-rules-for.mjs --ids          (id → owning file)
//        node scripts/design-rules-for.mjs C14 V3         (look up ids)
// A rule row lives in the `## Rules` section of `apps/web/DESIGN.md` or one
// `docs/design/surfaces/*.md`; the section's `Scope:` line lists the
// repo-relative path prefixes that load it. Paste the output into UI briefs.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ENTRY = 'apps/web/DESIGN.md';
const SURFACES_DIR = 'docs/design/surfaces';
const RULE_HEADING = '## Rules';
const ROW = /^\| ([A-Z]+\d+) \|/;

export function ruleFiles(root = ROOT) {
  return [
    ENTRY,
    ...readdirSync(join(root, SURFACES_DIR))
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => `${SURFACES_DIR}/${name}`),
  ];
}

export function parseRuleSection(text) {
  const after =
    text.split(`\n${RULE_HEADING}\n`)[1] ?? (text.startsWith(`${RULE_HEADING}\n`) ? text : null);
  if (after === null || after === undefined) return null;
  const section = after.split('\n## ')[0] ?? '';
  const scopeLine = section.split('\n').find((line) => line.startsWith('Scope:'));
  const scope = [...(scopeLine ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const rows = section
    .split('\n')
    .filter((line) => ROW.test(line))
    .map((line) => ({ id: ROW.exec(line)[1], line: line.trimEnd() }));
  return { scope, rows };
}

export function loadBlocks(root = ROOT) {
  return ruleFiles(root)
    .map((file) => ({ file, ...(parseRuleSection(readFileSync(join(root, file), 'utf8')) ?? {}) }))
    .filter((block) => block.rows !== undefined && block.rows.length > 0);
}

export function normalizePath(arg) {
  let path = arg.replace(/\\/g, '/');
  if (path.startsWith(ROOT)) path = relative(ROOT, path).split(sep).join('/');
  return path.replace(/^\.\//, '');
}

export function selectBlocks(paths, root = ROOT) {
  const inputs = paths.map(normalizePath);
  return loadBlocks(root).filter((block) =>
    block.scope.some((prefix) => inputs.some((path) => path.startsWith(prefix))),
  );
}

function prefixIsLive(prefix) {
  const base = join(ROOT, prefix);
  if (existsSync(base)) return true;
  const dir = join(ROOT, prefix.slice(0, Math.max(0, prefix.lastIndexOf('/'))));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  const leaf = prefix.slice(prefix.lastIndexOf('/') + 1);
  return readdirSync(dir).some((name) => name.startsWith(leaf));
}

export function deadScopePrefixes(root = ROOT) {
  return loadBlocks(root).flatMap((block) =>
    block.scope
      .filter((prefix) => !prefixIsLive(prefix))
      .map((prefix) => `${block.file}: ${prefix}`),
  );
}

function printBlocks(blocks) {
  for (const block of blocks) {
    console.log(`\n${block.file}:`);
    console.log('| Id | Rule | Check |');
    console.log('|---|---|---|');
    for (const row of block.rows) console.log(row.line);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  normalizePath(process.argv[1]) === normalizePath(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--ids')) {
    for (const block of loadBlocks())
      for (const row of block.rows) console.log(`${row.id}\t${block.file}`);
  } else if (args.length === 0) {
    console.error('usage: node scripts/design-rules-for.mjs <repo-path…> | <rule-id…> | --ids');
    process.exit(1);
  } else if (args.every((arg) => /^[A-Z]+\d+$/.test(arg))) {
    const wanted = new Set(args);
    for (const block of loadBlocks()) {
      const rows = block.rows.filter((row) => wanted.has(row.id));
      if (rows.length > 0) printBlocks([{ ...block, rows }]);
    }
  } else {
    const blocks = selectBlocks(args);
    const count = blocks.reduce((sum, block) => sum + block.rows.length, 0);
    if (count === 0) {
      console.log(`No design rules scoped to: ${args.map(normalizePath).join(', ')}`);
    } else {
      console.log(`${count} design rules apply to: ${args.map(normalizePath).join(', ')}`);
      printBlocks(blocks);
    }
  }
}
