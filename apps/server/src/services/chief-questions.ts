import {
  ASK_USER_QUESTION_KIND,
  type AskUserAnswer,
  type AskUserQuestion,
  type AskUserQuestionContent,
  askUserAnswerBodySchema,
  askUserQuestionSchema,
  isChiefConversationId,
  type UserRecord,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { chief, chiefThread } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import {
  parkedReply,
  proposalIdOfCard,
  publishQuestion,
  questionAskedAt,
  readQuestion,
  writeQuestion,
} from './chief-question-store.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { notifyChiefMessage } from './notifications.js';
import { pushToUserSafely, type VapidKeys } from './push.js';
import { coordinatorProfile } from './routing-rules.js';

export interface ChiefQuestionDeps {
  db: Db;
  hub?: TeamStreamHub;
  convHub?: ConversationStreamHub;
  user?: UserRecord;
  vapidKeys?: VapidKeys | null;
}

export const ASK_HOLD_MS = 70_000;

export const ASK_PARK_MS = ASK_HOLD_MS;

const ASK_POLL_MS = 400;

export function createOrGetQuestion(
  deps: ChiefQuestionDeps,
  input: {
    threadId: string;
    requestId: string;
    questions: AskUserQuestion[];
    provenance?: string;
    askedFor: string[];
  },
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
    ...(input.provenance !== undefined ? { provenance: input.provenance } : {}),
    askedFor: input.askedFor,
  };
  deps.db.transaction(() => {
    writeQuestion(deps.db, input.threadId, input.requestId, content, nowMs());
    notifyQuestion(deps, input.threadId, input.questions, input.requestId);
  });
  publishQuestion(deps, input.threadId, input.requestId);
  pushQuestion(deps, input.threadId, input.requestId, input.questions);
  return { content, created: true };
}

function notifyQuestion(
  deps: ChiefQuestionDeps,
  threadId: string,
  questions: readonly AskUserQuestion[],
  requestId?: string,
): void {
  if (deps.hub === undefined || deps.user === undefined) return;
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  const chiefRow =
    threadRow === undefined
      ? undefined
      : deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
  const agentRow = chiefRow === undefined ? null : coordinatorProfile(deps.db, chiefRow.teamId);
  notifyChiefMessage(
    { db: deps.db, hub: deps.hub, user: deps.user },
    {
      threadId,
      message: questions[0]?.question ?? '',
      ...(agentRow
        ? { agent: { name: agentRow.displayName, avatarUrl: null } }
        : { agent: { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl } }),
      ...(requestId !== undefined ? { card: { requestId } } : {}),
    },
  );
}

function pushQuestion(
  deps: ChiefQuestionDeps,
  threadId: string,
  requestId: string,
  questions: readonly AskUserQuestion[],
): void {
  if (deps.user === undefined || deps.vapidKeys == null) return;
  const teamId =
    deps.db
      .select({ teamId: chiefThread.teamId })
      .from(chiefThread)
      .where(eq(chiefThread.id, threadId))
      .get()?.teamId ?? '';
  const questionLines = questions.map((q) => {
    const options = q.options.map((o) => o.label).join(' / ');
    return options.length > 0 ? `${q.question}（${options}）` : q.question;
  });
  pushToUserSafely(deps.db, deps.vapidKeys ?? null, deps.user.id, teamId, {
    title: '需要你决定',
    body: questionLines.join('\n'),
    href: `/app?chief=${encodeURIComponent(threadId)}`,
    tag: `${deps.user.id}:${requestId}`,
  });
}

export function announceQuestion(
  deps: ChiefQuestionDeps,
  threadId: string,
  requestId: string,
): void {
  const content = readQuestion(deps.db, threadId, requestId);
  if (content === null) return;
  notifyQuestion(deps, threadId, content.questions, requestId);
  publishQuestion(deps, threadId, requestId);
  pushQuestion(deps, threadId, requestId, content.questions);
}

export async function holdForQuestion(
  deps: ChiefQuestionDeps,
  input: { threadId: string; requestId: string; holdMs: number; signal?: AbortSignal },
): Promise<AskUserQuestionContent | null> {
  const deadline = Date.now() + Math.max(0, input.holdMs);
  const askedAt = questionAskedAt(deps.db, input.threadId, input.requestId);
  for (;;) {
    if (input.signal?.aborted === true) return null;
    const content = readQuestion(deps.db, input.threadId, input.requestId);
    if (content === null || content.status !== 'pending') return content;
    if (content.parkedAt !== undefined) return parkedReply(content);
    if (askedAt !== null && Date.now() - askedAt >= ASK_PARK_MS) {
      const parked: AskUserQuestionContent = { ...content, parkedAt: Date.now() };
      writeQuestion(deps.db, input.threadId, input.requestId, parked, askedAt);
      publishQuestion(deps, input.threadId, input.requestId);
      return parkedReply(parked);
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, ASK_POLL_MS));
  }
}

export function answerQuestion(
  deps: ChiefQuestionDeps,
  input: {
    threadId: string;
    requestId: string;
    answers: AskUserAnswer[];
  },
): AskUserQuestionContent {
  const content = readQuestion(deps.db, input.threadId, input.requestId);
  if (content === null) throw new HttpError(404, `question ${input.requestId}`);
  if (proposalIdOfCard(content) !== null) {
    throw new HttpError(403, 'an approval card is answered only on its card in Cairn');
  }
  if (content.status !== 'pending') {
    const reason = content.status === 'cancelled' ? content.cancelReason : undefined;
    throw new HttpError(
      409,
      `question ${input.requestId} already ${content.status}${reason ? `: ${reason}` : ''}`,
    );
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
  const answeredAt = nowMs();
  const next: AskUserQuestionContent = {
    ...content,
    status: 'answered',
    answers: validated,
    answeredAt,
  };
  writeQuestion(deps.db, input.threadId, input.requestId, next, answeredAt);
  publishQuestion(deps, input.threadId, input.requestId);
  return next;
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
