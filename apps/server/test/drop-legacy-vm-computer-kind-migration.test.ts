import { rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

test('migration 0256 strips non-host computerKind values and retires offline VM machine rows', () => {
  const directory = makeTestTempDir('cairn-drop-legacy-vm-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, '0255_runner_auto_dispatch');
    sqlite.pragma('foreign_keys = OFF');
    const insert = sqlite.prepare(
      'INSERT INTO machine (id, teamId, name, online, retiredAt, capabilities) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insert.run(
      'vm-offline',
      'team',
      'vm-offline',
      0,
      null,
      JSON.stringify({ mcpServers: ['figma'], skills: [], computer: true, computerKind: 'vm' }),
    );
    insert.run(
      'vm-already-retired',
      'team',
      'vm-already-retired',
      0,
      12345,
      JSON.stringify({ mcpServers: [], skills: [], computerKind: 'vm' }),
    );
    insert.run(
      'vm-online',
      'team',
      'vm-online',
      1,
      null,
      JSON.stringify({ mcpServers: [], skills: [], computerKind: 'vm' }),
    );
    insert.run(
      'unknown-kind',
      'team',
      'unknown-kind',
      0,
      null,
      JSON.stringify({ mcpServers: ['docs'], skills: [], computerKind: 'legacy-unknown' }),
    );
    insert.run(
      'host-offline',
      'team',
      'host-offline',
      0,
      null,
      JSON.stringify({ mcpServers: [], skills: [], computer: true, computerKind: 'host' }),
    );
    insert.run('null-caps', 'team', 'null-caps', 0, null, null);

    migrateAll(sqlite);

    const rows = sqlite
      .prepare('SELECT id, retiredAt, capabilities FROM machine ORDER BY id')
      .all() as { id: string; retiredAt: number | null; capabilities: string | null }[];
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get('vm-offline')?.retiredAt).not.toBeNull();
    expect(JSON.parse(byId.get('vm-offline')!.capabilities!)).toEqual({
      mcpServers: ['figma'],
      skills: [],
      computer: true,
    });

    expect(byId.get('vm-already-retired')?.retiredAt).toBe(12345);
    expect(JSON.parse(byId.get('vm-already-retired')!.capabilities!)).toEqual({
      mcpServers: [],
      skills: [],
    });

    expect(byId.get('vm-online')?.retiredAt).toBeNull();
    expect(JSON.parse(byId.get('vm-online')!.capabilities!)).toEqual({
      mcpServers: [],
      skills: [],
    });

    expect(byId.get('unknown-kind')?.retiredAt).toBeNull();
    expect(JSON.parse(byId.get('unknown-kind')!.capabilities!)).toEqual({
      mcpServers: ['docs'],
      skills: [],
    });

    expect(byId.get('host-offline')?.retiredAt).toBeNull();
    expect(JSON.parse(byId.get('host-offline')!.capabilities!)).toEqual({
      mcpServers: [],
      skills: [],
      computer: true,
      computerKind: 'host',
    });

    expect(byId.get('null-caps')?.retiredAt).toBeNull();
    expect(byId.get('null-caps')?.capabilities).toBeNull();
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
