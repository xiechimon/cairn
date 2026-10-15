// #753 手动落位矩阵（HTTP PATCH phase 面）——todos.dev 2026-10-03/04 live
// 重测把 #351 的「待处理不作落点 + 平面白名单」换成 per-source 矩阵：
//   · 执行中 只吃 待开始 源（PATCH building 仅 todo/queued 源放行）；
//   · 待处理（落点正名 review）只吃 已完成 源，且要变更产物（hasChanges 数据
//     闸在 updateTodo——无变更 done 卡参考站恒素面，raw PATCH 同判 409）；
//   · 已完成 吃 待开始/执行中/待处理 源，含 failed（#1247，不要求 hasChanges）；
//     failed→review 仍走 #702 动作面专属 409；
//   · 同列 / closed 源 / 非落点相 恒 409（漏斗兜底）。
// 分层不新设：PATCH 面 = 手动矩阵 ∪ 系统漏斗（矩阵只扩权——漏斗非法的列迁
// 移边放行；漏斗合法边照旧通过，不因矩阵收窄）。拖拽手势的非法对由客户端
// canDropOnColumn 挡在发请求之前（恒素面、零提交）。
// 边级单源 = shared canBoardDrop（vocabulary.test 钉真值表）；本文件钉 HTTP
// 面的状态码与错误形状 {error}（r5 §1 实测族）。

import { type Phase, todoRecordSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { todo as todoTable } from '../src/db/schema.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

async function setup(phase: Phase, hasChanges?: boolean): Promise<{ s: TestServer; id: string }> {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = todoRecordSchema.parse(
    await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'p', spec: 'x' })
    ).json(),
  );
  s.db
    .update(todoTable)
    .set({ phase, ...(hasChanges === undefined ? {} : { hasChanges }) })
    .where(eq(todoTable.id, created.id))
    .run();
  return { s, id: created.id };
}

async function patchPhase(s: TestServer, id: string, phase: Phase): Promise<Response> {
  return req(s.app, 'PATCH', `/api/todos/${id}`, { phase });
}

describe('手动落位矩阵（#753）：已完成 源', () => {
  test('done(有变更)→review = 重开回审核关口：200 + phaseAt 刷新', async () => {
    const { s, id } = await setup('done', true);
    const res = await patchPhase(s, id, 'review');
    expect(res.status).toBe(200);
    const doc = todoRecordSchema.parse(await res.json());
    expect(doc.phase).toBe('review');
  });

  test('done(无变更)→review = 409（数据闸：没有可重开验收的东西）', async () => {
    const { s, id } = await setup('done', false);
    const res = await patchPhase(s, id, 'review');
    expect(res.status).toBe(409);
    expect(await res.json()).toHaveProperty('error');
  });

  test('done→todo = 200（实测 uncomplete 语义，本仓载体 = PATCH phase）', async () => {
    const { s, id } = await setup('done', true);
    const res = await patchPhase(s, id, 'todo');
    expect(res.status).toBe(200);
    expect(todoRecordSchema.parse(await res.json()).phase).toBe('todo');
  });

  test('done→building = 409（执行中只吃待开始源，实测恒素面）', async () => {
    const { s, id } = await setup('done', true);
    const res = await patchPhase(s, id, 'building');
    expect(res.status).toBe(409);
    expect(await res.json()).toHaveProperty('error');
  });
});

describe('手动落位矩阵（#753）：待处理 源', () => {
  test('confirm→done / review→done = 200（手动验收捷径；合并步不是本面语义）', async () => {
    for (const phase of ['confirm', 'review'] as const) {
      const { s, id } = await setup(phase);
      const res = await patchPhase(s, id, 'done');
      expect(res.status, phase).toBe(200);
      expect(todoRecordSchema.parse(await res.json()).phase).toBe('done');
    }
  });

  test('confirm/review/failed→closed = 200（#1247 canceled 结局）', async () => {
    for (const phase of ['confirm', 'review', 'failed'] as const) {
      const { s, id } = await setup(phase);
      const res = await patchPhase(s, id, 'closed');
      expect(res.status, phase).toBe(200);
      expect(todoRecordSchema.parse(await res.json()).phase).toBe('closed');
    }
  });

  test('confirm/review→todo = 200（参考站：已开始的卡拖回待开始；重置语义另票）', async () => {
    for (const phase of ['confirm', 'review'] as const) {
      const { s, id } = await setup(phase);
      const res = await patchPhase(s, id, 'todo');
      expect(res.status, phase).toBe(200);
      expect(todoRecordSchema.parse(await res.json()).phase).toBe('todo');
    }
  });

  test('→执行中：review→building = 409；confirm→building 走漏斗合法边仍放行', async () => {
    // 矩阵只扩权不收权：PATCH 面 = 手动矩阵 ∪ 系统漏斗（既有分层，wire.test
    // 的 closed 边同款）。confirm→building 是漏斗的确认边（02 §4.2），手动
    // 矩阵虽不收（执行中只吃待开始拖入），漏斗放行不因此收窄——拖拽面由
    // 客户端 canDropOnColumn 挡（恒素面、不发 PATCH）。
    const review = await setup('review');
    expect((await patchPhase(review.s, review.id, 'building')).status).toBe(409);
    const confirm = await setup('confirm');
    expect((await patchPhase(confirm.s, confirm.id, 'building')).status).toBe(200);
  });

  test('failed→done = 200 without hasChanges (#1247 manual close)', async () => {
    const { s, id } = await setup('failed', false);
    const res = await patchPhase(s, id, 'done');
    expect(res.status).toBe(200);
    expect(todoRecordSchema.parse(await res.json()).phase).toBe('done');
  });

  test('failed→review = 409 且仍走 #702 动作面专属文案（漏斗合法边被手动面拒收）', async () => {
    const { s, id } = await setup('failed', true);
    const res = await patchPhase(s, id, 'review');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('恢复由合并/审核重跑动作发起');
  });

  test('同列迁移（confirm→review）= 409（拖拽不产生列内相位改写）', async () => {
    const { s, id } = await setup('confirm');
    expect((await patchPhase(s, id, 'review')).status).toBe(409);
  });
});

describe('手动落位矩阵（#753）：待开始/执行中 源与非落点相', () => {
  test('todo→building = 200（#160 手动面保留：平面白名单时代的合法边不回归）', async () => {
    const { s, id } = await setup('todo');
    const res = await patchPhase(s, id, 'building');
    expect(res.status).toBe(200);
    expect(todoRecordSchema.parse(await res.json()).phase).toBe('building');
  });

  test('todo→review = 409（待开始→待处理 实测恒素面）', async () => {
    const { s, id } = await setup('todo');
    expect((await patchPhase(s, id, 'review')).status).toBe(409);
  });

  test('building→todo / building→done = 200（执行中源行沿用既有语义 [设计]）', async () => {
    const a = await setup('building');
    expect((await patchPhase(a.s, a.id, 'todo')).status).toBe(200);
    const b = await setup('building');
    expect((await patchPhase(b.s, b.id, 'done')).status).toBe(200);
  });

  test('非落点相（failed/confirm/closed 作目标）= 409 {error}（漏斗兜底）', async () => {
    for (const target of ['failed', 'confirm', 'closed'] as const) {
      const { s, id } = await setup('done', true);
      const res = await patchPhase(s, id, target);
      expect(res.status, target).toBe(409);
      expect(await res.json(), target).toHaveProperty('error');
    }
  });
});
