#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(new URL('../apps/web/src', import.meta.url)));
const TAGS = ['button', 'input', 'select', 'textarea'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const allFiles = walk(SRC);
const tsxFiles = allFiles.filter((f) => f.endsWith('.tsx'));
const cssFiles = allFiles.filter((f) => f.endsWith('.css'));

const cssClasses = new Set();
for (const f of cssFiles) {
  const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) cssClasses.add(m[1]);
}

function tagsOf(source, tag) {
  const open = `<${tag}`;
  const found = [];
  for (let i = source.indexOf(open); i !== -1; i = source.indexOf(open, i + 1)) {
    const next = source[i + open.length];
    if (next !== undefined && /[A-Za-z0-9-]/.test(next)) continue;
    let depth = 0;
    let quote = null;
    let j = i + open.length;
    for (; j < source.length; j++) {
      const c = source[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    found.push(source.slice(i, j));
  }
  return found;
}

function classTokens(tag) {
  const m = tag.match(/className\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/s);
  if (!m) return [];
  const body = m[1];
  const literals = [...body.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map(
    (x) => x[1] ?? x[2] ?? x[3] ?? '',
  );
  return literals
    .join(' ')
    .split(/\s+/)
    .filter((t) => /^-?[_a-zA-Z][\w-]*$/.test(t));
}

const domains = new Map();
const perFile = [];
for (const f of tsxFiles) {
  const rel = relative(SRC, f);
  const [domain, ...rest] = rel.split('/');
  if (rest.length === 0) continue;
  if (!domains.has(domain)) {
    domains.set(domain, { raw: 0, handrolled: new Set(), shadcn: 0, byTag: {} });
  }
  const bucket = domains.get(domain);
  const source = readFileSync(f, 'utf8');
  if (source.includes('components/ui/button')) bucket.shadcn++;
  const fileHandrolled = new Set();
  const fileByTag = {};
  for (const tag of TAGS) {
    const found = tagsOf(source, tag);
    if (found.length === 0) continue;
    bucket.byTag[tag] = (bucket.byTag[tag] ?? 0) + found.length;
    fileByTag[tag] = found.length;
    bucket.raw += found.length;
    for (const t of found) {
      for (const token of classTokens(t)) {
        if (cssClasses.has(token)) {
          bucket.handrolled.add(token);
          fileHandrolled.add(token);
        }
      }
    }
  }
  if (fileHandrolled.size > 0 || Object.keys(fileByTag).length > 0) {
    perFile.push({ rel, byTag: fileByTag, handrolled: fileHandrolled.size });
  }
}

const rows = [...domains.entries()].sort((a, b) => b[1].raw - a[1].raw || a[0].localeCompare(b[0]));
const cell = (b, tag) => String(b.byTag[tag] ?? 0);

console.log(
  '| Domain | `<button>` | `<input>` | `<select>` | `<textarea>` | Total | Handrolled classes | Files consuming `components/ui/button` |',
);
console.log('|---|---|---|---|---|---|---|---|');
const totals = { button: 0, input: 0, select: 0, textarea: 0, raw: 0, hand: 0, shadcn: 0 };
for (const [domain, b] of rows) {
  totals.raw += b.raw;
  totals.hand += b.handrolled.size;
  totals.shadcn += b.shadcn;
  for (const tag of TAGS) totals[tag] += b.byTag[tag] ?? 0;
  console.log(
    `| ${domain} | ${cell(b, 'button')} | ${cell(b, 'input')} | ${cell(b, 'select')} | ${cell(b, 'textarea')} | ${b.raw} | ${b.handrolled.size} | ${b.shadcn} |`,
  );
}
console.log(
  `| **Total** | **${totals.button}** | **${totals.input}** | **${totals.select}** | **${totals.textarea}** | **${totals.raw}** | **${totals.hand}** | **${totals.shadcn}** |`,
);

console.log(
  '\nPer file (only files with raw controls, sorted by total desc; "handrolled" = distinct within that file):\n',
);
console.log('| File | button | input | select | textarea | Total | Handrolled |');
console.log('|---|---|---|---|---|---|---|');
const fileRows = perFile
  .map((r) => ({ ...r, raw: Object.values(r.byTag).reduce((a, b) => a + b, 0) }))
  .sort((a, b) => b.raw - a.raw || a.rel.localeCompare(b.rel));
for (const r of fileRows) {
  const g = (tag) => String(r.byTag[tag] ?? 0);
  console.log(
    `| \`${r.rel}\` | ${g('button')} | ${g('input')} | ${g('select')} | ${g('textarea')} | ${r.raw} | ${r.handrolled} |`,
  );
}
