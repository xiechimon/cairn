import { eq } from 'drizzle-orm';
import { agentMemory } from '../../../apps/server/src/db/schema.js';
import { api, type RealServer } from '../../test/helpers.js';
import type { SeededWorld } from '../chief-dispatch/stack.mts';
import { type MemoryCase, type MemoryRowLite, type MemoryScope, memoryIdFor } from './grade.mts';

const DAY_MS = 86_400_000;
const OTHER_PROJECT_NAME = 'other-project';

async function createOtherProject(server: RealServer): Promise<string> {
  const res = await api(server.url, 'POST', '/api/projects', {
    name: OTHER_PROJECT_NAME,
    teamId: server.teamId,
    repoKind: 'hosted',
  });
  if (res.status !== 201) throw new Error(`建 ${OTHER_PROJECT_NAME} 失败: ${res.status}`);
  return (res.body as { id: string }).id;
}

export async function seedMemories(
  server: RealServer,
  world: Pick<SeededWorld, 'chiefAgentId' | 'projectId'>,
  input: MemoryCase,
  now = Date.now(),
): Promise<void> {
  const needsOtherProject = input.memories.some((m) => m.scope === 'other-project');
  const otherProjectId = needsOtherProject ? await createOtherProject(server) : null;
  const projectIdOf = (scope: MemoryScope): string | null =>
    scope === 'eval-project' ? world.projectId : scope === 'other-project' ? otherProjectId : null;
  const createdAtOf = (key: string): number => {
    const seed = input.memories.find((m) => m.key === key);
    if (seed === undefined) throw new Error(`${input.id}: 记忆 ${key} 不存在`);
    return now - seed.ageDays * DAY_MS;
  };
  for (const seed of input.memories) {
    const createdAt = createdAtOf(seed.key);
    server.db
      .insert(agentMemory)
      .values({
        id: memoryIdFor(input.id, seed.key),
        agentId: world.chiefAgentId,
        teamId: server.teamId,
        title: seed.title,
        content: seed.content,
        projectId: projectIdOf(seed.scope),
        sourceTodoId: null,
        sourceBuildId: null,
        invalidAt: seed.invalidatedBy === undefined ? null : createdAtOf(seed.invalidatedBy),
        supersededBy:
          seed.invalidatedBy === undefined ? null : memoryIdFor(input.id, seed.invalidatedBy),
        createdAt,
        updatedAt: createdAt,
      })
      .run();
  }
}

export function readMemoryRows(server: RealServer, chiefAgentId: string): MemoryRowLite[] {
  return server.db
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, chiefAgentId))
    .all()
    .map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      invalidAt: row.invalidAt,
      supersededBy: row.supersededBy,
    }));
}
