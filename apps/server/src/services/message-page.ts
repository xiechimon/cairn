import { quickRepliesRowId, transcriptPromptRowId } from '@cairn/shared';
import { and, desc, eq, gt, inArray, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, message, step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { parseChiefTrigger } from './chief.js';
import { stepScopeProjectId } from './picked-project.js';

export interface MessagePageQuery {
  before?: string;
  limit: number;
  projectId?: string;
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

function chiefMessagesWithTurnBoundaries(
  db: Db,
  threadId: string,
  messages: (typeof chiefMessage.$inferSelect)[],
  query: MessagePageQuery,
): (typeof chiefMessage.$inferSelect)[] {
  const first = messages[0];
  const last = messages.at(-1);
  if (first === undefined || last === undefined) return messages;
  const ceiling =
    query.before === undefined
      ? last.createdAt
      : (db
          .select({ createdAt: chiefMessage.createdAt })
          .from(chiefMessage)
          .where(and(eq(chiefMessage.threadId, threadId), eq(chiefMessage.id, query.before)))
          .get()?.createdAt ?? last.createdAt);
  const turns = db
    .select({
      id: step.id,
      claimedAt: step.claimedAt,
      prompt: step.prompt,
      scopeProjectId: step.scopeProjectId,
    })
    .from(step)
    .where(
      and(
        eq(step.buildId, threadId),
        eq(step.kind, 'chief'),
        gt(step.claimedAt, first.createdAt),
        or(
          lte(step.claimedAt, ceiling),
          query.before === undefined ? eq(step.status, 'claimed') : undefined,
        ),
      ),
    )
    .all();
  if (turns.length === 0) return messages;
  const present = new Set(
    db
      .select({ id: chiefMessage.id })
      .from(chiefMessage)
      .where(
        and(
          eq(chiefMessage.threadId, threadId),
          inArray(
            chiefMessage.id,
            turns.flatMap((turn) => [turn.id, transcriptPromptRowId(turn.id)]),
          ),
        ),
      )
      .all()
      .map((row) => row.id),
  );
  const boundaryStepIds = new Map<string, string>();
  const boundaries = turns.flatMap((turn) => {
    const id = transcriptPromptRowId(turn.id);
    const scope = stepScopeProjectId(turn);
    if (
      turn.claimedAt === null ||
      parseChiefTrigger(turn.prompt) !== 'user' ||
      present.has(id) ||
      present.has(turn.id) ||
      (query.projectId !== undefined && scope !== query.projectId)
    )
      return [];
    boundaryStepIds.set(id, turn.id);
    return [
      {
        id,
        threadId,
        role: 'system' as const,
        content: '',
        createdAt: turn.claimedAt,
        projectId: scope,
      },
    ];
  });
  return [...messages, ...boundaries].sort((a, b) => {
    const chronological = a.createdAt - b.createdAt;
    if (chronological !== 0) return chronological;
    const aStepId = boundaryStepIds.get(a.id);
    const bStepId = boundaryStepIds.get(b.id);
    if (aStepId !== undefined && bStepId === undefined) {
      return writtenDuringTurn(b.id, aStepId) ? -1 : 1;
    }
    if (bStepId !== undefined && aStepId === undefined) {
      return writtenDuringTurn(a.id, bStepId) ? 1 : -1;
    }
    return 0;
  });
}

function writtenDuringTurn(messageId: string, stepId: string): boolean {
  return messageId.startsWith(`${stepId}-`) || messageId === quickRepliesRowId(stepId);
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
  const messages = rows.slice(0, query.limit).reverse();
  return {
    messages:
      table === chiefMessage
        ? (chiefMessagesWithTurnBoundaries(
            db,
            ownerId,
            messages as (typeof chiefMessage.$inferSelect)[],
            query,
          ) as T['$inferSelect'][])
        : messages,
    hasEarlier: rows.length > query.limit,
  };
}
