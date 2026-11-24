import { buildDocEventSchema, teamStreamEventSchema, todoDocEventSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { insertMachine, openStream, req, seedSessionRoute } from './helpers.js';
import { bootStreamServer as bootServer } from './sse-fixture.js';

describe('the SSE team stream (the r5 §7.2 document event shape)', () => {
  test('ping and full todo/build documents carry no payload sequence', async () => {
    const s = bootServer({ pingIntervalMs: 50 });
    insertMachine(s);
    seedSessionRoute(s);
    const stream = await openStream(s.app, s.team.id);
    try {
      const ping = await stream.next((ev) => ev.type === 'ping');
      expect(ping).toEqual({ type: 'ping' });
      expect(teamStreamEventSchema.safeParse(ping).success).toBe(true);

      const project = (await (
        await req(s.app, 'POST', '/api/projects', { name: 'demo' })
      ).json()) as { id: string };
      const created = (await (
        await req(s.app, 'POST', `/api/projects/${project.id}/todos`, { title: '写文档', spec: '' })
      ).json()) as { id: string; v: number };

      const rawTodo = await stream.next((ev) => ev.type === 'todo');
      expect(rawTodo).not.toHaveProperty('seq');
      const todoEv = todoDocEventSchema.parse(rawTodo);
      expect(todoEv.doc.id).toBe(created.id);
      expect(todoEv.v).toBe(created.v);
      expect(teamStreamEventSchema.safeParse(todoEv).success).toBe(true);

      await req(s.app, 'POST', `/api/projects/${project.id}/builds`, {
        todoIds: [created.id],
      });
      const rawBuild = await stream.next((ev) => ev.type === 'build');
      expect(rawBuild).not.toHaveProperty('seq');
      const buildEv = buildDocEventSchema.parse(rawBuild);
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
    } finally {
      stream.close();
    }
  });

  test('each fresh attachment starts its own wire sequence in the id line', async () => {
    const s = bootServer({ pingIntervalMs: 60_000 });
    for (let index = 0; index < 2; index++) {
      const controller = new AbortController();
      const response = await s.app.request(`/api/teams/${s.team.id}/stream`, {
        signal: controller.signal,
      });
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error('Expected stream response');
      try {
        const decoder = new TextDecoder();
        let raw = '';
        while (raw.split('\n\n').length < 3) {
          const { done, value } = await reader.read();
          if (done) throw new Error('Stream ended before hello and ping');
          raw += decoder.decode(value, { stream: true });
        }
        const [hello, ping] = raw.split('\n\n');
        expect(hello).toMatch(/(?:^|\n)id: 1(?:\n|$)/);
        expect(hello).toContain('"followRevision":true');
        expect(ping).toMatch(/(?:^|\n)id: 2(?:\n|$)/);
        expect(ping).toContain('data: {"type":"ping"}');
      } finally {
        controller.abort();
        await reader.cancel().catch(() => {});
      }
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
