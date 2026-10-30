import { scheduleRecordSchema, todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { schedule, todo } from '../src/db/schema.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
const tz = 'Asia/Shanghai';

afterEach(() => {
  for (const server of servers.splice(0)) server.dispose();
});

async function setup() {
  const server = bootServer();
  servers.push(server);
  const projectId = await postProject(server.app, 'Schedule archive');
  const createTodo = async (title: string) => {
    const created = await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
      title,
      spec: 'Report recent changes',
    });
    expect(created.status).toBe(201);
    return todoRecordSchema.parse(await created.json());
  };
  const createSchedule = async (todoId: string) => {
    const created = await req(server.app, 'POST', '/api/schedules', {
      todoId,
      kind: 'cron',
      cron: '*/10 * * * *',
      tz,
    });
    expect(created.status).toBe(201);
    return scheduleRecordSchema.parse(await created.json());
  };
  return { ...server, projectId, createTodo, createSchedule };
}

describe('scheduler tick and archived tasks', () => {
  test('a due schedule on an archived task is paused and later schedules still fire', async () => {
    const s = await setup();
    const archived = await s.createTodo('Archived task');
    const active = await s.createTodo('Active task');
    const archivedSchedule = await s.createSchedule(archived.id);
    const activeSchedule = await s.createSchedule(active.id);
    s.db.update(todo).set({ archivedAt: 1 }).where(eq(todo.id, archived.id)).run();
    const dueAt = Math.max(
      archivedSchedule.nextRunAt as number,
      activeSchedule.nextRunAt as number,
    );
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    expect(() => scheduler.tick(dueAt)).not.toThrow();
    expect(
      s.db.select().from(schedule).where(eq(schedule.todoId, archived.id)).get(),
    ).toMatchObject({ enabled: false, nextRunAt: null, pausedReason: expect.any(String) });
    expect(s.db.select().from(todo).where(eq(todo.id, archived.id)).get()?.phase).toBe('todo');
    expect(s.db.select().from(todo).where(eq(todo.id, active.id)).get()?.phase).toBe('queued');
    expect(() => scheduler.tick(dueAt + 600_000)).not.toThrow();
  });

  test('archiving a task pauses its schedule and unarchiving leaves it paused', async () => {
    const s = await setup();
    const task = await s.createTodo('Scheduled task');
    await s.createSchedule(task.id);
    expect((await req(s.app, 'POST', `/api/todos/${task.id}/archive`)).status).toBe(200);
    expect(s.db.select().from(schedule).where(eq(schedule.todoId, task.id)).get()).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: expect.any(String),
    });
    expect((await req(s.app, 'POST', `/api/todos/${task.id}/unarchive`)).status).toBe(200);
    expect(s.db.select().from(schedule).where(eq(schedule.todoId, task.id)).get()).toMatchObject({
      enabled: false,
      nextRunAt: null,
    });
  });
});
