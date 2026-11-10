import { expect, test } from 'vitest';
import { applyFlush, flushPrompt } from '../src/coordinator/memory-flush.js';
import { agentMemory, memoryCandidate, project } from '../src/db/schema.js';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { injectMemoryDocuments } from '../src/services/memory.js';
import { memoryPassDue } from '../src/services/memory-consolidation.js';
import {
  appendMemoryIndex,
  executeMemoryDocumentTool,
  rememberMemoryFile,
} from '../src/services/memory-documents.js';
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

test.each(paths)('injected baseVersion updates the index through %s', async (path) => {
  const injected = injectMemoryDocuments(H.s.db, {
    teamId: H.teamId,
    agentId: AGENT_ID,
    projectId: null,
  }).memories.find((row) => row.title === 'MEMORY.md')!;
  const updated = (await call(path, 'update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: injected.baseVersion,
    content: '- updated',
  })) as Document;
  expect(updated.content).toBe('- updated');
  expect((await read(path)).baseVersion).toBe(updated.baseVersion);
});
test('injected revision is accepted by the document API', () => {
  const owner = { teamId: H.teamId, agentId: AGENT_ID, projectId: null };
  const injected = injectMemoryDocuments(H.s.db, owner).memories[0]!;
  expect(
    executeMemoryDocumentTool(H.s.db, owner, 'update_memory', {
      scope: 'team',
      file: 'MEMORY.md',
      baseVersion: injected.baseVersion,
      content: '- direct',
    }),
  ).toMatchObject({ content: '- direct' });
});
test.each(['MEMORY.md', 'duplicate.md', 'bad\nname\0.md', 'x'.repeat(1200)])(
  'internal callers allocate reachable files for %s',
  (title) => {
    const owner = { teamId: H.teamId, agentId: AGENT_ID, projectId: null };
    const first = rememberMemoryFile(H.s.db, owner, title, 'first file');
    expect(appendMemoryIndex(H.s.db, owner, title, 'second\nfile')).toBe(true);
    expect(appendMemoryIndex(H.s.db, owner, title, 'second\nfile')).toBe(false);
    const { documents } = executeMemoryDocumentTool(H.s.db, owner, 'memories', {
      scope: 'team',
    }) as { documents: Document[] };
    expect(new Set(documents.map((row) => row.file)).size).toBe(documents.length);
    expect(documents.some((row) => row.id === first.id)).toBe(true);
    for (const row of documents.filter((row) => row.file !== 'MEMORY.md')) {
      expect(
        executeMemoryDocumentTool(H.s.db, owner, 'memories', { scope: 'team', file: row.file }),
      ).toMatchObject({ id: row.id });
    }
  },
);

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
  const id = confirmCandidate(H.s.db, 'candidate');
  await relay('memories', { scope: H.projectId });
  const rows = H.s.db.select().from(agentMemory).all();
  const row = rows.find((r) => r.id === id)!;
  expect(row.title.length).toBeLessThanOrEqual(1024);
  expect(row.layer).toBe('searchable');
  expect(row.invalidAt).toBeNull();
  expect(row.content).toBe('durable curated lesson');
});

test.each(['append', 'remember'] as const)(
  'spilled references stay injected for %s at either load bound',
  async (path) => {
    const owner = { teamId: H.teamId, agentId: AGENT_ID, projectId: null };
    for (const content of [Array(200).fill('existing').join('\n'), 'x'.repeat(25 * 1024)]) {
      const index = await read('Coordinator');
      await relay('update_memory', {
        scope: 'team',
        file: 'MEMORY.md',
        baseVersion: index.baseVersion,
        content,
      });
      const title = `new-${content.length}.md`;
      if (path === 'append') appendMemoryIndex(H.s.db, owner, title, `detail-${content.length}`);
      else rememberMemoryFile(H.s.db, owner, title, `detail-${content.length}`);
      const injected = injectMemoryDocuments(H.s.db, owner).memories[0]!;
      expect(injected.content).toContain(`](${title})`);
      const current = await read('Coordinator');
      const stored = H.s.db
        .select()
        .from(agentMemory)
        .all()
        .find((row) => row.id === current.id)!;
      expect(stored.content).toContain(content);
      expect(await read('Coordinator', title)).toMatchObject({
        content: `detail-${content.length}`,
      });
    }
  },
);

test('flush prompt retains project scopes and a prefix of an oversized team index', async () => {
  for (const scope of ['team', H.projectId]) {
    const index = await read('Coordinator', 'MEMORY.md', scope);
    await relay('update_memory', {
      scope,
      file: 'MEMORY.md',
      baseVersion: index.baseVersion,
      content: scope === 'team' ? `TEAM-PREFIX\n${'x'.repeat(9000)}` : 'PROJECT-COVERED-FACT',
    });
  }
  const prompt = flushPrompt(H.s.db, { teamId: H.teamId, threadId: H.threadId }, 'transcript');
  const existing = prompt.split('Existing memories:\n')[1]!.split('\n\nProjects:')[0]!;
  expect(existing).toContain('TEAM-PREFIX');
  expect(existing).toContain('PROJECT-COVERED-FACT');
  expect(existing).toContain(`${H.projectId} | MEMORY.md`);
  expect(existing.length).toBeLessThanOrEqual(8000);
});

test.each(['same fact', 'same\nmultiline fact'])(
  'flush idempotence ignores generated titles for %s',
  (detail) => {
    const owner = { teamId: H.teamId, agentId: AGENT_ID, projectId: null };
    expect(appendMemoryIndex(H.s.db, owner, 'first：title', detail)).toBe(true);
    const before = H.s.db.select().from(agentMemory).all();
    expect(appendMemoryIndex(H.s.db, owner, 'another generated title', detail)).toBe(false);
    expect(H.s.db.select().from(agentMemory).all()).toEqual(before);
  },
);

test('flush scope headers leave bounded room for represented facts', () => {
  const scopes = Array.from({ length: 80 }, (_, i) => `scope-${i}`);
  H.s.db
    .insert(project)
    .values(scopes.map((id) => ({ id, teamId: H.teamId, name: id })))
    .run();
  H.s.db
    .insert(agentMemory)
    .values(
      scopes.map((projectId) => ({
        id: `fact-${projectId}`,
        agentId: AGENT_ID,
        teamId: H.teamId,
        projectId,
        title: 'fact',
        content: `FACT-${projectId}!`,
        layer: 'core' as const,
        createdAt: 1,
        updatedAt: 1,
      })),
    )
    .run();
  const prompt = flushPrompt(H.s.db, { teamId: H.teamId, threadId: H.threadId }, 'transcript');
  const existing = prompt.split('Existing memories:\n')[1]!.split('\n\nProjects:')[0]!;
  expect(existing.length).toBeLessThanOrEqual(8000);
  for (const scope of scopes.filter((scope) => existing.includes(`${scope} | MEMORY.md`)))
    expect(existing).toContain(`FACT-${scope}!`);
  expect(existing).toContain('additional scopes omitted');
});
