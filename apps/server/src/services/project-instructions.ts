import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project } from '../db/schema.js';
import { injectMemoriesCapped, MEMORY_INJECT_TOKEN_CAP } from './memory.js';

export function projectTurnContext(
  db: Db,
  scope: {
    teamId: string;
    agentId: string | null;
    projectId: string | null;
    threadId?: string;
  },
): string | null {
  return projectTurnContextTraced(db, scope, Number.POSITIVE_INFINITY)?.text ?? null;
}

export function projectTurnContextTraced(
  db: Db,
  scope: {
    teamId: string;
    agentId: string | null;
    projectId: string | null;
    threadId?: string;
  },
  capTokens: number = MEMORY_INJECT_TOKEN_CAP,
): { text: string; memoryIds: string[]; memoriesOmitted: number } | null {
  if (scope.projectId === null) return null;
  const row = db
    .select({ name: project.name, instructions: project.instructions })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.teamId, scope.teamId)))
    .get();
  if (row === undefined) return null;
  const name = row.name.replace(/[\r\n]+/g, ' ');
  const injected =
    scope.agentId === null
      ? { memories: [], omitted: 0 }
      : injectMemoriesCapped(
          db,
          {
            agentId: scope.agentId,
            teamId: scope.teamId,
            projectId: scope.projectId,
            projectOnly: true,
            ...(scope.threadId !== undefined ? { threadId: scope.threadId } : {}),
          },
          capTokens,
        );
  const memories = injected.memories;
  const sections = [
    ...(row.instructions != null ? [`## 项目说明（${name}）\n${row.instructions}`] : []),
    ...(memories.length > 0 || injected.omitted > 0
      ? [
          `## 项目记忆（${name}）\n${memories.map((m) => `- ${m.title}：${m.content}`).join('\n')}${
            injected.omitted > 0
              ? `\n（另有 ${injected.omitted} 条项目记忆因篇幅未显示；用 memories 工具带 query 搜索）`
              : ''
          }`,
        ]
      : []),
  ];
  return sections.length > 0
    ? {
        text: sections.join('\n\n'),
        memoryIds: memories.map((m) => m.id),
        memoriesOmitted: injected.omitted,
      }
    : null;
}
