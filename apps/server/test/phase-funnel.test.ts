// XMON-59 相位漏斗同相位幂等（主断口）：setTodoPhase 是服务面相位流转唯一
// 入口（写 + 文档事件 + 通知挂接），from === to 的重放调用此前走
// assertPhaseTransition 抛 PhaseTransitionError——与 notifyPhaseEntry 既有的
// from === to 早退语义相悖。失败方式清单（先固化，代码是让场景通过的手段）：
//  1. 同相位重放（机器 done 重报 / daemon recover 重放 / MCP 批量流转重入）
//     抛错 → done 500 → journal 卡死只能重启恢复；该轮相位事件的效果被
//     「服务端 500」观感吞掉，web 停旧相位；
//  2. 同相位重放零副作用：不写 v/phaseAt、不发 todo 文档事件——重放不得
//     改任何可观测状态（幂等的字面契约）；
//  3. 同相位 + 伴随位（hasPlan 等 extras）：旧实现直抛；completeStep 曾把
//     hasPlan 直写漏斗外（无 v 无发布）——漏斗一抛 = 伴随位落库但无事件，
//     看板 plan chip 永久陈旧。幂等化后 extras 必须仍走「写 + 发」原子位；
//  4. 幂等化不得放宽非法边：流转表外的相位对（confirm→queued）仍抛
//     （双 start / 手动 PATCH 409 门依赖此严格性）；
//  5. 真流转边照常「写 + 发」：相位已变、事件必发（本票主断口的正向钉）。

import { todoDocEventSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { todo as todoTable } from '../src/db/schema.js';
import { startBuilds } from '../src/services/builds.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, openStream, postProject, req, type TestServer } from './helpers.js';

/** 服务面直驱到 confirm（notifications.test 同款：startBuilds → planning →
 *  confirm；不走机器面，聚焦漏斗契约本身）。pingIntervalMs 收紧：负向断言
 *  （同相位重放无新帧）靠心跳解阻塞读，15s 默认会顶穿测试超时。 */
async function withConfirmTodo(): Promise<TestServer & { todoId: string }> {
  const s = bootServer({ pingIntervalMs: 100 });
  const projectId = await postProject(s.app);
  const todoDoc = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: '写周报', spec: '' })
  ).json()) as { id: string };
  startBuilds(s.svc, {
    projectId,
    todoIds: [todoDoc.id],
    assignment: { plan: null, build: null },
    withPlan: true,
  });
  setTodoPhase(s.svc, todoDoc.id, 'planning');
  setTodoPhase(s.svc, todoDoc.id, 'confirm');
  return { ...s, todoId: todoDoc.id };
}

function rowOf(s: TestServer, todoId: string) {
  return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
}

describe('相位漏斗同相位幂等（XMON-59 主断口）', () => {
  test('同相位重放不抛、返回当前 record；零副作用（v/phaseAt 不动、无新 todo 文档帧）', async () => {
    const s = await withConfirmTodo();
    try {
      const before = rowOf(s, s.todoId);
      const rec = setTodoPhase(s.svc, s.todoId, 'confirm'); // 重放（无伴随位）
      expect(rec?.phase).toBe('confirm');
      const after = rowOf(s, s.todoId);
      expect(after.v).toBe(before.v);
      expect(after.phaseAt).toBe(before.phaseAt);

      const stream = await openStream(s.app, s.team.id);
      try {
        setTodoPhase(s.svc, s.todoId, 'confirm');
        await expect(stream.next((ev) => ev.type === 'todo', 300)).rejects.toThrow(/timeout/);
      } finally {
        stream.close();
      }
    } finally {
      s.dispose();
    }
  });

  test('同相位 + hasPlan 伴随位：落库 + v+1 + todo 文档事件（相位/phaseAt 不动）', async () => {
    const s = await withConfirmTodo();
    const stream = await openStream(s.app, s.team.id);
    try {
      const before = rowOf(s, s.todoId);
      expect(before.hasPlan).toBe(false);
      const rec = setTodoPhase(s.svc, s.todoId, 'confirm', { hasPlan: true });
      const after = rowOf(s, s.todoId);
      expect(after.hasPlan).toBe(true);
      expect(after.v).toBe(before.v + 1);
      expect(after.phase).toBe('confirm');
      expect(after.phaseAt).toBe(before.phaseAt);
      expect(rec?.hasPlan).toBe(true);

      const ev = todoDocEventSchema.parse(await stream.next((e) => e.type === 'todo', 3000));
      expect(ev.doc).toMatchObject({ id: s.todoId, phase: 'confirm', hasPlan: true });
    } finally {
      stream.close();
      s.dispose();
    }
  });

  test('幂等化不放宽非法边：confirm → done 仍抛（流转表外的相位对）', async () => {
    const s = await withConfirmTodo();
    try {
      expect(() => setTodoPhase(s.svc, s.todoId, 'done')).toThrow();
    } finally {
      s.dispose();
    }
  });

  test('真流转边照常「写 + 发」：confirm → building 事件必发（相位已变不吞事件）', async () => {
    const s = await withConfirmTodo();
    const stream = await openStream(s.app, s.team.id);
    try {
      const before = rowOf(s, s.todoId);
      const rec = setTodoPhase(s.svc, s.todoId, 'building');
      const after = rowOf(s, s.todoId);
      expect(rec?.phase).toBe('building');
      expect(after.v).toBe(before.v + 1);
      expect(after.phaseAt).toBeGreaterThanOrEqual(before.phaseAt);
      const ev = todoDocEventSchema.parse(await stream.next((e) => e.type === 'todo', 3000));
      expect(ev.doc).toMatchObject({ id: s.todoId, phase: 'building' });
    } finally {
      stream.close();
      s.dispose();
    }
  });
});
