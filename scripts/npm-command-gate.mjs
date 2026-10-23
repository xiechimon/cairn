import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SCANNED = [':(glob)README*.md', ':(glob)site/**/*.html', ':(glob)apps/web/src/**/*.tsx'];
const COMMAND =
  /\b(?:npx(?:\s+-y)?|npm\s+(?:i|install)(?:\s+-g)?)\s+((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)/g;

export function packagesIn(text) {
  const names = [...text.matchAll(COMMAND)].map((m) => m[1].replace(/(?<=.)@.*$/, ''));
  return [...new Set(names)];
}

export async function missingPackages(contents, fetchFn = fetch) {
  const filesByName = new Map();
  for (const [file, text] of Object.entries(contents))
    for (const name of packagesIn(text))
      filesByName.set(name, [...(filesByName.get(name) ?? []), file]);
  const missing = [];
  for (const [name, files] of filesByName) {
    const res = await fetchFn(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (res.status === 404) missing.push({ name, files });
  }
  return missing;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const files = execFileSync('git', ['ls-files', '-z', '--', ...SCANNED], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const contents = Object.fromEntries(
    files.map((f) => [f, readFileSync(resolve(root, f), 'utf8')]),
  );
  const missing = await missingPackages(contents);
  for (const { name, files: where } of missing)
    console.error(`npm-command-gate: ${name} is not on npm (used in ${where.join(', ')})`);
  if (missing.length > 0) process.exit(1);
  console.log(`npm-command-gate: PASS (${files.length} files)`);
}
