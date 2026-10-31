import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { newestSnapshotName, renderSchemaGlance } from './schema-glance.mjs';

const script = resolve('scripts/schema-glance.mjs');

function column(type, extra = {}) {
  return { type, primaryKey: false, notNull: false, autoincrement: false, ...extra };
}

function table(name, columns) {
  const named = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [key, { name: key, ...value }]),
  );
  return { name, columns: named, indexes: {}, foreignKeys: {} };
}

function snapshot(...tables) {
  return {
    version: '6',
    dialect: 'sqlite',
    tables: Object.fromEntries(tables.map((entry) => [entry.name, entry])),
  };
}

const base = () =>
  snapshot(
    table('task', {
      id: column('text', { notNull: true }),
      title: column('text'),
      status: column('text', { default: "'open'" }),
    }),
  );

const rowLines = (output) => output.split('\n').filter((line) => line.startsWith('| `'));

test('identical snapshots report no schema changes', () => {
  assert.equal(renderSchemaGlance(base(), base()), '### Schema changes\n\nNo schema changes\n');
});

test('an added table is listed once', () => {
  const next = base();
  next.tables.note = table('note', { id: column('text', { notNull: true }) });
  const out = renderSchemaGlance(base(), next);
  assert.match(out, /^### Schema changes\n\n\| table \| change \| detail \|\n\|---\|---\|---\|\n/);
  assert.deepEqual(rowLines(out), ['| `note` | table added | 1 column |']);
});

test('a dropped table and dropped columns are listed', () => {
  const prev = base();
  prev.tables.legacy = table('legacy', { id: column('text') });
  const next = base();
  delete next.tables.task.columns.title;
  delete next.tables.task.columns.status;
  assert.deepEqual(rowLines(renderSchemaGlance(prev, next)), [
    '| `legacy` | table dropped | 1 column |',
    "| `task` | - status | text default 'open' |",
    '| `task` | - title | text |',
  ]);
});

test('a type, nullability and default change are described together', () => {
  const next = base();
  next.tables.task.columns.title = {
    name: 'title',
    ...column('integer', { notNull: true, default: '0' }),
  };
  assert.deepEqual(rowLines(renderSchemaGlance(base(), next)), [
    '| `task` | ~ title | type text -> integer; NOT NULL added; default none -> 0 |',
  ]);
});

test('an added column shows type, NOT NULL and default', () => {
  const next = base();
  next.tables.task.columns.due = {
    name: 'due',
    ...column('integer', { notNull: true, default: '0' }),
  };
  assert.deepEqual(rowLines(renderSchemaGlance(base(), next)), [
    '| `task` | + due | integer NOT NULL default 0 |',
  ]);
});

test('an added index lists its columns and uniqueness', () => {
  const next = base();
  next.tables.task.indexes.task_title_unique = {
    name: 'task_title_unique',
    columns: ['title', 'status'],
    isUnique: true,
  };
  assert.deepEqual(rowLines(renderSchemaGlance(base(), next)), [
    '| `task` | + index task_title_unique | unique (title, status) |',
  ]);
});

test('foreign keys added and dropped are listed', () => {
  const next = base();
  next.tables.task.foreignKeys.task_owner_fk = {
    name: 'task_owner_fk',
    tableFrom: 'task',
    tableTo: 'user',
    columnsFrom: ['owner'],
    columnsTo: ['id'],
    onDelete: 'cascade',
    onUpdate: 'no action',
  };
  assert.deepEqual(rowLines(renderSchemaGlance(base(), next)), [
    '| `task` | + foreign key task_owner_fk | (owner) -> user(id) on delete cascade on update no action |',
  ]);
  assert.match(renderSchemaGlance(next, base()), /\| `task` \| - foreign key task_owner_fk \|/);
});

test('pipes in details are escaped', () => {
  const next = base();
  next.tables.task.columns.x = { name: 'x', ...column('text', { default: "'a|b'" }) };
  assert.match(renderSchemaGlance(base(), next), /default 'a\\\|b'/);
});

test('output is byte-stable regardless of key order', () => {
  const next = base();
  next.tables.zeta = table('zeta', { id: column('text') });
  next.tables.alpha = table('alpha', { id: column('text') });
  next.tables.task.columns.b = { name: 'b', ...column('text') };
  next.tables.task.columns.a = { name: 'a', ...column('text') };
  const reversed = {
    ...next,
    tables: Object.fromEntries(
      Object.entries(next.tables)
        .reverse()
        .map(([key, value]) => [
          key,
          { ...value, columns: Object.fromEntries(Object.entries(value.columns).reverse()) },
        ]),
    ),
  };
  const first = renderSchemaGlance(base(), next);
  assert.equal(renderSchemaGlance(base(), next), first);
  assert.equal(renderSchemaGlance(base(), reversed), first);
  const tableNames = rowLines(first).map((line) => line.slice(3, line.indexOf('`', 3)));
  assert.deepEqual(tableNames, ['alpha', 'task', 'task', 'zeta']);
});

test('newestSnapshotName picks the highest numbered snapshot', () => {
  assert.equal(
    newestSnapshotName([
      '0009_snapshot.json',
      '0010_snapshot.json',
      '_journal.json',
      '0002_snapshot.json',
    ]),
    '0010_snapshot.json',
  );
  assert.equal(newestSnapshotName(['_journal.json']), null);
});

test('the CLI renders two files byte-stably', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'glance-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const next = base();
  next.tables.note = table('note', { id: column('text') });
  writeFileSync(join(dir, 'a.json'), JSON.stringify(base()));
  writeFileSync(join(dir, 'b.json'), JSON.stringify(next));
  const run = () =>
    spawnSync('node', [script, join(dir, 'a.json'), join(dir, 'b.json')], { encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0);
  assert.equal(first.stdout, renderSchemaGlance(base(), next));
  assert.equal(run().stdout, first.stdout);
});

test('the CLI rejects missing arguments', () => {
  const result = spawnSync('node', [script], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage/i);
});

test('git mode picks the newest snapshot on each ref', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'glance-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  const meta = join(dir, 'apps/server/drizzle/meta');
  mkdirSync(meta, { recursive: true });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(meta, '0001_snapshot.json'), JSON.stringify(base()));
  git('add', 'apps');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
  const next = base();
  next.tables.note = table('note', { id: column('text') });
  writeFileSync(join(meta, '0002_snapshot.json'), JSON.stringify(next));
  git('add', 'apps');
  git('commit', '-q', '-m', 'head');
  const result = spawnSync('node', [script, '--base', 'main', '--head', 'feature'], {
    encoding: 'utf8',
    cwd: dir,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, renderSchemaGlance(base(), next));
});
