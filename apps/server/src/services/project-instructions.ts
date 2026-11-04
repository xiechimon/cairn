import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project } from '../db/schema.js';
import { injectMemories } from './memory.js';

export function projectTurnContext(
  db: Db,
  scope: { teamId: string; agentId: string | null; projectId: string | null },
): string | null {
  if (scope.projectId === null) return null;
  const row = db
    .select({ name: project.name, instructions: project.instructions })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.teamId, scope.teamId)))
    .get();
  if (row === undefined) return null;
  const name = row.name.replace(/[\r\n]+/g, ' ');
  const memories =
    scope.agentId === null
      ? []
      : injectMemories(db, {
          agentId: scope.agentId,
          teamId: scope.teamId,
          projectId: scope.projectId,
          projectOnly: true,
        });
  const sections = [
    ...(row.instructions != null ? [`## 项目说明（${name}）\n${row.instructions}`] : []),
    ...(memories.length > 0
      ? [`## 项目记忆（${name}）\n${memories.map((m) => `- ${m.title}：${m.content}`).join('\n')}`]
      : []),
  ];
  return sections.length > 0 ? sections.join('\n\n') : null;
}
