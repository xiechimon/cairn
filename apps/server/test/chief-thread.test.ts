import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  chiefMessage,
  chief as chiefTable,
  chiefThread,
  step as stepTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { sendChiefMessage } from '../src/services/chief.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

describe('chief thread surface persistence (02 section 4.3 / r5 section 3.6)', () => {
  test('sending a message -> chief_thread + chief_message(user) persisted + chief step enqueued', async () => {
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: '帮 demo 写一份 CONTRIBUTING.md 贡献指南。',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { thread: { id: string }; message: { role: string } };
    expect(body.thread.id.startsWith('chief-')).toBe(true);
    expect(body.message.role).toBe('user');
    const threads = H.s.db.select().from(chiefThread).all();
    expect(threads.length).toBeGreaterThanOrEqual(2);
    const msgs = H.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, body.thread.id))
      .all();
    expect(msgs.some((m) => m.role === 'user')).toBe(true);
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, body.thread.id))
      .all();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.kind).toBe('chief');
    expect(steps[0]!.status).toBe('pending');
  });

  test('GET /conversations/chief-<threadId>/messages reads chief_message (not the message table)', async () => {
    await sendChiefMessage(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
      { threadId: H.threadId, content: '第一条' },
    );
    const res = await req(H.s.app, 'GET', `/api/conversations/${H.threadId}/messages`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { role: string; content: unknown }[] };
    expect(body.messages.some((m) => m.role === 'user' && m.content === '第一条')).toBe(true);
  });

  test('no Agent bound -> sending a message 409 (gate clause canon server half, r5 section 2)', async () => {
    H.s.db.update(chiefTable).set({ agentId: null }).where(eq(chiefTable.id, H.chiefId)).run();
    expect(() =>
      sendChiefMessage(
        { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
        H.teamId,
        {
          threadId: H.threadId,
          content: 'x',
        },
      ),
    ).toThrow(HttpError);
  });
});
