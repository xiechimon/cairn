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
function relay(
  name: string,
  params: Record<string, unknown>,
  over?: { turnScopeProjectId: string },
) {
  return call('Coordinator', name, params, over?.turnScopeProjectId ?? null);
}
async function read(path: (typeof paths)[number], file = 'MEMORY.md', scope = 'team') {
  return (await call(path, 'memories', { scope, file })) as Document;
}

test.each(paths)('section 4 %s document mutations', async (path) => {
  const lesson = (name: string, params: Record<string, unknown>) =>
    call(path, name, { scope: 'team', file: 'lesson.md', ...params });
  const index = await read(path);
  expect(index).toMatchObject({ file: 'MEMORY.md', content: '' });
  const created = (await lesson('save_memory', {
    content: 'first\nmore',
  })) as Document;
  const updated = (await lesson('update_memory', {
    baseVersion: created.baseVersion,
    old_str: 'first',
    new_str: 'second',
  })) as Document;
  expect(updated.content).toBe('second\nmore');
  await expect(
    lesson('delete_memory', {
      baseVersion: created.baseVersion,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    lesson('update_memory', {
      baseVersion: updated.baseVersion,
      old_str: 'absent',
      new_str: '',
    }),
  ).rejects.toThrow('not found verbatim');
  await call(path, 'save_memory', {
    scope: H.projectId,
    file: 'taken.md',
    content: 'keep destination',
  });
  for (const change of [{ renameTo: 'MEMORY.md' }, { moveTo: H.projectId, renameTo: 'taken.md' }]) {
    await expect(
      lesson('update_memory', {
        baseVersion: updated.baseVersion,
        ...change,
      }),
    ).rejects.toMatchObject({ status: change.renameTo === 'MEMORY.md' ? 400 : 409 });
    expect((await read(path, 'lesson.md')).baseVersion).toBe(updated.baseVersion);
  }
  await expect(
    lesson('update_memory', {
      baseVersion: updated.baseVersion,
      old_str: 'o',
      new_str: '',
    }),
  ).rejects.toThrow('multiple occurrences');
  const moved = (await lesson('update_memory', {
    baseVersion: updated.baseVersion,
    moveTo: H.projectId,
    renameTo: 'moved.md',
  })) as Document;
  expect(moved).toMatchObject({ scope: H.projectId, file: 'moved.md' });
  const deleted = (await call(path, 'delete_memory', {
    scope: H.projectId,
    file: 'moved.md',
    baseVersion: moved.baseVersion,
  })) as Document;
  await expect(
    call(path, 'save_memory', { scope: H.projectId, file: 'moved.md', content: 'reuse' }),
  ).rejects.toMatchObject({ status: 409 });
  const versions = (await call(path, 'memories', {
    scope: H.projectId,
    file: 'moved.md',
    versions: 'list',
  })) as { versions: { id: string; content: string }[] };
  const original = versions.versions.find((v) => v.content === 'first\nmore')!;
  expect(original).toBeTruthy();
  const restored = (await call(path, 'update_memory', {
    scope: H.projectId,
    file: 'moved.md',
    baseVersion: deleted.baseVersion,
    restoreVersion: original.id,
  })) as Document;
  expect(restored.content).toBe('first\nmore');
  expect(restored.baseVersion).not.toBe(created.baseVersion);
});

test('section 4 memories lists indexes and first lines, searches, and pages escaped UTF-8 under the tool cap', async () => {
  await relay('save_memory', {
    scope: H.projectId,
    file: 'large.md',
    content: '汉"\n'.repeat(30_000),
  });
  const listing = (await relay('memories', {}, { turnScopeProjectId: H.projectId })) as {
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
    H.s.db
      .insert(agentMemory)
      .values(
        titles.map((title, i) => ({
          id: `legacy-${i}`,
          teamId: H.teamId,
          agentId: AGENT_ID,
          projectId: null,
          title,
          content: `legacy content ${i}`,
          layer: 'searchable' as const,
          createdAt: i + 1,
          updatedAt: i + 1,
        })),
      )
      .run();
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
      expect(documents.filter((d) => d.title === file.title)).toMatchObject([
        { id: file.id, content: `legacy content ${i}` },
      ]);
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
  H.s.db
    .insert(agentMemory)
    .values(
      rows.map((row, i) => ({
        ...row,
        teamId: H.teamId,
        agentId: AGENT_ID,
        createdAt: i + 1,
        updatedAt: i + 1,
      })),
    )
    .run();
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

test('document mutations validate revisions and reserve names without changing rejected writes', async () => {
  const created = (await relay('save_memory', {
    scope: 'team',
    file: 'file',
    content: 'one',
  })) as Document;
  const snapshot = H.s.db.select().from(agentMemory).all();
  for (const [name, params, status] of [
    ['save_memory', { content: 'two' }, 409],
    ['update_memory', { content: 'two' }, 400],
    ['delete_memory', {}, 400],
    ['update_memory', { content: 'two', baseVersion: 'stale' }, 409],
    [
      'update_memory',
      { content: 'two', old_str: 'one', new_str: 'two', baseVersion: created.baseVersion },
      400,
    ],
  ] as const) {
    await expect(relay(name, { scope: 'team', file: 'file', ...params })).rejects.toMatchObject({
      status,
    });
    expect(H.s.db.select().from(agentMemory).all()).toEqual(snapshot);
  }
  await expect(
    relay('save_memory', { scope: 'team', file: 'MEMORY.md', content: '' }),
  ).rejects.toMatchObject({ status: 400 });
  const index = await read('Coordinator');
  await expect(
    relay('delete_memory', { scope: 'team', file: 'MEMORY.md', baseVersion: index.baseVersion }),
  ).rejects.toMatchObject({ status: 400 });
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
  H.s.db
    .insert(agentMemory)
    .values(
      [1, 2].map((n) => ({
        id: `late-${n}`,
        teamId: H.teamId,
        agentId: AGENT_ID,
        title: 'late.md',
        content: `detail ${n}\nsecond`,
        createdAt: n,
        updatedAt: n,
      })),
    )
    .run();
  const listing = (await relay('memories', { scope: 'team' })) as { documents: Document[] };
  expect(listing.documents.filter((d) => d.file !== 'MEMORY.md')).toHaveLength(2);
  for (const file of listing.documents.filter((d) => d.file !== 'MEMORY.md')) {
    expect((await read('Coordinator', file.file)).content).toMatch(/^detail [12]\nsecond$/);
    expect((await read('Coordinator')).content).toContain(`记忆文件：${file.file}`);
  }
});
