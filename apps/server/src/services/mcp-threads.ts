import {
  askUserAnswerBodySchema,
  isChiefConversationId,
  isChiefDigestThreadId,
  orchestrationSourceRef,
} from '@cairn/shared';
import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { build, chief, chiefMessage, chiefThread, project, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { messageTodo } from './builds.js';
import { sendChiefMessage } from './chief.js';
import { answerQuestion, askQuestionContentOf } from './chief-questions.js';
import type { ChiefToolDeps } from './chief-tools.js';
import { steerChiefMessage } from './chief-turns.js';
import { readConversationPage } from './conversation-page.js';
import { queueTaskMessage } from './task-message-queue.js';
import { toTodoRecord } from './todos.js';

const content = z
  .string()
  .max(32 * 1024)
  .refine((value) => value.trim().length > 0, 'Must not be blank');
const nonblank = z.string().refine((value) => value.trim().length > 0, 'Must not be blank');

export const THREAD_TOOL_SCHEMAS = {
  start_thread: { projectId: nonblank, content },
  threads_waiting_on_me: { projectId: nonblank.optional() },
  read_thread: { threadId: nonblank, before: nonblank.optional() },
  reply_thread: {
    threadId: nonblank,
    content: content.optional(),
    projectId: nonblank.optional(),
    mode: z.enum(['queue', 'steer']).optional(),
    requestId: nonblank.optional(),
    answers: askUserAnswerBodySchema.shape.answers.optional(),
  },
  thread_pull_requests: { threadId: nonblank },
};

export const THREAD_TOOL_DESCRIPTIONS: Record<keyof typeof THREAD_TOOL_SCHEMAS, string> = {
  start_thread:
    'Start a Thread with the Coordinator in a Project. Send the request as content; the Coordinator must already have an Agent configured.',
  threads_waiting_on_me:
    'List Threads waiting on you: pending Coordinator questions and unarchived work Threads at confirmation, review, or failure gates. Optionally filter by Project.',
  read_thread:
    'Read a Coordinator or work Thread, its current status, pending questions, and a bounded conversation page. Use nextBefore as before for older messages.',
  reply_thread:
    'Reply to a Coordinator or work Thread. Queue by default; mode=steer interrupts a running turn. For a Coordinator question, pass requestId and answers instead of content.',
  thread_pull_requests:
    'Get persisted PR links for a work Thread or work linked to a Coordinator Thread. An empty list means no PR link is recorded yet.',
};

function requireProject(db: Db, teamId: string, projectId: string) {
  const row = db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `Project ${projectId}`);
}

function requireThread(db: Db, teamId: string, threadId: string) {
  if (isChiefConversationId(threadId)) {
    const row = db
      .select()
      .from(chiefThread)
      .where(and(eq(chiefThread.id, threadId), eq(chiefThread.teamId, teamId)))
      .get();
    if (!row || isChiefDigestThreadId(threadId)) throw new HttpError(404, `Thread ${threadId}`);
    return { kind: 'coordinator' as const, row };
  }
  const row = db
    .select()
    .from(todo)
    .where(and(eq(todo.id, threadId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `Thread ${threadId}`);
  requireProject(db, teamId, row.projectId);
  return { kind: 'work' as const, row };
}

function threadProjectId(db: Db, teamId: string, threadId: string): string | null {
  return (
    db
      .select({ id: project.id })
      .from(chiefMessage)
      .innerJoin(project, eq(chiefMessage.projectId, project.id))
      .where(and(eq(chiefMessage.threadId, threadId), eq(project.teamId, teamId)))
      .orderBy(desc(chiefMessage.createdAt), sql`${chiefMessage}.rowid desc`)
      .limit(1)
      .get()?.id ?? null
  );
}

function pendingQuestions(db: Db, threadId: string) {
  return db
    .select({ content: chiefMessage.content })
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, threadId))
    .orderBy(asc(chiefMessage.createdAt))
    .all()
    .flatMap((row) => {
      const question = askQuestionContentOf(row.content);
      return question?.status === 'pending' ? [question] : [];
    });
}

function coordinatorSummary(
  db: Db,
  row: Pick<typeof chiefThread.$inferSelect, 'id' | 'chiefId' | 'teamId' | 'title' | 'updatedAt'>,
) {
  const questions = pendingQuestions(db, row.id);
  const turns = db
    .select({ status: step.status })
    .from(step)
    .where(and(eq(step.buildId, row.id), eq(step.kind, 'chief')))
    .orderBy(desc(step.createdAt), sql`rowid desc`)
    .all();
  const live = turns.some((turn) => ['pending', 'claimed', 'waiting_quota'].includes(turn.status));
  return {
    id: row.id,
    coordinatorId: row.chiefId,
    projectId: threadProjectId(db, row.teamId, row.id),
    title: row.title,
    status:
      questions.length > 0
        ? 'waiting_on_you'
        : live
          ? 'working'
          : turns[0]?.status === 'failed'
            ? 'failed'
            : 'idle',
    updatedAt: row.updatedAt,
    questions,
  };
}

function requireWorkConversation(db: Db, teamId: string, row: typeof todo.$inferSelect) {
  if (row.latestBuildId === null) return null;
  const owned = db
    .select({ id: build.id })
    .from(build)
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(build.id, row.latestBuildId), eq(todo.id, row.id), eq(todo.teamId, teamId)))
    .get();
  if (!owned) throw new HttpError(404, `Thread conversation ${row.latestBuildId}`);
  return owned.id;
}

export async function executeThreadMcpTool(
  deps: ChiefToolDeps,
  teamId: string,
  name: keyof typeof THREAD_TOOL_SCHEMAS,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { db } = deps;
  switch (name) {
    case 'start_thread': {
      const input = z.object(THREAD_TOOL_SCHEMAS.start_thread).parse(args);
      requireProject(db, teamId, input.projectId);
      const result = sendChiefMessage(deps, teamId, { ...input, threadId: null });
      deps.convHub?.publishMessage(result.thread.id, result.message);
      return {
        thread: {
          id: result.thread.id,
          projectId: input.projectId,
          status: coordinatorSummary(db, result.thread).status,
        },
        message: result.message,
      };
    }
    case 'threads_waiting_on_me': {
      const { projectId } = z.object(THREAD_TOOL_SCHEMAS.threads_waiting_on_me).parse(args);
      if (projectId !== undefined) requireProject(db, teamId, projectId);
      const coordinator = db
        .select()
        .from(chiefThread)
        .where(and(eq(chiefThread.teamId, teamId), eq(chiefThread.userId, deps.user.id)))
        .orderBy(desc(chiefThread.updatedAt))
        .all()
        .filter((row) => !isChiefDigestThreadId(row.id))
        .map((row) => coordinatorSummary(db, row))
        .filter(
          (row) =>
            row.questions.length > 0 && (projectId === undefined || row.projectId === projectId),
        );
      const work = db
        .select({ row: todo })
        .from(todo)
        .innerJoin(project, eq(todo.projectId, project.id))
        .where(
          and(
            eq(todo.teamId, teamId),
            eq(project.teamId, teamId),
            inArray(todo.phase, ['confirm', 'review', 'failed']),
            sql`${todo.archivedAt} is null`,
            or(eq(todo.ownerId, deps.user.id), sql`${todo.ownerId} is null`),
            projectId === undefined ? undefined : eq(todo.projectId, projectId),
          ),
        )
        .orderBy(desc(todo.phaseAt))
        .all()
        .map(({ row }) => ({
          id: row.id,
          projectId: row.projectId,
          title: row.title,
          status: row.phase,
        }));
      return [...coordinator, ...work];
    }
    case 'read_thread': {
      const { threadId, before } = z.object(THREAD_TOOL_SCHEMAS.read_thread).parse(args);
      const thread = requireThread(db, teamId, threadId);
      if (thread.kind === 'coordinator') {
        const { questions, ...summary } = coordinatorSummary(db, thread.row);
        return {
          thread: summary,
          questions,
          conversation: readConversationPage(db, threadId, before),
        };
      }
      const conversationId = requireWorkConversation(db, teamId, thread.row);
      if (conversationId === null && before !== undefined)
        throw new HttpError(404, `Thread message ${before}`);
      return {
        thread: { ...toTodoRecord(deps, thread.row), status: thread.row.phase },
        questions: [],
        conversation:
          conversationId === null
            ? { messages: [], truncated: false, nextBefore: null }
            : readConversationPage(db, conversationId, before),
      };
    }
    case 'reply_thread': {
      const input = z.object(THREAD_TOOL_SCHEMAS.reply_thread).parse(args);
      const thread = requireThread(db, teamId, input.threadId);
      const answering = input.requestId !== undefined || input.answers !== undefined;
      if (answering) {
        if (
          thread.kind !== 'coordinator' ||
          input.requestId === undefined ||
          input.answers === undefined ||
          input.content !== undefined ||
          input.mode !== undefined ||
          input.projectId !== undefined
        )
          throw new HttpError(400, 'Answer a Coordinator question with requestId and answers only');
        return answerQuestion(deps, {
          threadId: input.threadId,
          requestId: input.requestId,
          answers: input.answers,
        });
      }
      if (input.content === undefined) throw new HttpError(400, 'Thread reply requires content');
      if (input.projectId !== undefined) requireProject(db, teamId, input.projectId);
      if (thread.kind === 'coordinator') {
        const result = sendChiefMessage(deps, teamId, {
          threadId: input.threadId,
          content: input.content,
          projectId: input.projectId ?? threadProjectId(db, teamId, input.threadId),
        });
        deps.convHub?.publishMessage(input.threadId, result.message);
        const steered =
          input.mode === 'steer'
            ? steerChiefMessage(deps, teamId, input.threadId, result.message.id).steered
            : false;
        return { threadId: input.threadId, message: result.message, steered };
      }
      if (input.projectId !== undefined && input.projectId !== thread.row.projectId)
        throw new HttpError(400, 'A work Thread cannot change Project through a reply');
      const conversationId = requireWorkConversation(db, teamId, thread.row);
      if (conversationId === null)
        throw new HttpError(409, 'Thread has no run; ask the Coordinator to start work first');
      return input.mode === 'steer'
        ? messageTodo(deps, teamId, input.threadId, input.content)
        : queueTaskMessage(deps, conversationId, input.content);
    }
    case 'thread_pull_requests': {
      const { threadId } = z.object(THREAD_TOOL_SCHEMAS.thread_pull_requests).parse(args);
      const thread = requireThread(db, teamId, threadId);
      const watches =
        thread.kind === 'coordinator'
          ? (db
              .select({ watches: chief.watches })
              .from(chief)
              .where(and(eq(chief.id, thread.row.chiefId), eq(chief.teamId, teamId)))
              .get()
              ?.watches.filter((watch) => watch.threadId === threadId)
              .map((watch) => watch.todoId) ?? [])
          : [];
      return db
        .select({
          threadId: todo.id,
          buildId: build.id,
          prUrl: build.prUrl,
          prNumber: build.prNumber,
        })
        .from(build)
        .innerJoin(todo, eq(build.todoId, todo.id))
        .innerJoin(project, eq(todo.projectId, project.id))
        .where(
          and(
            eq(todo.teamId, teamId),
            eq(project.teamId, teamId),
            isNotNull(build.prUrl),
            ne(build.prUrl, ''),
            thread.kind === 'work'
              ? eq(todo.id, threadId)
              : or(
                  and(
                    eq(todo.sourceKind, 'orchestration'),
                    eq(todo.sourceRef, orchestrationSourceRef(threadId)),
                  ),
                  watches.length > 0 ? inArray(todo.id, watches) : undefined,
                ),
          ),
        )
        .orderBy(desc(build.createdAt))
        .all();
    }
  }
}
