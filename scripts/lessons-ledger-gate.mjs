#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FIELDS = [
  'Category',
  'Source',
  'Level',
  'Safeguard',
  'Intercepts',
  'Recurrences',
  'Notes',
];
const ENTRY_NAME = /^\d+-[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---(\n|$)/;

export function parseEntry(text) {
  const match = FRONTMATTER.exec(text);
  if (!match) return { fields: null, problems: ['missing leading --- frontmatter'] };
  const lines = match[1].split('\n');
  const problems = [];
  const fields = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    const key = separator === -1 ? line : line.slice(0, separator);
    if (!FIELDS.includes(key)) problems.push(`unknown or malformed line: ${line.slice(0, 30)}`);
    else if (Object.hasOwn(fields, key)) problems.push(`duplicate field: ${key}`);
    else fields[key] = line.slice(separator + 1).trim();
  }
  const present = lines.map((line) => line.slice(0, line.indexOf(':'))).filter((k) => k in fields);
  for (const key of FIELDS) if (!(key in fields)) problems.push(`missing field: ${key}`);
  if (problems.length === 0 && present.join() !== FIELDS.join())
    problems.push(`fields must be in the order: ${FIELDS.join(', ')}`);
  return { fields: problems.length === 0 ? fields : null, problems };
}

export function checkEntry(fileName, text) {
  const violations = [];
  if (!ENTRY_NAME.test(fileName))
    violations.push(
      `${fileName}: file name must be <ticket>-<short-name>.md with a lowercase alphanumeric hyphenated short name`,
    );
  const { fields, problems } = parseEntry(text);
  violations.push(...problems.map((problem) => `${fileName}: ${problem}`));
  if (fields === null) return violations;
  for (const key of ['Category', 'Source', 'Safeguard'])
    if (fields[key] === '') violations.push(`${fileName}: ${key} must not be empty`);
  if (!/^[1-5]$/.test(fields.Level)) violations.push(`${fileName}: Level must be between 1 and 5`);
  for (const key of ['Intercepts', 'Recurrences'])
    if (!/^\d+$/.test(fields[key]))
      violations.push(`${fileName}: ${key} must be a non-negative integer`);
  if (Number(fields.Level) >= 4 && fields.Notes === '')
    violations.push(
      `${fileName}: Level ${fields.Level} must state in Notes why a higher level is not feasible`,
    );
  if (/pending upgrade|upgrade pending|待升/i.test(fields.Notes) && !/#\d+/.test(fields.Notes))
    violations.push(`${fileName}: "pending upgrade" in Notes must carry a ticket number`);
  return violations;
}

export function ledgerEntries(root) {
  const directory = join(root, 'docs/lessons');
  return readdirSync(directory)
    .filter((name) => name !== 'README.md')
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => ({ name, text: readFileSync(join(directory, name), 'utf8') }));
}

export function checkLedgerRoot(root) {
  const violations = [];
  if (existsSync(join(root, 'docs/lessons.md')))
    violations.push(
      'docs/lessons.md was split into per-entry files under docs/lessons/; do not bring the summary table back',
    );
  if (!existsSync(join(root, 'docs/lessons'))) return [...violations, 'docs/lessons/ is missing'];
  const entries = ledgerEntries(root);
  if (entries.length === 0) violations.push('docs/lessons/ has no entries');
  for (const { name, text } of entries) violations.push(...checkEntry(name, text));
  return violations;
}

export function renderTable(entries) {
  const violations = entries.flatMap(({ name, text }) => checkEntry(name, text));
  if (violations.length > 0) throw new Error(violations.join('\n'));
  const rows = entries.map(({ name, text }) => {
    const { fields } = parseEntry(text);
    return `| ${[name.replace(/\.md$/, ''), ...FIELDS.map((key) => fields[key])].map((value) => value.replaceAll('\\|', '|').replaceAll('|', '\\|')).join(' | ')} |`;
  });
  return [`| File | ${FIELDS.join(' | ')} |`, `|${'---|'.repeat(FIELDS.length + 1)}`, ...rows].join(
    '\n',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  if (process.argv[2] === '--table') {
    console.log(renderTable(ledgerEntries(root)));
    process.exit(0);
  }
  const violations = checkLedgerRoot(root);
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exit(1);
  }
  console.log('lessons ledger ok');
}
