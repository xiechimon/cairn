import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER, openDbWithHandle } from '../src/db/client.js';
import { runAgentLayerDataMigration } from '../src/legacy/agent-layer/data-migration.js';
import { isCorrectionTask } from '../src/services/correction.js';
import { bootServer, postProject, req } from './helpers.js';
import { migrateUpTo } from './migrate-helpers.js';

type MigrationSnapshot = {
  id: string;
  prevId: string;
  tables: { todo: { columns: Record<string, unknown> } };
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function previousDatabase(): string {
  const dir = makeTestTempDir('correction-classification-');
  dirs.push(dir);
  const path = join(dir, 'server.db');
  const sqlite = new Database(path);
  try {
    sqlite.pragma('foreign_keys = ON');
    migrateUpTo(sqlite, dir, '0119_agent_layer_backup');
    runAgentLayerDataMigration(sqlite);
    migrateUpTo(sqlite, dir, '0138_step_prompt_origin');
    sqlite.exec(`
      INSERT INTO user (id, displayName) VALUES ('u', 'Owner');
      INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1);
      INSERT INTO project (id, teamId, name) VALUES ('local', 'team', 'Local');
      INSERT INTO project (id, teamId, name, repoKind, githubRepo)
        VALUES ('github', 'team', 'GitHub', 'github', 'octo/demo');
      INSERT INTO todo (id, teamId, projectId, title, spec, phaseAt, seqNum, sourceKind)
        VALUES ('local-fix', 'team', 'local', 'Fix', 'Original spec', 1, 1, NULL),
               ('github-fix', 'team', 'github', 'Fix issue', 'Issue spec', 2, 2, 'github-issue'),
               ('ordinary', 'team', 'local', 'Ordinary', 'Ordinary spec', 3, 3, NULL);
      INSERT INTO tag (id, projectId, name, color)
        VALUES ('local-correction', 'local', 'CoRrEcTiOn', '#123456'),
               ('github-correction', 'github', 'correction', '#654321'),
               ('bug', 'local', 'bug', '#abcdef');
      INSERT INTO todo_tag (todoId, tagId)
        VALUES ('local-fix', 'local-correction'), ('github-fix', 'github-correction'),
               ('ordinary', 'bug');
    `);
  } finally {
    sqlite.close();
  }
  return path;
}

async function correctionWorld(classified = false) {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Original task',
    spec: 'Original body.',
  });
  expect(created.status).toBe(201);
  const taskId = ((await created.json()) as { id: string }).id;
  if (classified) {
    s.db.run(sql`UPDATE todo SET correctionRequired = 1 WHERE id = ${taskId}`);
  }
  return { s, projectId, taskId };
}

function classificationState(s: ReturnType<typeof bootServer>, taskId: string) {
  return {
    task: s.db.get(sql`SELECT * FROM todo WHERE id = ${taskId}`),
    schedules: s.db.all(sql`SELECT * FROM schedule WHERE todoId = ${taskId} ORDER BY id`),
  };
}

describe('internal correction classification', () => {
  test('the correction migration immediately follows prior migrations with a newer timestamp', () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; when: number; tag: string }[] };
    const position = journal.entries.findIndex((entry) =>
      entry.tag.endsWith('_correction_classification'),
    );
    expect(position).toBeGreaterThan(0);
    const previous = journal.entries.slice(0, position);
    expect(journal.entries[position]?.idx).toBe(
      Math.max(...previous.map((entry) => entry.idx)) + 1,
    );
    expect(journal.entries[position]?.when).toBeGreaterThan(
      Math.max(...previous.map((entry) => entry.when)),
    );
  });

  test('the correction snapshot chains to its predecessor and adds only classification', () => {
    const snapshot = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta/0139_snapshot.json'), 'utf8'),
    ) as MigrationSnapshot;
    const previous = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta/0138_snapshot.json'), 'utf8'),
    ) as MigrationSnapshot;
    expect(snapshot.prevId).toBe(previous.id);
    const { correctionRequired, ...columns } = snapshot.tables.todo.columns;
    expect(correctionRequired).toEqual({
      name: 'correctionRequired',
      type: 'integer',
      primaryKey: false,
      notNull: true,
      autoincrement: false,
      default: false,
    });
    expect({
      ...snapshot,
      id: previous.id,
      prevId: previous.prevId,
      tables: {
        ...snapshot.tables,
        todo: { ...snapshot.tables.todo, columns },
      },
    }).toEqual(previous);
  });

  test('fresh tasks default to ordinary and the flag is not a public todo field', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const response = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Ordinary task',
      spec: 'Keep the thread intact.',
    });
    expect(response.status).toBe(201);
    const record = (await response.json()) as { id: string };
    expect(record).not.toHaveProperty('correctionRequired');
    expect(s.db.get(sql`SELECT correctionRequired FROM todo WHERE id = ${record.id}`)).toEqual({
      correctionRequired: 0,
    });
    s.db.run(sql`UPDATE todo SET correctionRequired = 1 WHERE id = ${record.id}`);
    const patched = await req(s.app, 'PATCH', `/api/todos/${record.id}`, {
      title: 'Still a correction',
      correctionRequired: false,
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).not.toHaveProperty('correctionRequired');
    expect(isCorrectionTask(s.db, record.id)).toBe(true);
    expect(isCorrectionTask(s.db, 'missing')).toBe(false);
  });

  test('a validated project move clears the correction flag', async () => {
    const { s, taskId } = await correctionWorld(true);
    const before = classificationState(s, taskId);
    expect(
      (await req(s.app, 'PATCH', `/api/todos/${taskId}`, { tagIds: ['retired'] })).status,
    ).toBe(200);
    expect(classificationState(s, taskId)).toEqual(before);
    expect(isCorrectionTask(s.db, taskId)).toBe(true);
    const target = await postProject(s.app, 'Target');
    expect((await req(s.app, 'PATCH', `/api/todos/${taskId}`, { projectId: target })).status).toBe(
      200,
    );
    expect(isCorrectionTask(s.db, taskId)).toBe(false);
  });

  test('upgrade snapshots local and GitHub correction membership without changing thread data', () => {
    const path = previousDatabase();
    const before = new Database(path, { readonly: true });
    const taskColumns = before
      .prepare('PRAGMA table_info(todo)')
      .all()
      .map((column) => (column as { name: string }).name)
      .filter((name) => name !== 'snoozedUntil' && name !== 'snoozeMode')
      .join(', ');
    const tasks = before.prepare(`SELECT ${taskColumns} FROM todo ORDER BY id`).all();
    before.close();
    const opened = openDbWithHandle(path);
    try {
      expect(opened.db.all('SELECT id, correctionRequired FROM todo ORDER BY id')).toEqual([
        { id: 'github-fix', correctionRequired: 1 },
        { id: 'local-fix', correctionRequired: 1 },
        { id: 'ordinary', correctionRequired: 0 },
      ]);
      expect(opened.db.all(`SELECT ${taskColumns} FROM todo ORDER BY id`)).toEqual(tasks);
      expect(
        opened.db.all(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tag', 'todo_tag')",
        ),
      ).toEqual([]);
      expect(opened.db.all('SELECT id, name FROM github_label ORDER BY id')).toEqual([
        { id: 'github-correction', name: 'correction' },
      ]);
      expect(
        opened.db.all('SELECT todoId, labelId FROM todo_github_label ORDER BY todoId'),
      ).toEqual([{ todoId: 'github-fix', labelId: 'github-correction' }]);
      expect(opened.db.all('PRAGMA foreign_key_check')).toEqual([]);
      opened.db.run('DELETE FROM todo_github_label');
      expect(isCorrectionTask(opened.db, 'local-fix')).toBe(true);
      expect(isCorrectionTask(opened.db, 'github-fix')).toBe(true);
      expect(isCorrectionTask(opened.db, 'ordinary')).toBe(false);
    } finally {
      opened.close();
    }
    const restarted = openDbWithHandle(path);
    try {
      expect(isCorrectionTask(restarted.db, 'local-fix')).toBe(true);
      expect(isCorrectionTask(restarted.db, 'github-fix')).toBe(true);
    } finally {
      restarted.close();
    }
  });

  test('a failed snapshot rolls back the column and leaves legacy associations available', () => {
    const path = previousDatabase();
    const sqlite = new Database(path);
    sqlite.exec(`CREATE TRIGGER reject_snapshot BEFORE UPDATE ON todo
      BEGIN SELECT RAISE(ABORT, 'snapshot blocked'); END`);
    sqlite.close();
    expect(() => openDbWithHandle(path)).toThrow(/UPDATE todo SET correctionRequired/);
    const after = new Database(path, { readonly: true });
    try {
      expect(after.prepare('SELECT * FROM todo_tag').all()).toHaveLength(3);
      const columns = after.pragma('table_info(todo)') as { name: string }[];
      expect(columns.map((column) => column.name)).not.toContain('correctionRequired');
    } finally {
      after.close();
    }
  });
});
