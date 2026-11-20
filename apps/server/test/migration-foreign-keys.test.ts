import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { migrateDatabase } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';

const JOURNAL = {
  version: '7',
  dialect: 'sqlite',
  entries: [
    { idx: 0, tag: '0000_base', when: 0, breakpoints: true },
    { idx: 1, tag: '0001_change', when: 1, breakpoints: true },
  ],
};

const BASE_SQL = `CREATE TABLE parent (id text PRIMARY KEY NOT NULL);--> statement-breakpoint
CREATE TABLE child (id text PRIMARY KEY NOT NULL, parentId text NOT NULL, FOREIGN KEY (parentId) REFERENCES parent(id));--> statement-breakpoint
INSERT INTO parent VALUES ('p1');--> statement-breakpoint
INSERT INTO child VALUES ('c1', 'p1');`;

function folderWith(changeSql: string): string {
  const directory = makeTestTempDir('cairn-migrate-fk-');
  const folder = join(directory, 'migrations');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(JOURNAL));
  writeFileSync(join(folder, '0000_base.sql'), BASE_SQL);
  writeFileSync(join(folder, '0001_change.sql'), changeSql);
  return folder;
}

function open() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

test('a migration that drops a foreign-keyed parent is reported instead of orphaned silently', () => {
  const { sqlite, db } = open();
  try {
    expect(() => migrateDatabase(db, sqlite, folderWith('DROP TABLE `parent`;'))).toThrow(
      /foreign key violations introduced by migrations/,
    );
  } finally {
    sqlite.close();
  }
});

test('the documented create-copy-drop-rename rebuild keeps child rows attached', () => {
  const { sqlite, db } = open();
  try {
    const folder = folderWith(
      `CREATE TABLE \`__new_parent\` (id text PRIMARY KEY NOT NULL);--> statement-breakpoint
INSERT INTO \`__new_parent\` SELECT * FROM \`parent\`;--> statement-breakpoint
DROP TABLE \`parent\`;--> statement-breakpoint
ALTER TABLE \`__new_parent\` RENAME TO \`parent\`;`,
    );
    migrateDatabase(db, sqlite, folder);
    const rows = sqlite
      .prepare(
        'SELECT child.id, parent.id IS NOT NULL AS attached FROM child LEFT JOIN parent ON child.parentId = parent.id',
      )
      .all() as { id: string; attached: number }[];
    expect(rows).toEqual([{ id: 'c1', attached: 1 }]);
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  } finally {
    sqlite.close();
  }
});
