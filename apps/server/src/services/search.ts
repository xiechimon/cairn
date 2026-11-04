import {
  type ParsedSearchFilter,
  parseSearchQuery,
  type SearchFilterResult,
  type SearchIsState,
  type SearchResponse,
} from '@cairn/shared';
import { and, asc, eq, inArray, not, or, type SQL, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';
import { agent, build, project, todo, tokenUsage, user } from '../db/schema.js';

export interface SearchDeps {
  db: Db;
}

export function escapeLike(q: string): string {
  return q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function containsLike(column: AnySQLiteColumn, pattern: string) {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

const IS_CONDITIONS: Record<SearchIsState, SQL> = {
  failed: sql`${todo.phase} = 'failed'`,
  waiting: sql`${todo.phase} IN ('confirm', 'review')`,
  review: sql`${todo.phase} = 'review'`,
  running: sql`${todo.phase} IN ('queued', 'planning', 'building')`,
  done: sql`${todo.phase} IN ('done', 'closed')`,
  snoozed: sql`${todo.snoozeMode} IS NOT NULL`,
};

const THREAD_COST = sql`(SELECT COALESCE(SUM(${tokenUsage.costTotal}), 0) FROM ${tokenUsage} INNER JOIN ${build} ON ${build.id} = ${tokenUsage.buildId} WHERE ${build.todoId} = ${todo.id})`;
const THREAD_COST_UNPRICED = sql`EXISTS (SELECT 1 FROM ${tokenUsage} INNER JOIN ${build} ON ${build.id} = ${tokenUsage.buildId} WHERE ${build.todoId} = ${todo.id} AND ${tokenUsage.costTotal} IS NULL)`;

interface ResolvedFilter {
  parsed: ParsedSearchFilter;
  condition: SQL | null;
  reason: SearchFilterResult['reason'];
}

function resolveFilter(
  deps: SearchDeps,
  teamId: string,
  parsed: ParsedSearchFilter,
): ResolvedFilter {
  const cond = parsed.condition;
  if (cond === null) return { parsed, condition: null, reason: parsed.problem ?? undefined };
  switch (cond.key) {
    case 'is':
      return { parsed, condition: IS_CONDITIONS[cond.state], reason: undefined };
    case 'project': {
      const ids = deps.db
        .select({ id: project.id })
        .from(project)
        .where(
          and(eq(project.teamId, teamId), sql`lower(${project.name}) = ${cond.name.toLowerCase()}`),
        )
        .all()
        .map((row) => row.id);
      return ids.length === 0
        ? { parsed, condition: null, reason: 'unknown_project' }
        : { parsed, condition: inArray(todo.projectId, ids), reason: undefined };
    }
    case 'pr':
      return {
        parsed,
        condition:
          cond.number === 'any'
            ? sql`EXISTS (SELECT 1 FROM ${build} WHERE ${build.todoId} = ${todo.id} AND ${build.prNumber} IS NOT NULL)`
            : sql`EXISTS (SELECT 1 FROM ${build} WHERE ${build.todoId} = ${todo.id} AND ${build.prNumber} = ${cond.number})`,
        reason: undefined,
      };
    case 'by': {
      const pattern = `%${escapeLike(cond.name)}%`;
      const agentIds = deps.db
        .select({ id: agent.id })
        .from(agent)
        .where(and(eq(agent.teamId, teamId), containsLike(agent.displayName, pattern)))
        .all();
      const userIds = deps.db
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            containsLike(user.displayName, pattern),
            sql`${user.id} IN (SELECT ${todo.createdBy} FROM ${todo} WHERE ${todo.teamId} = ${teamId})`,
          ),
        )
        .all();
      const ids = [...agentIds, ...userIds].map((row) => row.id);
      return ids.length === 0
        ? { parsed, condition: null, reason: 'unknown_person' }
        : { parsed, condition: inArray(todo.createdBy, ids), reason: undefined };
    }
    case 'after':
      return { parsed, condition: sql`${todo.phaseAt} >= ${cond.sinceMs}`, reason: undefined };
    case 'cost':
      return {
        parsed,
        condition:
          cond.op === '>'
            ? sql`NOT ${THREAD_COST_UNPRICED} AND ${THREAD_COST} > ${cond.dollars}`
            : sql`NOT ${THREAD_COST_UNPRICED} AND ${THREAD_COST} < ${cond.dollars}`,
        reason: undefined,
      };
  }
}

function filterConditions(resolved: ResolvedFilter[]): SQL[] | 'none' {
  const conditions: SQL[] = [];
  const positives = new Map<string, SQL[]>();
  for (const filter of resolved) {
    if (filter.condition === null) {
      if (!filter.parsed.negated) return 'none';
      continue;
    }
    if (filter.parsed.negated) {
      conditions.push(sql`NOT COALESCE(${filter.condition}, 0)`);
    } else {
      const group = positives.get(filter.parsed.key) ?? [];
      group.push(filter.condition);
      positives.set(filter.parsed.key, group);
    }
  }
  for (const group of positives.values()) {
    const any = or(...group);
    if (any) conditions.push(any);
  }
  return conditions;
}

function searchWithSyntax(
  deps: SearchDeps,
  teamId: string,
  q: string,
  nowMs: number,
): SearchResponse {
  const parsed = parseSearchQuery(q, nowMs);
  const resolved = parsed.filters.map((filter) => resolveFilter(deps, teamId, filter));
  const filters: SearchFilterResult[] = resolved.map(({ parsed: filter, reason }) => ({
    key: filter.key,
    raw: filter.raw,
    value: filter.value,
    negated: filter.negated,
    valid: reason === undefined,
    ...(reason === undefined ? {} : { reason }),
  }));
  const conditions = filterConditions(resolved);
  if (conditions === 'none') return { todos: [], projects: [], agents: [], filters };
  const wordConditions = parsed.words.map((word) => {
    const like = containsLike(todo.title, `%${escapeLike(word.text)}%`);
    return word.negated ? not(like) : like;
  });
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
    .where(and(eq(todo.teamId, teamId), ...conditions, ...wordConditions))
    .orderBy(asc(todo.seqNum))
    .all();
  return { todos, projects: [], agents: [], filters };
}

export function search(
  deps: SearchDeps,
  input: { teamId: string; q: string | null; nowMs?: number },
): SearchResponse {
  const q = input.q?.trim();
  if (!q) return { todos: [], projects: [], agents: [] };
  const nowMs = input.nowMs ?? Date.now();
  if (parseSearchQuery(q, nowMs).filters.length > 0) {
    return searchWithSyntax(deps, input.teamId, q, nowMs);
  }
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
    .where(and(eq(todo.teamId, input.teamId), containsLike(todo.title, pattern)))
    .orderBy(asc(todo.seqNum))
    .all();

  const projects = deps.db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(and(eq(project.teamId, input.teamId), containsLike(project.name, pattern)))
    .orderBy(asc(project.name))
    .all();

  const agents = deps.db
    .select({ id: agent.id, displayName: agent.displayName })
    .from(agent)
    .where(and(eq(agent.teamId, input.teamId), containsLike(agent.displayName, pattern)))
    .orderBy(asc(agent.displayName))
    .all();

  return { todos, projects, agents };
}
