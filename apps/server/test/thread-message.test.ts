import { threadMessageContentSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { build, chiefMessage, message, steerPending, step, todo } from '../src/db/schema.js';
import { pickedProjectIdOf } from '../src/services/picked-project.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { H, registerChiefHarness, toolDeps } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

type Phase = (typeof todo.$inferSelect)['phase'];

function seedThread(phase: Phase, stepStatus: 'claimed' | 'done' | 'pending' = 'done') {
  H.s.db
    .insert(todo)
    .values({
      id: 'direct-todo',
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Talk to me directly',
      phase,
      phaseAt: 1,
      seqNum: 7,
      latestBuildId: 'direct-build',
    })
    .run();
  H.s.db
    .insert(build)
    .values({
      id: 'direct-build',
      todoId: 'direct-todo',
      withPlan: true,
      triggerSource: 'chief',
      createdAt: 1,
    })
    .run();
  H.s.db
    .insert(step)
    .values({
      id: 'direct-step',
      buildId: 'direct-build',
      kind: phase === 'confirm' ? 'plan' : 'build',
      status: stepStatus,
      sessionId: 'worker-session',
      createdAt: 1,
    })
    .run();
}

function send(body: unknown = { content: 'Use the cached index', clientMessageId: 'c-1' }) {
  return req(H.s.app, 'POST', '/api/todos/direct-todo/messages', body);
}

function markers() {
  return H.s.db
    .select()
    .from(chiefMessage)
    .all()
    .filter((row) => String(row.content).includes('thread-message'))
    .map((row) => ({
      row,
      content: threadMessageContentSchema.parse(JSON.parse(String(row.content))),
    }));
}

describe('POST /api/todos/:id/messages', () => {
  test('steers a running thread and records it in the Coordinator conversation', async () => {
    seedThread('building', 'claimed');
    const signal = vi.spyOn(H.s.machineHub, 'steerSignal');
    const publish = vi.spyOn(H.s.convHub, 'publishMessage');
    const res = await send();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      todoId: 'direct-todo',
      conversationId: 'direct-build',
      delivered: 'steer',
    });
    expect(signal).toHaveBeenCalledExactlyOnceWith(H.teamId, 'direct-step');
    expect(H.s.db.select().from(steerPending).get()).toMatchObject({
      content: 'Use the cached index',
    });
    expect(H.s.db.select().from(message).get()).toMatchObject({
      role: 'user',
      actor: H.s.user.displayName,
      content: 'Use the cached index',
    });
    const [marker] = markers();
    expect(marker?.row).toMatchObject({ threadId: H.threadId, role: 'system' });
    expect(marker?.content).toEqual({
      kind: 'thread-message',
      todoId: 'direct-todo',
      seqNum: 7,
      title: 'Talk to me directly',
      excerpt: 'Use the cached index',
      delivered: 'steer',
      conversationId: 'direct-build',
      by: 'user',
    });
    expect(publish).toHaveBeenCalledWith(
      H.threadId,
      expect.objectContaining({ id: marker?.row.id, role: 'system' }),
    );
  });

  test('a user steer with a same-team attachment token grants that attachment to the thread', async () => {
    seedThread('building', 'claimed');
    const token = `![shot.png](attachment:${H.teamId}/att-user.png)`;
    const res = await send({ content: token, clientMessageId: 'c-att-user' });
    expect(res.status).toBe(201);
    expect(H.s.db.select().from(todo).get()?.userMessageAttachmentIds).toEqual(['att-user']);
  });

  test('continues a done thread with a new turn', async () => {
    seedThread('done');
    const res = await send();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ delivered: 'new-turn' });
    expect(H.s.db.select().from(todo).get()?.phase).toBe('queued');
    expect(markers()).toHaveLength(1);
    expect(
      H.s.db
        .select()
        .from(step)
        .all()
        .find((row) => row.id !== 'direct-step')?.byPerson,
    ).toBe(true);
  });

  test('treats a reply at the plan gate as a revision, never as approval', async () => {
    seedThread('confirm');
    const res = await send({ content: 'Split the migration out', clientMessageId: 'c-2' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ delivered: 'revision' });
    const steps = H.s.db.select().from(step).all();
    expect(steps.some((row) => row.kind === 'build')).toBe(false);
    expect(steps.find((row) => row.id !== 'direct-step')).toMatchObject({ kind: 'plan' });
    expect(H.s.db.select().from(todo).get()?.phase).not.toBe('building');
    expect(markers()[0]?.content.delivered).toBe('revision');
  });

  test('restarts a failed thread with the reply as feedback', async () => {
    seedThread('failed');
    const res = await send({ content: 'Retry on the orb machine', clientMessageId: 'c-3' });
    expect(res.status).toBe(201);
    const result = (await res.json()) as { conversationId: string; delivered: string };
    expect(result.delivered).toBe('restart');
    const latest = H.s.db.select().from(todo).get()?.latestBuildId;
    expect(result.conversationId).toBe(latest);
    expect(markers()[0]?.content).toMatchObject({ delivered: 'restart', conversationId: latest });
  });

  test.each([
    ['a queued thread', 'queued', 'pending'],
    ['an idle todo', 'todo', 'done'],
  ] as const)('refuses %s and leaves no marker', async (_label, phase, status) => {
    seedThread(phase, status);
    const res = await send();
    expect(res.status).toBe(409);
    expect(markers()).toEqual([]);
    expect(H.s.db.select().from(message).all()).toEqual([]);
  });

  test('refuses a thread that has not started', async () => {
    seedThread('done');
    H.s.db.update(todo).set({ latestBuildId: null }).where(eq(todo.id, 'direct-todo')).run();
    const res = await send();
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/#7 has not started/);
    expect(markers()).toEqual([]);
  });

  test('refuses an archived thread', async () => {
    seedThread('done');
    H.s.db.update(todo).set({ archivedAt: 5 }).where(eq(todo.id, 'direct-todo')).run();
    expect((await send()).status).toBe(409);
    expect(markers()).toEqual([]);
  });

  test('returns 404 for an unknown thread', async () => {
    seedThread('building', 'claimed');
    const res = await req(H.s.app, 'POST', '/api/todos/missing-todo/messages', {
      content: 'hi',
      clientMessageId: 'c-6',
    });
    expect(res.status).toBe(404);
    expect(H.s.db.select().from(steerPending).all()).toEqual([]);
  });

  test.each([
    ['empty content', { content: '   ', clientMessageId: 'c-4' }],
    ['missing client id', { content: 'hi' }],
  ])('rejects %s', async (_label, body) => {
    seedThread('building', 'claimed');
    expect((await send(body)).status).toBe(400);
    expect(markers()).toEqual([]);
  });

  test('clips a long message to the marker excerpt', async () => {
    seedThread('building', 'claimed');
    await send({ content: `${'x'.repeat(400)}\n\nend`, clientMessageId: 'c-5' });
    const excerpt = markers()[0]?.content.excerpt ?? '';
    expect(excerpt.length).toBe(280);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('Coordinator awareness of direct thread messages', () => {
  function coordinatorPrompts(): string[] {
    return H.s.db
      .select()
      .from(step)
      .where(eq(step.kind, 'chief'))
      .all()
      .map((row) => row.prompt ?? '');
  }

  async function sayToCoordinator(content: string) {
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/messages`, {
      content,
    });
    expect(res.status).toBe(201);
  }

  test('the next Coordinator turn hears about it once, and the transcript stays clean', async () => {
    seedThread('building', 'claimed');
    await send({ content: 'Use the cached index', clientMessageId: 'c-7' });
    await sayToCoordinator('How is it going?');
    const [first] = coordinatorPrompts();
    expect(first).toContain('#7');
    expect(first).toContain('Use the cached index');
    expect(first?.endsWith('How is it going?')).toBe(true);
    const stored = H.s.db
      .select()
      .from(chiefMessage)
      .all()
      .filter((row) => row.role === 'user');
    expect(stored.map((row) => row.content)).toEqual(['How is it going?']);

    H.s.db.update(step).set({ status: 'done' }).where(eq(step.kind, 'chief')).run();
    await sayToCoordinator('And now?');
    expect(coordinatorPrompts().at(-1)).toBe('And now?');
  });

  test('keeps the picked project readable when a direct-message note is attached', async () => {
    seedThread('building', 'claimed');
    await send({ content: 'Use the cached index', clientMessageId: 'c-9' });
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/messages`, {
      content: 'Status?',
      projectId: H.projectId,
    });
    expect(res.status).toBe(201);
    const prompt = coordinatorPrompts().at(-1) ?? '';
    expect(pickedProjectIdOf(prompt)).toBe(H.projectId);
    expect(prompt).toContain('#7');
  });

  function insertMarker(id: string, over: Record<string, unknown>, createdAt: number) {
    H.s.db
      .insert(chiefMessage)
      .values({
        id,
        threadId: H.threadId,
        role: 'system',
        content: JSON.stringify({
          kind: 'thread-message',
          todoId: 'direct-todo',
          seqNum: 7,
          title: 'Talk to me directly',
          excerpt: 'placeholder',
          delivered: 'steer',
          conversationId: 'direct-build',
          ...over,
        }),
        createdAt,
      })
      .run();
  }

  test('only markers from the user reach the next Coordinator prompt; markers without by count as the user', async () => {
    seedThread('building', 'claimed');
    insertMarker('m-user', { by: 'user', excerpt: 'from the user' }, 2_000_000_000_000);
    insertMarker('m-legacy', { excerpt: 'from an old row' }, 2_000_000_000_001);
    insertMarker(
      'm-coordinator',
      { by: 'coordinator', excerpt: 'from a tool call' },
      2_000_000_000_002,
    );
    await sayToCoordinator('Status?');
    const prompt = coordinatorPrompts().at(-1) ?? '';
    expect(prompt).toContain('from the user');
    expect(prompt).toContain('from an old row');
    expect(prompt).not.toContain('from a tool call');
  });

  test('a prompt note carries no control or format characters and no secrets', async () => {
    seedThread('building', 'claimed');
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
    const content = `Use it\u202e\u200b\u0007 now ${secret}`;
    await send({ content, clientMessageId: 'c-10' });
    expect(markers()[0]?.content.excerpt).toMatch(/^Use it now /);
    expect(markers()[0]?.content.excerpt).not.toContain(secret);
    expect(markers()[0]?.content.excerpt).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    insertMarker(
      'm-raw',
      { by: 'user', excerpt: `raw\u202e\u200bnote ${secret}` },
      2_000_000_000_000,
    );
    await sayToCoordinator('Status?');
    const prompt = coordinatorPrompts().at(-1) ?? '';
    expect(prompt).toContain('raw note');
    expect(prompt).not.toContain(secret);
    expect(prompt).not.toMatch(/\p{Cf}/u);
    expect(prompt).not.toContain(String.fromCharCode(7));
  });

  test('a message to another team’s thread is refused at the service', async () => {
    seedThread('building', 'claimed');
    await expect(
      messageThreadAsUser({ ...toolDeps(), convHub: H.s.convHub }, 'other-team', 'direct-todo', {
        content: 'hi',
        clientMessageId: 'c-8',
      }),
    ).rejects.toThrow('todo direct-todo');
    expect(markers()).toEqual([]);
  });
});
