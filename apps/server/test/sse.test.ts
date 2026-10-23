// SSE team stream 对拍（02 §1.2 + r5 §7.2 实测形状）：
// - {"type":"ping","seq":n} 心跳（r3 §8.1；节奏可配，默认 ~15s）
// - {"type":"todo"|"build",seq,v,doc} 全文档推送（r5 §7.2；seq 连接内递增，
//   v = todo 记录版本）
// 事件 schema 单源 = shared teamStreamEventSchema（notification/
// machine_presence 事件面归 M2c/M3）。

import {
  buildDocEventSchema,
  pingEventSchema,
  teamStreamEventSchema,
  todoDocEventSchema,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { bootServer, openStream, req } from './helpers.js';

describe('SSE team stream（r5 §7.2 文档事件形状）', () => {
  test('连接首帧 ping；todo/build 变更推全文档事件，seq 连接内递增', async () => {
    const s = bootServer({ pingIntervalMs: 50 });
    const stream = await openStream(s.app, s.team.id);
    try {
      // 首帧 ping（seq=1）
      const ping1 = pingEventSchema.parse(await stream.next((ev) => ev.type === 'ping'));
      expect(ping1.seq).toBe(1);

      // 建 project + todo → todo 文档事件（{type:"todo",seq,v,doc}）
      const project = (await (
        await req(s.app, 'POST', '/api/projects', { name: 'demo' })
      ).json()) as { id: string };
      const created = (await (
        await req(s.app, 'POST', `/api/projects/${project.id}/todos`, { title: '写文档', spec: '' })
      ).json()) as { id: string; v: number };

      const todoEv = todoDocEventSchema.parse(await stream.next((ev) => ev.type === 'todo'));
      expect(todoEv.doc.id).toBe(created.id);
      expect(todoEv.v).toBe(created.v);
      expect(todoEv.seq).toBeGreaterThan(ping1.seq);
      expect(teamStreamEventSchema.safeParse(todoEv).success).toBe(true);

      // 启动 build → todo（queued, v+1）与 build 文档事件同流
      await req(s.app, 'POST', `/api/projects/${project.id}/builds`, {
        todoIds: [created.id],
        assignment: { plan: null, build: null },
        withPlan: true,
      });
      const buildEv = buildDocEventSchema.parse(await stream.next((ev) => ev.type === 'build'));
      expect(buildEv.doc.todoId).toBe(created.id);
      expect(buildEv.doc.triggerSource).toBe('user');
      const queuedEv = todoDocEventSchema.parse(
        await stream.next(
          (ev) => ev.type === 'todo' && (ev.doc as { phase: string }).phase === 'queued',
        ),
      );
      expect(queuedEv.v).toBe(created.v + 1);

      // PATCH → 再推 todo 文档事件（v 递增）
      await req(s.app, 'PATCH', `/api/todos/${created.id}`, { title: '写文档 v2' });
      const patchedEv = todoDocEventSchema.parse(
        await stream.next(
          (ev) => ev.type === 'todo' && (ev.doc as { title: string }).title === '写文档 v2',
        ),
      );
      expect(patchedEv.v).toBe(created.v + 2);

      // 心跳持续：再收一帧 ping，seq 严格递增
      const lastSeq = Math.max(patchedEv.seq, buildEv.seq, queuedEv.seq);
      const ping2 = pingEventSchema.parse(
        await stream.next((ev) => ev.type === 'ping' && (ev.seq as number) > lastSeq),
      );
      expect(ping2.seq).toBeGreaterThan(lastSeq);
    } finally {
      stream.close();
    }
  });

  test('断开即退订（hub 无泄漏连接）', async () => {
    const s = bootServer({ pingIntervalMs: 50 });
    const stream = await openStream(s.app, s.team.id);
    await stream.next((ev) => ev.type === 'ping');
    expect(s.hub.subscriberCount(s.team.id)).toBe(1);
    stream.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(s.hub.subscriberCount(s.team.id)).toBe(0);
  });

  test('未知 team 404 {error}（team 恒 seed 一行）', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', '/api/teams/nope/stream');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});
