import { todoDocEventSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { todo as todoTable } from '../src/db/schema.js';
import { startBuilds } from '../src/services/builds.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, openStream, postProject, req, type TestServer } from './helpers.js';

async function withConfirmTodo(): Promise<TestServer & { todoId: string }> {
  const s = bootServer({ pingIntervalMs: 100 });
  const projectId = await postProject(s.app);
  const todoDoc = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: '写周报', spec: '' })
  ).json()) as { id: string };
  startBuilds(s.svc, {
    projectId,
    todoIds: [todoDoc.id],
    assignment: { plan: null, build: null },
    withPlan: true,
  });
  setTodoPhase(s.svc, todoDoc.id, 'planning');
  setTodoPhase(s.svc, todoDoc.id, 'confirm');
  return { ...s, todoId: todoDoc.id };
}

function rowOf(s: TestServer, todoId: string) {
  return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
}

describe('phase funnel same-phase idempotency (the XMON-59 main break)', () => {
  test('a same-phase replay does not throw and returns the current record; zero side effects (v/phaseAt unchanged, no new todo doc frame)', async () => {
    const s = await withConfirmTodo();
    try {
      const before = rowOf(s, s.todoId);
      const rec = setTodoPhase(s.svc, s.todoId, 'confirm');
      expect(rec?.phase).toBe('confirm');
      const after = rowOf(s, s.todoId);
      expect(after.v).toBe(before.v);
      expect(after.phaseAt).toBe(before.phaseAt);

      const stream = await openStream(s.app, s.team.id);
      try {
        setTodoPhase(s.svc, s.todoId, 'confirm');
        await expect(stream.next((ev) => ev.type === 'todo', 300)).rejects.toThrow(/timeout/);
      } finally {
        stream.close();
      }
    } finally {
      s.dispose();
    }
  });

  test('same phase + the hasPlan companion bit: stored + v+1 + a todo doc event (phase/phaseAt unchanged)', async () => {
    const s = await withConfirmTodo();
    const stream = await openStream(s.app, s.team.id);
    try {
      const before = rowOf(s, s.todoId);
      expect(before.hasPlan).toBe(false);
      const rec = setTodoPhase(s.svc, s.todoId, 'confirm', { hasPlan: true });
      const after = rowOf(s, s.todoId);
      expect(after.hasPlan).toBe(true);
      expect(after.v).toBe(before.v + 1);
      expect(after.phase).toBe('confirm');
      expect(after.phaseAt).toBe(before.phaseAt);
      expect(rec?.hasPlan).toBe(true);

      const ev = todoDocEventSchema.parse(await stream.next((e) => e.type === 'todo', 3000));
      expect(ev.doc).toMatchObject({ id: s.todoId, phase: 'confirm', hasPlan: true });
    } finally {
      stream.close();
      s.dispose();
    }
  });

  test('idempotency does not relax illegal edges: confirm -> done still throws (a phase pair outside the transition table)', async () => {
    const s = await withConfirmTodo();
    try {
      expect(() => setTodoPhase(s.svc, s.todoId, 'done')).toThrow();
    } finally {
      s.dispose();
    }
  });

  test('a real transition edge still writes and publishes: the confirm -> building event always fires (a changed phase does not swallow the event)', async () => {
    const s = await withConfirmTodo();
    const stream = await openStream(s.app, s.team.id);
    try {
      const before = rowOf(s, s.todoId);
      const rec = setTodoPhase(s.svc, s.todoId, 'building');
      const after = rowOf(s, s.todoId);
      expect(rec?.phase).toBe('building');
      expect(after.v).toBe(before.v + 1);
      expect(after.phaseAt).toBeGreaterThanOrEqual(before.phaseAt);
      const ev = todoDocEventSchema.parse(await stream.next((e) => e.type === 'todo', 3000));
      expect(ev.doc).toMatchObject({ id: s.todoId, phase: 'building' });
    } finally {
      stream.close();
      s.dispose();
    }
  });
});
