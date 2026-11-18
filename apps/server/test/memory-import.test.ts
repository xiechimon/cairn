import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { agentMemory, project, team } from '../src/db/schema.js';
import {
  importMemoryFile,
  isMemoryImportFile,
  listMemoryImportCandidates,
  memoryImportSource,
  type RepoReader,
} from '../src/services/memory-import.js';
import { AGENT_ID, H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

function makeProject(id: string, name = 'Repo') {
  H.s.db.insert(project).values({ id, teamId: H.teamId, name }).run();
}

function repo(files: Record<string, { path: string; content?: string; encoding?: string }[]>) {
  const reader: RepoReader = {
    list: async (projectId) => files[projectId] ?? [],
    read: async (projectId, path) => {
      const f = (files[projectId] ?? []).find((x) => x.path === path);
      if (!f || f.content === undefined) throw new Error(`no file ${path}`);
      return { content: f.content, encoding: f.encoding ?? 'utf-8' };
    },
  };
  return reader;
}

const FAILING: RepoReader = {
  list: async () => {
    throw new Error('repo not cloned');
  },
  read: async () => {
    throw new Error('repo not cloned');
  },
};

test('isMemoryImportFile matches basenames case-insensitively, not other files', () => {
  expect(isMemoryImportFile('CLAUDE.md')).toBe(true);
  expect(isMemoryImportFile('docs/AGENTS.md')).toBe(true);
  expect(isMemoryImportFile('claude.md')).toBe(true);
  expect(isMemoryImportFile('CLAUDE.md.bak')).toBe(false);
  expect(isMemoryImportFile('README.md')).toBe(false);
});

test('candidates lists importable files per project and skips unreadable repos', async () => {
  makeProject('p1', 'Alpha');
  makeProject('p2', 'Beta');
  makeProject('p3', 'No repo');
  const reader = repo({
    p1: [
      { path: 'CLAUDE.md' },
      { path: 'docs/AGENTS.md' },
      { path: 'README.md' },
      { path: 'src/claude.mdx' },
    ],
    p2: [{ path: 'AGENTS.md' }],
  });
  const list = await listMemoryImportCandidates(H.s.db, H.teamId, {
    list: async (id) => (id === 'p3' ? FAILING.list(id) : reader.list(id)),
    read: reader.read,
  });
  expect(list).toHaveLength(3);
  expect(list.map((c) => `${c.projectName}:${c.file}`).sort()).toEqual([
    'Alpha:CLAUDE.md',
    'Alpha:docs/AGENTS.md',
    'Beta:AGENTS.md',
  ]);
  expect(list.every((c) => !c.imported)).toBe(true);
});

test('import saves a searchable doc with import provenance and marks the candidate', async () => {
  makeProject('p1', 'Alpha');
  const reader = repo({ p1: [{ path: 'CLAUDE.md', content: '# Rules\nBe nice.' }] });
  const result = (await importMemoryFile(
    H.s.db,
    H.teamId,
    { projectId: 'p1', file: 'CLAUDE.md' },
    reader,
  )) as { file: string };
  expect(result.file).toBe('CLAUDE.md');
  const row = H.s.db
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.source, memoryImportSource('CLAUDE.md')))
    .get()!;
  expect(row.layer).toBe('searchable');
  expect(row.projectId).toBe('p1');
  expect(row.agentId).toBe(AGENT_ID);
  expect(row.content).toBe('# Rules\nBe nice.');
  const list = await listMemoryImportCandidates(H.s.db, H.teamId, reader);
  expect(list.find((c) => c.file === 'CLAUDE.md')?.imported).toBe(true);
});

test('import rejects non-importable names and binary content', async () => {
  makeProject('p1', 'Alpha');
  const reader = repo({ p1: [{ path: 'AGENTS.md', content: 'x' }] });
  await expect(
    importMemoryFile(H.s.db, H.teamId, { projectId: 'p1', file: 'README.md' }, reader),
  ).rejects.toThrow('not an importable memory file');
  const binary = repo({ p1: [{ path: 'AGENTS.md', content: 'AAE=', encoding: 'base64' }] });
  await expect(
    importMemoryFile(H.s.db, H.teamId, { projectId: 'p1', file: 'AGENTS.md' }, binary),
  ).rejects.toThrow('binary');
});

test('import rejects a project outside the team', async () => {
  H.s.db.insert(team).values({ id: 'other-team', name: 'Other', createdAt: 1 }).run();
  H.s.db.insert(project).values({ id: 'other', name: 'X', teamId: 'other-team' }).run();
  const reader = repo({ other: [{ path: 'AGENTS.md', content: 'x' }] });
  await expect(
    importMemoryFile(H.s.db, H.teamId, { projectId: 'other', file: 'AGENTS.md' }, reader),
  ).rejects.toThrow('project other');
});

test('REST: candidates and import round-trip', async () => {
  makeProject('p1', 'Alpha');
  const app = H.s.app;
  const candidates = await req(app, 'GET', `/api/teams/${H.teamId}/memory-imports/candidates`);
  expect(candidates.status).toBe(200);
  const imported = await req(app, 'POST', `/api/teams/${H.teamId}/memory-imports`, {
    projectId: 'p1',
    file: 'README.md',
  });
  expect(imported.status).toBe(400);
});
