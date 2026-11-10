import { MEMORY_INDEX_ID_PREFIX } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import {
  deleteMemoryEntry,
  foldMemoryIndexes,
  listMemoryEntries,
  listStoredMemoryEntries,
  MEMORY_VERSION_RETENTION_MS,
  promoteMemoryEntry,
  purgeExpiredMemoryVersions,
  updateMemoryEntry,
} from '../src/services/memory.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();
const scope = () => ({ agentId: AGENT_ID, teamId: H.teamId, projectId: null });
function put(id: string, updatedAt: number, projectId: string | null = null, multiline = false) {
  return H.s.db
    .insert(agentMemory)
    .values({
      ...scope(),
      id,
      title: id,
      content: 'x'.repeat(300) + (multiline ? '\nbody' : ''),
      projectId,
      createdAt: updatedAt,
      updatedAt,
      source: 'fixture',
      sourceTodoId: 'source-todo',
      history: [{ title: id, content: 'previous', updatedAt: 0 }],
      lastInjectedAt: 1,
    })
    .returning()
    .get();
}
function foldAndPurge() {
  foldMemoryIndexes(H.s.db, 10_000);
  purgeExpiredMemoryVersions(H.s.db, 10_001 + MEMORY_VERSION_RETENTION_MS);
}

test('every REST history flag and chief/worker tool lists active logical facts exactly once', async () => {
  const original = put('fact', 1, null, true);
  foldMemoryIndexes(H.s.db, 10_000);
  for (const suffix of ['', '?includeInvalid=false', '?includeInvalid=true']) {
    const response = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/memories${suffix}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([
      { id: 'fact', invalidAt: null, content: original.content },
    ]);
    expect(listMemoryEntries(H.s.db, scope(), suffix.endsWith('true'))).toHaveLength(1);
  }
  foldAndPurge();
  const params = { scope: 'team' };
  expect(await relay('memories', params)).toMatchObject({
    documents: [{ file: 'fact' }, { file: 'MEMORY.md' }],
  });
  const worker = JSON.parse(
    await executeWorkerMemoryTool(
      H.s.db,
      {
        ...scope(),
        todoId: H.threadId,
        buildId: 'build',
        sourceName: null,
        attachmentsDir: H.s.attachmentsDir,
      },
      'memories',
      params,
    ),
  );
  expect(worker.documents).toHaveLength(2);
});

test('projection preserves fact sources, dates and history instead of document metadata', () => {
  const original = put('fact', 1);
  put('other', 8);
  foldMemoryIndexes(H.s.db);
  expect(listMemoryEntries(H.s.db, scope()).find((r) => r.id === 'fact')).toMatchObject({
    createdAt: original.createdAt,
    updatedAt: original.updatedAt,
    source: original.source,
    sourceTodoId: original.sourceTodoId,
    history: original.history,
    lastInjectedAt: original.lastInjectedAt,
  });
});

test('updated and deleted virtual versions remain fact-level history after original rows expire', () => {
  put('first', 1, null, true);
  put('sibling', 2);
  foldAndPurge();
  const next = updateMemoryEntry(H.s.db, { ...scope(), memoryId: 'first', content: 'new\nbody' });
  deleteMemoryEntry(H.s.db, { ...scope(), memoryId: next.id });
  const rows = listMemoryEntries(H.s.db, scope(), true);
  expect(rows.some((r) => r.id.startsWith(MEMORY_INDEX_ID_PREFIX))).toBe(false);
  expect(rows).toHaveLength(3);
  expect(rows.find((r) => r.id === 'first')).toMatchObject({
    content: `${'x'.repeat(300)}\nbody`,
    invalidAt: expect.any(Number),
    supersededBy: next.id,
  });
  expect(rows.find((r) => r.id === next.id)).toMatchObject({
    content: 'new\nbody',
    invalidAt: expect.any(Number),
    supersededBy: null,
  });
  expect(rows.find((r) => r.id === 'sibling')).toMatchObject({
    invalidAt: null,
    history: [],
  });
  expect(
    H.s.db.select().from(agentMemory).where(eq(agentMemory.id, 'first')).get()?.supersededBy,
  ).toBe(next.id);
});

test('retention trims fact history inside active documents without losing current content', () => {
  put('fact', 1);
  foldMemoryIndexes(H.s.db, 10_000);
  purgeExpiredMemoryVersions(H.s.db, 10_001 + MEMORY_VERSION_RETENTION_MS);
  expect(listMemoryEntries(H.s.db, scope())[0]).toMatchObject({
    id: 'fact',
    history: [],
    content: 'x'.repeat(300),
  });
});

test.each([
  ['delete', deleteMemoryEntry],
  ['promote', promoteMemoryEntry],
] as const)(
  'stale internal document IDs cannot mutate a whole scope (%s)',
  (_operation, mutate) => {
    put('fact', 1, H.projectId);
    foldMemoryIndexes(H.s.db);
    const document = listStoredMemoryEntries(H.s.db, scope()).find((r) =>
      r.id.startsWith(MEMORY_INDEX_ID_PREFIX),
    )!;
    expect(() => mutate(H.s.db, { ...scope(), memoryId: document.id })).toThrow('managed');
    expect(listMemoryEntries(H.s.db, scope())).toMatchObject([
      { id: 'fact', projectId: H.projectId },
    ]);
  },
);
