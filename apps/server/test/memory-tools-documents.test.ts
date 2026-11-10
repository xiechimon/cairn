import { expect, test } from 'vitest';
import { applyFlush } from '../src/coordinator/memory-flush.js';
import { agentMemory, memoryCandidate } from '../src/db/schema.js';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { memoryPassDue } from '../src/services/memory-consolidation.js';
import { confirmCandidate } from '../src/trajectory-curate.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

type Document = { file: string; scope: string; baseVersion: string; content: string; id: string };
function worker(name: string, params: Record<string, unknown>) {
  return executeWorkerMemoryTool(
    H.s.db,
    {
      teamId: H.teamId,
      agentId: AGENT_ID,
      sourceName: 'worker',
      todoId: 'task',
      projectId: H.projectId,
      buildId: 'build',
      attachmentsDir: H.s.attachmentsDir,
    },
    name,
    params,
  ).then((text) => JSON.parse(text));
}
const paths = ['Coordinator', 'worker'] as const;
function call(path: (typeof paths)[number], name: string, params: Record<string, unknown>) {
  return path === 'Coordinator' ? relay(name, params) : worker(name, params);
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

test('section 4 flush appends to a persisted index rather than creating legacy facts', async () => {
  const before = await read('Coordinator');
  expect(
    applyFlush(
      H.s.db,
      { teamId: H.teamId, threadId: H.threadId },
      JSON.stringify({ memories: [{ title: 'lesson', content: 'keep this' }] }),
    ),
  ).toMatchObject({ saved: 1 });
  const after = await read('Coordinator');
  expect(after.content).toContain('keep this');
  expect(after.baseVersion).not.toBe(before.baseVersion);
});

test('section 4 tidy schedules only indexes beyond the load bound', async () => {
  const index = await read('Coordinator');
  expect(memoryPassDue(H.s.db, H.chiefId, H.teamId, AGENT_ID, Date.now())).toBe(false);
  const result = (await relay('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    content: 'line\n'.repeat(205),
    baseVersion: index.baseVersion,
  })) as Document & { reminder: string };
  expect(result.reminder).toContain('memories');
  expect(memoryPassDue(H.s.db, H.chiefId, H.teamId, AGENT_ID, Date.now())).toBe(true);
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

test('curation returns a file id that survives document reads and injection folds', async () => {
  H.s.db
    .insert(memoryCandidate)
    .values({
      id: 'candidate',
      agentId: AGENT_ID,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'curated'.repeat(300),
      content: 'durable curated lesson',
      buildIds: ['one', 'two'],
      evidence: [],
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const id = confirmCandidate(H.s.db, 'candidate', false);
  await relay('memories', { scope: H.projectId });
  const rows = H.s.db.select().from(agentMemory).all();
  const row = rows.find((r) => r.id === id)!;
  expect(row.title.length).toBeLessThanOrEqual(1024);
  expect(row.layer).toBe('searchable');
  expect(row.invalidAt).toBeNull();
  expect(row.content).toBe('durable curated lesson');
});
