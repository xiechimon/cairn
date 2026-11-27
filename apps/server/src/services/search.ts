import {
  extractPlainMessageText,
  isChiefPromptEcho,
  type ParsedSearchFilter,
  parseSearchQuery,
  type SearchFilterResult,
  type SearchIsState,
  type SearchMessageHit,
  type SearchResponse,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
  visibleChiefMessageText,
  WAITING_PHASES,
  WAKE_MARKER_PREFIX_RE,
} from '@cairn/shared';
import { and, asc, desc, eq, inArray, isNull, not, notLike, or, type SQL, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';
import { build, chiefMessage, chiefThread, project, todo, tokenUsage, user } from '../db/schema.js';
import { foldSearchText, snippetAround } from './chief-history.js';
import { listedProjects } from './personal-space.js';

const SEARCH_THREAD_SCAN_CAP = 2000;
const SEARCH_TOTAL_SCAN_CAP = 10_000;
const SEARCH_MESSAGE_LIMIT = 20;
const MESSAGE_SNIPPET_CHARS = 120;
const MESSAGE_SNIPPET_LEAD_CHARS = 30;

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
      const ids = deps.db
        .select({ id: project.id, name: project.name })
        .from(project)
        .where(listedProjects(teamId))
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

function formatMessageSnippet(text: string, foldedTerms: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= MESSAGE_SNIPPET_CHARS) return flat;
  const rawSnippet = snippetAround(flat, foldSearchText(flat), foldedTerms, {
    maxChars: MESSAGE_SNIPPET_CHARS,
    leadChars: MESSAGE_SNIPPET_LEAD_CHARS,
  });
  const idx = flat.indexOf(rawSnippet);
  const trimmedStart = idx > 0;
  const trimmedEnd = idx >= 0 && idx + rawSnippet.length < flat.length;
  return `${trimmedStart ? '…' : ''}${rawSnippet}${trimmedEnd ? '…' : ''}`;
}

function decodeRawContent(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function searchMessages(
  deps: SearchDeps,
  teamId: string,
  userId: string | undefined,
  q: string,
): SearchMessageHit[] {
  const terms = q.split(/\s+/).filter((term) => term !== '');
  if (terms.length === 0) return [];
  const foldedTerms = terms.map(foldSearchText);
  const threads = deps.db
    .select({
      id: chiefThread.id,
      projectId: chiefThread.projectId,
      projectName: project.name,
      personalOwnerId: project.personalOwnerId,
      projectTeamId: project.teamId,
    })
    .from(chiefThread)
    .leftJoin(project, eq(chiefThread.projectId, project.id))
    .where(
      and(
        eq(chiefThread.teamId, teamId),
        userId !== undefined ? eq(chiefThread.userId, userId) : undefined,
        isNull(chiefThread.archivedAt),
        notLike(chiefThread.id, 'chief-digest-%'),
        notLike(chiefThread.id, 'chief-memory-%'),
      ),
    )
    .orderBy(desc(chiefThread.updatedAt), desc(chiefThread.createdAt))
    .all()
    .filter(
      (row) =>
        row.projectId === null ||
        (row.projectName !== null && row.projectTeamId === teamId && row.personalOwnerId === null),
    );
  const hits: (SearchMessageHit & { rowid: number })[] = [];
  let remainingBudget = SEARCH_TOTAL_SCAN_CAP;
  for (const thread of threads) {
    const threadLimit = Math.min(SEARCH_THREAD_SCAN_CAP, remainingBudget);
    if (threadLimit <= 0) break;
    const rows = deps.db
      .select({
        id: chiefMessage.id,
        role: chiefMessage.role,
        origin: chiefMessage.origin,
        content: sql<
          string | null
        >`CASE WHEN ${chiefMessage.role} = 'assistant' AND json_valid(${chiefMessage.content}) AND json_type(${chiefMessage.content}) = 'object' AND coalesce(json_extract(${chiefMessage.content}, '$.type'), '') != 'text' THEN NULL ELSE ${chiefMessage.content} END`,
        createdAt: chiefMessage.createdAt,
        rowid: sql<number>`rowid`,
      })
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, thread.id))
      .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
      .limit(threadLimit)
      .all();
    if (rows.length === 0) continue;
    remainingBudget -= rows.length;
    rows.reverse();
    let eventTurn = false;
    for (const row of rows) {
      const content = decodeRawContent(row.content);
      if (
        row.role === 'system' &&
        content === '' &&
        row.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX)
      ) {
        eventTurn = false;
        continue;
      }
      if (row.role === 'user' && isChiefPromptEcho(row)) {
        eventTurn = WAKE_MARKER_PREFIX_RE.test(extractPlainMessageText(content).trim());
        continue;
      }
      if (row.role === 'user') eventTurn = false;
      if (eventTurn && row.role === 'assistant') continue;
      const visible = visibleChiefMessageText({
        id: row.id,
        role: row.role,
        origin: row.origin,
        content,
      });
      if (visible === null) continue;
      const folded = foldSearchText(visible.text);
      if (!foldedTerms.every((term) => folded.includes(term))) continue;
      hits.push({
        id: row.id,
        threadId: thread.id,
        projectId: thread.projectId,
        projectName: thread.projectId === null ? null : thread.projectName,
        role: visible.role,
        snippet: formatMessageSnippet(visible.text, foldedTerms),
        createdAt: row.createdAt,
        rowid: row.rowid,
      });
    }
  }
  hits.sort((a, b) => b.createdAt - a.createdAt || b.rowid - a.rowid);
  return hits.slice(0, SEARCH_MESSAGE_LIMIT).map(({ rowid: _rowid, ...hit }) => hit);
}

export function search(
  deps: SearchDeps,
  input: { teamId: string; userId?: string; q: string | null; nowMs?: number },
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
    .where(and(listedProjects(input.teamId), containsLike(project.name, pattern)))
    .orderBy(asc(project.name))
    .all();

  const messages = searchMessages(deps, input.teamId, input.userId, q);

  return { todos, projects, ...(messages.length > 0 ? { messages } : {}) };
}
