import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

interface LegacyTableSpec {
  name: string;
  jsonColumns: readonly string[];
}

const LEGACY_TABLES: readonly LegacyTableSpec[] = [
  { name: 'skill', jsonColumns: ['files'] },
  { name: 'mcp_server', jsonColumns: ['credentialKeys', 'args'] },
];

function tableExists(sqlite: Database.Database, table: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return row !== undefined;
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function exportFileName(now: Date): string {
  return `legacy-export-${now.toISOString().replaceAll(':', '-').replaceAll('.', '-')}.json`;
}

export function exportLegacyTables(
  sqlite: Database.Database,
  legacyExportDir: string | undefined,
  now: Date = new Date(),
): void {
  if (legacyExportDir === undefined) return;
  const tables: Record<string, unknown[]> = {};
  let rowCount = 0;
  for (const spec of LEGACY_TABLES) {
    if (!tableExists(sqlite, spec.name)) continue;
    const rows = sqlite.prepare(`SELECT * FROM \`${spec.name}\``).all() as Record<
      string,
      unknown
    >[];
    if (rows.length === 0) continue;
    tables[spec.name] = rows.map((row) => {
      const out: Record<string, unknown> = { ...row };
      for (const col of spec.jsonColumns) {
        if (col in out) out[col] = tryParseJson(out[col]);
      }
      return out;
    });
    rowCount += rows.length;
  }
  if (rowCount === 0) return;
  mkdirSync(legacyExportDir, { recursive: true });
  const file = join(legacyExportDir, exportFileName(now));
  writeFileSync(
    file,
    `${JSON.stringify({ exportedAt: now.getTime(), tables }, null, 2)}\n`,
    'utf8',
  );
}

export function listLegacyExports(legacyExportDir: string): string[] {
  try {
    return readdirSync(legacyExportDir)
      .filter((f) => /^legacy-export-.+\.json$/.test(f))
      .sort();
  } catch {
    return [];
  }
}
