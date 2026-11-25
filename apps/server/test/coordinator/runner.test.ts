import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  chiefMessage,
  chiefTurnUsage,
  coordinatorConversation,
  coordinatorEntry,
  step,
} from '../../src/db/schema.js';
import {
  setCoordinatorInServer,
  setCoordinatorWake,
} from '../../src/services/coordinator-context.js';
import { req } from '../helpers.js';
import { boot, stub, world } from './runner-world.js';

describe('in-server Coordinator runner', () => {
  it('runs a pending chief step and lands the answer in chief_message', async () => {
    const w = await world('status?');
    const { faux, seen } = stub('all quiet');
    const coordinator = boot(w, faux);

    coordinator.wake(w.threadId);
    await coordinator.idle();

    const row = w.s.db.select().from(step).where(eq(step.id, w.stepId)).get();
    expect(row?.status).toBe('done');
    expect(row?.machineId).toBeNull();
    const messages = w.s.db.select().from(chiefMessage).all();
    const assistant = messages.filter((m) => m.role === 'assistant');
    expect(JSON.stringify(assistant.map((m) => m.content))).toContain('all quiet');
    expect(seen).toHaveLength(1);
    expect(w.s.db.select().from(chiefTurnUsage).all()).toHaveLength(1);
    const conversation = w.s.db.select().from(coordinatorConversation).all();
    expect(conversation).toHaveLength(1);
    const entries = w.s.db.select().from(coordinatorEntry).all();
    expect(entries.map((e) => e.chiefMessageId)).toContain(w.stepId);
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  it('does not claim a new turn while the deployment lease is draining', async () => {
    const w = await world('status?');
    const lease = { owner: '00000000-0000-4000-8000-0000000000aa', ttlMs: 60_000 };
    expect((await req(w.s.app, 'PUT', '/api/server/deploy/lease', lease)).status).toBe(200);
    const { faux, seen } = stub('after deploy');
    const coordinator = boot(w, faux);

    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('pending');
    expect(seen).toHaveLength(0);
    expect(
      (await req(w.s.app, 'DELETE', '/api/server/deploy/lease', { owner: lease.owner })).status,
    ).toBe(200);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('done');
    expect(seen).toHaveLength(1);
  });

  it('leaves the turn to daemons when the flag is off', async () => {
    const w = await world();
    setCoordinatorInServer(false);
    const { faux, seen } = stub('never');
    const coordinator = boot(w, faux);

    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('pending');
    expect(seen).toHaveLength(0);
  });

  it('runs a second step after the first, once each', async () => {
    const w = await world('one');
    const { faux, seen } = stub('ok');
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    const again = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'two',
    });
    expect(again.status).toBeLessThan(300);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    const done = w.s.db.select().from(step).all();
    expect(done.map((r) => r.status)).toEqual(['done', 'done']);
    expect(seen).toHaveLength(2);
  });

  it('answers a composer send on an idle Coordinator without a steering conflict', async () => {
    const w = await world('one');
    const { faux, seen } = stub('ok');
    const coordinator = boot(w, faux);
    setCoordinatorWake((threadId) => coordinator.wake(threadId));
    await coordinator.idle();
    coordinator.wake(w.threadId);
    await coordinator.idle();

    const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'two',
    });
    expect(sent.status).toBe(201);
    await coordinator.idle();

    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done', 'done']);
    expect(seen).toHaveLength(2);
  });
});
