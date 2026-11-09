import { and, desc, eq, lt, or, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, message } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

export interface MessagePageQuery {
  before?: string;
  limit: number;
}

type PagedTable = typeof chiefMessage | typeof message;

function ownerColumn(table: PagedTable) {
  return table === chiefMessage ? chiefMessage.threadId : message.conversationId;
}

function earlierThan(db: Db, table: PagedTable, ownerId: string, messageId: string): SQL {
  const owner = ownerColumn(table);
  const cursor = db
    .select({ createdAt: table.createdAt, rowid: sql<number>`rowid` })
    .from(table)
    .where(and(eq(table.id, messageId), eq(owner, ownerId)))
    .get();
  if (!cursor) throw new HttpError(404, `message ${messageId}`);
  return or(
    lt(table.createdAt, cursor.createdAt),
    and(eq(table.createdAt, cursor.createdAt), sql`rowid < ${cursor.rowid}`),
  ) as SQL;
}

export function newestMessagePage<T extends PagedTable>(
  db: Db,
  table: T,
  ownerId: string,
  query: MessagePageQuery,
  filter?: SQL,
) {
  const rows = db
    .select()
    .from(table as PagedTable)
    .where(
      and(
        eq(ownerColumn(table), ownerId),
        filter,
        query.before !== undefined ? earlierThan(db, table, ownerId, query.before) : undefined,
      ),
    )
    .orderBy(desc(table.createdAt), sql`rowid desc`)
    .limit(query.limit + 1)
    .all() as T['$inferSelect'][];
  return {
    messages: rows.slice(0, query.limit).reverse(),
    hasEarlier: rows.length > query.limit,
  };
}
