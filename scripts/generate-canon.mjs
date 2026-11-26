#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const REGISTRY_REL = 'docs/canon/rulings.json';
const DOC_REL = 'docs/CANON.md';
const SPEC_DIR = 'docs/spec';
const RULING_KEYS = ['id', 'spec', 'date'];
const MARK = /<!--\s*ruling:([\w.-]+)\s*-->|<!--\s*\/ruling\s*-->/g;
const CODE_SPAN = /(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g;
const COMMENT_EDGE = /<!--\s*(?:ruling:[\w.-]+|\/ruling)\s*-->|<!--|-->/g;
const DELETED_EDGE = /<(\/?)(?:del|s|strike)\b[^>]*>/gi;
const INDENTED_CODE = /^(?: {4}|\t)(?!\s*(?:[-*+]|\d+\.) )/;
const FENCE = /^\s*(```|~~~)/;
const NUMBERED_HEADING = /^#{2,6}\s+(\d+(?:\.\d+)*)\.?\s/;
const PLACEHOLDER = /\b(?:TODO|TBD|FIXME|XXX|placeholder|lorem ipsum)\b|\.\.\.|…|<!--/i;
const MIN_WORDS = 8;

function fail(lines) {
  for (const line of [lines].flat()) process.stderr.write(`generate-canon: ${line}\n`);
  process.exit(1);
}

function shownMarks(line, state) {
  const prose = line.replace(CODE_SPAN, (span) => ' '.repeat(span.length));
  const commented = new Set();
  for (const edge of prose.matchAll(COMMENT_EDGE)) {
    if (edge[0] === '<!--') state.comment = true;
    else if (edge[0] === '-->') state.comment = false;
    else if (state.comment) commented.add(edge.index);
  }
  if (prose.trim() === '') state.struck = false;
  if (INDENTED_CODE.test(line)) return [];
  const edges = [...prose.matchAll(DELETED_EDGE), ...prose.matchAll(/~~/g)].sort(
    (a, b) => a.index - b.index,
  );
  const shown = [];
  let next = 0;
  const apply = (edge) => {
    if (edge[0] === '~~') state.struck = !state.struck;
    else state.deleted = Math.max(0, state.deleted + (edge[1] ? -1 : 1));
  };
  for (const mark of line.matchAll(MARK)) {
    while (next < edges.length && edges[next].index < mark.index) apply(edges[next++]);
    if (prose[mark.index] === '<' && !commented.has(mark.index) && !state.struck && !state.deleted)
      shown.push(mark);
  }
  while (next < edges.length) apply(edges[next++]);
  return shown;
}

function readMarks(spec, problems) {
  const marks = [];
  let fence = null;
  let section = 'volume';
  const state = { comment: false, struck: false, deleted: 0 };
  for (const [index, line] of readFileSync(join(REPO_ROOT, spec), 'utf8').split('\n').entries()) {
    const fenceMark = FENCE.exec(line)?.[1];
    if (fenceMark) fence = fence === null ? fenceMark : fence === fenceMark ? null : fence;
    if (fence !== null || fenceMark) continue;
    const heading = NUMBERED_HEADING.exec(line)?.[1];
    if (heading) section = `§${heading}`;
    const at = `${spec}:${index + 1}`;
    let open = null;
    for (const match of shownMarks(line, state)) {
      if (match[1]) {
        if (open) problems.push(`${at}: ruling mark ${open.id} is not closed`);
        open = { id: match[1], from: match.index + match[0].length };
      } else if (open) {
        const ruling = line.slice(open.from, match.index).trim();
        marks.push({ id: open.id, spec, section, ruling, at });
        open = null;
      } else problems.push(`${at}: closing ruling mark without an opening one`);
    }
    if (open) problems.push(`${at}: ruling mark ${open.id} must close on the same line`);
  }
  return marks;
}

const registry = JSON.parse(readFileSync(join(REPO_ROOT, REGISTRY_REL), 'utf8'));
if (!Array.isArray(registry.rulings) || registry.rulings.length === 0)
  fail(`${REGISTRY_REL}: rulings must be a non-empty array`);

const problems = [];
const rows = new Map();
for (const row of registry.rulings) {
  const name = row.id ?? 'ruling';
  for (const key of Object.keys(row))
    if (!RULING_KEYS.includes(key)) problems.push(`${name}: unknown key ${key}`);
  for (const key of RULING_KEYS)
    if (typeof row[key] !== 'string' || row[key] === '') problems.push(`${name}: missing ${key}`);
  if (rows.has(row.id)) problems.push(`duplicate ruling id ${row.id}`);
  rows.set(row.id, row);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) problems.push(`${name}: date must be YYYY-MM-DD`);
  if (!String(row.spec).startsWith(`${SPEC_DIR}/`) || row.spec.includes('..'))
    problems.push(`${name}: spec ${row.spec} must be under ${SPEC_DIR}/`);
  else if (!existsSync(join(REPO_ROOT, row.spec)))
    problems.push(`${name}: spec ${row.spec} does not exist`);
}
if (problems.length > 0) fail(problems);

const marks = new Map();
const sentences = new Set();
const specs = readdirSync(join(REPO_ROOT, SPEC_DIR))
  .filter((file) => file.endsWith('.md'))
  .map((file) => `${SPEC_DIR}/${file}`);
for (const spec of new Set([...specs, ...[...rows.values()].map((row) => row.spec)])) {
  for (const mark of readMarks(spec, problems)) {
    const row = rows.get(mark.id);
    if (!row) problems.push(`${mark.at}: ruling ${mark.id} has no row in ${REGISTRY_REL}`);
    else if (row.spec !== mark.spec)
      problems.push(`${mark.at}: ruling ${mark.id} belongs in ${row.spec}`);
    if (marks.has(mark.id)) problems.push(`${mark.at}: ruling ${mark.id} is marked twice`);
    if (
      mark.ruling.split(/\s+/).length < MIN_WORDS ||
      PLACEHOLDER.test(mark.ruling.replace(CODE_SPAN, 'code'))
    )
      problems.push(`${mark.at}: ruling ${mark.id} marks no complete sentence`);
    else if (!/[.!?]["')\]*_`]*$/.test(mark.ruling))
      problems.push(`${mark.at}: ruling ${mark.id} must end where its sentence ends`);
    if (sentences.has(mark.ruling))
      problems.push(`${mark.at}: ruling ${mark.id} repeats another ruling's sentence`);
    sentences.add(mark.ruling);
    marks.set(mark.id, mark);
  }
}
for (const row of rows.values())
  if (!marks.has(row.id)) problems.push(`${row.id}: ${row.spec} has no ruling mark for it`);
if (problems.length > 0) fail(problems);

const rulings = [...rows.values()].map((row) => ({ ...row, ...marks.get(row.id) }));

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
  `Generated by \`scripts/generate-canon.mjs\` from the ruling sentences marked in the spec volumes; \`${REGISTRY_REL}\``,
  'lists each ruling id, spec and date. Edit the marked sentence, not this file; CI fails when this file is stale.',
  'One line per standing ruling; the spec volume stays the full record. To add one, wrap its sentence on one line in',
  '`<!-- ruling:area.topic -->` and `<!-- /ruling -->`, then add its registry row.',
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
