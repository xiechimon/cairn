import { fenceHistoryText, redactSecrets, TRANSCRIPT_PROMPT_ROW_ID_PREFIX } from '@cairn/shared';
import { and, desc, eq, like, lt, not, notInArray, sql } from 'drizzle-orm';
import { conversational, strictlyAfter } from '../coordinator/seed-summary.js';
import type { Db } from '../db/client.js';
import { chiefMessage, chiefSummary, type chiefThread, type step } from '../db/schema.js';
import { chiefTranscriptLines } from './chief-digest.js';

export const CHIEF_HISTORY_MAX_CHARS = 16_000;
export const CHIEF_HISTORY_SUMMARY_MAX_CHARS = 4_000;
export const CHIEF_HISTORY_LINE_MAX_CHARS = 8_000;
const CHIEF_HISTORY_MAX_ROWS = 300;

const redacted = (text: string): string => redactSecrets(text).value as string;

export function chiefHistoryFor(
  db: Db,
  threadRow: typeof chiefThread.$inferSelect,
  stepRow: typeof step.$inferSelect,
): string | null {
  const summaryRow = db
    .select()
    .from(chiefSummary)
    .where(eq(chiefSummary.threadId, threadRow.id))
    .get();
  const summary =
    summaryRow === undefined || summaryRow.summary.trim() === ''
      ? ''
      : redacted(summaryRow.summary.trim()).slice(-CHIEF_HISTORY_SUMMARY_MAX_CHARS);
  const ownerMessageIds = stepRow.ownerMessageIds ?? [];
  const rows = db
    .select()
    .from(chiefMessage)
    .where(
      and(
        conversational(threadRow.id),
        summaryRow === undefined
          ? undefined
          : strictlyAfter({ at: summaryRow.coveredAt, rowid: summaryRow.coveredRowid }),
        not(like(chiefMessage.id, `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}%`)),
        lt(chiefMessage.createdAt, stepRow.createdAt),
        ownerMessageIds.length > 0 ? notInArray(chiefMessage.id, ownerMessageIds) : undefined,
        sql`json_type(${chiefMessage.content}) != 'object'`,
      ),
    )
    .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
    .limit(CHIEF_HISTORY_MAX_ROWS)
    .all()
    .reverse();
  let budget = CHIEF_HISTORY_MAX_CHARS - summary.length;
  const kept: string[] = [];
  for (const line of chiefTranscriptLines(rows).reverse()) {
    const text = redacted(
      line.text.length > CHIEF_HISTORY_LINE_MAX_CHARS
        ? `${line.text.slice(0, CHIEF_HISTORY_LINE_MAX_CHARS)}\n[cut: ${line.text.length} characters in all]`
        : line.text,
    );
    if (text.length + 1 > budget) break;
    budget -= text.length + 1;
    kept.unshift(text);
  }
  const sections = [
    ...(summary === '' ? [] : [`[摘要，覆盖更早的对话]\n${summary}`]),
    ...(kept.length === 0 ? [] : [`[最近的对话]\n${kept.join('\n')}`]),
  ];
  return sections.length === 0 ? null : fenceHistoryText(sections.join('\n\n'));
}
