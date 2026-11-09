import { MEMORY_INDEX_TITLE } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { deleteProject } from '../src/services/projects.js';
import { AGENT_ID, H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();
afterEach(() => H.s.dispose());

function index(projectId: string | null, content: string) {
  H.s.db
    .insert(agentMemory)
    .values({
      id: newRecordId(),
      agentId: AGENT_ID,
      teamId: H.teamId,
      title: MEMORY_INDEX_TITLE,
      content,
      projectId,
      sourceTodoId: null,
      sourceBuildId: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    })
    .run();
}

test('deleting a project merges its MEMORY.md into the one team MEMORY.md', () => {
  index(null, '- 团队：一条');
  index(H.projectId, '- 项目：一条');

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
  expect(team.map((row) => row.content)).toEqual(['- 团队：一条\n- 项目：一条']);
});
