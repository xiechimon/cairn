import {
  buildDocEventSchema,
  pingEventSchema,
  teamStreamEventSchema,
  todoDocEventSchema,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { bootServer, openStream, req } from './helpers.js';

describe('the SSE team stream (the r5 §7.2 document event shape)', () => {
  test('the first frame on connect is a ping; todo/build changes push full document events, seq increasing within the connection', async () => {
    const s = bootServer({ pingIntervalMs: 50 });
    const stream = await openStream(s.app, s.team.id);
    try {
      const ping1 = pingEventSchema.parse(await stream.next((ev) => ev.type === 'ping'));
      expect(ping1.seq).toBe(1);

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

      await req(s.app, 'PATCH', `/api/todos/${created.id}`, { title: '写文档 v2' });
      const patchedEv = todoDocEventSchema.parse(
        await stream.next(
          (ev) => ev.type === 'todo' && (ev.doc as { title: string }).title === '写文档 v2',
        ),
      );
      expect(patchedEv.v).toBe(created.v + 2);

      const lastSeq = Math.max(patchedEv.seq, buildEv.seq, queuedEv.seq);
      const ping2 = pingEventSchema.parse(
        await stream.next((ev) => ev.type === 'ping' && (ev.seq as number) > lastSeq),
      );
      expect(ping2.seq).toBeGreaterThan(lastSeq);
    } finally {
      stream.close();
    }
  });

  test('disconnect unsubscribes at once (no leaked connections in the hub)', async () => {
    const s = bootServer({ pingIntervalMs: 50 });
    const stream = await openStream(s.app, s.team.id);
    await stream.next((ev) => ev.type === 'ping');
    expect(s.hub.subscriberCount(s.team.id)).toBe(1);
    stream.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(s.hub.subscriberCount(s.team.id)).toBe(0);
  });

  test('an unknown team 404 {error} (the team stays one seeded row)', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', '/api/teams/nope/stream');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});
