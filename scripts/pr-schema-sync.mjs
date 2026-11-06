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

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CODE_OR_COMMENT = /(?<ticks>`+)(?!`).*?(?<!`)\k<ticks>(?!`)|<!--/g;
const blank = (length) => ' '.repeat(length);

export function visibleLines(lines) {
  let fence = null;
  let insideComment = false;
  return lines.map((line) => {
    const marker = FENCE.exec(line);
    if (fence !== null) {
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        fence = null;
      }
      return blank(line.length);
    }
    if (marker && !insideComment) {
      fence = marker[1];
      return blank(line.length);
    }
    let visible = '';
    let cursor = 0;
    while (cursor < line.length) {
      if (insideComment) {
        const end = line.indexOf('-->', cursor);
        if (end === -1) {
          visible += blank(line.length - cursor);
          break;
        }
        visible += blank(end + 3 - cursor);
        cursor = end + 3;
        insideComment = false;
        continue;
      }
      CODE_OR_COMMENT.lastIndex = cursor;
      const token = CODE_OR_COMMENT.exec(line);
      if (token === null) {
        visible += line.slice(cursor);
        break;
      }
      const start = token.index;
      const end = start + token[0].length;
      const close = line.indexOf('-->', start + 2);
      if (
        token.groups.ticks !== undefined ||
        !(/^ {0,3}$/.test(line.slice(0, start)) || close !== -1)
      ) {
        visible += line.slice(cursor, end);
        cursor = end;
        continue;
      }
      if (close !== -1) {
        visible += line.slice(cursor, start) + blank(close + 3 - start);
        cursor = close + 3;
        continue;
      }
      visible += line.slice(cursor, start) + blank(line.length - start);
      insideComment = true;
      break;
    }
    return visible;
  });
}

function sectionEnd(visible, headingIndex) {
  let index = headingIndex + 1;
  while (index < visible.length && visible[index].trim() === '') index += 1;
  while (index < visible.length && isRowLine(visible[index])) index += 1;
  return index;
}

export function replaceSchemaSection(body, glance) {
  const section = glance.trim().split('\n');
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const visible = visibleLines(lines);
  const heading = visible.findIndex((line) => line.trim() === HEADING);
  if (heading !== -1) {
    const end = sectionEnd(visible, heading);
    return [...lines.slice(0, heading), ...section, ...lines.slice(end)].join('\n');
  }
  const what = visible.findIndex((line) => line.trim() === WHAT_HEADING);
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
