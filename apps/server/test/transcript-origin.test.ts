import { transcriptPromptRowId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { message, step, todo } from '../src/db/schema.js';
import { messageTodo, startBuilds } from '../src/services/builds.js';
import { upsertMessage } from '../src/services/machine-deps.js';
import { receiveUpload } from '../src/services/machine-uploads.js';
import {
  bootServer,
  claimedGeneration,
  insertMachine,
  postProject,
  req,
  seedSessionRoute,
} from './helpers.js';

async function claimedStep(s: ReturnType<typeof bootServer>, machineId: string) {
  const projectId = await postProject(s.app, 'Prompt provenance');
  const response = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Do a thing',
    spec: 'the spec',
  });
  const { id: todoId } = (await response.json()) as { id: string };
  const [started] = startBuilds(s.svc, { projectId, todoIds: [todoId] });
  const row = s.db.select().from(step).where(eq(step.buildId, started!.id)).get()!;
  s.db
    .update(step)
    .set({ machineId, status: 'claimed', claimedAt: 1 })
    .where(eq(step.id, row.id))
    .run();
  return { buildId: started!.id, stepId: row.id };
}

test('receiveUpload stamps the step prompt row task-prompt and leaves other rows unmarked', async () => {
  const s = bootServer();
  const machineId = insertMachine(s);
  seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });
  const { buildId, stepId } = await claimedStep(s, machineId);
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
  };
  receiveUpload(
    deps,
    { stepId, name: 'transcript', machineId, generation: claimedGeneration(s.db, stepId) },
    {
      stepId,
      messages: [
        {
          id: transcriptPromptRowId(stepId),
          role: 'user',
          content: 'the delivered prompt',
          createdAt: 1,
        },
        { id: 'human-1', role: 'user', content: 'person words', createdAt: 2 },
        { id: 'a-1', role: 'assistant', content: 'answer', createdAt: 3 },
      ],
    },
  );
  const rows = s.db.select().from(message).where(eq(message.conversationId, buildId)).all();
  expect(rows.find((r) => r.id === transcriptPromptRowId(stepId))?.origin).toBe('task-prompt');
  expect(rows.find((r) => r.id === 'human-1')?.origin).toBeNull();
  expect(rows.find((r) => r.id === 'a-1')?.origin).toBeNull();
});

test('upsertMessage persists origin and keeps it across conflict updates', () => {
  const s = bootServer();
  upsertMessage(s.svc, {
    id: 'm-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'v1',
    createdAt: 1,
    origin: 'user',
  });
  upsertMessage(s.svc, {
    id: 'm-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'v2',
    createdAt: 2,
    origin: 'user',
  });
  const row = s.db.select().from(message).where(eq(message.id, 'm-1')).get();
  expect(row?.origin).toBe('user');
  upsertMessage(s.svc, {
    id: 'm-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'v3',
    createdAt: 4,
  });
  expect(s.db.select().from(message).where(eq(message.id, 'm-1')).get()?.origin).toBe('user');
  upsertMessage(s.svc, {
    id: 'm-2',
    conversationId: 'conv-1',
    role: 'user',
    content: 'unmarked',
    createdAt: 3,
  });
  expect(s.db.select().from(message).where(eq(message.id, 'm-2')).get()?.origin).toBeNull();
});

test("a person's message through the todo message route is stored with the person marker", async () => {
  const s = bootServer();
  const machineId = insertMachine(s);
  seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });
  const projectId = await postProject(s.app, 'Prompt provenance');
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Do a thing',
    spec: 'the spec',
  });
  const { id: todoId } = (await created.json()) as { id: string };
  const [started] = startBuilds(s.svc, { projectId, todoIds: [todoId] });
  s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
  s.db.update(step).set({ status: 'done' }).where(eq(step.buildId, started!.id)).run();
  await messageTodo(s.svc, s.team.id, todoId, 'Do a thing\n\nthe spec', 'client-1');
  const row = s.db
    .select()
    .from(message)
    .where(eq(message.conversationId, started!.id))
    .all()
    .find((r) => r.content === 'Do a thing\n\nthe spec');
  expect(row?.origin).toBe('user');
});
