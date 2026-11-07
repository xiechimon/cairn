import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect } from 'vitest';
import { MIGRATIONS_FOLDER, migrateDatabase } from '../src/db/client.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

export function migrationsThrough(directory: string, lastTag: string): string {
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  expect(cut).toBeGreaterThan(0);
  const prior = join(directory, 'prior');
  mkdirSync(join(prior, 'meta'), { recursive: true });
  const entries = journal.entries.slice(0, cut + 1);
  writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
  return prior;
}

export function migrateUpTo(sqlite: Database.Database, directory: string, lastTag: string): void {
  migrate(drizzle(sqlite), { migrationsFolder: migrationsThrough(directory, lastTag) });
}

export function migrateAll(sqlite: Database.Database): void {
  migrateDatabase(sqlite, drizzle(sqlite));
}
