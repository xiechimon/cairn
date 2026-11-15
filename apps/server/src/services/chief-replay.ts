import {
  CHIEF_DIGEST_ROW_ID_PREFIX,
  CHIEF_REPORT_ROW_ID_PREFIX,
  redactSecrets,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
} from '@cairn/shared';
import { and, asc, desc, eq, gt, isNotNull, isNull, like, lt, ne, not, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, step } from '../db/schema.js';
import { chiefTranscriptLines } from './chief-digest.js';

export const CHIEF_REPLAY_MAX_CHARS = 6000;
const CHIEF_REPLAY_MAX_ROWS = 300;

export function chiefReplaySection(db: Db, threadId: string): string | null {
  const lastServerStep = db
    .select({ createdAt: step.createdAt })
    .from(step)
    .where(
      and(
        eq(step.buildId, threadId),
        eq(step.kind, 'chief'),
        isNull(step.machineId),
        isNotNull(step.claimedAt),
      ),
    )
    .orderBy(desc(step.createdAt), sql`rowid desc`)
    .get();
  const firstRunnerStep = db
    .select({ createdAt: step.createdAt, ownerMessageIds: step.ownerMessageIds })
    .from(step)
    .where(
      and(
        eq(step.buildId, threadId),
        eq(step.kind, 'chief'),
        isNotNull(step.machineId),
        lastServerStep === undefined ? undefined : gt(step.createdAt, lastServerStep.createdAt),
      ),
    )
    .orderBy(asc(step.createdAt), sql`rowid`)
    .get();
  if (firstRunnerStep === undefined) return null;
  const current = new Set(firstRunnerStep.ownerMessageIds ?? []);
  const rows = db
    .select()
    .from(chiefMessage)
    .where(
      and(
        eq(chiefMessage.threadId, threadId),
        lt(chiefMessage.createdAt, firstRunnerStep.createdAt),
        ne(chiefMessage.role, 'system'),
        not(like(chiefMessage.id, `${CHIEF_DIGEST_ROW_ID_PREFIX}%`)),
        not(like(chiefMessage.id, `${CHIEF_REPORT_ROW_ID_PREFIX}%`)),
        not(like(chiefMessage.id, `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}%`)),
      ),
    )
    .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
    .limit(CHIEF_REPLAY_MAX_ROWS)
    .all()
    .reverse()
    .filter(
      (row) =>
        !current.has(row.id) &&
        (typeof row.content !== 'object' || row.content === null || Array.isArray(row.content)),
    );
  const text = chiefTranscriptLines(rows)
    .map((line) => line.text)
    .join('\n');
  if (text === '') return null;
  const redacted = redactSecrets(text).value as string;
  const tailStart = redacted.length - CHIEF_REPLAY_MAX_CHARS;
  const lineStart = tailStart <= 0 ? 0 : redacted.indexOf('\n', tailStart) + 1;
  const capped = redacted.slice(lineStart === 0 && tailStart > 0 ? tailStart : lineStart);
  return `## 此前的对话（本线程改用 Claude Code 之前，只读背景）\n${capped}`;
}
