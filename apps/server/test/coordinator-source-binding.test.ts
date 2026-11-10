import { coordinatorCreateTodoParamsSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { todo } from '../src/db/schema.js';
import { createRequestTodo, updateRequestTodo } from '../src/services/coordinator-request.js';
import { ctx, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

const message = (text: string) => seedOwnerMessage(H.s.db, H.threadId, text);

function unstarted(messageIds: string[]) {
  return createRequestTodo(
    toolDeps(),
    ctx(),
    { projectId: H.projectId, messageIds },
    { createdBy: H.userId, ownerId: H.userId },
  );
}

describe('Coordinator source bindings', () => {
  test('replays the 02:21Z omitted-source then one-call-per-message sequence', async () => {
    const caret = message('Please dispatch the caret alignment fix.');
    const preview = message('Research Markdown preview implementations, then propose a plan.');
    const turn = { turnMessageIds: [caret, preview] };
    const outcomes = [];
    for (const params of [
      { projectId: H.projectId, output: 'info' },
      { projectId: H.projectId, messageIds: [preview], output: 'info' },
      { projectId: H.projectId, messageIds: [caret] },
    ]) {
      outcomes.push(await Promise.allSettled([relay('create_todo', params, turn)]));
    }
    expect(outcomes.flat().map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
      'rejected',
    ]);
    const rows = H.s.db.select().from(todo).all();
    expect(rows).toHaveLength(1);
    expect(rows.map((row) => row.request?.segments.map((segment) => segment.source))).toEqual([
      [
        { kind: 'chat', threadId: H.threadId, messageId: caret, span: 'whole' },
        { kind: 'chat', threadId: H.threadId, messageId: preview, span: 'whole' },
      ],
    ]);
  });

  test('schema preserves the turn source default', () => {
    expect(coordinatorCreateTodoParamsSchema.safeParse({ projectId: 'p' }).success).toBe(true);
    expect(
      coordinatorCreateTodoParamsSchema.safeParse({ projectId: 'p', messageIds: ['m'] }).success,
    ).toBe(true);
    expect(
      coordinatorCreateTodoParamsSchema.safeParse({ projectId: 'p', sourceTodoId: 't' }).success,
    ).toBe(true);
  });

  test.each(['same turn', 'later turn', 'closed task', 'archived task'])(
    '%s cannot bind a whole owner message again',
    async (state) => {
      const id = message('Fix the caret.');
      const first = unstarted([id]);
      if (state === 'closed task') await relay('close_todos', { todoIds: [first.id] });
      if (state === 'archived task') {
        H.s.db.update(todo).set({ archivedAt: Date.now() }).where(eq(todo.id, first.id)).run();
      }
      await expect(
        relay(
          'create_todo',
          { projectId: H.projectId, messageIds: [id] },
          { turnMessageIds: state === 'same turn' ? [id] : [] },
        ),
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining(first.id) });
      expect(H.s.db.select().from(todo).all()).toHaveLength(1);
    },
  );

  test('a failed creation does not consume a source', async () => {
    const id = message('Fix the caret.');
    await expect(
      relay('create_todo', { projectId: H.projectId, messageIds: [id], dependsOn: ['missing'] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      relay('create_todo', { projectId: H.projectId, messageIds: [id] }),
    ).resolves.toMatchObject({ spec: 'Fix the caret.' });
  });

  test('quotes explicitly allow a split after a whole-message binding', async () => {
    const id = message('Fix the caret. Add preview.');
    unstarted([id]);
    for (const quote of ['Fix the caret.', 'Add preview.']) {
      await expect(
        relay('create_todo', { projectId: H.projectId, messageIds: [id], quotes: [quote] }),
      ).resolves.toMatchObject({ spec: `> ${quote}` });
    }
    await expect(
      relay('create_todo', { projectId: H.projectId, messageIds: [id] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('a quoted binding also prevents a later implicit whole-message task', async () => {
    const id = message('Fix the caret. Add preview.');
    await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [id],
      quotes: ['Fix the caret.'],
    });
    await expect(
      relay('create_todo', { projectId: H.projectId, messageIds: [id] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('append cannot bind a message already used by another task', async () => {
    const id = message('Fix the caret.');
    const first = unstarted([id]);
    const second = unstarted([message('Add preview.')]);
    await expect(
      relay('update_todo', { todoId: second.id, title: 'Must not change', addMessageIds: [id] }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining(first.id) });
    expect(H.s.db.select().from(todo).where(eq(todo.id, second.id)).get()?.spec).toBe(
      'Add preview.',
    );
    expect(H.s.db.select().from(todo).where(eq(todo.id, second.id)).get()?.title).toBe(
      'Add preview.',
    );
  });

  test.each(['tool', 'request-service'] as const)(
    '%s rejects duplicate input IDs on create and append before any writes',
    async (entry) => {
      const id = message('Fix the caret.');
      const create = async () =>
        entry === 'tool'
          ? relay('create_todo', { projectId: H.projectId, messageIds: [id, id] })
          : unstarted([id, id]);
      await expect(create()).rejects.toMatchObject({ status: 400 });
      expect(H.s.db.select().from(todo).all()).toHaveLength(0);
      const first = unstarted([id]);
      const addition = message('Add preview.');
      const params = {
        todoId: first.id,
        title: 'Must not change',
        addMessageIds: [addition, addition],
      };
      const append = async () =>
        entry === 'tool'
          ? relay('update_todo', params)
          : updateRequestTodo(toolDeps(), ctx(), params);
      await expect(append()).rejects.toMatchObject({ status: 400 });
      expect(H.s.db.select().from(todo).where(eq(todo.id, first.id)).get()?.spec).toBe(
        'Fix the caret.',
      );
      expect(H.s.db.select().from(todo).where(eq(todo.id, first.id)).get()?.title).toBe(
        'Fix the caret.',
      );
    },
  );

  test('an appended source prevents a later create', async () => {
    const first = unstarted([message('Add preview.')]);
    const id = message('Use Markdown.');
    await relay('update_todo', { todoId: first.id, addMessageIds: [id] });
    await expect(
      relay('create_todo', { projectId: H.projectId, messageIds: [id] }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
