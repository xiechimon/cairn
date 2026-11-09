import { projectRecordSchema } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { project } from '../src/db/schema.js';
import { bootServer, req } from './helpers.js';

const s = bootServer();
afterAll(() => s.dispose());

test.each(['example/app', 'xiechimon/cairn', 'fork/cairn'])(
  'new project %s exposes the attachments default through create and read',
  async (githubRepo) => {
    const created = await req(s.app, 'POST', '/api/projects', {
      name: 'Evidence project',
      kind: 'github',
      githubRepo,
    });
    expect(created.status).toBe(201);
    const record = (await created.json()) as { id: string; evidenceStore?: unknown };
    expect(record.evidenceStore).toBe('attachments');
    expect(projectRecordSchema.parse(record)).toHaveProperty('evidenceStore', 'attachments');
    const read = await req(s.app, 'GET', '/api/projects');
    expect(read.status).toBe(200);
    expect(await read.json()).toContainEqual(
      expect.objectContaining({ id: record.id, evidenceStore: 'attachments' }),
    );
  },
);

test.each(['attachments', 'repository'])(
  'PATCH accepts %s as the only setting',
  async (evidenceStore) => {
    const created = await req(s.app, 'POST', '/api/projects', { name: 'Setting only' });
    const { id } = (await created.json()) as { id: string };
    const response = await req(s.app, 'PATCH', `/api/projects/${id}`, { evidenceStore });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('evidenceStore', evidenceStore);
  },
);

test('PATCH persists both evidence modes without updating build snapshots', async () => {
  const created = await req(s.app, 'POST', '/api/projects', { name: 'Modes' });
  const { id } = (await created.json()) as { id: string };
  s.db.run(sql`INSERT INTO todo (id, teamId, projectId, title, phaseAt, seqNum)
    VALUES ('evidence-todo', ${s.team.id}, ${id}, 'Snapshot', 1, 1)`);
  s.db.run(sql`INSERT INTO build (id, todoId, withPlan, triggerSource, createdAt)
    VALUES ('unsnapshotted', 'evidence-todo', 0, 'user', 1)`);
  s.db.run(sql`INSERT INTO build (id, todoId, withPlan, triggerSource, createdAt, evidenceStore)
    VALUES ('snapshotted', 'evidence-todo', 0, 'user', 1, 'repository')`);
  for (const evidenceStore of ['repository', 'attachments']) {
    const patched = await req(s.app, 'PATCH', `/api/projects/${id}`, { evidenceStore });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toHaveProperty('evidenceStore', evidenceStore);
    expect(s.db.select().from(project).where(eq(project.id, id)).get()).toHaveProperty(
      'evidenceStore',
      evidenceStore,
    );
    expect(s.db.all(sql`SELECT id, evidenceStore FROM build ORDER BY id`)).toEqual([
      { id: 'snapshotted', evidenceStore: 'repository' },
      { id: 'unsnapshotted', evidenceStore: null },
    ]);
  }
  for (const evidenceStore of [null, '', 'other', 1, true]) {
    const rejected = await req(s.app, 'PATCH', `/api/projects/${id}`, { evidenceStore });
    expect(rejected.status).toBe(400);
  }
  const read = await req(s.app, 'GET', '/api/projects');
  expect(await read.json()).toContainEqual(
    expect.objectContaining({ id, evidenceStore: 'attachments' }),
  );
});
