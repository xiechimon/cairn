#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DOC_DIRS = ['docs/spec', 'docs/adr'];
const SCOPE_DIRS = ['apps', 'packages', 'scripts'];
const IDENT_RE = /(?<![\w.])((?:[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][A-Za-z0-9]*))\(/g;
const SPAN_RE = /`([^`]+)`/g;
const RANGE_SUFFIX = /:\d+(?:[-,/]\d+)*$/;

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitOk(cwd, ...args) {
  try {
    return git(cwd, ...args).trim();
  } catch {
    return '';
  }
}

function existsAtHead(tracked, path) {
  if (tracked.has(path)) return true;
  for (const entry of tracked) {
    if (entry.endsWith(`/${path}`) || entry.startsWith(`${path}/`)) return true;
  }
  return false;
}

function identifierExisted(cwd, name) {
  return gitOk(cwd, 'log', '--format=%H', '-1', '-S', name, '--', ...SCOPE_DIRS).length > 0;
}

function identifierInCode(cwd, name) {
  return gitOk(cwd, 'grep', '-w', '-l', name, 'HEAD', '--', ...SCOPE_DIRS).length > 0;
}

function stripRange(path) {
  return path.replace(RANGE_SUFFIX, '');
}

export function collectDocDrift(cwd = process.cwd()) {
  const tracked = new Set(
    git(cwd, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean),
  );
  const docs = [...tracked]
    .filter((file) => DOC_DIRS.some((dir) => file.startsWith(`${dir}/`)) && file.endsWith('.md'))
    .sort();
  const rows = [];
  for (const doc of docs) {
    const lines = git(cwd, 'show', `HEAD:${doc}`).split('\n');
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fenceMark = line.trim().match(/^(```|~~~)/);
      if (fenceMark) {
        fence = fence ? null : fenceMark[1];
        continue;
      }
      if (fence || (/^#|^\s*\|/.test(line) && /\b(superseded|retired|removed)\b/i.test(line)))
        continue;
      for (const match of line.matchAll(SPAN_RE)) {
        const span = match[1].trim();
        if (!span || /:\/\//.test(span) || /^(https?:|www\.|mailto:|[~/])/.test(span)) continue;
        const token = span.split(/\s+/)[0];
        let path = null;
        if (SCOPE_DIRS.some((dir) => token.startsWith(`${dir}/`))) path = token;
        else if (/^[^/]+\/\S+\.\w+$/.test(token)) path = token;
        if (path) {
          path = stripRange(path);
          const plain = path.replace(/[{}*?[\]]/g, '');
          if (path !== plain) continue;
          if (!/\.\w+$/.test(path)) continue;
          if (
            !existsAtHead(tracked, path) &&
            gitOk(
              cwd,
              'log',
              '--format=%H',
              '-1',
              'HEAD',
              '--',
              `:(literal)${path}`,
              `:(glob)**/${path}`,
            ).length > 0
          ) {
            rows.push({ doc, name: path, kind: 'path', line: i + 1 });
          }
        }
        for (const ident of span.matchAll(IDENT_RE)) {
          const name = ident[1];
          if (name.length < 6) continue;
          if (!identifierInCode(cwd, name) && identifierExisted(cwd, name)) {
            rows.push({ doc, name, kind: 'identifier', line: i + 1 });
          }
        }
        const pathToken = stripRange(token);
        if (
          /\.tsx?$/.test(pathToken) &&
          !/[{}*?[\]]/.test(pathToken) &&
          existsAtHead(tracked, pathToken)
        ) {
          const base = pathToken
            .split('/')
            .pop()
            .replace(/\.tsx?$/, '');
          if (
            base.length >= 6 &&
            /^[A-Za-z][A-Za-z0-9]*$/.test(base) &&
            !identifierInCode(cwd, base) &&
            identifierExisted(cwd, base)
          ) {
            rows.push({ doc, name: base, kind: 'identifier', line: i + 1 });
          }
        }
      }
    }
  }
  rows.sort(
    (a, b) =>
      a.doc.localeCompare(b.doc) ||
      a.line - b.line ||
      a.kind.localeCompare(b.kind) ||
      a.name.localeCompare(b.name),
  );
  return { docs, rows };
}

export function renderDriftSection({ docs, rows }) {
  const kinds = { path: 0, identifier: 0 };
  for (const row of rows) kinds[row.kind] += 1;
  const table = rows
    .map((row) => `| ${row.doc} | \`${row.name}\` | ${row.kind} | ${row.line} |`)
    .join('\n');
  return [
    '## Spec/ADR drift at HEAD',
    '',
    `Scanned ${docs.length} docs under ${DOC_DIRS.join(' and ')}. ${rows.length} missing names: ${kinds.path} paths, ${kinds.identifier} identifiers.`,
    '',
    ...(rows.length === 0
      ? ['No spec/ADR drift found.']
      : ['| doc | missing | kind | line |', '| --- | --- | --- | --- |', table]),
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const option = (name) => {
      const at = args.indexOf(name);
      return at === -1 ? undefined : args[at + 1];
    };
    const now = new Date(option('--now') ?? Date.now());
    const outDir = option('--out') ?? '.gardener';
    const report = collectDocDrift();
    const section = renderDriftSection(report);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, `drift-${now.toISOString().slice(0, 10)}.json`),
      JSON.stringify(report.rows, null, 2),
    );
    process.stdout.write(section);
  } catch (error) {
    console.error(`doc-drift: ${error.message}`);
    process.exitCode = 2;
  }
}
