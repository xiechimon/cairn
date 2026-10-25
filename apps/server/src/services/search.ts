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

function contains(column: AnySQLiteColumn, pattern: string) {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

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
