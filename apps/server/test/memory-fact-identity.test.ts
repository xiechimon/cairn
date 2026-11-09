import { MEMORY_INDEX_TITLE, MEMORY_QUOTA_PER_TEAM } from '@cairn/shared';
import { expect, test } from 'vitest';
import {
  foldMemoryIndexes,
  isMemoryIndex,
  listStoredMemoryEntries,
  MEMORY_VERSION_RETENTION_MS,
  memoriesInScope,
  purgeExpiredMemoryVersions,
  saveMemoryEntry,
  updateMemoryEntry,
} from '../src/services/memory.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();
const scope = () => ({ agentId: AGENT_ID, teamId: H.teamId, projectId: null });
const facts = () => H.s.db.transaction((tx) => memoriesInScope(tx, scope()));
const save = async (title: string, content: string) =>
  saveMemoryEntry(H.s.db, {
    ...scope(),
    title,
    content,
    force: true,
    sourceTodoId: null,
    sourceBuildId: null,
  }) as { id: string };

test('fact IDs survive folding and retention in the active REST response used by digest cards', async () => {
  const first = await save('release', 'Squash only.');
  const second = await save('proof', 'Attach evidence.');
  foldMemoryIndexes(H.s.db, 10_000);
  purgeExpiredMemoryVersions(H.s.db, 10_001 + MEMORY_VERSION_RETENTION_MS);
  const response = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/memories`);
  expect(response.status).toBe(200);
  const listed = (await response.json()) as { id: string }[];
  expect(listed.map((row) => row.id)).toEqual([first.id, second.id]);
  expect(() =>
    updateMemoryEntry(H.s.db, {
      ...scope(),
      teamId: 'other-team',
      memoryId: first.id,
      content: 'unauthorized',
    }),
  ).toThrow('memory');
});

test.each(['DB：prod', 'two\nlines', 'quotes " and \\ <!-- -->', ''])(
  'titles round-trip for fact comparison: %s',
  async (title) => {
    const saved = await save(title, 'Unique exact content.');
    foldMemoryIndexes(H.s.db);
    expect(facts()).toMatchObject([{ id: saved.id, title, content: 'Unique exact content.' }]);
    await expect(save('same', 'Unique exact content.')).rejects.toMatchObject({ status: 409 });
  },
);

test('MEMORY.md is a valid ordinary fact title, never a document discriminator', async () => {
  const saved = await save(MEMORY_INDEX_TITLE, 'A real user preference.');
  expect(isMemoryIndex(H.s.db, saved.id)).toBe(false);
  foldMemoryIndexes(H.s.db);
  expect(facts()).toMatchObject([
    { id: saved.id, title: MEMORY_INDEX_TITLE, content: 'A real user preference.' },
  ]);
});

test('forgetting a retained fact removes only that fact after its original row has been purged', async () => {
  const first = await save('release', 'Squash only.');
  const second = await save('proof', 'Attach evidence.');
  foldMemoryIndexes(H.s.db, 10_000);
  purgeExpiredMemoryVersions(H.s.db, 10_001 + MEMORY_VERSION_RETENTION_MS);
  expect((await req(H.s.app, 'DELETE', `/api/teams/${H.teamId}/memories/${first.id}`)).status).toBe(
    204,
  );
  expect(facts()).toMatchObject([{ id: second.id, content: 'Attach evidence.' }]);
  expect(facts()).toHaveLength(1);
});

test('fact updates version just that fact and leave sibling references intact', async () => {
  const first = await save('release', 'Squash only.');
  const second = await save('proof', 'Attach evidence.');
  foldMemoryIndexes(H.s.db);
  const updated = (await relay('update_memory', {
    memoryId: first.id,
    content: 'Use merge commits.',
  })) as { id: string; createdAt: number; updatedAt: number };
  expect(updated.id).not.toBe(first.id);
  expect(updated.createdAt).toBe(updated.updatedAt);
  const document = listStoredMemoryEntries(H.s.db, scope()).find((row) => row.layer === 'core')!;
  await expect(
    relay('update_memory', { memoryId: document.id, content: 'not an encoded index' }),
  ).rejects.toMatchObject({ status: 400 });
  expect(facts()).toMatchObject([
    { id: updated.id, content: 'Use merge commits.' },
    { id: second.id, content: 'Attach evidence.' },
  ]);
  await expect(
    relay('update_memory', { memoryId: first.id, content: 'stale' }),
  ).rejects.toMatchObject({ status: 409 });
});

test('multiline facts stay lossless through repeated folds and file edits', async () => {
  const first = await save('DB：prod\nnotes', 'first\nsecond\n');
  foldMemoryIndexes(H.s.db);
  expect(facts()).toMatchObject([{ id: first.id, content: 'first\nsecond\n' }]);
  const response = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/memories`);
  expect(await response.json()).toHaveLength(1);
  const file = listStoredMemoryEntries(H.s.db, scope()).find((row) => row.layer === 'searchable')!;
  const updated = (await relay('update_memory', {
    memoryId: file.id,
    content: 'edited\nfile',
  })) as { id: string };
  foldMemoryIndexes(H.s.db);
  expect(facts()).toMatchObject([
    { id: updated.id, title: 'DB：prod\nnotes', content: 'edited\nfile' },
  ]);
});

test('promotion retains the fact ID referenced by digest and trajectory rows', async () => {
  const saved = (await relay('save_memory', {
    title: 'project',
    content: 'one\ntwo',
    projectId: H.projectId,
    force: true,
  })) as { id: string };
  await save('team', 'A sibling fact.');
  foldMemoryIndexes(H.s.db);
  const file = listStoredMemoryEntries(H.s.db, scope()).find((row) => row.layer === 'searchable')!;
  const response = await req(
    H.s.app,
    'POST',
    `/api/teams/${H.teamId}/memories/${saved.id}/promote`,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: saved.id, projectId: null });
  expect(facts().find((row) => row.id === saved.id)).toMatchObject({
    content: 'one\ntwo',
    projectId: null,
  });
  expect(facts()).toHaveLength(2);
  expect(
    listStoredMemoryEntries(H.s.db, scope(), true).find((row) => row.id === file.id),
  ).toMatchObject({ invalidAt: expect.any(Number) });
});

test('folded facts still occupy the existing team quota', async () => {
  for (let i = 0; i < MEMORY_QUOTA_PER_TEAM; i++) await save(`fact ${i}`, `content ${i}`);
  foldMemoryIndexes(H.s.db);
  await expect(save('extra', 'Over quota.')).rejects.toMatchObject({ status: 409 });
});
