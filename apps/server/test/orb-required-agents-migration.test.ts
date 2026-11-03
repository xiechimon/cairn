import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

function migrateUpTo(sqlite: Database.Database, directory: string, lastTag: string): void {
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  expect(cut).toBeGreaterThan(0);
  const prior = join(directory, 'prior');
  mkdirSync(join(prior, 'meta'), { recursive: true });
  const entries = journal.entries.slice(0, cut + 1);
  writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
  migrate(drizzle(sqlite), { migrationsFolder: prior });
}

function seedMachine(
  sqlite: Database.Database,
  row: { id: string; name: string; capabilities: string | null },
): void {
  sqlite
    .prepare(
      "INSERT INTO machine (id, teamId, name, capabilities) VALUES (@id, 't1', @name, @capabilities)",
    )
    .run(row);
}

function seedAgent(
  sqlite: Database.Database,
  row: { id: string; machineId: string | null; requiredCapabilities: string | null },
): void {
  sqlite
    .prepare(
      "INSERT INTO agent (id, teamId, displayName, machineId, requiredCapabilities) VALUES (@id, 't1', @id, @machineId, @requiredCapabilities)",
    )
    .run(row);
}

test('D71: agents pinned to an Orb executor keep the sandbox as a hard requirement once the pin becomes a preference', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-orb-required-migration-'));
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, '0089_chief_summary');
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('t1', 'Team', 1)");
    seedMachine(sqlite, { id: 'm-orb-name', name: 'omarchy-orb', capabilities: null });
    seedMachine(sqlite, {
      id: 'm-orb-report',
      name: 'sandbox-box',
      capabilities: JSON.stringify({ mcpServers: [], skills: [], executor: 'orb' }),
    });
    seedMachine(sqlite, {
      id: 'm-host',
      name: 'mac',
      capabilities: JSON.stringify({ mcpServers: [], skills: [], executor: 'host' }),
    });
    seedAgent(sqlite, { id: 'planner', machineId: 'm-orb-name', requiredCapabilities: null });
    seedAgent(sqlite, {
      id: 'implementer',
      machineId: 'm-orb-report',
      requiredCapabilities: JSON.stringify({ mcpServers: ['figma'] }),
    });
    seedAgent(sqlite, { id: 'reviewer', machineId: 'm-host', requiredCapabilities: null });
    seedAgent(sqlite, { id: 'floating', machineId: null, requiredCapabilities: null });

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });

    const required = (id: string) =>
      (
        sqlite.prepare('SELECT requiredCapabilities AS r FROM agent WHERE id = ?').get(id) as {
          r: string | null;
        }
      ).r;
    expect(JSON.parse(required('planner') ?? 'null')).toEqual({ executor: 'orb' });
    expect(JSON.parse(required('implementer') ?? 'null')).toEqual({
      mcpServers: ['figma'],
      executor: 'orb',
    });
    expect(required('reviewer')).toBeNull();
    expect(required('floating')).toBeNull();
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
