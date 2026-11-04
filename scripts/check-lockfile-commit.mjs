#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const LOCKFILE = 'pnpm-lock.yaml';
const allowValue = process.env.CAIRN_ALLOW_LOCKFILE_CHANGE;
const allowed = allowValue === '1' || allowValue === 'true' || allowValue === 'yes';
const EXTERNAL_SECTIONS = new Set(['packages', 'snapshots']);
const SUMMARY_CAP = 40;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readFromGit(ref) {
  try {
    return git(['show', ref]);
  } catch {
    return undefined;
  }
}

const SECTION_RE = /^([A-Za-z][\w.-]*):/;
const ENTRY_RE = /^ {2}(\S.*?):(.*)$/;

function parseExternalEntries(text) {
  const entries = new Map();
  let sawExternalSection = false;
  let inExternal = false;
  let currentKey = null;
  let body = [];
  const flushEntry = () => {
    if (currentKey === null) return;
    entries.set(
      currentKey,
      body
        .map((l) => l.trimEnd())
        .filter((l) => l !== '')
        .join('\n'),
    );
    currentKey = null;
    body = [];
  };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '---') {
      flushEntry();
      inExternal = false;
      continue;
    }
    const section = SECTION_RE.exec(line);
    if (section) {
      flushEntry();
      inExternal = EXTERNAL_SECTIONS.has(section[1]);
      if (inExternal) sawExternalSection = true;
      continue;
    }
    if (!inExternal) continue;
    const entry = ENTRY_RE.exec(line);
    if (entry) {
      flushEntry();
      currentKey = entry[1];
      const inline = entry[2].trim();
      if (inline !== '' && inline !== '{}') body.push(inline);
      continue;
    }
    if (currentKey !== null) body.push(line);
  }
  flushEntry();
  return { ok: text.trim() === '' || sawExternalSection, entries };
}

function diffEntries(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (!before.has(key)) added.push(key);
    else if (!after.has(key)) removed.push(key);
    else if (before.get(key) !== after.get(key)) changed.push(key);
  }
  return { added, removed, changed };
}

function splitKey(key) {
  let k = key;
  if (k.startsWith("'")) k = k.slice(1, -1);
  const paren = k.indexOf('(');
  if (paren !== -1) k = k.slice(0, paren);
  const at = k.startsWith('@') ? k.indexOf('@', 1) : k.indexOf('@');
  if (at === -1) return { name: k, version: undefined };
  return { name: k.slice(0, at), version: k.slice(at + 1) };
}

function summarize({ added, removed, changed }) {
  const addedByName = new Map();
  for (const key of added) {
    const { name, version } = splitKey(key);
    addedByName.set(name, [...(addedByName.get(name) ?? []), version ?? '?']);
  }
  const removedByName = new Map();
  for (const key of removed) {
    const { name, version } = splitKey(key);
    removedByName.set(name, [...(removedByName.get(name) ?? []), version ?? '?']);
  }
  const lines = [];
  for (const name of [...new Set([...addedByName.keys(), ...removedByName.keys()])].sort()) {
    const addedVersions = addedByName.get(name);
    const removedVersions = removedByName.get(name);
    if (addedVersions && removedVersions) {
      const sameVersion = removedVersions.join('/') === addedVersions.join('/');
      lines.push(
        sameVersion
          ? `changed ${name}@${addedVersions.join('/')} (peer-dependency variants)`
          : `changed ${name} ${removedVersions.join('/')} -> ${addedVersions.join('/')}`,
      );
    } else if (addedVersions) {
      lines.push(`added ${name}@${addedVersions.join('/')}`);
    } else if (removedVersions) {
      lines.push(`removed ${name}@${removedVersions.join('/')}`);
    }
  }
  for (const key of changed.sort()) lines.push(`changed ${key} (resolution/metadata)`);
  return lines;
}

function block(summary) {
  console.error(`${LOCKFILE} is staged with external dependency changes.`);
  console.error('');
  console.error('Review the lockfile changes before committing:');
  console.error('  - confirm every added/updated package is intentional');
  console.error('  - confirm the resolution came from your own pnpm install, not an editor');
  console.error('  - review any new install scripts in the dependency tree');
  if (summary.length > 0) {
    console.error('');
    console.error('Detected external dependency changes:');
    for (const line of summary.slice(0, SUMMARY_CAP)) console.error(`  - ${line}`);
    if (summary.length > SUMMARY_CAP) {
      console.error(`  ... ${summary.length - SUMMARY_CAP} more`);
    }
  }
  console.error('');
  console.error('If this lockfile change is intentional, commit with:');
  console.error('  CAIRN_ALLOW_LOCKFILE_CHANGE=1 git commit ...');
  console.error('To drop it, run `git reset pnpm-lock.yaml`.');
  process.exit(1);
}

const stagedFiles = git(['diff', '--cached', '--name-only'])
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

if (!stagedFiles.includes(LOCKFILE)) process.exit(0);

if (allowed) {
  console.error(`${LOCKFILE} is staged; CAIRN_ALLOW_LOCKFILE_CHANGE is set, allowing commit.`);
  process.exit(0);
}

const before = readFromGit(`HEAD:${LOCKFILE}`);
const after = readFromGit(`:${LOCKFILE}`);

if (after === undefined) {
  console.error(`${LOCKFILE} is staged for deletion — removing the lockfile needs review.`);
  console.error('');
  console.error('If this deletion is intentional, commit with:');
  console.error('  CAIRN_ALLOW_LOCKFILE_CHANGE=1 git commit ...');
  process.exit(1);
}
if (before === undefined) {
  console.error(
    `${LOCKFILE} is newly added (no copy in HEAD) — the gate cannot classify a whole new lockfile.`,
  );
  console.error('');
  console.error('If this addition is intentional, commit with:');
  console.error('  CAIRN_ALLOW_LOCKFILE_CHANGE=1 git commit ...');
  process.exit(1);
}

const beforeParsed = parseExternalEntries(before);
const afterParsed = parseExternalEntries(after);
if (!beforeParsed.ok || !afterParsed.ok) {
  console.error(
    `${LOCKFILE} does not parse as a known pnpm lockfile shape (no packages/snapshots section found in the ${beforeParsed.ok ? 'staged' : 'HEAD'} copy); the gate cannot classify the change.`,
  );
  console.error('');
  console.error('If this change is intentional, commit with:');
  console.error('  CAIRN_ALLOW_LOCKFILE_CHANGE=1 git commit ...');
  process.exit(1);
}

const { added, removed, changed } = diffEntries(beforeParsed.entries, afterParsed.entries);
if (added.length === 0 && removed.length === 0 && changed.length === 0) {
  console.error(
    `${LOCKFILE} only updates workspace-side metadata (importers/catalogs/settings); allowing commit.`,
  );
  process.exit(0);
}

block(summarize({ added, removed, changed }));
