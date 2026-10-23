// ⌘K 搜索（02 §6.3 [设计] 自设，wire 无外部真值——04 附录 A：不触发补采、
// 无平价义务；响应形状单源 = shared searchResponseSchema）。
// 服务端 LIKE 查标题/名称三集：todo.title / project.name / agent.displayName
// （placeholder「搜索任务、项目、成员…」的三组，r2 04）。
// 空 q / 缺 q → 三空数组 [设计]（空输入面板「前往」组 = 客户端行为，r2 04）。
// LIKE 通配转义 [设计]：% _ \ 按字面匹配（ESCAPE '\'）；ASCII 大小写不敏感
// = SQLite LIKE 内建行为，中文逐字节相等。

import type { SearchResponse } from '@cairn/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';
import { agent, project, todo } from '../db/schema.js';

export interface SearchDeps {
  db: Db;
}

function escapeLike(q: string): string {
  return q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

/** LIKE 带显式 ESCAPE（SQL 文本 = `LIKE ? ESCAPE '\'`，反斜杠转义在 TS 侧）。 */
function contains(column: AnySQLiteColumn, pattern: string) {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

/** 三集各自 team 域内 LIKE（团队恒一行，02 §2.2；无 teamId 查询参数 =
 * 02 §6.1 词表 `?q=` 单参）。排序 [设计]：todos 按 seqNum、projects/agents
 * 按名称——面板分组稳定序。 */
export function search(
  deps: SearchDeps,
  input: { teamId: string; q: string | null },
): SearchResponse {
  const q = input.q?.trim();
  if (!q) return { todos: [], projects: [], agents: [] };
  const pattern = `%${escapeLike(q)}%`;

  const todos = deps.db
    .select({
      id: todo.id,
      seqNum: todo.seqNum,
      title: todo.title,
      phase: todo.phase,
      phaseAt: todo.phaseAt,
      projectName: project.name,
    })
    .from(todo)
    .innerJoin(project, eq(todo.projectId, project.id))
    .where(and(eq(todo.teamId, input.teamId), contains(todo.title, pattern)))
    .orderBy(asc(todo.seqNum))
    .all();

  const projects = deps.db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(and(eq(project.teamId, input.teamId), contains(project.name, pattern)))
    .orderBy(asc(project.name))
    .all();

  const agents = deps.db
    .select({ id: agent.id, displayName: agent.displayName })
    .from(agent)
    .where(and(eq(agent.teamId, input.teamId), contains(agent.displayName, pattern)))
    .orderBy(asc(agent.displayName))
    .all();

  return { todos, projects, agents };
}
