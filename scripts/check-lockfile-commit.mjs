#!/usr/bin/env node

// Diff-aware lockfile commit gate (#1077), adapted from
// earendil-works/pi's scripts/check-lockfile-commit.mjs (which guards an npm
// package-lock.json) for pnpm's pnpm-lock.yaml. The direct port is
// impossible: npm's lockfile is JSON with a flat `packages` map keyed by
// filesystem paths, while pnpm's is YAML whose workspace/external split is
// expressed by section, not by path prefix — `importers`/`catalogs`/`settings`
// hold workspace-side metadata, `packages`/`snapshots` hold resolved external
// packages (including the pnpm self-manager document that pnpm 12 prepends
// for `packageManagerDependencies`).
//
// Why diff-aware: the previous guard in .husky/pre-commit was binary — any
// staged pnpm-lock.yaml required PACMAN_ALLOW_LOCKFILE_CHANGE, so routine
// workspace-side edits (a renamed or newly linked workspace dependency, a
// catalog specifier edit, lockfile regeneration) all tripped it and the only
// way through was the env var. This gate auto-allows commits whose
// packages/snapshots entries are entry-for-entry equal to HEAD, and blocks
// with a per-package added/removed/changed summary otherwise.
//
// Comparison granularity is the entry, not the byte: pnpm may reorder
// sections when regenerating, and entry-map comparison makes that churn
// invisible while any real resolution change stays visible.
//
// Fail-closed: anything the gate cannot parse, or cannot read from git, is
// treated as an external change. A block is always overridable with
// PACMAN_ALLOW_LOCKFILE_CHANGE (1/true/yes) — the same escape hatch the
// binary gate used, so lane discipline keeps working unchanged.
//
// Exit code 0 = allow, 1 = block. Run from the repo root (husky does).

import { execFileSync } from 'node:child_process';

const LOCKFILE = 'pnpm-lock.yaml';
const allowValue = process.env.PACMAN_ALLOW_LOCKFILE_CHANGE;
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

// pnpm v9 lockfiles are machine-generated: 2-space indents, no block
// scalars, documents split on `---`. That regularity is what makes a
// line-shape parse stable here where a general YAML parse would need a
// dependency. A top-level `name:` line opens a section; inside
// packages/snapshots, the 2-space-indented `key:` lines open entries and
// every deeper (or blank) line belongs to the current entry. Keys come in
// two shapes — `key:` opening a block body, and `key: {}` for entries with
// no content (common in snapshots); both must open an entry, otherwise the
// inline form leaks into the previous entry's body and every diff is wrong.
const SECTION_RE = /^([A-Za-z][\w.-]*):/;
const ENTRY_RE = /^ {2}(\S.*?):(.*)$/;

// Returns { ok, entries } — ok=false means the text is non-empty but no
// packages/snapshots section was found, i.e. it does not look like a pnpm
// lockfile we understand (garbage, conflict markers, a future format).
// Such a result must fail closed, never read as "no external changes".
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

// Key shapes: name@version, '@scope/name@version', and snapshots keys with
// peer-suffixes like name@version(peer@x)(peer@y). Strip quotes and the
// peer suffix before splitting so an add+remove pair of the same package
// renders as a version change instead of two unrelated lines.
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
  console.error('  PACMAN_ALLOW_LOCKFILE_CHANGE=1 git commit ...');
  console.error('To drop it, run `git reset pnpm-lock.yaml`.');
  process.exit(1);
}

const stagedFiles = git(['diff', '--cached', '--name-only'])
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

if (!stagedFiles.includes(LOCKFILE)) process.exit(0);

if (allowed) {
  console.error(`${LOCKFILE} is staged; PACMAN_ALLOW_LOCKFILE_CHANGE is set, allowing commit.`);
  process.exit(0);
}

const before = readFromGit(`HEAD:${LOCKFILE}`);
const after = readFromGit(`:${LOCKFILE}`);

if (after === undefined) {
  console.error(`${LOCKFILE} is staged for deletion — removing the lockfile needs review.`);
  console.error('');
  console.error('If this deletion is intentional, commit with:');
  console.error('  PACMAN_ALLOW_LOCKFILE_CHANGE=1 git commit ...');
  process.exit(1);
}
if (before === undefined) {
  console.error(
    `${LOCKFILE} is newly added (no copy in HEAD) — the gate cannot classify a whole new lockfile.`,
  );
  console.error('');
  console.error('If this addition is intentional, commit with:');
  console.error('  PACMAN_ALLOW_LOCKFILE_CHANGE=1 git commit ...');
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
  console.error('  PACMAN_ALLOW_LOCKFILE_CHANGE=1 git commit ...');
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
