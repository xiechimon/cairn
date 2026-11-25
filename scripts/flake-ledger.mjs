#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function loadFlakeLedger({ cwd = REPO_ROOT, now = new Date(), ledgerPath = null } = {}) {
  const file = ledgerPath ?? join(cwd, 'scripts/flake-ledger.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed?.version !== 1 || !Array.isArray(parsed.flakes)) {
    throw new Error('flake ledger must be {version:1,flakes:[...]}');
  }
  const seen = new Set();
  const entries = parsed.flakes.map((entry, index) => {
    const label = `flake ledger row ${index + 1}`;
    if (typeof entry?.path !== 'string' || entry.path.length === 0) {
      throw new Error(`${label}: path is required`);
    }
    if (seen.has(entry.path)) throw new Error(`${label}: duplicate path ${entry.path}`);
    seen.add(entry.path);
    if (typeof entry.owner !== 'string' || !/^[a-z0-9-]+$/i.test(entry.owner)) {
      throw new Error(`${label}: owner must be a GitHub handle`);
    }
    if (typeof entry.expires !== 'string' || !DATE.test(entry.expires)) {
      throw new Error(`${label}: expires must be YYYY-MM-DD`);
    }
    if (Date.parse(`${entry.expires}T23:59:59Z`) < now.getTime()) {
      throw new Error(
        `${label}: ${entry.path} expired on ${entry.expires}; fix the flake or renew it with an owner`,
      );
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 10) {
      throw new Error(`${label}: reason must say what instability is being tracked`);
    }
    if (!existsSync(join(cwd, entry.path)))
      throw new Error(`${label}: ${entry.path} does not exist`);
    return { path: entry.path, owner: entry.owner, expires: entry.expires, reason: entry.reason };
  });
  return entries;
}

export function retryGreenVerdict(files, entries) {
  const listed = new Map(entries.map((entry) => [entry.path, entry]));
  const known = [];
  const unlisted = [];
  for (const file of [...new Set(files)].sort()) {
    const entry = listed.get(file);
    if (entry) known.push({ path: file, entry });
    else unlisted.push(file);
  }
  return { listed: known, unlisted };
}

export function reportRetryGreen(
  files,
  { cwd = REPO_ROOT, label = 'test', now = new Date() } = {},
) {
  if (files.length === 0) return { failed: false, listed: [], unlisted: [] };
  const verdict = retryGreenVerdict(files, loadFlakeLedger({ cwd, now }));
  for (const item of verdict.listed) {
    console.log(
      `::warning::flake ledger: ${item.path} went green on retry; owner ${item.entry.owner}, expires ${item.entry.expires}. ${item.entry.reason}`,
    );
  }
  if (verdict.unlisted.length > 0) {
    console.error(
      `flake ledger: unlisted ${label} file(s) went green on retry: ${verdict.unlisted.join(', ')}. Fix the flake or add owner+expiry to scripts/flake-ledger.json.`,
    );
  }
  return { failed: verdict.unlisted.length > 0, ...verdict };
}

export function playwrightFileId(relativeSpecPath) {
  return createHash('sha1')
    .update(relativeSpecPath.split('\\').join('/'))
    .digest('hex')
    .slice(0, 20);
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, base));
    else if (entry.isFile())
      out.push(
        path
          .slice(base.length + 1)
          .split('\\')
          .join('/'),
      );
  }
  return out;
}

export function playwrightSpecFilesFromIds(ids, webDir = join(REPO_ROOT, 'apps/web')) {
  const testDir = join(webDir, 'e2e');
  const byId = new Map();
  for (const rel of walk(testDir).filter((path) => path.endsWith('.spec.ts'))) {
    byId.set(playwrightFileId(rel), `apps/web/e2e/${rel}`);
  }
  const files = [];
  const unknown = [];
  for (const id of ids) {
    const file = byId.get(id.slice(0, 20));
    if (file) files.push(file);
    else unknown.push(`unknown-playwright-test:${id}`);
  }
  return [...new Set([...files, ...unknown])].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const entries = loadFlakeLedger();
    console.log(`flake-ledger: PASS (${entries.length} entries)`);
  } catch (error) {
    console.error(`flake-ledger: FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
