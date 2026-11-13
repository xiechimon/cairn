import { chiefDigestThreadId } from '@cairn/shared';
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, chiefThread } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { messageText, readConversationPage } from './conversation-page.js';

const HISTORY_TRUST = 'untrusted-history';
const SEARCH_DEFAULT_LIMIT = 10;
const SEARCH_MAX_LIMIT = 50;
const SEARCH_MAX_TERMS = 10;
const SNIPPET_CHARS = 200;
const SNIPPET_LEAD_CHARS = 80;
const SEARCH_BATCH_ROWS = 200;
export const SEARCH_SCAN_CAP_ROWS = 2000;
const READ_MAX_IDS = 20;
export const READ_DEFAULT_CHARS = 8000;
export const READ_MAX_CHARS = 20000;
export const READ_CALL_BUDGET_CHARS = 40000;

export interface HistoryScope {
  threadId: string;
  userId: string;
  teamId: string;
}

function requireOwnThread(db: Db, scope: HistoryScope): void {
  const thread = db
    .select({ id: chiefThread.id })
    .from(chiefThread)
    .where(
      and(
        eq(chiefThread.id, scope.threadId),
        eq(chiefThread.userId, scope.userId),
        eq(chiefThread.teamId, scope.teamId),
      ),
    )
    .get();
  if (!thread) throw new HttpError(404, `chief thread ${scope.threadId}`);
}

function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

function originalOffset(text: string, foldedIndex: number): number {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (fold(text.slice(0, mid)).length >= foldedIndex) high = mid;
    else low = mid + 1;
  }
  return low;
}

function snippetAround(text: string, folded: string, foldedTerms: string[]): string {
  const index = Math.min(...foldedTerms.map((term) => folded.indexOf(term)).filter((i) => i >= 0));
  const start = Math.max(0, originalOffset(text, index) - SNIPPET_LEAD_CHARS);
  return text.slice(start, start + SNIPPET_CHARS);
}

export async function searchHistory(
  db: Db,
  scope: HistoryScope,
  input: { query: string; limit?: number; before?: string },
) {
  const terms = input.query.split(/\s+/).filter((term) => term !== '');
  if (terms.length === 0) throw new HttpError(400, 'invalid params.query: expected a search term');
  if (terms.length > SEARCH_MAX_TERMS)
    throw new HttpError(400, `invalid params.query: at most ${SEARCH_MAX_TERMS} terms`);
  requireOwnThread(db, scope);
  const limit = Math.min(
    SEARCH_MAX_LIMIT,
    Math.max(1, Math.floor(input.limit ?? SEARCH_DEFAULT_LIMIT)),
  );
  const fields = {
    id: chiefMessage.id,
    role: chiefMessage.role,
    content: chiefMessage.content,
    projectId: chiefMessage.projectId,
    createdAt: chiefMessage.createdAt,
    rowid: sql<number>`rowid`,
  };
  const inThread = eq(chiefMessage.threadId, scope.threadId);
  const cursor =
    input.before === undefined
      ? undefined
      : db
          .select(fields)
          .from(chiefMessage)
          .where(and(inThread, eq(chiefMessage.id, input.before)))
          .get();
  if (input.before !== undefined && cursor === undefined)
    throw new HttpError(404, `chief message ${input.before}`);
  const foldedTerms = terms.map(fold);
  const hits: {
    id: string;
    role: string;
    createdAt: number;
    projectId: string | null;
    snippet: string;
  }[] = [];
  let position = cursor;
  let scanned = 0;
  for (;;) {
    const batch = db
      .select(fields)
      .from(chiefMessage)
      .where(
        and(
          inThread,
          position === undefined
            ? undefined
            : or(
                lt(chiefMessage.createdAt, position.createdAt),
                and(eq(chiefMessage.createdAt, position.createdAt), sql`rowid < ${position.rowid}`),
              ),
        ),
      )
      .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
      .limit(SEARCH_BATCH_ROWS)
      .all();
    for (const row of batch) {
      const text = messageText(row.content);
      const folded = fold(text);
      if (!foldedTerms.every((term) => folded.includes(term))) continue;
      if (hits.length === limit) {
        return {
          trust: HISTORY_TRUST,
          hits,
          truncated: false,
          nextBefore: hits.at(-1)?.id ?? null,
        };
      }
      hits.push({
        id: row.id,
        role: row.role,
        createdAt: row.createdAt,
        projectId: row.projectId,
        snippet: snippetAround(text, folded, foldedTerms),
      });
    }
    if (batch.length < SEARCH_BATCH_ROWS)
      return { trust: HISTORY_TRUST, hits, truncated: false, nextBefore: null };
    position = batch.at(-1);
    scanned += batch.length;
    if (scanned >= SEARCH_SCAN_CAP_ROWS)
      return { trust: HISTORY_TRUST, hits, truncated: true, nextBefore: position?.id ?? null };
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function pagingInt(
  value: number | undefined,
  name: string,
  fallback: number,
  [min, max]: [number, number],
) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new HttpError(400, `invalid params.${name}: expected an integer from ${min} to ${max}`);
  return value;
}

export function readHistory(
  db: Db,
  scope: HistoryScope,
  ids: string[],
  paging: { offset?: number; maxChars?: number } = {},
) {
  const offset = pagingInt(paging.offset, 'offset', 0, [0, Number.MAX_SAFE_INTEGER]);
  const maxChars = pagingInt(paging.maxChars, 'maxChars', READ_DEFAULT_CHARS, [1, READ_MAX_CHARS]);
  if (ids.length === 0) throw new HttpError(400, 'invalid params.ids: expected at least one id');
  if (ids.length > READ_MAX_IDS)
    throw new HttpError(400, `invalid params.ids: at most ${READ_MAX_IDS} ids`);
  requireOwnThread(db, scope);
  const rows = db
    .select({
      id: chiefMessage.id,
      role: chiefMessage.role,
      content: chiefMessage.content,
      createdAt: chiefMessage.createdAt,
    })
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, scope.threadId), inArray(chiefMessage.id, ids)))
    .orderBy(asc(chiefMessage.createdAt), sql`rowid asc`)
    .all();
  let budget = READ_CALL_BUDGET_CHARS;
  return {
    trust: HISTORY_TRUST,
    messages: rows.map((row) => {
      const text = messageText(row.content);
      const content = text.slice(offset, offset + Math.min(maxChars, budget));
      budget -= content.length;
      const end = offset + content.length;
      return {
        id: row.id,
        role: row.role,
        content,
        createdAt: row.createdAt,
        totalChars: text.length,
        nextOffset: end < text.length ? end : null,
      };
    }),
  };
}

export const MAIN_CHANNEL = 'main';

export async function channelMessages(
  db: Db,
  scope: HistoryScope,
  input: { channel: string; query?: string; limit?: number; before?: string },
) {
  requireOwnThread(db, scope);
  const own = db
    .select({ chiefId: chiefThread.chiefId, projectId: chiefThread.projectId })
    .from(chiefThread)
    .where(eq(chiefThread.id, scope.threadId))
    .get();
  if (!own) throw new HttpError(404, `chief thread ${scope.threadId}`);
  const projectId = input.channel === MAIN_CHANNEL ? null : input.channel;
  if (projectId === (own.projectId ?? null))
    throw new HttpError(
      400,
      'invalid params.channel: that is this channel; use search_history or read_history',
    );
  const target = db
    .select({ id: chiefThread.id })
    .from(chiefThread)
    .where(
      and(
        eq(chiefThread.chiefId, own.chiefId),
        eq(chiefThread.userId, scope.userId),
        ne(chiefThread.id, chiefDigestThreadId(own.chiefId)),
        isNull(chiefThread.archivedAt),
        projectId === null ? isNull(chiefThread.projectId) : eq(chiefThread.projectId, projectId),
      ),
    )
    .get();
  if (!target) return { trust: HISTORY_TRUST, channel: input.channel, opened: false, messages: [] };
  const targetScope = { ...scope, threadId: target.id };
  if (input.query !== undefined && input.query.trim() !== '') {
    const found = await searchHistory(db, targetScope, {
      query: input.query,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.before !== undefined ? { before: input.before } : {}),
    });
    return { channel: input.channel, opened: true, ...found };
  }
  return {
    trust: HISTORY_TRUST,
    channel: input.channel,
    opened: true,
    ...readConversationPage(db, target.id, input.before),
  };
}
