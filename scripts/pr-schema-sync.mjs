import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HEADING = '### Schema changes';
const WHAT_HEADING = '## What';
const NO_SCHEMA_CHANGES = 'No schema changes';
const GLANCE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'schema-glance.mjs');

const isRowLine = (line) => line.trim().startsWith('|') || line.trim() === NO_SCHEMA_CHANGES;

function sectionEnd(lines, headingIndex) {
  let index = headingIndex + 1;
  while (index < lines.length && lines[index].trim() === '') index += 1;
  while (index < lines.length && isRowLine(lines[index])) index += 1;
  return index;
}

function fencedLines(lines) {
  const fenced = new Set();
  let open = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      open = !open;
      fenced.add(index);
    } else if (open) {
      fenced.add(index);
    }
  });
  return fenced;
}

function findLine(lines, matches) {
  const fenced = fencedLines(lines);
  return lines.findIndex((line, index) => !fenced.has(index) && matches(line));
}

export function replaceSchemaSection(body, glance) {
  const section = glance.trim().split('\n');
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const heading = findLine(lines, (line) => line.trim() === HEADING);
  if (heading !== -1) {
    const end = sectionEnd(lines, heading);
    return [...lines.slice(0, heading), ...section, ...lines.slice(end)].join('\n');
  }
  const what = findLine(lines, (line) => line.trim() === WHAT_HEADING);
  if (what !== -1) {
    const before = lines.slice(0, what);
    const gap = before.length && before[before.length - 1].trim() !== '' ? [''] : [];
    return [...before, ...gap, ...section, '', ...lines.slice(what)].join('\n');
  }
  return `${lines.join('\n').replace(/\n*$/, '')}\n\n${section.join('\n')}\n`;
}

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' });

export function main(args) {
  const number = args[0];
  if (!/^\d+$/.test(number ?? '')) throw new Error('usage: pr-schema-sync.mjs <pr-number>');
  const pr = JSON.parse(run('gh', ['pr', 'view', number, '--json', 'headRefOid,body']));
  run('git', ['fetch', '--quiet', 'origin', 'main', `pull/${number}/head`]);
  const base = run('git', ['merge-base', 'origin/main', pr.headRefOid]).trim();
  const glance = run('node', [GLANCE_SCRIPT, '--base', base, '--head', pr.headRefOid]);
  const path = join(mkdtempSync(join(tmpdir(), 'pr-schema-sync-')), `pr-${number}-body.md`);
  writeFileSync(path, replaceSchemaSection(pr.body ?? '', glance));
  return `${path}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
