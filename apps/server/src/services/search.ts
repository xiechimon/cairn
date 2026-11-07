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
import { build, project, todo, tokenUsage, user } from '../db/schema.js';

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
        .select({ id: project.id, name: project.name })
        .from(project)
        .where(eq(project.teamId, teamId))
        .all()
        .filter((row) => row.name.toLowerCase() === cond.name.toLowerCase())
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
      const ids = userIds.map((row) => row.id);
      return ids.length === 0
        ? { parsed, condition: null, reason: 'unknown_person' }
        : { parsed, condition: inArray(todo.createdBy, ids), reason: undefined };
    }
    case 'after':
      return { parsed, condition: sql`${todo.phaseAt} >= ${cond.sinceMs}`, reason: undefined };
    case 'cost': {
      const totals = deps.db
        .select({
          todoId: build.todoId,
          total: sql<number>`sum(${tokenUsage.costTotal})`.as('total'),
          unpriced:
            sql<number>`max(case when ${tokenUsage.buildId} IS NOT NULL AND ${tokenUsage.costTotal} IS NULL then 1 else 0 end)`.as(
              'unpriced',
            ),
        })
        .from(build)
        .leftJoin(tokenUsage, eq(build.id, tokenUsage.buildId))
        .groupBy(build.todoId)
        .as('thread_costs');
      const total = sql`COALESCE(${totals.total}, 0)`;
      const matches = deps.db
        .select({ id: todo.id })
        .from(todo)
        .leftJoin(totals, eq(todo.id, totals.todoId))
        .where(
          and(
            eq(todo.teamId, teamId),
            sql`COALESCE(${totals.unpriced}, 0) = 0`,
            cond.op === '>' ? sql`${total} > ${cond.dollars}` : sql`${total} < ${cond.dollars}`,
          ),
        );
      return {
        parsed,
        condition: inArray(todo.id, matches),
        reason: undefined,
      };
    }
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
  if (conditions === 'none') return { todos: [], projects: [], filters };
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
  return { todos, projects: [], filters };
}

export function search(
  deps: SearchDeps,
  input: { teamId: string; q: string | null; nowMs?: number },
): SearchResponse {
  const q = input.q?.trim();
  if (!q) return { todos: [], projects: [] };
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

  return { todos, projects };
}
