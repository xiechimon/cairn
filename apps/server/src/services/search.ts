import {
  foldSearchText,
  type ParsedSearchFilter,
  parseSearchQuery,
  type SearchFilterResult,
  type SearchIsState,
  type SearchMemoryHit,
  type SearchMessageHit,
  type SearchResponse,
  type SearchWord,
  searchSeqNum,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
  WAITING_PHASES,
} from '@cairn/shared';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notLike,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { type Db, extractMessageText } from '../db/client.js';
import {
  agentMemory,
  build,
  chiefMessage,
  chiefThread,
  project,
  todo,
  tokenUsage,
  user,
} from '../db/schema.js';
import { listedProjects } from './personal-space.js';

export interface SearchDeps {
  db: Db;
}

const TODO_SEARCH_LIMIT = 50;
const PROJECT_SEARCH_LIMIT = 20;
const MESSAGE_SEARCH_LIMIT = 20;
const MEMORY_SEARCH_LIMIT = 20;
const SNIPPET_MAX_CHARS = 140;

export function escapeLike(q: string): string {
  return q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function containsLike(column: AnySQLiteColumn, pattern: string) {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

function containsNfkc(column: AnySQLiteColumn, foldedNeedle: string): SQL {
  const pattern = `%${escapeLike(foldedNeedle)}%`;
  return sql`nfkc_lower(${column}) LIKE ${pattern} ESCAPE '\\'`;
}

function containsMessageText(column: AnySQLiteColumn, foldedNeedle: string): SQL {
  const pattern = `%${escapeLike(foldedNeedle)}%`;
  return sql`nfkc_message_text(${column}) LIKE ${pattern} ESCAPE '\\'`;
}

const IS_CONDITIONS: Record<SearchIsState, SQL> = {
  failed: sql`${todo.phase} = 'failed'`,
  waiting: inArray(todo.phase, [...WAITING_PHASES]),
  review: sql`${todo.phase} = 'review'`,
  running: sql`${todo.phase} IN ('queued', 'planning', 'building')`,
  done: sql`${todo.phase} IN ('done', 'closed')`,
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
      const target = foldSearchText(cond.name);
      const ids = deps.db
        .select({ id: project.id, name: project.name })
        .from(project)
        .where(listedProjects(teamId))
        .all()
        .filter((row) => foldSearchText(row.name) === target)
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
      const folded = foldSearchText(cond.name);
      const userIds = deps.db
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            containsNfkc(user.displayName, folded),
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

function todoWordCondition(word: SearchWord): SQL {
  const folded = foldSearchText(word.text);
  const seq = searchSeqNum(word.text);
  const parts: SQL[] = [containsNfkc(todo.title, folded), containsNfkc(todo.spec, folded)];
  if (seq !== null) parts.push(eq(todo.seqNum, seq));
  const matched = or(...parts) as SQL;
  return word.negated ? sql`NOT COALESCE(${matched}, 0)` : matched;
}

function projectWordCondition(word: SearchWord): SQL {
  const folded = foldSearchText(word.text);
  const repoMatch = and(isNotNull(project.githubRepo), containsNfkc(project.githubRepo, folded));
  const matched = or(containsNfkc(project.name, folded), repoMatch) as SQL;
  return word.negated ? sql`NOT COALESCE(${matched}, 0)` : matched;
}

function messageWordCondition(word: SearchWord): SQL {
  const folded = foldSearchText(word.text);
  const matched = containsMessageText(chiefMessage.content, folded);
  return word.negated ? sql`NOT COALESCE(${matched}, 0)` : matched;
}

function memoryWordCondition(word: SearchWord): SQL {
  const folded = foldSearchText(word.text);
  const matched = or(
    containsNfkc(agentMemory.title, folded),
    containsNfkc(agentMemory.content, folded),
  ) as SQL;
  return word.negated ? sql`NOT COALESCE(${matched}, 0)` : matched;
}

function snippetOf(rawText: string, positiveWords: readonly string[]): string {
  const collapsed = rawText.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= SNIPPET_MAX_CHARS) return collapsed;
  const folded = foldSearchText(collapsed);
  let matchIndex = -1;
  for (const word of positiveWords) {
    const idx = folded.indexOf(word);
    if (idx !== -1 && (matchIndex === -1 || idx < matchIndex)) matchIndex = idx;
  }
  if (matchIndex <= 32) return `${collapsed.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd()}…`;
  const start = Math.max(0, matchIndex - 32);
  const end = Math.min(collapsed.length, start + SNIPPET_MAX_CHARS - 2);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < collapsed.length ? '…' : '';
  return `${prefix}${collapsed.slice(start, end).trim()}${suffix}`;
}

export function search(
  deps: SearchDeps,
  input: { teamId: string; q: string | null; nowMs?: number },
): SearchResponse {
  const q = input.q?.trim();
  if (!q) return { todos: [], projects: [] };
  const nowMs = input.nowMs ?? Date.now();
  const parsed = parseSearchQuery(q, nowMs);
  const hasFilters = parsed.filters.length > 0;

  let filters: SearchFilterResult[] | undefined;
  let resolvedConditions: SQL[] = [];
  if (hasFilters) {
    const resolved = parsed.filters.map((filter) => resolveFilter(deps, input.teamId, filter));
    filters = resolved.map(({ parsed: filter, reason }) => ({
      key: filter.key,
      raw: filter.raw,
      value: filter.value,
      negated: filter.negated,
      valid: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
    }));
    const checked = filterConditions(resolved);
    if (checked === 'none') return { todos: [], projects: [], filters };
    resolvedConditions = checked;
  }

  const todoWords = parsed.words.map(todoWordCondition);
  const todoRows = deps.db
    .select({
      id: todo.id,
      seqNum: todo.seqNum,
      title: todo.title,
      phase: todo.phase,
      phaseAt: todo.phaseAt,
      archivedAt: todo.archivedAt,
      projectName: project.name,
    })
    .from(todo)
    .innerJoin(project, eq(todo.projectId, project.id))
    .where(
      and(
        eq(todo.teamId, input.teamId),
        isNull(project.personalOwnerId),
        ...resolvedConditions,
        ...todoWords,
      ),
    )
    .orderBy(desc(todo.phaseAt), desc(todo.seqNum))
    .limit(TODO_SEARCH_LIMIT)
    .all();

  const todos = todoRows.map(({ archivedAt, ...row }) => ({
    ...row,
    ...(archivedAt !== null ? { archived: true } : {}),
  }));

  if (hasFilters) {
    return { todos, projects: [], filters };
  }

  const projectWords = parsed.words.map(projectWordCondition);
  const projectRows = deps.db
    .select({
      id: project.id,
      name: project.name,
      archivedAt: project.archivedAt,
    })
    .from(project)
    .where(and(listedProjects(input.teamId), ...projectWords))
    .orderBy(asc(sql`CASE WHEN ${project.archivedAt} IS NULL THEN 0 ELSE 1 END`), asc(project.name))
    .limit(PROJECT_SEARCH_LIMIT)
    .all();

  const projects = projectRows.map(({ archivedAt, ...row }) => ({
    ...row,
    ...(archivedAt !== null ? { archived: true } : {}),
  }));

  const positiveWords = parsed.words
    .filter((word) => !word.negated)
    .map((word) => foldSearchText(word.text));

  let messages: SearchMessageHit[] = [];
  let memories: SearchMemoryHit[] = [];
  if (parsed.words.length > 0) {
    const messageRows = deps.db
      .select({
        id: chiefMessage.id,
        threadId: chiefMessage.threadId,
        content: chiefMessage.content,
        projectId: project.id,
        projectName: project.name,
        createdAt: chiefMessage.createdAt,
      })
      .from(chiefMessage)
      .innerJoin(chiefThread, eq(chiefMessage.threadId, chiefThread.id))
      .leftJoin(
        project,
        and(
          eq(project.id, sql`COALESCE(${chiefMessage.projectId}, ${chiefThread.projectId})`),
          isNull(project.personalOwnerId),
        ),
      )
      .where(
        and(
          eq(chiefThread.teamId, input.teamId),
          inArray(chiefMessage.role, ['user', 'assistant']),
          notLike(chiefMessage.id, `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}%`),
          ...parsed.words.map(messageWordCondition),
        ),
      )
      .orderBy(desc(chiefMessage.createdAt))
      .limit(MESSAGE_SEARCH_LIMIT)
      .all();

    messages = messageRows
      .map((row) => ({
        id: row.id,
        threadId: row.threadId,
        snippet: snippetOf(extractMessageText(row.content), positiveWords),
        ...(row.projectId !== null ? { projectId: row.projectId } : {}),
        ...(row.projectName !== null ? { projectName: row.projectName } : {}),
        createdAt: row.createdAt,
      }))
      .filter((row) => row.snippet !== '');

    const memoryRows = deps.db
      .select({
        id: agentMemory.id,
        title: agentMemory.title,
        content: agentMemory.content,
        projectId: project.id,
        projectName: project.name,
        updatedAt: agentMemory.updatedAt,
      })
      .from(agentMemory)
      .leftJoin(
        project,
        and(eq(project.id, agentMemory.projectId), isNull(project.personalOwnerId)),
      )
      .where(
        and(
          eq(agentMemory.teamId, input.teamId),
          isNull(agentMemory.invalidAt),
          isNull(agentMemory.supersededBy),
          ...parsed.words.map(memoryWordCondition),
        ),
      )
      .orderBy(desc(agentMemory.updatedAt), desc(agentMemory.createdAt))
      .limit(MEMORY_SEARCH_LIMIT)
      .all();

    memories = memoryRows.map((row) => ({
      id: row.id,
      title: row.title,
      snippet: snippetOf(row.content, positiveWords),
      ...(row.projectId !== null ? { projectId: row.projectId } : {}),
      ...(row.projectName !== null ? { projectName: row.projectName } : {}),
      updatedAt: row.updatedAt,
    }));
  }

  return {
    todos,
    projects,
    ...(messages.length > 0 ? { messages } : {}),
    ...(memories.length > 0 ? { memories } : {}),
  };
}
