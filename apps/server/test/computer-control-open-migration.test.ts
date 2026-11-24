import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { infoComputerHosts } from '../src/services/info-card.js';
import { teamOffersDesktop } from '../src/services/machine-computer.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

test('a machine whose owner had turned computer control off offers the browser and desktop again after the upgrade', () => {
  const directory = makeTestTempDir('cairn-computer-control-open-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  const db = drizzle(sqlite, { schema });
  try {
    const drop = journal.entries.findIndex((entry) =>
      readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8').includes(
        'DROP COLUMN `desktopOverride`',
      ),
    );
    const cut = drop === -1 ? journal.entries.length : drop;
    const prior = join(directory, 'prior');
    mkdirSync(join(prior, 'meta'), { recursive: true });
    const entries = journal.entries.slice(0, cut);
    writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
    }
    migrate(db, { migrationsFolder: prior });
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
    sqlite.exec(
      `INSERT INTO machine (id, teamId, name, online, lastSeenAt, capabilities, browserOverride, desktopOverride) VALUES ('m1', 'team', 'desktop', 1, 1, '${JSON.stringify(
        { mcpServers: [], skills: [], computer: true, browser: true, computerKind: 'host' },
      )}', 0, 0)`,
    );
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(teamOffersDesktop(db, 'team')).toBe(true);
    expect(infoComputerHosts(db, 'team')).toHaveLength(1);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
