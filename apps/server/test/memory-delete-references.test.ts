import { expect, test } from 'vitest';
import { agentMemory, memoryCandidate } from '../src/db/schema.js';
import { injectMemoryDocuments } from '../src/services/memory.js';
import {
  appendMemoryIndex,
  executeMemoryDocumentTool,
  rememberMemoryFile,
} from '../src/services/memory-documents.js';
import { confirmCandidate } from '../src/trajectory-curate.js';
import { AGENT_ID, H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

type Document = { id: string; file: string; baseVersion: string; content: string };
const owner = (projectId: string | null = null) => ({
  teamId: H.teamId,
  agentId: AGENT_ID,
  projectId,
});
const index = (projectId: string | null = null) =>
  executeMemoryDocumentTool(H.s.db, owner(projectId), 'memories', {
    scope: projectId ?? 'team',
    file: 'MEMORY.md',
  }) as Document;
const writeIndex = (content: string) =>
  executeMemoryDocumentTool(H.s.db, owner(), 'update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: index().baseVersion,
    content,
  });
const forget = (id: string) => req(H.s.app, 'DELETE', `/api/teams/${H.teamId}/memories/${id}`);
const injected = (projectId: string | null = null) =>
  injectMemoryDocuments(H.s.db, { ...owner(projectId), projectOnly: projectId !== null })
    .memories[0]!.content;

const writers = {
  digest: () => ({
    projectId: null,
    label: 'ship on Fridays only',
    id: rememberMemoryFile(
      H.s.db,
      { ...owner(), source: 'digest', sourceBuildId: 'thread' },
      'ship on Fridays only',
      'ship on Fridays only after the smoke run',
    ).id,
  }),
  curation: () => {
    H.s.db
      .insert(memoryCandidate)
      .values({
        id: 'candidate',
        agentId: AGENT_ID,
        teamId: H.teamId,
        projectId: H.projectId,
        title: 'curated lesson',
        content: 'durable curated lesson',
        buildIds: ['one', 'two'],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    return {
      projectId: H.projectId,
      label: 'curated lesson',
      id: confirmCandidate(H.s.db, 'candidate') as string,
    };
  },
  'spilled flush': () => {
    appendMemoryIndex(H.s.db, owner(), 'flushed detail', 'first line\nsecond line');
    const file = H.s.db
      .select()
      .from(agentMemory)
      .all()
      .find((row) => row.content === 'first line\nsecond line')!;
    return { projectId: null, label: 'flushed detail', id: file.id };
  },
};

test.each(Object.keys(writers) as (keyof typeof writers)[])(
  'forgetting a %s file through REST removes its generated index reference',
  async (writer) => {
    const { id, label, projectId } = writers[writer]();
    appendMemoryIndex(H.s.db, owner(projectId), 'sibling', 'stays in the index');
    const before = index(projectId);
    expect(before.content).toContain(`- [${label}](`);
    expect((await forget(id)).status).toBe(204);
    expect(injected(projectId)).toBe('- sibling：stays in the index');
    expect(index(projectId).baseVersion).not.toBe(before.baseVersion);
    expect((await forget(id)).status).toBe(404);
  },
);

test('forgetting a file drops generated lines only and leaves hand-written mentions', async () => {
  const kept = rememberMemoryFile(H.s.db, owner(), 'kept', 'kept detail');
  const gone = rememberMemoryFile(H.s.db, owner(), 'gone', 'gone detail');
  const handWritten = [
    '- deploy notes live in [gone](gone) and nowhere else',
    '- [kept](kept) and [gone](gone)',
    'see [gone](gone)',
  ];
  writeIndex(
    [
      '- [kept](kept)',
      '- [gone](gone)',
      '- release：squash only（记忆文件：gone）',
      ...handWritten,
    ].join('\n'),
  );
  expect((await forget(gone.id)).status).toBe(204);
  expect(injected()).toBe(['- [kept](kept)', ...handWritten].join('\n'));
  expect(
    executeMemoryDocumentTool(H.s.db, owner(), 'memories', { scope: 'team', file: 'kept' }),
  ).toMatchObject({ id: kept.id });
});

test('forgetting a superseded version keeps the reference to the live file', async () => {
  const first = rememberMemoryFile(H.s.db, owner(), 'lesson', 'first text') as Document;
  const second = executeMemoryDocumentTool(H.s.db, owner(), 'update_memory', {
    scope: 'team',
    file: first.file,
    baseVersion: first.baseVersion,
    content: 'second text',
  }) as Document;
  const before = index();
  expect((await forget(first.id)).status).toBe(204);
  expect(index()).toMatchObject({ content: before.content, baseVersion: before.baseVersion });
  expect((await forget(second.id)).status).toBe(204);
  expect(injected()).toBe('');
});

test('forgetting a file leaves another scope with the same file name untouched', async () => {
  const team = rememberMemoryFile(H.s.db, owner(), 'shared', 'team detail');
  rememberMemoryFile(H.s.db, owner(H.projectId), 'shared', 'project detail');
  expect((await forget(team.id)).status).toBe(204);
  expect(injected()).toBe('');
  expect(injected(H.projectId)).toBe('- [shared](shared)');
});
