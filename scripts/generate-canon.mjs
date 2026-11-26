#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const REGISTRY_REL = 'docs/canon/rulings.json';
const DOC_REL = 'docs/CANON.md';
const SPEC_DIR = 'docs/spec';
const RULING_KEYS = ['id', 'spec', 'date'];
const requireParser = createRequire(join(REPO_ROOT, 'apps/server/package.json'));
const { fromMarkdown } = requireParser('mdast-util-from-markdown');
const { gfm } = requireParser('micromark-extension-gfm');
const { gfmFromMarkdown } = requireParser('mdast-util-gfm');
const OPENING_MARK = /^<!--\s*ruling:([\w.-]+)\s*-->$/;
const CLOSING_MARK = /^<!--\s*\/ruling\s*-->$/;
const MENTIONED_MARK = /<!--\s*ruling:([\w.-]+)\s*-->/g;
const HTML_TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<(\/?)([A-Za-z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const HIDING_ELEMENTS = new Set(['code', 'del', 'pre', 's', 'strike']);
const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr']);
const PHRASING_PARENTS = new Set([
  'delete',
  'emphasis',
  'heading',
  'link',
  'linkReference',
  'paragraph',
  'strong',
  'tableCell',
]);
const CODE_SPAN = /(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g;
const NUMBERED_HEADING = /^#{2,6}\s+(\d+(?:\.\d+)*)\.?\s/;
const PLACEHOLDER = /\b(?:TODO|TBD|FIXME|XXX|placeholder|lorem ipsum)\b|\.\.\.|…|<!--/i;
const MIN_WORDS = 8;

function fail(lines) {
  for (const line of [lines].flat()) process.stderr.write(`generate-canon: ${line}\n`);
  process.exit(1);
}

const newlines = (text) => text.split('\n').length - 1;

function readHtml(node, source, inline, context) {
  const text = inline
    ? source.slice(node.position.start.offset, node.position.end.offset)
    : node.value;
  const container = inline ? source : node;
  const base = inline ? node.position.start.offset : 0;
  const elements = inline ? context.inlineElements : context.blockElements;
  for (const token of text.matchAll(HTML_TOKEN)) {
    const line = node.position.start.line + newlines(text.slice(0, token.index));
    const [whole, closing, rawName, , selfClosing] = token;
    if (rawName) {
      const name = rawName.toLowerCase();
      if (closing) {
        const at = elements.findLastIndex((element) => element.name === name);
        if (at !== -1) elements.splice(at, 1);
      } else if (!selfClosing && !VOID_ELEMENTS.has(name))
        elements.push({ name, line, hides: HIDING_ELEMENTS.has(name) });
      continue;
    }
    const opening = OPENING_MARK.exec(whole);
    if (!opening && !CLOSING_MARK.test(whole)) {
      for (const mention of whole.matchAll(MENTIONED_MARK))
        context.unrendered(
          mention[1],
          line + newlines(whole.slice(0, mention.index)),
          `inside a comment opened at line ${line}`,
        );
      continue;
    }
    const hider = [...context.blockElements, ...context.inlineElements].find(
      (element) => element.hides,
    );
    const why =
      context.concealed ??
      (hider && `inside a <${hider.name}> element opened at line ${hider.line}`);
    if (why) {
      if (opening) context.unrendered(opening[1], line, why);
      continue;
    }
    context.shown.push({
      id: opening?.[1],
      line,
      container,
      from: base + token.index,
      to: base + token.index + whole.length,
    });
  }
}

function footnoteReferences(node, found = new Set()) {
  if (node.type === 'footnoteReference') found.add(node.identifier);
  for (const child of node.children ?? []) footnoteReferences(child, found);
  return found;
}

function renderedMarks(source) {
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const hidden = [];
  const context = {
    shown: [],
    headings: [],
    blockElements: [],
    inlineElements: [],
    concealed: null,
    unrendered: (id, line, why) => hidden.push({ id, line, why }),
  };
  const referenced = footnoteReferences(tree);
  const walk = (node, parent) => {
    if (node.type === 'html') {
      readHtml(node, source, PHRASING_PARENTS.has(parent?.type), context);
      return;
    }
    if (node.type === 'code' || node.type === 'inlineCode') {
      const kind = node.type === 'code' ? 'code block' : 'code span';
      for (const mention of node.value.matchAll(MENTIONED_MARK))
        context.unrendered(
          mention[1],
          node.position.start.line,
          `inside a ${kind} starting at line ${node.position.start.line}`,
        );
      return;
    }
    if (node.type === 'heading') context.headings.push(node.position.start.line);
    const outer = context.concealed;
    if (node.type === 'delete') context.concealed = 'struck through';
    if (node.type === 'footnoteDefinition' && !referenced.has(node.identifier))
      context.concealed = 'in a footnote nothing refers to';
    for (const child of node.children ?? []) walk(child, node);
    context.concealed = outer;
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell')
      context.inlineElements.length = 0;
  };
  walk(tree);
  return { shown: context.shown, headings: context.headings, hidden };
}

function readMarks(spec, problems, unrendered) {
  const source = readFileSync(join(REPO_ROOT, spec), 'utf8');
  const lines = source.split('\n');
  const { shown, headings, hidden } = renderedMarks(source);
  unrendered.push(...hidden.map((mark) => ({ ...mark, spec })));
  const explained = new Set([...hidden, ...shown].map((mark) => mark.id));
  for (const [at, text] of lines.entries())
    for (const [, id] of text.matchAll(MENTIONED_MARK))
      if (!explained.has(id))
        unrendered.push({ id, spec, line: at + 1, why: 'not in visible text' });
  const sectionAt = (line) =>
    headings
      .filter((at) => at <= line)
      .map((at) => NUMBERED_HEADING.exec(lines[at - 1])?.[1])
      .findLast(Boolean);
  const marks = [];
  let open = null;
  const unclosed = () => {
    if (open)
      problems.push(`${spec}:${open.line}: ruling mark ${open.id} must close on the same line`);
  };
  for (const mark of shown) {
    if (mark.id) {
      unclosed();
      open = mark;
    } else if (!open) {
      problems.push(`${spec}:${mark.line}: closing ruling mark without an opening one`);
    } else {
      if (open.line !== mark.line || open.container !== mark.container) unclosed();
      else {
        const text = typeof mark.container === 'string' ? mark.container : mark.container.value;
        const number = sectionAt(mark.line);
        marks.push({
          id: open.id,
          spec,
          section: number ? `§${number}` : 'volume',
          ruling: text.slice(open.to, mark.from).trim(),
          at: `${spec}:${open.line}`,
        });
      }
      open = null;
    }
  }
  unclosed();
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
const unrendered = [];
const sentences = new Set();
const specs = readdirSync(join(REPO_ROOT, SPEC_DIR))
  .filter((file) => file.endsWith('.md'))
  .map((file) => `${SPEC_DIR}/${file}`);
for (const spec of new Set([...specs, ...[...rows.values()].map((row) => row.spec)])) {
  for (const mark of readMarks(spec, problems, unrendered)) {
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
for (const row of rows.values()) {
  if (marks.has(row.id)) continue;
  problems.push(`${row.id}: ${row.spec} has no ruling mark for it`);
  for (const mark of unrendered.filter((hidden) => hidden.id === row.id))
    problems.push(
      `${mark.spec}:${mark.line}: the ${row.id} mark does not render: it is ${mark.why}`,
    );
}
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
