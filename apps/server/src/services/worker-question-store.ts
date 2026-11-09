import {
  ASK_USER_QUESTION_KIND,
  type AskUserQuestionContent,
  askUserQuestionContentSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { message } from '../db/schema.js';
import type { ConversationStreamHub } from './events.js';

export interface StoreDeps {
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

function publishQuestion(
  deps: StoreDeps,
  buildId: string,
  requestId: string,
  content: AskUserQuestionContent,
  createdAt: number,
): void {
  deps.convHub?.publishMessage(buildId, {
    id: requestId,
    role: 'assistant',
    content,
    createdAt,
    actor: null,
  });
}

export function writeWorkerQuestion(
  deps: StoreDeps,
  buildId: string,
  requestId: string,
  content: AskUserQuestionContent,
  createdAt: number,
): boolean {
  const inserted = deps.db
    .insert(message)
    .values({
      id: requestId,
      conversationId: buildId,
      role: 'assistant',
      content,
      createdAt,
      actor: null,
    })
    .onConflictDoNothing()
    .run();
  if (inserted.changes === 0) return false;
  publishQuestion(deps, buildId, requestId, content, createdAt);
  return true;
}

export function updateWorkerQuestion(
  deps: StoreDeps,
  buildId: string,
  requestId: string,
  content: AskUserQuestionContent,
  createdAt: number,
): void {
  if (readWorkerQuestion(deps.db, buildId, requestId) === null) return;
  deps.db
    .update(message)
    .set({ content })
    .where(and(eq(message.id, requestId), eq(message.conversationId, buildId)))
    .run();
  publishQuestion(deps, buildId, requestId, content, createdAt);
}

export interface WorkerQuestionRow {
  id: string;
  createdAt: number;
  content: AskUserQuestionContent;
}

export function workerQuestionRows(db: Db, buildId: string): WorkerQuestionRow[] {
  return db
    .select()
    .from(message)
    .where(eq(message.conversationId, buildId))
    .all()
    .flatMap((row) => {
      const content = contentOf(row.content);
      return content !== null ? [{ id: row.id, createdAt: row.createdAt, content }] : [];
    });
}

function pendingRows(db: Db, buildId: string): WorkerQuestionRow[] {
  return workerQuestionRows(db, buildId).filter((row) => row.content.status === 'pending');
}

export function pendingWorkerQuestionIds(db: Db, buildId: string): string[] {
  return pendingRows(db, buildId).map((row) => row.id);
}

export function pendingWorkerQuestions(db: Db, buildId: string): AskUserQuestionContent[] {
  return pendingRows(db, buildId).map((row) => row.content);
}

export function blockingWorkerQuestions(db: Db, buildId: string): AskUserQuestionContent[] {
  return pendingWorkerQuestions(db, buildId);
}

export function cancelPendingWorkerQuestions(
  deps: StoreDeps,
  buildId: string,
  reason: string,
): void {
  for (const row of pendingRows(deps.db, buildId)) {
    updateWorkerQuestion(
      deps,
      buildId,
      row.id,
      { ...row.content, status: 'cancelled', cancelReason: reason },
      row.createdAt,
    );
  }
}
