import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { build, chiefMessage, message, plan, step, todo } from '../src/db/schema.js';
import { addChiefWatch, triggerChiefWakes } from '../src/services/chief.js';
import { finishStep } from '../src/services/machines.js';
import { executeMcpTool } from '../src/services/mcp-face.js';
import { getTodo } from '../src/services/todos.js';
import { H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { insertMachine } from './helpers.js';

registerChiefHarness();

function seedGate() {
  H.s.db
    .insert(todo)
    .values({
      id: 'gate-todo',
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Gate',
      spec: '',
      seqNum: 1,
      phase: 'confirm',
      phaseAt: 1,
      latestBuildId: 'gate-build',
    })
    .run();
  H.s.db
    .insert(build)
    .values({
      id: 'gate-build',
      todoId: 'gate-todo',
      withPlan: true,
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  const deps = { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user };
  const record = getTodo(deps, 'gate-todo')!;
  addChiefWatch(deps, {
    teamId: H.teamId,
    todo: record,
    projectName: 'demo',
    threadId: H.threadId,
  });
  return { deps, record };
}

function gateSteps() {
  return H.s.db.select().from(step).where(eq(step.buildId, H.threadId)).all();
}

test('confirm wake embeds the latest persisted plan without the megabyte transcript', () => {
  const { deps, record } = seedGate();
  H.s.db
    .insert(message)
    .values({
      id: 'huge',
      conversationId: 'gate-build',
      role: 'assistant',
      content: 'history'.repeat(160000),
      createdAt: 1,
    })
    .run();
  H.s.db
    .insert(plan)
    .values([
      { id: 'new', buildId: 'gate-build', version: 2, content: 'Latest plan text', createdAt: 1 },
      { id: 'old', buildId: 'gate-build', version: 1, content: 'Obsolete plan', createdAt: 2 },
    ])
    .run();
  triggerChiefWakes(deps, record, 'confirm');
  const prompt = gateSteps().at(-1)!.prompt!;
  expect(prompt).toContain('Latest plan text');
  expect(prompt).not.toContain('Obsolete plan');
  expect(prompt).not.toContain('conversation');
  expect(prompt.length).toBeLessThan(42000);
  H.s.db
    .update(plan)
    .set({ content: `Plan start\n${'x'.repeat(50000)}END` })
    .where(eq(plan.id, 'new'))
    .run();
  triggerChiefWakes(deps, record, 'confirm');
  const capped = gateSteps().at(-1)!.prompt!;
  expect(capped).toContain('Plan start');
  expect(capped).toContain('truncated');
  expect(capped).not.toContain('END');
  expect(capped.length).toBeLessThan(42000);
});

test.each(['chief', 'build'] as const)(
  'conversation bounds %s output and pages backwards with tied timestamps',
  async (kind) => {
    seedGate();
    const conversationId = kind === 'chief' ? H.threadId : 'gate-build';
    for (let i = 0; i < 5; i++) {
      const row = {
        id: `m-${i}`,
        role: 'assistant' as const,
        content: `${i}:${'x'.repeat(20000)}`,
        createdAt: 1,
      };
      if (kind === 'chief')
        H.s.db
          .insert(chiefMessage)
          .values({ ...row, threadId: conversationId })
          .run();
      else
        H.s.db
          .insert(message)
          .values({ ...row, conversationId })
          .run();
    }
    type Page = {
      messages: { id: string; content: string }[];
      truncated: boolean;
      nextBefore: string | null;
    };
    for (const call of [
      (args: Record<string, unknown>) => relay('conversation', args),
      async (args: Record<string, unknown>) =>
        JSON.parse(
          await executeMcpTool(
            toolDeps(),
            { teamId: H.teamId, user: H.s.user, grants: new Set(['Conversation']) },
            'conversation',
            args,
          ),
        ),
    ]) {
      const first = (await call({ conversationId })) as Page;
      expect(JSON.stringify(first).length).toBeLessThanOrEqual(60000);
      expect(first.truncated).toBe(true);
      expect(first.messages.map((m) => m.id)).toEqual(['m-4', 'm-3']);
      expect(first.nextBefore).toBe('m-3');
      const older = (await call({ conversationId, before: first.nextBefore })) as Page;
      expect(older.messages.map((m) => m.id)).toEqual(['m-2', 'm-1']);
      const last = (await call({ conversationId, before: older.nextBefore })) as Page;
      expect(last.messages.map((m) => m.id)).toEqual(['m-0']);
      expect(last.truncated).toBe(false);
    }
    expect(
      JSON.stringify(CHIEF_REMOTE_TOOLS.find((t) => t.name === 'conversation')!.parameters),
    ).toContain('before');
  },
);

test('conversation summarises tool payloads and makes progress past an oversized message', async () => {
  seedGate();
  H.s.db
    .insert(message)
    .values([
      {
        id: 'older',
        conversationId: 'gate-build',
        role: 'user',
        content: 'Older text',
        createdAt: 1,
      },
      {
        id: 'large',
        conversationId: 'gate-build',
        role: 'assistant',
        content: 'x'.repeat(100000),
        createdAt: 2,
      },
      {
        id: 'tools',
        conversationId: 'gate-build',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Visible text' },
          { type: 'toolCall', name: 'read', arguments: { secretPayload: 'hidden'.repeat(100000) } },
          {
            kind: 'toolcall',
            call: {
              name: 'shell',
              id: 'shell-call',
              arguments: { command: 'hidden'.repeat(100000) },
              result: 'hidden'.repeat(100000),
              isError: false,
            },
          },
        ],
        createdAt: 3,
      },
    ])
    .run();
  const first = (await relay('conversation', { conversationId: 'gate-build' })) as {
    messages: { id: string; content: string }[];
    nextBefore: string;
    truncated: boolean;
  };
  expect(JSON.stringify(first).length).toBeLessThanOrEqual(60000);
  expect(first.truncated).toBe(true);
  expect(JSON.stringify(first)).toContain('Visible text');
  expect(JSON.stringify(first)).toContain('read');
  expect(JSON.stringify(first)).toContain('shell');
  expect(JSON.stringify(first)).not.toContain('secretPayload');
  const second = (await relay('conversation', {
    conversationId: 'gate-build',
    before: first.nextBefore,
  })) as { messages: { id: string }[] };
  expect(second.messages.length).toBeGreaterThan(0);
});

test('failed gate turn retries once with a fresh plan then posts a visible system line', async () => {
  const { deps, record } = seedGate();
  H.s.db
    .insert(plan)
    .values({ id: 'p', buildId: 'gate-build', version: 1, content: 'First plan', createdAt: 1 })
    .run();
  triggerChiefWakes(deps, record, 'confirm');
  const machineId = insertMachine(H.s);
  const finishDeps = {
    ...H.s.svc,
    box: H.s.secretBox,
    reposDir: H.s.reposDir,
    attachmentsDir: H.s.attachmentsDir,
    skillsDir: H.s.skillsDir,
  };
  async function fail(id: string) {
    H.s.db.update(step).set({ status: 'claimed', machineId }).where(eq(step.id, id)).run();
    await finishStep(finishDeps, machineId, id, {
      status: 'failed',
      errorMessage: 'context_length_exceeded',
    });
  }
  H.s.db.update(plan).set({ content: 'Updated plan' }).where(eq(plan.id, 'p')).run();
  await fail(gateSteps()[0]!.id);
  expect(gateSteps()).toHaveLength(2);
  const retry = gateSteps()[1]!;
  expect(retry.status).toBe('pending');
  expect(retry.prompt).toContain('Updated plan');
  expect(retry.freshSession).toBe(true);
  expect(
    H.s.db.select().from(message).where(eq(message.conversationId, 'gate-build')).all(),
  ).toHaveLength(0);
  await fail(retry.id);
  expect(gateSteps()).toHaveLength(2);
  const lines = H.s.db.select().from(message).where(eq(message.conversationId, 'gate-build')).all();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    role: 'system',
    content: expect.stringMatching(/gate.*needs.*person/i),
  });
});
