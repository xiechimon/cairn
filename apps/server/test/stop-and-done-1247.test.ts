// #1247 stop-then-done + canceled（closed）结局。
import { STOP_MESSAGE, todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build as buildTable, step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { prepareStopForDone } from '../src/services/builds.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

async function seedBuildingWithPendingStep(s: TestServer): Promise<{
  todoId: string;
  buildId: string;
  stepId: string;
}> {
  const projectId = await postProject(s.app);
  const created = todoRecordSchema.parse(
    await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'inflight', spec: 'x' })
    ).json(),
  );
  const buildId = 'build-1247-stop';
  const stepId = 'step-1247-stop';
  const now = Date.now();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId: created.id,
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: now,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'build',
      status: 'pending',
      createdAt: now,
    })
    .run();
  s.db
    .update(todoTable)
    .set({ phase: 'building', latestBuildId: buildId, phaseAt: now })
    .where(eq(todoTable.id, created.id))
    .run();
  return { todoId: created.id, buildId, stepId };
}

describe('#1247 stop-and-done', () => {
  test('pending：stop-and-done 同步停步并落 done，相位不经 gate 回落', async () => {
    const s = bootServer();
    const { todoId, stepId, buildId } = await seedBuildingWithPendingStep(s);
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/stop-and-done`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; todo: { phase: string } };
    expect(body.state).toBe('done');
    expect(body.todo.phase).toBe('done');
    expect(s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'stopped',
    );
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!.errorMessage,
    ).toBe(STOP_MESSAGE);
    // 不是普通 stop 的 gate 回落（todo/confirm/review）
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!.phase).toBe('done');
  });

  test('prepareStopForDone pending 保相位，供调用方再写 done', async () => {
    const s = bootServer();
    const { todoId, stepId } = await seedBuildingWithPendingStep(s);
    const prep = prepareStopForDone(s.svc, todoId);
    expect(prep.state).toBe('ready');
    expect(s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'stopped',
    );
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!.phase).toBe(
      'building',
    );
  });
});

describe('#1247 canceled（closed）', () => {
  test('failed→closed = 200；不占成功（settle 只认 done）', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const created = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'fail', spec: 'x' })
      ).json(),
    );
    s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, created.id)).run();
    const res = await req(s.app, 'PATCH', `/api/todos/${created.id}`, { phase: 'closed' });
    expect(res.status).toBe(200);
    expect(todoRecordSchema.parse(await res.json()).phase).toBe('closed');
  });

  test('confirm→closed = 200（#1247 手动取消边）', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const created = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'c', spec: 'x' })
      ).json(),
    );
    s.db.update(todoTable).set({ phase: 'confirm' }).where(eq(todoTable.id, created.id)).run();
    const res = await req(s.app, 'PATCH', `/api/todos/${created.id}`, { phase: 'closed' });
    expect(res.status).toBe(200);
    expect(todoRecordSchema.parse(await res.json()).phase).toBe('closed');
  });
});
