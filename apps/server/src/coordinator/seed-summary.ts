import { CHIEF_DIGEST_ROW_ID_PREFIX, CHIEF_REPORT_ROW_ID_PREFIX } from '@cairn/shared';
import { and, asc, desc, eq, gt, like, lt, ne, not, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, chiefSummary } from '../db/schema.js';
import { chiefTranscriptLines } from '../services/chief-digest.js';
import { foldSummary, type Summarize, summaryBatches } from './runtime/compaction.js';
import { recordCompactionSuccess } from './runtime/failure-report.js';

export const SEED_SUMMARY_MAX_BATCHES = 8;
export const SUMMARY_LAG_ROWS = 20;
const SEED_SUMMARY_MAX_ROWS = 2_000;

export interface RowPosition {
  at: number;
  rowid: number;
}

export interface SeedSummaryResult {
  summary: string;
  complete: boolean;
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

export function laggingSeedWindowStart(
  db: Db,
  threadId: string,
  keepRows: number,
  lagRows: number,
): RowPosition | null {
  const prior = db.select().from(chiefSummary).where(eq(chiefSummary.threadId, threadId)).get();
  const newest = db
    .select({ at: chiefMessage.createdAt, rowid: sql<number>`rowid` })
    .from(chiefMessage)
    .where(
      and(
        conversational(threadId),
        prior === undefined
          ? undefined
          : strictlyAfter({ at: prior.coveredAt, rowid: prior.coveredRowid }),
      ),
    )
    .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
    .limit(keepRows + lagRows)
    .all();
  if (newest.length < keepRows + lagRows) return null;
  return newest[keepRows - 1] ?? null;
}

export async function seedSummary(
  db: Db,
  threadId: string,
  windowStart: RowPosition | null,
  summarize: Summarize | null,
  onError: (error: unknown, startAt: number) => void,
  now: number,
): Promise<SeedSummaryResult> {
  const prior = db.select().from(chiefSummary).where(eq(chiefSummary.threadId, threadId)).get();
  const previous = prior?.summary ?? '';
  if (summarize === null || windowStart === null) return { summary: previous, complete: true };
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
    .orderBy(asc(chiefMessage.createdAt), sql`rowid asc`)
    .limit(SEED_SUMMARY_MAX_ROWS)
    .all();
  if (gap.length === 0) return { summary: previous, complete: true };
  const lineTexts = (n: number) => chiefTranscriptLines(gap.slice(0, n)).map((line) => line.text);
  let chunkEnd = gap.length;
  if (summaryBatches(lineTexts(chunkEnd)).length > SEED_SUMMARY_MAX_BATCHES) {
    let lo = 0;
    let hi = gap.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (summaryBatches(lineTexts(mid)).length <= SEED_SUMMARY_MAX_BATCHES) lo = mid;
      else hi = mid - 1;
    }
    chunkEnd = lo;
  }
  const chunk = gap.slice(0, chunkEnd);
  const through = chunk.at(-1);
  if (through === undefined) return { summary: previous, complete: false };
  const batches = summaryBatches(lineTexts(chunkEnd));
  if (batches.length === 0) return { summary: previous, complete: true };
  const moreRemain =
    db
      .select({ id: chiefMessage.id })
      .from(chiefMessage)
      .where(
        and(
          conversational(threadId),
          strictlyAfter({ at: through.createdAt, rowid: through.rowid }),
          strictlyBefore(windowStart),
        ),
      )
      .limit(1)
      .get() !== undefined;
  let folded: string;
  const startAt = Date.now();
  try {
    folded = await foldSummary(prior?.summary ?? null, batches, summarize);
  } catch (error) {
    onError(error, startAt);
    return { summary: previous, complete: false };
  }
  recordCompactionSuccess({ threadId }, 'seed-summary', startAt);
  if (folded.trim() === '') return { summary: previous, complete: false };
  const values = {
    summary: folded,
    coveredThroughId: through.id,
    coveredAt: through.createdAt,
    coveredRowid: through.rowid,
    compactedMessages: (prior?.compactedMessages ?? 0) + chunk.length,
    generation: (prior?.generation ?? 0) + 1,
    updatedAt: now,
  };
  db.insert(chiefSummary)
    .values({ threadId, ...values })
    .onConflictDoUpdate({ target: chiefSummary.threadId, set: values })
    .run();
  return { summary: folded, complete: !moreRemain };
}
