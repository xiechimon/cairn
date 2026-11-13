import { MEMORY_INDEX_TITLE } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import { foldMemoryIndexes, listMemoryEntries, saveMemoryEntry } from '../src/services/memory.js';
import { deleteProject } from '../src/services/projects.js';
import { AGENT_ID, H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

test('deleting a project merges its MEMORY.md into the one team MEMORY.md', async () => {
  saveMemoryEntry(H.s.db, {
    agentId: AGENT_ID,
    teamId: H.teamId,
    projectId: null,
    sourceTodoId: null,
    sourceBuildId: null,
    title: 'team fact',
    content: '- 团队：一条',
  });
  saveMemoryEntry(H.s.db, {
    agentId: AGENT_ID,
    teamId: H.teamId,
    sourceTodoId: null,
    sourceBuildId: null,
    title: 'project fact',
    content: '- 项目：一条',
    projectId: H.projectId,
  });
  foldMemoryIndexes(H.s.db);

  expect(deleteProject({ db: H.s.db, reposDir: H.s.reposDir }, H.projectId)).toBe(true);

  const team = H.s.db
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.title, MEMORY_INDEX_TITLE),
        isNull(agentMemory.projectId),
        isNull(agentMemory.invalidAt),
      ),
    )
    .all();
  expect(team).toHaveLength(1);
  expect(
    listMemoryEntries(H.s.db, { agentId: AGENT_ID, teamId: H.teamId }).map((row) => row.content),
  ).toEqual(['- 团队：一条', '- 项目：一条']);
});
