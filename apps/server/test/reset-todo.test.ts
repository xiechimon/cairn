// 任务重置（#755，todos.dev 看板指南「已开始的卡片拖回待开始会重置任务：
// 中断构建并清空对话、方案和改动记录」）：POST /api/todos/:id/reset 面——
// 中断在飞构建（含远端执行机的 stop 信号）+ 硬清空产物 + 相位回 todo。
// 脏读面：dialog 打开后构建推进了 = 409 + 现记录（按旧文案重置被拒）。

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
  // startBuilds = pending 步在队 + latestBuildId 在位（真实开始路径的产物位）。
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

describe('任务重置（#755）', () => {
  test('building 卡：200 + 相位回 todo + 产物旗清零 + build/steps/messages 全删', async () => {
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

  test('pending 步：无 stop 信号（无机器可通知，随 build 删除而消失）', async () => {
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

  test('claimed 步：machineHub.stopSignal 被调用（远端执行机可达面）', async () => {
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

  test('done（有构建历史）卡：同样重置（改动记录清空，任务定义保留）', async () => {
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

  test('快照对不上：409 + 现记录（dialog 打开后构建推进，旧文案作废）', async () => {
    const { s, id } = await setupStarted('building');
    const { status, json } = await reset(s, id, { expectedBuildId: 'build-from-another-timeline' });
    expect(status).toBe(409);
    expect(json).toHaveProperty('error');
    expect(json).toHaveProperty('record');
    // 零写入：构建行还在，相位未动。
    expect(s.db.select().from(buildTable).where(eq(buildTable.todoId, id)).all().length).toBe(1);
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()!.phase).toBe('building');
    s.dispose();
  });

  test('不存在的 todo：404', async () => {
    const { s } = await setupStarted('building');
    const { status } = await reset(s, 'todo-that-does-not-exist');
    expect(status).toBe(404);
    s.dispose();
  });
});
