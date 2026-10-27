#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const META_DIR = join(SERVER_DIR, 'drizzle', 'meta');
const ZERO_UUID = '00000000000000000000000000000000';

const problems = [];
const notes = [];

const journalPath = join(META_DIR, '_journal.json');
if (!existsSync(journalPath)) {
  problems.push(`missing ${journalPath}`);
} else {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const entries = [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);
  if (entries.length === 0) problems.push('_journal.json has no entries');

  let prev = null;
  for (const entry of entries) {
    const file = `${String(entry.idx).padStart(4, '0')}_snapshot.json`;
    const path = join(META_DIR, file);
    if (!existsSync(path)) {
      notes.push(
        `${file}: journal entry exists but snapshot file is missing; drizzle skips it in the chain`,
      );
      continue;
    }
    const snap = JSON.parse(readFileSync(path, 'utf8'));
    const expected = prev === null ? ZERO_UUID : prev.id.replace(/-/g, '');
    const actual = String(snap.prevId).replace(/-/g, '');
    if (actual !== expected) {
      problems.push(
        `${file}: prevId=${actual.slice(0, 8)} should point to ${
          prev === null ? 'zero (first entry)' : `${prev.file} id=${expected.slice(0, 8)}`
        } (snapshot chain broken — drizzle-kit silently refuses to generate migrations)`,
      );
    }
    prev = { id: snap.id, file };
  }
}

try {
  const out = execFileSync('pnpm', ['exec', 'drizzle-kit', 'check'], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (/collision|are pointing to a parent snapshot/i.test(out)) {
    problems.push('drizzle-kit check reported snapshot parent collision (see its output)');
  }
} catch (err) {
  const text = `${err?.stdout ?? ''}${err?.stderr ?? ''}`;
  if (/collision|are pointing to a parent snapshot/i.test(text)) {
    problems.push('drizzle-kit check reported snapshot parent collision (see its output)');
  } else {
    problems.push(`drizzle-kit check failed: ${err?.message ?? String(err)}`);
  }
}

for (const n of notes) process.stdout.write(`note: ${n}\n`);

if (problems.length > 0) {
  process.stderr.write('drizzle guard failed:\n');
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.stderr.write(
    '\nfix: make the snapshot chain linear — entry N prevId must equal entry N-1 id' +
      ' (common after parallel-lane drizzle merge collisions; see migration discipline 01 §6).\n',
  );
  process.exit(1);
}
process.stdout.write('drizzle guard passed: linear snapshot chain, no parent collisions\n');
