import { CHIEF_DIGEST_ROW_ID_PREFIX, CHIEF_REPORT_ROW_ID_PREFIX } from '@cairn/shared';
import { and, desc, eq, gt, like, lt, ne, not, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, chiefSummary } from '../db/schema.js';
import { chiefTranscriptLines } from '../services/chief-digest.js';
import { foldSummary, type Summarize, summaryBatches } from './runtime/compaction.js';

export const SEED_SUMMARY_MAX_BATCHES = 8;
const SEED_SUMMARY_MAX_ROWS = 2_000;

export interface RowPosition {
  at: number;
  rowid: number;
}

const conversational = (threadId: string) =>
  and(
    eq(chiefMessage.threadId, threadId),
    not(like(chiefMessage.id, `${CHIEF_DIGEST_ROW_ID_PREFIX}%`)),
    not(like(chiefMessage.id, `${CHIEF_REPORT_ROW_ID_PREFIX}%`)),
    ne(chiefMessage.role, 'system'),
  );

const strictlyAfter = (cursor: RowPosition) =>
  or(
    gt(chiefMessage.createdAt, cursor.at),
    and(eq(chiefMessage.createdAt, cursor.at), gt(sql`rowid`, cursor.rowid)),
  );

const strictlyBefore = (limit: RowPosition) =>
  or(
    lt(chiefMessage.createdAt, limit.at),
    and(eq(chiefMessage.createdAt, limit.at), lt(sql`rowid`, limit.rowid)),
  );

export async function seedSummary(
  db: Db,
  threadId: string,
  windowStart: RowPosition | null,
  summarize: Summarize | null,
  onError: (error: unknown) => void,
  now: number,
): Promise<string> {
  const prior = db.select().from(chiefSummary).where(eq(chiefSummary.threadId, threadId)).get();
  const previous = prior?.summary ?? '';
  if (summarize === null || windowStart === null) return previous;
  const gap = db
    .select({
      id: chiefMessage.id,
      threadId: chiefMessage.threadId,
      role: chiefMessage.role,
      content: chiefMessage.content,
      createdAt: chiefMessage.createdAt,
      projectId: chiefMessage.projectId,
      rowid: sql<number>`rowid`,
    })
    .from(chiefMessage)
    .where(
      and(
        conversational(threadId),
        prior === undefined
          ? undefined
          : strictlyAfter({ at: prior.coveredAt, rowid: prior.coveredRowid }),
        strictlyBefore(windowStart),
      ),
    )
    .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
    .limit(SEED_SUMMARY_MAX_ROWS)
    .all()
    .reverse();
  const through = gap.at(-1);
  if (through === undefined) return previous;
  const batches = summaryBatches(chiefTranscriptLines(gap).map((line) => line.text)).slice(
    -SEED_SUMMARY_MAX_BATCHES,
  );
  if (batches.length === 0) return previous;
  let folded: string;
  try {
    folded = await foldSummary(prior?.summary ?? null, batches, summarize);
  } catch (error) {
    onError(error);
    return previous;
  }
  if (folded.trim() === '') return previous;
  const values = {
    summary: folded,
    coveredThroughId: through.id,
    coveredAt: through.createdAt,
    coveredRowid: through.rowid,
    compactedMessages: (prior?.compactedMessages ?? 0) + gap.length,
    generation: (prior?.generation ?? 0) + 1,
    updatedAt: now,
  };
  db.insert(chiefSummary)
    .values({ threadId, ...values })
    .onConflictDoUpdate({ target: chiefSummary.threadId, set: values })
    .run();
  return folded;
}
