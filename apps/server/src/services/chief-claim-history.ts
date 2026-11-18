import {
  ASK_USER_QUESTION_KIND,
  CHIEF_DIGEST_ROW_ID_PREFIX,
  CHIEF_REPORT_ROW_ID_PREFIX,
  fenceHistoryText,
  redactSecrets,
  shortEvent,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
} from '@cairn/shared';
import { and, desc, eq, like, lt, ne, not, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, type chiefThread, type step } from '../db/schema.js';
import { extractText } from './chief.js';

export const CHIEF_HISTORY_MAX_CHARS = 16_000;
export const CHIEF_HISTORY_LINE_MAX_CHARS = 8_000;
const CHIEF_HISTORY_MAX_ROWS = 300;

const redacted = (text: string): string => redactSecrets(text).value as string;

const conversational = (threadId: string) =>
  and(
    eq(chiefMessage.threadId, threadId),
    not(like(chiefMessage.id, `${CHIEF_DIGEST_ROW_ID_PREFIX}%`)),
    not(like(chiefMessage.id, `${CHIEF_REPORT_ROW_ID_PREFIX}%`)),
    ne(chiefMessage.role, 'system'),
  );

interface CoordinatorLine {
  id: string;
  at: number;
  text: string;
  projectId: string | null;
}

function chiefTranscriptLines(
  rows: readonly (typeof chiefMessage.$inferSelect)[],
): CoordinatorLine[] {
  const postedTexts = new Set(
    rows
      .filter((r) => r.role === 'user' && !r.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX))
      .map((r) => (extractText(r.content) ?? '').trim()),
  );
  const lines: CoordinatorLine[] = [];
  for (const row of rows) {
    const push = (text: string) =>
      lines.push({ id: row.id, at: row.createdAt, text, projectId: row.projectId });
    const content = row.content;
    if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
      const { kind, call } = content as {
        kind?: unknown;
        call?: { name?: unknown; arguments?: unknown };
      };
      if (kind === 'toolcall' && typeof call?.name === 'string')
        push(
          `Coordinator 调用工具 ${call.name} ${JSON.stringify(call.arguments ?? {}).slice(0, 200)}`,
        );
      continue;
    }
    const text = (extractText(content) ?? '').trim();
    if (text === '') continue;
    if (text.startsWith('{')) {
      let kind: unknown = null;
      try {
        kind = (JSON.parse(text) as { kind?: unknown }).kind;
      } catch {}
      if (kind === ASK_USER_QUESTION_KIND) push(`Coordinator 向用户提问：${text.slice(0, 600)}`);
      if (typeof kind === 'string') continue;
    }
    if (row.role === 'assistant') push(`Coordinator：${text}`);
    if (row.role !== 'user') continue;
    const event = shortEvent(text, row.id);
    if (event !== null) push(`系统通知：${event}`);
    else if (!row.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX) || !postedTexts.has(text))
      push(`用户：${text}`);
  }
  return lines;
}

export function chiefHistoryFor(
  db: Db,
  threadRow: typeof chiefThread.$inferSelect,
  stepRow: typeof step.$inferSelect,
): string | null {
  const ownerMessageIds = stepRow.ownerMessageIds ?? [];
  const rows = db
    .select()
    .from(chiefMessage)
    .where(
      and(
        conversational(threadRow.id),
        not(like(chiefMessage.id, `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}%`)),
        lt(chiefMessage.createdAt, stepRow.createdAt),
        ownerMessageIds.length > 0 ? notInArray(chiefMessage.id, ownerMessageIds) : undefined,
        sql`CASE WHEN json_valid(${chiefMessage.content}) THEN json_type(${chiefMessage.content}) != 'object' ELSE 0 END`,
      ),
    )
    .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
    .limit(CHIEF_HISTORY_MAX_ROWS)
    .all()
    .reverse();
  let budget = CHIEF_HISTORY_MAX_CHARS;
  const kept: string[] = [];
  for (const line of chiefTranscriptLines(rows).reverse()) {
    const whole = redacted(line.text);
    const text =
      whole.length > CHIEF_HISTORY_LINE_MAX_CHARS
        ? `${whole.slice(0, CHIEF_HISTORY_LINE_MAX_CHARS)}\n[cut: ${whole.length} characters in all]`
        : whole;
    if (text.length + 1 > budget) break;
    budget -= text.length + 1;
    kept.unshift(text);
  }
  return kept.length === 0 ? null : fenceHistoryText(`[最近的对话]\n${kept.join('\n')}`);
}
