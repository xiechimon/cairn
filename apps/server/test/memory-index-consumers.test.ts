import { MEMORY_INDEX_TITLE } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import {
  foldMemoryIndexes,
  injectMemoriesCapped,
  listMemoryEntries,
  memoriesInScope,
} from '../src/services/memory.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

async function document() {
  await relay('save_memory', { title: 'release', content: 'Use squash merges.' });
  await relay('save_memory', { title: 'review', content: 'Attach acceptance proof.' });
  foldMemoryIndexes(H.s.db);
  const rows = listMemoryEntries(H.s.db, { agentId: AGENT_ID, teamId: H.teamId });
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row.title).toBe(MEMORY_INDEX_TITLE);
  return row;
}

test('injection and REST serialization preserve all facts in the document and stamp its use', async () => {
  const row = await document();
  const scope = { agentId: AGENT_ID, teamId: H.teamId, projectId: null };
  const injected = injectMemoriesCapped(H.s.db, scope, Number.POSITIVE_INFINITY);
  expect(injected).toEqual({
    memories: [{ id: row.id, title: MEMORY_INDEX_TITLE, content: row.content }],
    omitted: 0,
  });
  const response = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/memories`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject([
    {
      id: row.id,
      title: MEMORY_INDEX_TITLE,
      content: row.content,
      lastInjectedAt: expect.any(Number),
    },
  ]);
});

test('fact comparisons expand document lines and appended core facts survive the next fold', async () => {
  const row = await document();
  const facts = H.s.db.transaction((tx) =>
    memoriesInScope(tx, { agentId: AGENT_ID, teamId: H.teamId, projectId: null }),
  );
  expect(facts.map(({ title, content }) => ({ title, content }))).toEqual([
    { title: 'release', content: 'Use squash merges.' },
    { title: 'review', content: 'Attach acceptance proof.' },
  ]);
  await expect(
    relay('save_memory', { title: 'release', content: 'Use squash merges.' }),
  ).rejects.toMatchObject({ status: 409 });
  await relay('save_memory', {
    title: 'focus',
    content: 'Check keyboard navigation.',
    force: true,
  });
  foldMemoryIndexes(H.s.db);
  const rows = listMemoryEntries(H.s.db, { agentId: AGENT_ID, teamId: H.teamId });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.content).toBe(`${row.content}\n- focus：Check keyboard navigation.`);
});

test('an explicit document update versions the full content and rejects its stale predecessor', async () => {
  const row = await document();
  const content = `${row.content}\n- focus：Check keyboard navigation.`;
  const updated = (await relay('update_memory', { memoryId: row.id, content })) as { id: string };
  expect(listMemoryEntries(H.s.db, { agentId: AGENT_ID, teamId: H.teamId })).toMatchObject([
    { id: updated.id, title: MEMORY_INDEX_TITLE, content },
  ]);
  expect(H.s.db.select().from(agentMemory).where(eq(agentMemory.id, row.id)).get()).toMatchObject({
    content: row.content,
    supersededBy: updated.id,
  });
  await expect(
    relay('update_memory', { memoryId: row.id, content: 'stale' }),
  ).rejects.toMatchObject({
    status: 409,
  });
});

test('explicit REST deletion removes the addressed document while retaining superseded versions', async () => {
  const row = await document();
  const response = await req(H.s.app, 'DELETE', `/api/teams/${H.teamId}/memories/${row.id}`);
  expect(response.status).toBe(204);
  expect(listMemoryEntries(H.s.db, { agentId: AGENT_ID, teamId: H.teamId })).toEqual([]);
  expect(listMemoryEntries(H.s.db, { agentId: AGENT_ID, teamId: H.teamId }, true)).toHaveLength(2);
});
