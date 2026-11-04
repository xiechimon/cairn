#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SNAPSHOT_DIR = join(REPO_ROOT, 'apps/web/e2e/gallery-snapshots.spec.ts-snapshots');
const REPO = 'xiechimon/cairn';
export const ARTIFACT_PATTERN = 'gallery-snapshots-*';

export function baselineNameFor(path) {
  const name = basename(path);
  if (!path.includes('gallery-snapshots')) return null;
  if (name.endsWith('-actual.png')) return `${name.slice(0, -'-actual.png'.length)}-linux.png`;
  if (
    name.endsWith('-linux.png') &&
    basename(dirname(path)) === 'gallery-snapshots.spec.ts-snapshots'
  )
    return name;
  return null;
}

export function pickBaselines(files, read = (file) => readFileSync(file)) {
  const chosen = new Map();
  const fromRender = new Set();
  for (const file of files) {
    const target = baselineNameFor(file);
    if (target == null) continue;
    const render = file.endsWith('-actual.png');
    if (!render && fromRender.has(target)) continue;
    if (render && fromRender.has(target) && !read(chosen.get(target)).equals(read(file)))
      throw new Error(`two different CI renders for ${target}: ${chosen.get(target)} and ${file}`);
    chosen.set(target, file);
    if (render) fromRender.add(target);
  }
  return chosen;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function latestFailedRun(ref) {
  const raw = execFileSync(
    'gh',
    [
      'run',
      'list',
      '--repo',
      REPO,
      '--workflow',
      'ci.yml',
      '--branch',
      ref,
      '--limit',
      '10',
      '--json',
      'databaseId,conclusion',
    ],
    { encoding: 'utf8' },
  );
  const run = JSON.parse(raw).find((r) => r.conclusion === 'failure');
  if (run == null) throw new Error(`no failed ci.yml run on ${ref}`);
  return String(run.databaseId);
}

function main() {
  const arg = process.argv[2];
  if (arg == null) {
    console.error('usage: node scripts/gallery-snapshots-accept.mjs <run-id | branch>');
    process.exit(2);
  }
  const runId = /^\d+$/.test(arg) ? arg : latestFailedRun(arg);
  const work = mkdtempSync(join(tmpdir(), 'gallery-snapshots-'));
  execFileSync(
    'gh',
    ['run', 'download', runId, '--repo', REPO, '--pattern', ARTIFACT_PATTERN, '--dir', work],
    { stdio: 'inherit' },
  );
  const chosen = pickBaselines(walk(work));
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  for (const [target, file] of chosen) copyFileSync(file, join(SNAPSHOT_DIR, target));
  const accepted = new Set(chosen.keys());
  for (const name of [...accepted].sort()) console.log(`accepted ${name}`);
  console.log(`[gallery-snapshots-accept] ${accepted.size} baseline(s) from run ${runId}`);
  if (accepted.size === 0) process.exit(1);
}

if (process.argv[1] === import.meta.filename) main();
