import {
  ASK_USER_QUESTION_KIND,
  type AskUserAnswer,
  type AskUserQuestion,
  type AskUserQuestionContent,
  askUserAnswerBodySchema,
  askUserQuestionContentSchema,
  askUserQuestionSchema,
  isChiefConversationId,
  type UserRecord,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { agent, chief, chiefMessage, chiefThread } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { notifyChiefMessage } from './notifications.js';
import { pushToUserSafely, type VapidKeys } from './push.js';

export interface ChiefQuestionDeps {
  db: Db;
  hub?: TeamStreamHub;
  convHub?: ConversationStreamHub;
  user?: UserRecord;
  vapidKeys?: VapidKeys | null;
}

export const ASK_HOLD_MS = 70_000;

const ASK_POLL_MS = 400;

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

function readQuestion(db: Db, threadId: string, requestId: string): AskUserQuestionContent | null {
  const row = db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.id, requestId), eq(chiefMessage.threadId, threadId)))
    .get();
  return row === undefined ? null : askQuestionContentOf(row.content);
}

function writeQuestion(
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
      createdAt,
    })
    .onConflictDoUpdate({
      target: chiefMessage.id,
      set: { content: JSON.stringify(content) },
    })
    .run();
  db.update(chiefThread).set({ updatedAt: nowMs() }).where(eq(chiefThread.id, threadId)).run();
}

function publishRow(deps: ChiefQuestionDeps, threadId: string, requestId: string): void {
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
    createdAt: row.createdAt,
  });
}

export function createOrGetQuestion(
  deps: ChiefQuestionDeps,
  input: { threadId: string; requestId: string; questions: AskUserQuestion[] },
): { content: AskUserQuestionContent; created: boolean } {
  if (!isChiefConversationId(input.threadId)) {
    throw new HttpError(400, `thread ${input.threadId} is not a chief thread`);
  }
  const existing = readQuestion(deps.db, input.threadId, input.requestId);
  if (existing !== null) return { content: existing, created: false };
  const content: AskUserQuestionContent = {
    kind: ASK_USER_QUESTION_KIND,
    requestId: input.requestId,
    status: 'pending',
    questions: input.questions,
    answers: null,
  };
  writeQuestion(deps.db, input.threadId, input.requestId, content, nowMs());
  publishRow(deps, input.threadId, input.requestId);
  const threadRow = deps.db
    .select()
    .from(chiefThread)
    .where(eq(chiefThread.id, input.threadId))
    .get();
  const chiefRow =
    threadRow === undefined
      ? undefined
      : deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
  const agentRow =
    chiefRow?.agentId !== undefined && chiefRow.agentId !== null
      ? deps.db.select().from(agent).where(eq(agent.id, chiefRow.agentId)).get()
      : undefined;
  if (deps.hub !== undefined && deps.user !== undefined) {
    notifyChiefMessage(
      { db: deps.db, hub: deps.hub, user: deps.user },
      {
        threadId: input.threadId,
        message: input.questions[0]?.question ?? '',
        ...(agentRow
          ? { agent: { name: agentRow.displayName, avatarUrl: agentRow.avatarUrl } }
          : { agent: { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl } }),
      },
    );
  }
  if (deps.user !== undefined && deps.vapidKeys != null) {
    const questionLines = input.questions.map((q) => {
      const options = q.options.map((o) => o.label).join(' / ');
      return options.length > 0 ? `${q.question}（${options}）` : q.question;
    });
    pushToUserSafely(deps.db, deps.vapidKeys ?? null, deps.user.id, threadRow?.teamId ?? '', {
      title: '需要你决定',
      body: questionLines.join('\n'),
      href: `/app?chief=${encodeURIComponent(input.threadId)}`,
      tag: `${deps.user.id}:${input.requestId}`,
    });
  }
  return { content, created: true };
}

export async function holdForQuestion(
  deps: ChiefQuestionDeps,
  input: { threadId: string; requestId: string; holdMs: number; signal?: AbortSignal },
): Promise<AskUserQuestionContent | null> {
  const deadline = Date.now() + Math.max(0, input.holdMs);
  for (;;) {
    if (input.signal?.aborted === true) return null;
    const content = readQuestion(deps.db, input.threadId, input.requestId);
    if (content === null || content.status !== 'pending') return content;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, ASK_POLL_MS));
  }
}

export function answerQuestion(
  deps: ChiefQuestionDeps,
  input: { threadId: string; requestId: string; answers: AskUserAnswer[] },
): AskUserQuestionContent {
  const content = readQuestion(deps.db, input.threadId, input.requestId);
  if (content === null) throw new HttpError(404, `question ${input.requestId}`);
  if (content.status !== 'pending') {
    throw new HttpError(409, `question ${input.requestId} already ${content.status}`);
  }
  if (input.answers.length !== content.questions.length) {
    throw new HttpError(
      400,
      `expected ${content.questions.length} answers, got ${input.answers.length}`,
    );
  }
  const validated: AskUserAnswer[] = input.answers.map((answer, i) => {
    const question = content.questions[i];
    if (question === undefined) throw new HttpError(400, `answer ${i} has no matching question`);
    const labels = question.options.map((o) => o.label);
    if (labels.length === 0) {
      if (answer.choices !== undefined || (answer.text ?? '').trim() === '') {
        throw new HttpError(400, `question ${i} expects a non-empty text answer`);
      }
      return { header: question.header, text: (answer.text ?? '').trim() };
    }
    if (answer.text !== undefined || answer.choices === undefined || answer.choices.length === 0) {
      throw new HttpError(400, `question ${i} expects choices`);
    }
    if (answer.choices.length > 1 && question.multiSelect !== true) {
      throw new HttpError(400, `question ${i} is single-select`);
    }
    const custom = answer.choices.filter((choice) => !labels.includes(choice));
    if (custom.length > 1) {
      throw new HttpError(
        400,
        `question ${i}: at most one custom (其他) answer, got ${custom.length}`,
      );
    }
    return { header: question.header, choices: answer.choices };
  });
  const next: AskUserQuestionContent = { ...content, status: 'answered', answers: validated };
  writeQuestion(deps.db, input.threadId, input.requestId, next, nowMs());
  publishRow(deps, input.threadId, input.requestId);
  return next;
}

export function cancelQuestion(
  deps: ChiefQuestionDeps,
  input: { threadId: string; requestId: string; reason: string },
): void {
  const content = readQuestion(deps.db, input.threadId, input.requestId);
  if (content === null || content.status !== 'pending') return;
  const next: AskUserQuestionContent = {
    ...content,
    status: 'cancelled',
    cancelReason: input.reason,
  };
  writeQuestion(deps.db, input.threadId, input.requestId, next, nowMs());
  publishRow(deps, input.threadId, input.requestId);
}

export function cancelPendingQuestions(
  deps: ChiefQuestionDeps,
  threadId: string,
  reason: string,
): void {
  const rows = deps.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, threadId)).all();
  for (const row of rows) {
    if (row.id.startsWith('user-') || row.id.startsWith('chief-err-')) continue;
    const content = askQuestionContentOf(row.content);
    if (content === null || content.status !== 'pending') continue;
    const next: AskUserQuestionContent = { ...content, status: 'cancelled', cancelReason: reason };
    writeQuestion(deps.db, threadId, row.id, next, nowMs());
    publishRow(deps, threadId, row.id);
  }
}

export function parseAnswerBody(raw: unknown): AskUserAnswer[] {
  return parseWith(askUserAnswerBodySchema, raw, 'body').answers;
}

export function askUserQuestionsOfParams(params: Record<string, unknown>): AskUserQuestion[] {
  const rawQuestions = params.questions;
  if (Array.isArray(rawQuestions)) {
    const parsed = z.array(askUserQuestionSchema).min(1).max(4).safeParse(rawQuestions);
    if (!parsed.success) {
      throw new HttpError(
        400,
        `ask_user questions invalid: ${parsed.error.issues[0]?.message ?? 'shape'}`,
      );
    }
    return parsed.data;
  }
  const legacy = params.question;
  if (typeof legacy === 'string' && legacy.trim() !== '') {
    return [{ header: '问题', question: legacy, options: [] }];
  }
  throw new HttpError(400, 'ask_user expects questions[] (or legacy question string)');
}
