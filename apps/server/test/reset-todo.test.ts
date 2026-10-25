import { type Phase, todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  build as buildTable,
  message as messageTable,
  plan as planTable,
  step as stepTable,
  stopPending as stopPendingTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { startBuilds } from '../src/services/builds.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

async function setupStarted(phase: Phase): Promise<{ s: TestServer; id: string }> {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = todoRecordSchema.parse(
    await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'p', spec: 'x' })
    ).json(),
  );
  startBuilds(s.svc, {
    projectId,
    todoIds: [created.id],
    assignment: { plan: null, build: null },
    withPlan: true,
  });
  s.db.update(todoTable).set({ phase }).where(eq(todoTable.id, created.id)).run();
  return { s, id: created.id };
}

async function reset(
  s: TestServer,
  id: string,
  body: unknown = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await req(s.app, 'POST', `/api/todos/${id}/reset`, body);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('todo reset (#755)', () => {
  test('a building card: 200 + phase back to todo + the deliverable flags zeroed + build/steps/messages all deleted', async () => {
    const { s, id } = await setupStarted('building');
    const buildsBefore = s.db.select().from(buildTable).where(eq(buildTable.todoId, id)).all();
    expect(buildsBefore.length).toBe(1);

    const { status, json } = await reset(s, id);
    expect(status).toBe(200);
    const doc = todoRecordSchema.parse(json);
    expect(doc.phase).toBe('todo');
    expect(doc.hasPlan).toBe(false);
    expect(doc.hasChanges).toBe(false);
    expect(doc.latestBuildId).toBeNull();
    expect(doc.buildHistory).toEqual([]);

    expect(s.db.select().from(buildTable).where(eq(buildTable.todoId, id)).all()).toEqual([]);
    expect(s.db.select().from(stepTable).all()).toEqual([]);
    expect(s.db.select().from(messageTable).all()).toEqual([]);
    expect(s.db.select().from(planTable).all()).toEqual([]);
    s.dispose();
  });

  test('a pending step: no stop signal (no machine to notify, it disappears with the deleted build)', async () => {
    const { s, id } = await setupStarted('building');
    const signals: Array<{ teamId: string; stepId: string }> = [];
    const origStop = s.machineHub.stopSignal.bind(s.machineHub);
    s.machineHub.stopSignal = (teamId: string, stepId: string) => {
      signals.push({ teamId, stepId });
      return origStop(teamId, stepId);
    };
    const { resetTodo } = await import('../src/services/todos.js');
    const result = resetTodo(s.svc, id, undefined);
    expect(result?.stale).toBe(false);
    expect(signals).toEqual([]);
    expect(s.db.select().from(stopPendingTable).all()).toEqual([]);
    s.dispose();
  });

  test('a claimed step: machineHub.stopSignal is called (the reachable remote execution machine surface)', async () => {
    const { s, id } = await setupStarted('building');
    const buildRow = s.db.select().from(buildTable).where(eq(buildTable.todoId, id)).get()!;
    const stepRow = s.db.select().from(stepTable).where(eq(stepTable.buildId, buildRow.id)).get()!;
    s.db
      .update(stepTable)
      .set({ status: 'claimed', machineId: 'm-1' })
      .where(eq(stepTable.id, stepRow.id))
      .run();
    const signals: Array<{ teamId: string; stepId: string }> = [];
    const origStop = s.machineHub.stopSignal.bind(s.machineHub);
    s.machineHub.stopSignal = (teamId: string, stepId: string) => {
      signals.push({ teamId, stepId });
      return origStop(teamId, stepId);
    };
    const { resetTodo } = await import('../src/services/todos.js');
    const result = resetTodo(s.svc, id, undefined);
    expect(result?.stale).toBe(false);
    expect(signals).toEqual([{ teamId: s.team.id, stepId: stepRow.id }]);
    s.dispose();
  });

  test('a done card (with build history): reset the same way (change records cleared, the todo definition kept)', async () => {
    const { s, id } = await setupStarted('done');
    const { status, json } = await reset(s, id);
    expect(status).toBe(200);
    const doc = todoRecordSchema.parse(json);
    expect(doc.phase).toBe('todo');
    expect(doc.title).toBe('p');
    expect(doc.spec).toBe('x');
    expect(doc.buildHistory).toEqual([]);
    s.dispose();
  });

  test('snapshot mismatch: 409 + the current record (the build advanced after the dialog opened, the old copy void)', async () => {
    const { s, id } = await setupStarted('building');
    const { status, json } = await reset(s, id, { expectedBuildId: 'build-from-another-timeline' });
    expect(status).toBe(409);
    expect(json).toHaveProperty('error');
    expect(json).toHaveProperty('record');
    expect(s.db.select().from(buildTable).where(eq(buildTable.todoId, id)).all().length).toBe(1);
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()!.phase).toBe('building');
    s.dispose();
  });

  test('a nonexistent todo: 404', async () => {
    const { s } = await setupStarted('building');
    const { status } = await reset(s, 'todo-that-does-not-exist');
    expect(status).toBe(404);
    s.dispose();
  });
});
