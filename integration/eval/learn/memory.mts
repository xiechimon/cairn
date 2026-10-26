import { eq } from 'drizzle-orm';
import { agentMemory } from '../../../apps/server/src/db/schema.js';
import type { RealServer } from '../../test/helpers.js';
import type { SeededWorld } from '../chief-dispatch/stack.mts';
import type { LearnCase, LearnMemoryRow } from './grade.mts';

export function seedOracleMemory(
  server: RealServer,
  world: Pick<SeededWorld, 'chiefAgentId' | 'projectId'>,
  input: LearnCase,
  now = Date.now(),
): void {
  server.db
    .insert(agentMemory)
    .values({
      id: `mem-${input.id}-oracle`,
      agentId: world.chiefAgentId,
      teamId: server.teamId,
      title: input.oracle.title,
      content: input.oracle.content,
      projectId: world.projectId,
      sourceTodoId: null,
      sourceBuildId: null,
      invalidAt: null,
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function readLearnMemories(server: RealServer, chiefAgentId: string): LearnMemoryRow[] {
  return server.db
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, chiefAgentId))
    .all()
    .map((row) => ({
      title: row.title,
      content: row.content,
      projectId: row.projectId,
      invalidAt: row.invalidAt,
    }));
}
