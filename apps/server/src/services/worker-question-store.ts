import {
  ASK_USER_QUESTION_KIND,
  type AskUserAnswer,
  type AskUserQuestionContent,
  askUserQuestionContentSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { message } from '../db/schema.js';
import type { ConversationStreamHub } from './events.js';

interface StoreDeps {
  db: Db;
  convHub?: ConversationStreamHub;
}

function contentOf(raw: unknown): AskUserQuestionContent | null {
  if (raw === null || typeof raw !== 'object') return null;
  if ((raw as { kind?: unknown }).kind !== ASK_USER_QUESTION_KIND) return null;
  const parsed = askUserQuestionContentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function readWorkerQuestion(
  db: Db,
  buildId: string,
  requestId: string,
): AskUserQuestionContent | null {
  const row = db
    .select()
    .from(message)
    .where(and(eq(message.id, requestId), eq(message.conversationId, buildId)))
    .get();
  return row === undefined ? null : contentOf(row.content);
}

export function writeWorkerQuestion(
  deps: StoreDeps,
  buildId: string,
  requestId: string,
  content: AskUserQuestionContent,
  createdAt: number,
): void {
  deps.db
    .insert(message)
    .values({
      id: requestId,
      conversationId: buildId,
      role: 'assistant',
      content,
      createdAt,
      actor: null,
    })
    .onConflictDoUpdate({ target: message.id, set: { content } })
    .run();
  deps.convHub?.publishMessage(buildId, {
    id: requestId,
    role: 'assistant',
    content,
    createdAt,
    actor: null,
  });
}

function pendingRows(db: Db, buildId: string) {
  return db
    .select()
    .from(message)
    .where(eq(message.conversationId, buildId))
    .all()
    .flatMap((row) => {
      const content = contentOf(row.content);
      return content !== null && content.status === 'pending'
        ? [{ id: row.id, createdAt: row.createdAt, content }]
        : [];
    });
}

export function pendingWorkerQuestions(db: Db, buildId: string): AskUserQuestionContent[] {
  return pendingRows(db, buildId).map((row) => row.content);
}

export function answerPendingWorkerQuestions(
  deps: StoreDeps,
  buildId: string,
  text: string,
): boolean {
  const pending = pendingRows(deps.db, buildId);
  for (const row of pending) {
    const answers: AskUserAnswer[] = row.content.questions.map((question) => ({
      header: question.header,
      text,
    }));
    writeWorkerQuestion(
      deps,
      buildId,
      row.id,
      { ...row.content, status: 'answered', answers },
      row.createdAt,
    );
  }
  return pending.length > 0;
}

export function cancelPendingWorkerQuestions(
  deps: StoreDeps,
  buildId: string,
  reason: string,
): void {
  for (const row of pendingRows(deps.db, buildId)) {
    writeWorkerQuestion(
      deps,
      buildId,
      row.id,
      { ...row.content, status: 'cancelled', cancelReason: reason },
      row.createdAt,
    );
  }
}
