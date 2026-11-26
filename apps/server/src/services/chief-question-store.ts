import {
  ASK_USER_QUESTION_KIND,
  type AskUserQuestionContent,
  askUserQuestionContentSchema,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
} from '@cairn/shared';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, chiefThread, step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { ConversationStreamHub } from './events.js';
import { stepScopeProjectId } from './picked-project.js';

export interface StoreDeps {
  db: Db;
  convHub?: ConversationStreamHub;
}

export const CHIEF_TURN_END_REASON = '回合已结束';

export const ASK_PARKED_REASON =
  '用户还没有回答。问题已留在用户的待办和对话里，用户回答后会开新一轮把问题和答复一起带给你。请现在简短说明在等用户回答，然后结束本轮，不要继续等待。';

export const ACTION_PROPOSAL_CARD_MARKER = 'action-proposal:';

export const APPROVAL_CARD_ID_PREFIX = 'approval-';

export function proposalIdOfCard(content: AskUserQuestionContent): string | null {
  const marker = content.askedFor?.find((entry) => entry.startsWith(ACTION_PROPOSAL_CARD_MARKER));
  return marker === undefined ? null : marker.slice(ACTION_PROPOSAL_CARD_MARKER.length);
}

export function isOwnerAnswered(question: AskUserQuestionContent): boolean {
  return (
    question.status === 'answered' &&
    question.answeredBy !== 'coordinator' &&
    (question.answers ?? []).length > 0
  );
}

export function askQuestionContentOf(content: unknown): AskUserQuestionContent | null {
  if (typeof content !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { kind?: unknown }).kind !== ASK_USER_QUESTION_KIND
  ) {
    return null;
  }
  const row = askUserQuestionContentSchema.safeParse(parsed);
  return row.success ? row.data : null;
}

export function readQuestion(
  db: Db,
  threadId: string,
  requestId: string,
): AskUserQuestionContent | null {
  const row = db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.id, requestId), eq(chiefMessage.threadId, threadId)))
    .get();
  return row === undefined ? null : askQuestionContentOf(row.content);
}

function askingTurnProjectId(db: Db, threadId: string): string | null {
  const turn = db
    .select({ prompt: step.prompt, scopeProjectId: step.scopeProjectId })
    .from(step)
    .where(and(eq(step.buildId, threadId), eq(step.kind, 'chief'), eq(step.status, 'claimed')))
    .get();
  return turn === undefined ? null : stepScopeProjectId(turn);
}

export function questionAskedAt(db: Db, threadId: string, requestId: string): number | null {
  return (
    db
      .select({ createdAt: chiefMessage.createdAt })
      .from(chiefMessage)
      .where(and(eq(chiefMessage.id, requestId), eq(chiefMessage.threadId, threadId)))
      .get()?.createdAt ?? null
  );
}

export function ownerSpokeSince(db: Db, threadId: string, since: number): boolean {
  return db
    .select({ id: chiefMessage.id })
    .from(chiefMessage)
    .where(
      and(
        eq(chiefMessage.threadId, threadId),
        eq(chiefMessage.role, 'user'),
        gt(chiefMessage.createdAt, since),
        or(isNull(chiefMessage.origin), eq(chiefMessage.origin, 'user')),
      ),
    )
    .all()
    .some((row) => !row.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX));
}

export function parkedReply(content: AskUserQuestionContent): AskUserQuestionContent {
  return { ...content, status: 'cancelled', cancelReason: ASK_PARKED_REASON };
}

export function writeQuestion(
  db: Db,
  threadId: string,
  requestId: string,
  content: AskUserQuestionContent,
  createdAt: number,
): void {
  db.insert(chiefMessage)
    .values({
      id: requestId,
      threadId,
      role: 'assistant',
      content: JSON.stringify(content),
      projectId: askingTurnProjectId(db, threadId),
      createdAt,
    })
    .onConflictDoUpdate({
      target: chiefMessage.id,
      set: { content: JSON.stringify(content) },
    })
    .run();
  db.update(chiefThread).set({ updatedAt: nowMs() }).where(eq(chiefThread.id, threadId)).run();
}

export function publishQuestion(deps: StoreDeps, threadId: string, requestId: string): void {
  const row = deps.db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.id, requestId), eq(chiefMessage.threadId, threadId)))
    .get();
  if (row === undefined) return;
  deps.convHub?.publishMessage(threadId, {
    id: row.id,
    role: row.role,
    content: row.content,
    projectId: row.projectId,
    createdAt: row.createdAt,
  });
}

export function cancelQuestion(
  deps: StoreDeps,
  input: { threadId: string; requestId: string; reason: string },
): void {
  const content = readQuestion(deps.db, input.threadId, input.requestId);
  if (content !== null && proposalIdOfCard(content) !== null) {
    throw new HttpError(403, 'an approval card is answered only on its card in Cairn');
  }
  if (content === null || content.status !== 'pending') return;
  const next: AskUserQuestionContent = {
    ...content,
    status: 'cancelled',
    cancelReason: input.reason,
  };
  writeQuestion(deps.db, input.threadId, input.requestId, next, nowMs());
  publishQuestion(deps, input.threadId, input.requestId);
}

export function pendingPlainQuestionIds(
  db: Db,
  threadId: string,
  projectId: string | null,
): string[] {
  return db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, threadId))
    .all()
    .filter((row) => {
      const content = askQuestionContentOf(row.content);
      return (
        content !== null &&
        content.status === 'pending' &&
        (projectId === null || row.projectId === projectId) &&
        !row.id.startsWith(APPROVAL_CARD_ID_PREFIX) &&
        proposalIdOfCard(content) === null &&
        content.questions.length === 1 &&
        content.questions[0]?.options.length === 0
      );
    })
    .map((row) => row.id);
}

export function cancelPendingQuestions(deps: StoreDeps, threadId: string, reason: string): void {
  const rows = deps.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, threadId)).all();
  for (const row of rows) {
    if (row.id.startsWith('user-') || row.id.startsWith('chief-err-')) continue;
    const content = askQuestionContentOf(row.content);
    if (content === null || content.status !== 'pending' || content.parkedAt !== undefined) {
      continue;
    }
    const next: AskUserQuestionContent = { ...content, status: 'cancelled', cancelReason: reason };
    writeQuestion(deps.db, threadId, row.id, next, nowMs());
    publishQuestion(deps, threadId, row.id);
  }
}
