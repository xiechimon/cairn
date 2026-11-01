import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, chiefThread } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { messageText } from './conversation-page.js';

const HISTORY_TRUST = 'untrusted-history';
const SEARCH_DEFAULT_LIMIT = 10;
const SEARCH_MAX_LIMIT = 50;
const SEARCH_MAX_TERMS = 10;
const SNIPPET_CHARS = 200;
const SNIPPET_LEAD_CHARS = 80;
const SEARCH_BATCH_ROWS = 200;
const READ_MAX_IDS = 20;

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

function snippetAround(text: string, folded: string, foldedTerms: string[]): string {
  const index = Math.min(...foldedTerms.map((term) => folded.indexOf(term)).filter((i) => i >= 0));
  const scaled =
    folded.length === text.length ? index : Math.floor((index * text.length) / folded.length);
  const start = Math.max(0, scaled - SNIPPET_LEAD_CHARS);
  return text.slice(start, start + SNIPPET_CHARS);
}

export function searchHistory(
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
        return { trust: HISTORY_TRUST, hits, nextBefore: hits.at(-1)?.id ?? null };
      }
      hits.push({
        id: row.id,
        role: row.role,
        createdAt: row.createdAt,
        projectId: row.projectId,
        snippet: snippetAround(text, folded, foldedTerms),
      });
    }
    if (batch.length < SEARCH_BATCH_ROWS) return { trust: HISTORY_TRUST, hits, nextBefore: null };
    position = batch.at(-1);
  }
}

export function readHistory(db: Db, scope: HistoryScope, ids: string[]) {
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
  return {
    trust: HISTORY_TRUST,
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: messageText(row.content),
      createdAt: row.createdAt,
    })),
  };
}
