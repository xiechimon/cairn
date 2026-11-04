import { type Phase, todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { todo as todoTable } from '../src/db/schema.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

type History = Partial<{
  hasChanges: boolean;
  hasPlan: boolean;
  latestBuildId: string;
  lastRunAt: number;
}>;

async function setup(phase: Phase, history: History = {}): Promise<{ s: TestServer; id: string }> {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = todoRecordSchema.parse(
    await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'p', spec: 'x' })
    ).json(),
  );
  s.db
    .update(todoTable)
    .set({ phase, ...history })
    .where(eq(todoTable.id, created.id))
    .run();
  return { s, id: created.id };
}

const row = (s: TestServer, id: string) =>
  s.db.select().from(todoTable).where(eq(todoTable.id, id)).get();

describe('the PATCH phase=todo reset gate (#1486)', () => {
  test.each<[Phase, History]>([
    ['done', { hasChanges: true }],
    ['review', { latestBuildId: 'build-1' }],
    ['confirm', { hasPlan: true }],
    ['failed', { lastRunAt: 1 }],
    ['queued', {}],
    ['planning', {}],
    ['building', {}],
  ])('失败方式 1：已开始的 %s 卡 %j → 409 指向 /reset，卡不动', async (phase, history) => {
    const { s, id } = await setup(phase, history);
    const before = row(s, id);
    const res = await req(s.app, 'PATCH', `/api/todos/${id}`, { phase: 'todo' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain(`/api/todos/${id}/reset`);
    expect(row(s, id)).toEqual(before);
  });

  test.each<Phase>(['done', 'review', 'confirm', 'failed'])(
    '失败方式 2：没开始过的 %s 卡 → 200 挪回待开始',
    async (phase) => {
      const { s, id } = await setup(phase);
      const res = await req(s.app, 'PATCH', `/api/todos/${id}`, { phase: 'todo' });
      expect(res.status).toBe(200);
      expect(todoRecordSchema.parse(await res.json()).phase).toBe('todo');
    },
  );

  test('failure mode 3: closed -> todo (reopen) with history still 200, the history kept', async () => {
    const { s, id } = await setup('closed', { hasChanges: true, latestBuildId: 'build-1' });
    const res = await req(s.app, 'PATCH', `/api/todos/${id}`, { phase: 'todo' });
    expect(res.status).toBe(200);
    const doc = todoRecordSchema.parse(await res.json());
    expect(doc.phase).toBe('todo');
    expect(doc.latestBuildId).toBe('build-1');
    expect(doc.hasChanges).toBe(true);
  });

  test('failure mode 4: a todo card with history patched to the same phase -> 200', async () => {
    const { s, id } = await setup('todo', { hasChanges: true });
    const res = await req(s.app, 'PATCH', `/api/todos/${id}`, { phase: 'todo' });
    expect(res.status).toBe(200);
  });
});
