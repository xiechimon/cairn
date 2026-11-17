#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const REGISTRY_REL = 'docs/canon/rulings.json';
const DOC_REL = 'docs/CANON.md';
const RULING_KEYS = new Set(['id', 'date', 'ruling', 'spec', 'section']);

function fail(lines) {
  for (const line of [lines].flat()) process.stderr.write(`generate-canon: ${line}\n`);
  process.exit(1);
}

const registry = JSON.parse(readFileSync(join(REPO_ROOT, REGISTRY_REL), 'utf8'));
const rulings = registry.rulings;
if (!Array.isArray(rulings)) fail(`${REGISTRY_REL}: rulings must be an array`);

const seen = new Set();
for (const r of rulings) {
  for (const key of Object.keys(r)) {
    if (!RULING_KEYS.has(key)) fail(`${r.id ?? 'ruling'}: unknown key ${key}`);
  }
  for (const key of RULING_KEYS) {
    if (typeof r[key] !== 'string' || r[key] === '') fail(`${r.id ?? 'ruling'}: missing ${key}`);
  }
  if (seen.has(r.id)) fail(`duplicate ruling id ${r.id}`);
  seen.add(r.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) fail(`${r.id}: date must be YYYY-MM-DD`);
  if (!existsSync(join(REPO_ROOT, r.spec))) fail(`${r.id}: spec ${r.spec} does not exist`);
}

function specSortKey(spec) {
  const m = spec.match(/spec\/(\d+)/);
  return m ? Number(m[1]) : 999;
}

const sorted = [...rulings].sort(
  (a, b) =>
    specSortKey(a.spec) - specSortKey(b.spec) ||
    a.date.localeCompare(b.date) ||
    a.id.localeCompare(b.id),
);

const lines = [
  '# CANON — current rulings',
  '',
  `Generated from \`${REGISTRY_REL}\` by \`scripts/generate-canon.mjs\`. Edit the registry, not this file;`,
  'CI fails when this file is stale. One line per standing ruling; the spec volume stays the full record.',
  'Lanes add an entry when they land or revise a ruling, keyed `area.topic`.',
  '',
];

let lastSpec = null;
for (const r of sorted) {
  if (r.spec !== lastSpec) {
    lines.push(`## ${r.spec}`, '');
    lastSpec = r.spec;
  }
  lines.push(`- **${r.id}** (${r.date}, ${r.section}) — ${r.ruling}`);
}
lines.push('');

const output = `${lines.join('\n')}\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(join(REPO_ROOT, DOC_REL))
    ? readFileSync(join(REPO_ROOT, DOC_REL), 'utf8')
    : '';
  if (current !== output) {
    fail(`${DOC_REL} is stale; run node scripts/generate-canon.mjs`);
  }
  process.stdout.write(`canon: ${rulings.length} rulings, ${DOC_REL} up to date\n`);
} else {
  writeFileSync(join(REPO_ROOT, DOC_REL), output);
  process.stdout.write(`canon: wrote ${rulings.length} rulings to ${DOC_REL}\n`);
}
