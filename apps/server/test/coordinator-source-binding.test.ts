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
      'rejected',
      'fulfilled',
      'fulfilled',
    ]);
    const rows = H.s.db.select().from(todo).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.request?.segments.map((segment) => segment.source))).toEqual([
      [{ kind: 'chat', threadId: H.threadId, messageId: preview, span: 'whole' }],
      [{ kind: 'chat', threadId: H.threadId, messageId: caret, span: 'whole' }],
    ]);
  });

  test('a follow-up turn with an earlier unbound request lists both and creates nothing until messageIds is passed', async () => {
    const request = message('Summarize 10 AI application developer jobs on BOSS.');
    const followUp = message('The BOSS window is the private browser.');
    const turn = { turnMessageIds: [followUp] };
    await expect(relay('create_todo', { projectId: H.projectId }, turn)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(request),
    });
    expect(H.s.db.select().from(todo).all()).toHaveLength(0);
    await relay('create_todo', { projectId: H.projectId, messageIds: [request, followUp] }, turn);
    const rows = H.s.db.select().from(todo).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.request?.segments.map((segment) => segment.text)).toEqual([
      'Summarize 10 AI application developer jobs on BOSS.',
      'The BOSS window is the private browser.',
    ]);
  });

  test('update_todo replaces a wrong quote without appending', async () => {
    const request = message('Summarize 10 AI application developer jobs on BOSS.');
    const followUp = message('The BOSS window is the private browser.');
    const created = unstarted([followUp]);
    await relay('update_todo', { todoId: created.id, replaceMessageIds: [request, followUp] });
    const stored = H.s.db.select().from(todo).where(eq(todo.id, created.id)).get();
    expect(stored?.request?.segments.map((segment) => segment.text)).toEqual([
      'Summarize 10 AI application developer jobs on BOSS.',
      'The BOSS window is the private browser.',
    ]);
    expect(stored?.spec).toBe(
      'Summarize 10 AI application developer jobs on BOSS.\n\nThe BOSS window is the private browser.',
    );
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
      if (state === 'closed task') await relay('archive_todos', { todoIds: [first.id] });
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

  test('superseding an info card with a code task is refused unless the owner asked for code', async () => {
    const id = message('Survey the job listings in my signed-in browser.');
    const card = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [id],
      output: 'info',
    })) as { id: string };
    const code = unstarted([message('Write REPORT.md')]);
    await expect(
      relay('archive_todos', { todoIds: [card.id], supersededBy: code.id }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('stays an info card'),
    });
    await expect(
      relay('create_todo', { projectId: H.projectId, sourceTodoId: card.id }),
    ).rejects.toMatchObject({ status: 409 });
    const ask = message('Please change the code to add a report exporter.');
    await expect(
      relay(
        'archive_todos',
        { todoIds: [card.id], supersededBy: code.id, codeChangeQuote: 'change the code' },
        { turnMessageIds: [ask] },
      ),
    ).resolves.toBeDefined();
  });
});
