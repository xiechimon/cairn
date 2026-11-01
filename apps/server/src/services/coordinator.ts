import type { CoordinatorPageQuery, CoordinatorPageResponse } from '@cairn/shared';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { chiefMessage } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { type ChiefDeps, chiefThreadView, coordinatorThreadRow, ensureChief } from './chief.js';

const turnProjectId = sql<
  string | null
>`coalesce(${chiefMessage.projectId}, case when ${chiefMessage.role} = 'user' then null else (select u.projectId from chief_message u where u.threadId = ${chiefMessage.threadId} and u.role = 'user' and (u.createdAt < ${chiefMessage.createdAt} or (u.createdAt = ${chiefMessage.createdAt} and u.rowid < ${chiefMessage}.rowid)) order by u.createdAt desc, u.rowid desc limit 1) end)`;

function earlierThan(deps: ChiefDeps, threadId: string, messageId: string) {
  const cursor = deps.db
    .select({ createdAt: chiefMessage.createdAt, rowid: sql<number>`rowid` })
    .from(chiefMessage)
    .where(and(eq(chiefMessage.id, messageId), eq(chiefMessage.threadId, threadId)))
    .get();
  if (!cursor) throw new HttpError(404, `chief message ${messageId}`);
  return or(
    lt(chiefMessage.createdAt, cursor.createdAt),
    and(eq(chiefMessage.createdAt, cursor.createdAt), sql`rowid < ${cursor.rowid}`),
  );
}

export function readCoordinatorPage(
  deps: ChiefDeps,
  teamId: string,
  query: CoordinatorPageQuery,
): CoordinatorPageResponse {
  const thread = coordinatorThreadRow(deps, ensureChief(deps, teamId));
  const rows = deps.db
    .select({
      id: chiefMessage.id,
      role: chiefMessage.role,
      content: chiefMessage.content,
      createdAt: chiefMessage.createdAt,
      projectId: turnProjectId,
    })
    .from(chiefMessage)
    .where(
      and(
        eq(chiefMessage.threadId, thread.id),
        query.projectId !== undefined ? sql`${turnProjectId} = ${query.projectId}` : undefined,
        query.before !== undefined ? earlierThan(deps, thread.id, query.before) : undefined,
      ),
    )
    .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
    .limit(query.limit + 1)
    .all();
  return {
    thread: chiefThreadView(deps, teamId, thread),
    messages: rows.slice(0, query.limit).reverse(),
    hasEarlier: rows.length > query.limit,
  };
}
