import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkEntry, checkLedgerRoot, ledgerEntries } from './lessons-ledger-gate.mjs';

const repoRoot = join(import.meta.dirname, '..');
const lessonsDir = join(repoRoot, 'docs/lessons');
const entryText = (name) => readFileSync(join(lessonsDir, name), 'utf8');
const withField = (text, field, value) =>
  text.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`);

const memoryEntry = '1656-image-not-attached-to-reply.md';
const gateEntry = '1566-prepush-stale-origin-main.md';

test('every migrated entry passes and the old table is gone', () => {
  assert.ok(ledgerEntries(repoRoot).length >= 55);
  assert.deepEqual(checkLedgerRoot(repoRoot), []);
  assert.equal(existsSync(join(repoRoot, 'docs/lessons.md')), false);
});

test('level 5 entry without a reason is rejected', () => {
  const bad = withField(entryText(memoryEntry), 'Notes', '');
  assert.equal(checkEntry(memoryEntry, bad).length, 1);
});

test('level outside 1 to 5 is rejected', () => {
  for (const level of ['0', '6', 'two']) {
    assert.equal(checkEntry(gateEntry, withField(entryText(gateEntry), 'Level', level)).length, 1);
  }
});

test('pending upgrade without a ticket is rejected, with a ticket passes', () => {
  const base = entryText(memoryEntry);
  assert.equal(
    checkEntry(memoryEntry, withField(base, 'Notes', 'pending upgrade to level 2')).length,
    1,
  );
  assert.deepEqual(
    checkEntry(memoryEntry, withField(base, 'Notes', 'pending upgrade to level 2, see #12')),
    [],
  );
});

test('the real bad note that sat on main without a ticket is rejected', () => {
  const unticketed =
    'Negative control: the old table said FULL, the new table says file map; pending upgrade: make --check-coverage also report unmapped route source files';
  const text = withField(entryText(gateEntry), 'Notes', unticketed);
  assert.deepEqual(checkEntry(gateEntry, text), [
    `${gateEntry}: "pending upgrade" in Notes must carry a ticket number`,
  ]);
});

test('file name without a ticket number is rejected', () => {
  const text = entryText(gateEntry);
  for (const name of [
    'prepush-stale-origin-main.md',
    '1566.md',
    '1566-Stale_Ref.md',
    'x1566-a.md',
  ]) {
    assert.equal(checkEntry(name, text).length, 1, name);
  }
});

test('missing, reordered or malformed fields are rejected', () => {
  const text = entryText(gateEntry);
  assert.ok(checkEntry(gateEntry, text.replace(/^Intercepts:.*\n/m, '')).length >= 1);
  assert.ok(checkEntry(gateEntry, withField(text, 'Recurrences', 'many')).length >= 1);
  assert.ok(checkEntry(gateEntry, withField(text, 'Intercepts', '-1')).length >= 1);
  assert.ok(checkEntry(gateEntry, text.replace(/^---\n/, '')).length >= 1);
});

test('a resurrected docs/lessons.md table is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'lessons-gate-'));
  try {
    mkdirSync(join(root, 'docs/lessons'), { recursive: true });
    cpSync(join(lessonsDir, gateEntry), join(root, 'docs/lessons', gateEntry));
    assert.deepEqual(checkLedgerRoot(root), []);
    writeFileSync(join(root, 'docs/lessons.md'), '| Category |\n');
    assert.equal(checkLedgerRoot(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two parallel branches each adding an entry merge without conflict', () => {
  const root = mkdtempSync(join(tmpdir(), 'lessons-merge-'));
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        ...args,
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  const addEntry = (branch, name) => {
    git('checkout', '-q', '-b', branch, 'main');
    cpSync(join(lessonsDir, gateEntry), join(root, 'docs/lessons', name));
    git('add', '.');
    git('commit', '-q', '-m', branch);
  };
  try {
    git('init', '-q', '-b', 'main');
    mkdirSync(join(root, 'docs/lessons'), { recursive: true });
    cpSync(join(lessonsDir, memoryEntry), join(root, 'docs/lessons', memoryEntry));
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    addEntry('lane-a', '2001-lane-a-mistake.md');
    addEntry('lane-b', '2002-lane-b-mistake.md');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-edit', 'lane-a');
    git('merge', '-q', '--no-edit', 'lane-b');
    assert.equal(readdirSync(join(root, 'docs/lessons')).length, 3);
    assert.deepEqual(checkLedgerRoot(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the old single table does conflict when two branches append a row', () => {
  const root = mkdtempSync(join(tmpdir(), 'lessons-table-'));
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        ...args,
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  const appendRow = (branch) => {
    git('checkout', '-q', '-b', branch, 'main');
    writeFileSync(join(root, 'lessons.md'), `| Category |\n|---|\n| base |\n| ${branch} |\n`);
    git('commit', '-q', '-am', branch);
  };
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(root, 'lessons.md'), '| Category |\n|---|\n| base |\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    appendRow('lane-a');
    appendRow('lane-b');
    git('checkout', '-q', 'lane-a');
    assert.throws(() => git('merge', '-q', '--no-edit', 'lane-b'));
    assert.equal(git('diff', '--name-only', '--diff-filter=U').trim(), 'lessons.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
