import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HAN = /[\p{Script=Han}\u3000-\u303f\uff01-\uff60]/u;
const PROSE = /\.(md|mdx|ya?ml)$/;
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|py|sh)$/;
const EXEMPT = [
  /^README\.zh\.md$/,
  /^docs\/feature-map\.md$/,
  /^apps\/web\/src\/i18n\//,
  /(^|\/)zh(-CN)?\.(md|ya?ml)$/,
];

export function stripQuoted(text) {
  return text
    .replace(/```[\s\S]*?(```|$)/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`[^`\n]*`/g, '');
}

function proseViolations(lines) {
  const found = [];
  let fenced = false;
  for (const [index, text] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(text)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && HAN.test(stripQuoted(text))) found.push(index + 1);
  }
  return found;
}

export function isChecked(path) {
  return (PROSE.test(path) || CODE.test(path)) && !EXEMPT.some((pattern) => pattern.test(path));
}

export function fileViolations(path, content) {
  if (!isChecked(path)) return [];
  const lines = content.split('\n');
  if (PROSE.test(path)) return proseViolations(lines);
  const hash = /\.(py|sh)$/.test(path);
  const found = [];
  let block = false;
  for (const [index, text] of lines.entries()) {
    const trimmed = text.trimStart();
    let comment = '';
    if (block) comment = text;
    else if (hash) comment = /(^|\s)#(?!!)(.*)$/.exec(text)?.[2] ?? '';
    else if (/^(\/\*|\{\s*\/\*)/.test(trimmed)) comment = text;
    else comment = /(^|\s)\/\/(.*)$/.exec(text)?.[2] ?? '';
    if (HAN.test(stripQuoted(comment))) found.push(index + 1);
    if (!hash && !block && /^(\/\*|\{\s*\/\*)/.test(trimmed)) block = true;
    if (block && trimmed.includes('*/')) block = false;
  }
  return found;
}

export function textViolations(content) {
  return proseViolations(content.split('\n'));
}

function report(where, lines) {
  for (const line of lines)
    console.error(`${where}:${line}: Chinese text; write repository content in English`);
  return lines.length;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    let violations = 0;
    if (args[0] === '--text') {
      if (!args[1]) throw new Error('Usage: english-only-gate.mjs [--text <file>]');
      violations = report(args[1], textViolations(readFileSync(args[1], 'utf8')));
    } else {
      const git = (...gitArgs) =>
        execFileSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const configured = process.env.ENGLISH_ONLY_BASE_SHA || process.env.PREPUSH_BASE_SHA || '';
      const base = git(
        'merge-base',
        'HEAD',
        configured && !/^0{40}$/.test(configured) ? configured : 'origin/main',
      ).trim();
      const files = git('diff', '--name-only', '-z', '--diff-filter=ACMR', base)
        .split('\0')
        .filter(isChecked);
      for (const path of files) {
        const added = new Set();
        let line = 0;
        for (const patchLine of git(
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--unified=0',
          base,
          '--',
          path,
        ).split('\n')) {
          const hunk = /^@@ .* \+(\d+)/.exec(patchLine);
          if (hunk) line = Number(hunk[1]);
          else if (patchLine.startsWith('+') && !patchLine.startsWith('+++')) added.add(line++);
          else if (patchLine.startsWith(' ')) line++;
        }
        const hits = fileViolations(path, readFileSync(path, 'utf8')).filter((line) =>
          added.has(line),
        );
        violations += report(path, hits);
      }
      for (const sha of git('rev-list', '--no-merges', `${base}..HEAD`).split('\n').filter(Boolean))
        violations += report(
          `commit ${sha.slice(0, 10)}`,
          textViolations(git('log', '-1', '--format=%B', sha)),
        );
    }
    console.log(`english-only-gate: ${violations} line(s) with Chinese text`);
    process.exitCode = violations ? 1 : 0;
  } catch (error) {
    console.error(`english-only-gate: ${error.message}`);
    process.exitCode = 2;
  }
}
