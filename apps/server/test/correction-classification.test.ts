import { join } from 'node:path';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import { runAgentLayerDataMigration } from '../src/legacy/agent-layer/data-migration.js';
import { isCorrectionTask } from '../src/services/correction.js';
import { bootServer, postProject, req } from './helpers.js';
import { migrateUpTo } from './migrate-helpers.js';

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
    migrateUpTo(sqlite, dir, '0131_project_group');
    sqlite.exec(`
      INSERT INTO user (id, displayName) VALUES ('u', 'Owner');
      INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1);
      INSERT INTO project (id, teamId, name) VALUES ('local', 'team', 'Local');
      INSERT INTO project (id, teamId, name, repoKind, githubRepo)
        VALUES ('github', 'team', 'GitHub', 'github', 'octo/demo');
      INSERT INTO todo (id, teamId, projectId, title, spec, phaseAt, seqNum)
        VALUES ('local-fix', 'team', 'local', 'Fix', 'Original spec', 1, 1),
               ('github-fix', 'team', 'github', 'Fix issue', 'Issue spec', 2, 2),
               ('ordinary', 'team', 'local', 'Ordinary', 'Ordinary spec', 3, 3);
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

describe('internal correction classification', () => {
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

  test('transitional create, replacement and project move keep category classification synchronized', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const labelResponse = await req(s.app, 'POST', `/api/projects/${projectId}/tags`, {
      name: 'CoRrEcTiOn',
      color: '#000000',
    });
    expect(labelResponse.status).toBe(201);
    const label = (await labelResponse.json()) as { id: string };
    const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Transitional correction',
      spec: 'Preserve classification until the generic feature is retired.',
      tagIds: [label.id],
    });
    expect(created.status).toBe(201);
    const task = (await created.json()) as { id: string };
    expect(isCorrectionTask(s.db, task.id)).toBe(true);
    expect((await req(s.app, 'PATCH', `/api/todos/${task.id}`, { tagIds: [] })).status).toBe(200);
    expect(isCorrectionTask(s.db, task.id)).toBe(false);
    expect(
      (await req(s.app, 'PATCH', `/api/todos/${task.id}`, { tagIds: [label.id] })).status,
    ).toBe(200);
    expect(isCorrectionTask(s.db, task.id)).toBe(true);
    const target = await postProject(s.app, 'Target');
    expect((await req(s.app, 'PATCH', `/api/todos/${task.id}`, { projectId: target })).status).toBe(
      200,
    );
    expect(isCorrectionTask(s.db, task.id)).toBe(false);
  });

  test('upgrade snapshots local and GitHub correction membership without changing thread data', () => {
    const path = previousDatabase();
    const before = new Database(path, { readonly: true });
    const tasks = before.prepare('SELECT * FROM todo ORDER BY id').all();
    const labels = before.prepare('SELECT * FROM tag ORDER BY id').all();
    const links = before.prepare('SELECT * FROM todo_tag ORDER BY todoId').all();
    before.close();
    const opened = openDbWithHandle(path);
    try {
      expect(opened.db.all('SELECT id, correctionRequired FROM todo ORDER BY id')).toEqual([
        { id: 'github-fix', correctionRequired: 1 },
        { id: 'local-fix', correctionRequired: 1 },
        { id: 'ordinary', correctionRequired: 0 },
      ]);
      expect(
        opened.db.all<Record<string, unknown>>('SELECT * FROM todo ORDER BY id').map((row) => {
          const { correctionRequired: _flag, ...rest } = row;
          return rest;
        }),
      ).toEqual(tasks);
      expect(opened.db.all('SELECT * FROM tag ORDER BY id')).toEqual(labels);
      expect(opened.db.all('SELECT * FROM todo_tag ORDER BY todoId')).toEqual(links);
      expect(opened.db.all('PRAGMA foreign_key_check')).toEqual([]);
      opened.db.run('DELETE FROM todo_tag');
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
