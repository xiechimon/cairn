import type { TranscriptRow } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { step, todo } from '../src/db/schema.js';
import { addChiefWatch, sendChiefMessage } from '../src/services/chief.js';
import { upsertChiefRow } from '../src/services/machine-deps.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

async function seedTask(watched: boolean) {
  const record = (await relay('create_todo', {
    projectId: H.projectId,
    title: 'Repair board counts',
    spec: 'Refresh counts after dragging a task.',
  })) as { id: string };
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, record.id)).run();
  const deps = {
    db: H.s.db,
    hub: H.s.hub,
    convHub: H.s.convHub,
    machineHub: H.s.machineHub,
    user: H.s.user,
  };
  if (watched)
    addChiefWatch(deps, {
      teamId: H.teamId,
      todo: getTodo(deps, record.id)!,
      projectName: 'demo',
      threadId: H.threadId,
    });
  return { deps, todoId: record.id };
}

async function messages(threadId = H.threadId) {
  const response = await req(H.s.app, 'GET', `/api/conversations/${threadId}/messages`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { messages: TranscriptRow[] }).messages;
}

describe('worker reports in the chief conversation', () => {
  test.each(['done', 'failed', 'review'] as const)(
    '%s persists and publishes a system report before the wake reply',
    async (phase) => {
      const { deps, todoId } = await seedTask(true);
      const unrelated = sendChiefMessage(deps, H.teamId, {
        threadId: null,
        content: 'An unrelated conversation',
      }).thread;
      const publish = vi.spyOn(H.s.convHub, 'publishMessage');
      setTodoPhase(deps, todoId, phase);
      const rows = await messages();
      expect(rows).toHaveLength(1);
      const report = rows[0]!;
      expect(report.role).toBe('system');
      expect(JSON.parse(report.content as string)).toEqual({
        kind: 'thread-report',
        todoId,
        phase,
        seqNum: 1,
        title: 'Repair board counts',
      });
      expect(publish).toHaveBeenCalledWith(H.threadId, expect.objectContaining(report));
      const wake = H.s.db.select().from(step).where(eq(step.buildId, H.threadId)).get()!;
      expect(wake.prompt).toMatch(/^\[wake:(settle|failed|gate)\]/);
      expect(report.createdAt).toBeLessThanOrEqual(wake.createdAt);
      upsertChiefRow(deps, {
        id: `reply-${wake.id}`,
        threadId: H.threadId,
        role: 'assistant',
        content: 'The worker result has been checked.',
        createdAt: report.createdAt,
      });
      expect((await messages()).map((row) => row.id)).toEqual([report.id, `reply-${wake.id}`]);
      expect(await messages(unrelated.id)).toHaveLength(1);
      setTodoPhase(deps, todoId, phase);
      expect(await messages()).toHaveLength(2);
    },
  );

  test('unwatched tasks do not report into chief conversations', async () => {
    const { deps, todoId } = await seedTask(false);
    setTodoPhase(deps, todoId, 'done');
    expect(await messages()).toEqual([]);
    expect(H.s.db.select().from(step).where(eq(step.buildId, H.threadId)).all()).toEqual([]);
  });

  test('non-report phases do not create a report', async () => {
    const { deps, todoId } = await seedTask(true);
    setTodoPhase(deps, todoId, 'closed');
    expect(await messages()).toEqual([]);
  });
});
