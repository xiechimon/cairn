import type { TaskRequest } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { chiefMessage, step, todo } from '../src/db/schema.js';
import { claimStep } from '../src/services/machine-claim.js';
import { H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { insertMachine, req, seedSessionRoute } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

test('a stored card that still carries the retired quick lane is claimed like an ordinary task', async () => {
  const machineId = insertMachine(H.s);
  seedSessionRoute(H.s, { provider: 'stub-gw', modelId: 'stub-model', machineId });
  const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/channels/${H.projectId}`);
  const threadId = ((await res.json()) as { id: string }).id;
  const words = seedOwnerMessage(H.s.db, threadId, 'add a node.txt that says hello');
  const created = (await relay(
    'create_todo',
    { projectId: H.projectId, messageIds: [words], title: 'Add node.txt' },
    { threadId, conversationId: threadId, turnMessageIds: [words], turnPrompt: 'add it' },
  )) as { id: string };
  const row = H.s.db.select().from(todo).where(eq(todo.id, created.id)).get()!;
  const legacy = {
    ...row.request,
    lane: 'quick',
    projectBasis: { kind: 'channel', threadId },
  } as unknown as TaskRequest;
  H.s.db
    .update(todo)
    .set({ sourceKind: 'github-issue-self', sourceRef: 'acme/demo#1', request: legacy })
    .where(eq(todo.id, created.id))
    .run();
  H.s.db.delete(chiefMessage).where(eq(chiefMessage.id, words)).run();
  H.s.db.delete(step).where(eq(step.kind, 'chief')).run();

  const claimed = await claimStep(toolDeps(), machineId, H.teamId, 0, 'http://localhost');

  expect(claimed).toMatchObject({ todo: { id: created.id } });
});
