import { buildRestartPrompt, CONTINUE_PROMPTS, transcriptPromptRowId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { message, step } from '../src/db/schema.js';
import { startBuilds } from '../src/services/builds.js';
import { backfillTranscriptOrigins } from '../src/services/transcript-origin-backfill.js';
import { bootServer, insertMachine, postProject, req, seedSessionRoute } from './helpers.js';

const TITLE = 'Do a thing';
const SPEC = 'the spec';
const TASK_TEXT = `${TITLE}\n\n${SPEC}`;
const DELIVERY_SECTION = '成果文件交接位置：/home/u/.cairn/deliverables/conv-1/';

async function legacyWorld(s: ReturnType<typeof bootServer>) {
  const machineId = insertMachine(s);
  seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });
  const projectId = await postProject(s.app, 'Prompt provenance backfill');
  const response = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: TITLE,
    spec: SPEC,
  });
  const { id: todoId } = (await response.json()) as { id: string };
  const [started] = startBuilds(s.svc, { projectId, todoIds: [todoId] });
  const stepRow = s.db.select().from(step).where(eq(step.buildId, started!.id)).get()!;
  return { conversationId: started!.id, stepId: stepRow.id };
}

function legacyRow(
  conversationId: string,
  input: {
    id: string;
    content: unknown;
    createdAt: number;
    origin?: 'task-prompt' | 'synthetic' | 'user';
  },
) {
  return {
    id: input.id,
    conversationId,
    role: 'user' as const,
    content: input.content,
    createdAt: input.createdAt,
    origin: input.origin ?? null,
  };
}

test('a legacy task prompt row keeps its provenance when a delivery section the reader never learned follows it', async () => {
  const s = bootServer();
  const { conversationId, stepId } = await legacyWorld(s);
  s.db
    .insert(message)
    .values([
      legacyRow(conversationId, {
        id: transcriptPromptRowId(stepId),
        content: `${TASK_TEXT}\n\n${DELIVERY_SECTION}`,
        createdAt: 1,
      }),
      legacyRow(conversationId, {
        id: 'user-step-long-gone',
        content: `${TASK_TEXT}\n\n${DELIVERY_SECTION}`,
        createdAt: 2,
      }),
    ])
    .run();

  backfillTranscriptOrigins(s.db);

  const rows = s.db.select().from(message).where(eq(message.conversationId, conversationId)).all();
  expect(rows.every((row) => row.origin === 'task-prompt')).toBe(true);
});

test('legacy generated instructions are stamped synthetic and a person keeps the person marker', async () => {
  const s = bootServer();
  const { conversationId } = await legacyWorld(s);
  s.db
    .insert(message)
    .values([
      legacyRow(conversationId, { id: 'm-1', content: CONTINUE_PROMPTS.build, createdAt: 1 }),
      legacyRow(conversationId, {
        id: 'm-2',
        content: buildRestartPrompt('先跑 lint 再提交'),
        createdAt: 2,
      }),
      legacyRow(conversationId, { id: 'm-3', content: '圆角改成 6px 吧', createdAt: 3 }),
      legacyRow(conversationId, {
        id: 'm-4',
        content: '收到，谢谢',
        createdAt: 4,
        origin: 'synthetic',
      }),
      {
        id: 'a-1',
        conversationId,
        role: 'assistant' as const,
        content: [{ type: 'text', text: '好' }],
        createdAt: 5,
      },
    ])
    .run();

  const counts = backfillTranscriptOrigins(s.db);

  const origins = new Map(
    s.db
      .select()
      .from(message)
      .where(eq(message.conversationId, conversationId))
      .all()
      .map((row) => [row.id, row.origin]),
  );
  expect(origins.get('m-1')).toBe('synthetic');
  expect(origins.get('m-2')).toBe('synthetic');
  expect(origins.get('m-3')).toBe('user');
  expect(origins.get('m-4')).toBe('synthetic');
  expect(origins.get('a-1')).toBeNull();
  expect(counts).toEqual({ 'task-prompt': 0, synthetic: 2, user: 1 });
});

test('a second run stamps nothing: every row already carries its marker', async () => {
  const s = bootServer();
  const { conversationId } = await legacyWorld(s);
  s.db
    .insert(message)
    .values([legacyRow(conversationId, { id: 'm-1', content: '圆角改成 6px 吧', createdAt: 1 })])
    .run();

  expect(backfillTranscriptOrigins(s.db)).toEqual({ 'task-prompt': 0, synthetic: 0, user: 1 });
  expect(backfillTranscriptOrigins(s.db)).toEqual({ 'task-prompt': 0, synthetic: 0, user: 0 });
});
