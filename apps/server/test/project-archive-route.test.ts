import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { project, team as teamTable, todo } from '../src/db/schema.js';
import { bootServer, req } from './helpers.js';

function world() {
  const s = bootServer();
  s.db.insert(project).values({ id: 'project-a', teamId: s.team.id, name: 'Alpha' }).run();
  s.db
    .insert(todo)
    .values({
      id: 'todo-a',
      teamId: s.team.id,
      projectId: 'project-a',
      title: 'Keep me',
      spec: 'spec',
      phase: 'todo',
      phaseAt: Date.now(),
      seqNum: 1,
    })
    .run();
  s.db.insert(teamTable).values({ id: 'team-other', name: 'Other', createdAt: 0 }).run();
  s.db
    .insert(project)
    .values({ id: 'project-other', teamId: 'team-other', name: 'Elsewhere' })
    .run();
  return s;
}

describe('project archive route', () => {
  test('archive sets archivedAt, keeps the project and its tasks, and the list still carries it', async () => {
    const s = world();
    const res = await req(s.app, 'POST', '/api/projects/project-a/archive');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { archivedAt: number | null }).archivedAt).toEqual(
      expect.any(Number),
    );
    expect(s.db.select().from(todo).where(eq(todo.id, 'todo-a')).all()).toHaveLength(1);
    const list = (await (await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`)).json()) as {
      id: string;
      archivedAt: number | null;
    }[];
    expect(list.find((p) => p.id === 'project-a')?.archivedAt).toEqual(expect.any(Number));
  });

  test('unarchive restores the project', async () => {
    const s = world();
    await req(s.app, 'POST', '/api/projects/project-a/archive');
    const res = await req(s.app, 'POST', '/api/projects/project-a/unarchive');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { archivedAt: number | null }).archivedAt).toBeNull();
  });

  test('archiving twice keeps the first timestamp', async () => {
    const s = world();
    const first = (await (await req(s.app, 'POST', '/api/projects/project-a/archive')).json()) as {
      archivedAt: number;
    };
    const second = (await (await req(s.app, 'POST', '/api/projects/project-a/archive')).json()) as {
      archivedAt: number;
    };
    expect(second.archivedAt).toBe(first.archivedAt);
  });

  test('a project of another team is not found and stays unarchived', async () => {
    const s = world();
    const res = await req(s.app, 'POST', '/api/projects/project-other/archive');
    expect(res.status).toBe(404);
    expect(
      s.db.select().from(project).where(eq(project.id, 'project-other')).get()?.archivedAt,
    ).toBeNull();
  });
});
