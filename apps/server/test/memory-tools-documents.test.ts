import { expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import {
  ensureMemoryIndex,
  injectMemoryDocuments,
  listStoredMemoryEntries,
} from '../src/services/memory.js';
import {
  appendMemoryIndex,
  executeMemoryDocumentTool,
  rememberMemoryFile,
} from '../src/services/memory-documents.js';
import { AGENT_ID, H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

type Document = { file: string; scope: string; baseVersion: string; content: string; id: string };
const paths = ['Coordinator', 'worker'] as const;
async function call(
  path: (typeof paths)[number],
  name: string,
  params: Record<string, unknown>,
  projectId: string | null = null,
) {
  return executeMemoryDocumentTool(
    H.s.db,
    {
      teamId: H.teamId,
      agentId: AGENT_ID,
      projectId: path === 'worker' ? H.projectId : projectId,
      workerScope: path === 'worker',
    },
    name,
    params,
  );
}
const relay = (name: string, params: Record<string, unknown>) => call('Coordinator', name, params);
async function read(path: (typeof paths)[number], file = 'MEMORY.md', scope = 'team') {
  return (await call(path, 'memories', { scope, file })) as Document;
}

function seed(rows: Pick<typeof agentMemory.$inferInsert, 'id' | 'title' | 'content' | 'layer'>[]) {
  H.s.db
    .insert(agentMemory)
    .values(
      rows.map((row, i) => ({
        teamId: H.teamId,
        agentId: AGENT_ID,
        createdAt: i + 1,
        updatedAt: i + 1,
        layer: 'searchable' as const,
        ...row,
      })),
    )
    .run();
}

test.each(paths)('section 4 %s document mutations', async (path) => {
  const operate = async (
    name: string,
    params: Record<string, unknown>,
    scope = 'team',
    file = 'lesson.md',
  ) => (await call(path, name, { scope, file, ...params })) as Document;
  expect(await read(path)).toMatchObject({ file: 'MEMORY.md', content: '' });
  const created = await operate('save_memory', { content: 'first\nmore' });
  const updated = await operate('update_memory', {
    baseVersion: created.baseVersion,
    old_str: 'first',
    new_str: 'second',
  });
  expect(updated.content).toBe('second\nmore');
  const snapshot = H.s.db.select().from(agentMemory).all();
  for (const [name, params, status] of [
    ['delete_memory', { baseVersion: created.baseVersion }, 409],
    ['update_memory', { content: 'missing base' }, 400],
    ['delete_memory', {}, 400],
    ['save_memory', { content: 'occupied' }, 409],
  ] as const) {
    await expect(operate(name, params)).rejects.toMatchObject({ status });
    expect(H.s.db.select().from(agentMemory).all()).toEqual(snapshot);
  }
  for (const [old_str, message] of [
    ['absent', 'not found verbatim'],
    ['o', 'multiple occurrences'],
  ])
    await expect(
      operate('update_memory', { baseVersion: updated.baseVersion, old_str, new_str: '' }),
    ).rejects.toThrow(message);
  await operate('save_memory', { content: 'keep destination' }, H.projectId, 'taken.md');
  for (const change of [{ renameTo: 'MEMORY.md' }, { moveTo: H.projectId, renameTo: 'taken.md' }]) {
    await expect(
      operate('update_memory', { baseVersion: updated.baseVersion, ...change }),
    ).rejects.toMatchObject({ status: change.renameTo === 'MEMORY.md' ? 400 : 409 });
    expect((await read(path, 'lesson.md')).baseVersion).toBe(updated.baseVersion);
  }
  const moved = await operate('update_memory', {
    baseVersion: updated.baseVersion,
    moveTo: H.projectId,
    renameTo: 'moved.md',
  });
  expect(moved).toMatchObject({ scope: H.projectId, file: 'moved.md' });
  const movedFile = (name: string, params: Record<string, unknown>) =>
    operate(name, params, H.projectId, 'moved.md');
  const deleted = await movedFile('delete_memory', { baseVersion: moved.baseVersion });
  await expect(movedFile('save_memory', { content: 'reuse' })).rejects.toMatchObject({
    status: 409,
  });
  const history = (await call(path, 'memories', {
    scope: H.projectId,
    file: 'moved.md',
    versions: 'list',
  })) as { versions: Document[] };
  const original = history.versions.find((v) => v.content === 'first\nmore')!;
  const restored = await movedFile('update_memory', {
    baseVersion: deleted.baseVersion,
    restoreVersion: original.id,
  });
  expect(restored.content).toBe('first\nmore');
  expect(restored.baseVersion).not.toBe(created.baseVersion);
});

test('section 4 memories lists indexes and first lines, searches, and pages escaped UTF-8 under the tool cap', async () => {
  await relay('save_memory', {
    scope: H.projectId,
    file: 'large.md',
    content: '汉"\n'.repeat(30_000),
  });
  const listing = (await call('Coordinator', 'memories', {}, H.projectId)) as {
    documents: Document[];
  };
  expect(listing.documents.filter((d) => d.file === 'MEMORY.md')).toHaveLength(2);
  const page = (await read('Coordinator', 'large.md', H.projectId)) as Document & {
    nextOffset: number;
  };
  expect(page.nextOffset).toBeGreaterThan(0);
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(32 * 1024);
  const next = (await relay('memories', {
    scope: H.projectId,
    file: 'large.md',
    offset: page.nextOffset,
  })) as Document;
  expect(next.content).not.toContain('\ufffd');
  const found = (await relay('memories', { scope: H.projectId, query: 'large' })) as {
    documents: Document[];
  };
  expect(found.documents.map((d) => d.file)).toEqual(['large.md']);
});

test('literal JSON-shaped Markdown is preserved verbatim after index writes', async () => {
  const before = await read('Coordinator');
  const content =
    '- {"id":"literal","title":"literal","content":"text","fileId":null,"createdAt":1,"updatedAt":1,"lastInjectedAt":null,"history":[],"source":null,"sourceTodoId":null,"sourceBuildId":null}';
  await relay('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: before.baseVersion,
    content,
  });
  expect((await read('Coordinator')).content).toBe(content);
});

test.each(['duplicate.md', 'MEMORY.md'])(
  'legacy title collision: %s stays addressable',
  async (title) => {
    const titles = title === 'MEMORY.md' ? [title] : [title, title];
    seed(titles.map((title, i) => ({ id: `legacy-${i}`, title, content: `legacy content ${i}` })));
    ensureMemoryIndex(H.s.db, { teamId: H.teamId, agentId: AGENT_ID, projectId: null });
    const documents = listStoredMemoryEntries(H.s.db, { teamId: H.teamId, agentId: AGENT_ID });
    expect(new Set(documents.map((d) => d.title)).size).toBe(documents.length);
    for (let i = 0; i < titles.length; i++) {
      const file = documents.find((d) => d.id === `legacy-${i}`)!;
      expect(file.title).not.toBe('MEMORY.md');
      expect(await read('Coordinator', file.title)).toMatchObject({
        id: file.id,
        content: `legacy content ${i}`,
      });
    }
    const snapshot = H.s.db.select().from(agentMemory).all();
    await relay('memories', { scope: 'team' });
    expect(H.s.db.select().from(agentMemory).all()).toEqual(snapshot);
  },
);

test('internal append and curation retain detail files and their identities', async () => {
  const owner = { teamId: H.teamId, agentId: AGENT_ID, projectId: null };
  expect(appendMemoryIndex(H.s.db, owner, 'lesson', 'keep this')).toBe(true);
  expect(appendMemoryIndex(H.s.db, owner, 'lesson', 'keep this')).toBe(false);
  appendMemoryIndex(H.s.db, owner, 'detail.md', 'first\nsecond');
  expect((await read('Coordinator', 'detail.md')).content).toBe('first\nsecond');
  const saved = rememberMemoryFile(H.s.db, owner, 'curated'.repeat(300), 'durable lesson');
  await relay('memories', { scope: 'team' });
  injectMemoryDocuments(H.s.db, owner);
  const row = H.s.db
    .select()
    .from(agentMemory)
    .all()
    .find((r) => r.id === saved.id)!;
  expect(row.title.length).toBeLessThanOrEqual(1024);
  expect(row).toMatchObject({ layer: 'searchable', invalidAt: null, content: 'durable lesson' });
  const index = await read('Coordinator');
  const updated = (await relay('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: index.baseVersion,
    content: 'line\n'.repeat(205),
  })) as Document & { reminder: string };
  expect(updated.reminder).toContain('memories');
});

test('fold allocates around literal suffixes and rewrites multiline fact references', async () => {
  const rows = [
    { id: 'literal', title: 'topic (2).md', content: 'literal', layer: 'searchable' as const },
    { id: 'file', title: 'topic.md', content: 'existing', layer: 'searchable' as const },
    { id: 'fact', title: 'topic.md', content: 'first\nsecond', layer: 'core' as const },
    { id: 'reserved', title: 'MEMORY.md', content: 'reserved', layer: 'log' as 'searchable' },
  ];
  seed(rows);
  const listing = (await relay('memories', { scope: 'team' })) as { documents: Document[] };
  expect(listing.documents.map((d) => d.file).sort()).toEqual(
    ['MEMORY (2).md', 'MEMORY.md', 'topic (2).md', 'topic (3).md', 'topic.md'].sort(),
  );
  expect((await read('Coordinator', 'topic (3).md')).content).toBe('first\nsecond');
  expect((await read('Coordinator')).content).toContain('topic (3).md');
  expect((await read('Coordinator', 'topic (2).md')).content).toBe('literal');
  const snapshot = H.s.db.select().from(agentMemory).all();
  await relay('memories', { scope: 'team' });
  expect(H.s.db.select().from(agentMemory).all()).toEqual(snapshot);
});

test('reserved index mutations and ambiguous edits leave persisted rows unchanged', async () => {
  const index = await read('Coordinator');
  const snapshot = H.s.db.select().from(agentMemory).all();
  for (const [name, params] of [
    ['save_memory', { content: '' }],
    ['delete_memory', { baseVersion: index.baseVersion }],
    [
      'update_memory',
      { baseVersion: index.baseVersion, content: 'two', old_str: 'one', new_str: 'two' },
    ],
  ] as const) {
    await expect(
      relay(name, { scope: 'team', file: 'MEMORY.md', ...params }),
    ).rejects.toMatchObject({ status: 400 });
    expect(H.s.db.select().from(agentMemory).all()).toEqual(snapshot);
  }
});

test('independent document stores stay isolated and workers reject foreign projects', async () => {
  const owner = { teamId: H.teamId, agentId: AGENT_ID, projectId: null, teamScoped: false };
  executeMemoryDocumentTool(H.s.db, owner, 'save_memory', {
    scope: 'team',
    file: 'private.md',
    content: 'private',
  });
  await relay('save_memory', { scope: 'team', file: 'private.md', content: 'team' });
  expect((await read('worker', 'private.md')).content).toBe('team');
  expect(
    executeMemoryDocumentTool(H.s.db, owner, 'memories', { scope: 'team', file: 'private.md' }),
  ).toMatchObject({ content: 'private' });
  await expect(call('worker', 'memories', { scope: 'foreign' })).rejects.toMatchObject({
    status: 404,
  });
});

test('late legacy multiline facts keep distinct files beside an existing Markdown index', async () => {
  const index = await read('Coordinator');
  await relay('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: index.baseVersion,
    content: '- existing text',
  });
  seed(
    [1, 2].map((n) => ({
      id: `late-${n}`,
      title: 'late.md',
      content: `detail ${n}\nsecond`,
      layer: 'core' as const,
    })),
  );
  const listing = (await relay('memories', { scope: 'team' })) as { documents: Document[] };
  expect(listing.documents.filter((d) => d.file !== 'MEMORY.md')).toHaveLength(2);
  for (const file of listing.documents.filter((d) => d.file !== 'MEMORY.md')) {
    expect((await read('Coordinator', file.file)).content).toMatch(/^detail [12]\nsecond$/);
    expect((await read('Coordinator')).content).toContain(`记忆文件：${file.file}`);
  }
});

test.each(
  ['x'.repeat(1024), 'x'.repeat(1025), 'line\nbreak', 'carriage\rreturn', 'nul\0byte', ''].flatMap(
    (title) => ['searchable', 'log', 'core'].map((layer) => ({ title, layer })),
  ),
)('legacy invalid file name $title in $layer becomes reachable', async ({ title, layer }) => {
  seed(
    [title, title].map((title, i) => ({
      id: `invalid-${i}`,
      title,
      content: `content ${i}\ndetail`,
      layer: layer as 'searchable',
    })),
  );
  const listing = (await relay('memories', { scope: 'team' })) as { documents: Document[] };
  const files = listing.documents.filter((d) => d.file !== 'MEMORY.md');
  expect(files).toHaveLength(2);
  for (const file of files) {
    const document = await read('Coordinator', file.file);
    expect(document.content).toMatch(/^content [01]\ndetail$/);
    const updated = (await relay('update_memory', {
      scope: 'team',
      file: file.file,
      content: 'updated',
      baseVersion: document.baseVersion,
    })) as Document;
    await relay('delete_memory', {
      scope: 'team',
      file: file.file,
      baseVersion: updated.baseVersion,
    });
  }
  const snapshot = H.s.db.select().from(agentMemory).all();
  await relay('memories', { scope: 'team' });
  expect(H.s.db.select().from(agentMemory).all()).toEqual(snapshot);
});
