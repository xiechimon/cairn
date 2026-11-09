import {
  assembleRequestSpec,
  type CoordinatorCreateTodoParams,
  type CoordinatorUpdateTodoParams,
  derivePlaceholderTitle,
  isIssueSourcedTask,
  orchestratedTodoIdOf,
  PLACEHOLDER_TITLE_FALLBACK,
  RequestQuoteError,
  type RequestSourceText,
  type TaskRequest,
  type TaskRequestQuote,
  type TaskRequestSource,
  type TodoRecord,
  uncoveredRequestText,
} from '@cairn/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { attachmentIdsInUserText } from './attachment-authorization.js';
import { askQuestionContentOf, isOwnerAnswered } from './chief-questions.js';
import { createAutonomousTodo, type TodoDeps, updateAutonomousTodo } from './todos.js';

type TodoRow = typeof todo.$inferSelect;

export interface RequestCtx {
  teamId: string;
  threadId: string;
  turnMessageIds?: readonly string[];
}

interface CitedSource {
  source: TaskRequestSource;
  text: RequestSourceText;
  inherits: { sourceKind: 'github-issue'; sourceRef: string | null } | null;
}

const NO_OWNER_WORDS =
  "create_todo needs the owner's words: cite owner messages of this thread with messageIds, or a todo with sourceTodoId. Ask the owner with ask_user when there is nothing to cite.";

function ownerAnswersText(content: unknown): string | null {
  const question = askQuestionContentOf(content);
  if (question === null || !isOwnerAnswered(question)) return null;
  return (question.answers ?? [])
    .map((answer) => answer.text ?? answer.choices?.join('、') ?? '')
    .filter((text) => text !== '')
    .join('\n');
}

function ownerMessagesText(db: Db, ctx: RequestCtx, messageIds: readonly string[]): string {
  const rows = db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, ctx.threadId), inArray(chiefMessage.id, [...messageIds])))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return messageIds
    .map((id) => {
      const row = byId.get(id);
      const answers = row === undefined ? null : ownerAnswersText(row.content);
      if (answers !== null) return answers;
      if (row === undefined || row.role !== 'user' || typeof row.content !== 'string') {
        throw new HttpError(400, `message ${id} is not an owner message of this thread`);
      }
      const orchestrated = orchestratedTodoIdOf(row.content);
      if (orchestrated !== null) {
        throw new HttpError(
          400,
          `message ${id} is an orchestration request for todo ${orchestrated}: open_thread on it, or split it with sourceTodoId`,
        );
      }
      return row.content;
    })
    .join('\n\n');
}

function citedMessages(db: Db, ctx: RequestCtx, messageIds: readonly string[]): CitedSource {
  return {
    source: { kind: 'chat', threadId: ctx.threadId, messageIds: [...messageIds] },
    text: { author: 'owner', text: ownerMessagesText(db, ctx, messageIds), sourceRef: null },
    inherits: null,
  };
}

function citedTodo(db: Db, ctx: RequestCtx, todoId: string): CitedSource {
  const row = db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, ctx.teamId)))
    .get();
  if (row === undefined) throw new HttpError(404, `todo ${todoId}`);
  const thirdParty = isIssueSourcedTask(row);
  return {
    source: { kind: 'todo', todoId, author: thirdParty ? 'third-party' : 'owner' },
    text: {
      author: thirdParty ? 'third-party' : 'owner',
      text: row.spec,
      sourceRef: row.sourceRef,
    },
    inherits: thirdParty ? { sourceKind: 'github-issue', sourceRef: row.sourceRef } : null,
  };
}

function assembled(texts: readonly RequestSourceText[], quotes: TaskRequestQuote[] | null): string {
  try {
    return assembleRequestSpec(texts, quotes);
  } catch (error) {
    if (error instanceof RequestQuoteError) throw new HttpError(400, error.message);
    throw error;
  }
}

const sameOrigin = (a: TaskRequestSource | undefined, b: TaskRequestSource) =>
  a !== undefined && JSON.stringify(a) === JSON.stringify(b);

function splitSiblings(db: Db, teamId: string, origin: TaskRequestSource): TodoRow[] {
  const key = origin.kind === 'chat' ? origin.messageIds[0] : origin.todoId;
  return db
    .select()
    .from(todo)
    .where(
      and(
        eq(todo.teamId, teamId),
        isNotNull(todo.request),
        sql`${todo.request} like ${`%"${key}"%`}`,
      ),
    )
    .all()
    .filter((row) => row.request?.quotes != null && sameOrigin(row.request.sources[0], origin));
}

function requireTeamTodos(db: Db, teamId: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const found = db
    .select({ id: todo.id })
    .from(todo)
    .where(and(eq(todo.teamId, teamId), inArray(todo.id, [...ids])))
    .all();
  const missing = ids.find((id) => !found.some((row) => row.id === id));
  if (missing !== undefined) throw new HttpError(404, `todo ${missing}`);
}

export function createRequestTodo(
  deps: TodoDeps,
  ctx: RequestCtx,
  params: CoordinatorCreateTodoParams,
  provenance: { createdBy: string | null; ownerId: string },
): TodoRecord & { uncovered?: string[] } {
  const { db } = deps;
  const messageIds = params.messageIds ?? ctx.turnMessageIds ?? [];
  if (params.sourceTodoId === undefined && messageIds.length === 0) {
    throw new HttpError(400, NO_OWNER_WORDS);
  }
  const cited =
    params.sourceTodoId !== undefined
      ? citedTodo(db, ctx, params.sourceTodoId)
      : citedMessages(db, ctx, messageIds);
  const quotes = params.quotes?.map((text) => ({ source: 0, text })) ?? null;
  const spec = assembled([cited.text], quotes);
  requireTeamTodos(db, ctx.teamId, params.dependsOn ?? []);
  const siblings = quotes === null ? [] : splitSiblings(db, ctx.teamId, cited.source);
  const request: TaskRequest = {
    sources: [cited.source],
    quotes,
    siblings: siblings.map((row) => row.id),
    difficulty: params.difficulty ?? null,
    titleSource: 'owner',
  };
  const record = createAutonomousTodo(deps, {
    teamId: ctx.teamId,
    projectId: params.projectId,
    title:
      derivePlaceholderTitle(quotes?.[0]?.text ?? cited.text.text) || PLACEHOLDER_TITLE_FALLBACK,
    spec,
    createdBy: provenance.createdBy,
    ownerId: provenance.ownerId,
    orchestration: { threadId: ctx.threadId },
    request,
    ...(cited.inherits !== null
      ? {
          sourceKind: cited.inherits.sourceKind,
          ...(cited.inherits.sourceRef !== null ? { sourceRef: cited.inherits.sourceRef } : {}),
        }
      : {}),
    ...(cited.text.author === 'owner'
      ? { userSpecAttachmentIds: attachmentIdsInUserText(cited.text.text, ctx.teamId) }
      : {}),
    ...(params.dependsOn !== undefined ? { blockedBy: params.dependsOn } : {}),
    ...(params.priority === 'first' ? { orderFirst: true } : {}),
    ...(params.output !== undefined ? { output: params.output } : {}),
  });
  for (const sibling of siblings) {
    if (sibling.request === null) continue;
    db.update(todo)
      .set({ request: { ...sibling.request, siblings: [...sibling.request.siblings, record.id] } })
      .where(eq(todo.id, sibling.id))
      .run();
  }
  if (quotes === null) return record;
  const allQuotes = [
    ...siblings.flatMap((row) => (row.request?.quotes ?? []).filter((q) => q.source === 0)),
    ...quotes,
  ];
  return { ...record, uncovered: uncoveredRequestText([cited.text], allQuotes) };
}

function appendableRow(
  db: Db,
  ctx: RequestCtx,
  todoId: string,
): TodoRow & { request: TaskRequest } {
  const row = db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, ctx.teamId)))
    .get();
  if (row === undefined) throw new HttpError(404, `todo ${todoId}`);
  if (row.request === null) {
    throw new HttpError(
      409,
      `todo ${todoId} has no cited request; forward the owner's words with message_thread`,
    );
  }
  if (row.phase !== 'todo' || row.latestBuildId !== null) {
    throw new HttpError(
      409,
      `todo ${todoId} has started; forward the owner's words with message_thread`,
    );
  }
  return { ...row, request: row.request };
}

export function updateRequestTodo(
  deps: TodoDeps,
  ctx: RequestCtx,
  params: CoordinatorUpdateTodoParams,
): TodoRecord | null {
  const { db } = deps;
  if (params.addMessageIds !== undefined) appendableRow(db, ctx, params.todoId);
  const added =
    params.addMessageIds === undefined ? null : citedMessages(db, ctx, params.addMessageIds);
  const routed = updateAutonomousTodo(deps, params.todoId, {
    ...(params.tagIds !== undefined ? { tagIds: params.tagIds } : {}),
    ...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
  });
  if (added === null || routed === null) return routed;
  const row = appendableRow(db, ctx, params.todoId);
  const grants = [
    ...new Set([
      ...row.userSpecAttachmentIds,
      ...attachmentIdsInUserText(added.text.text, ctx.teamId),
    ]),
  ];
  return db.transaction(() => {
    db.update(todo)
      .set({ request: { ...row.request, sources: [...row.request.sources, added.source] } })
      .where(eq(todo.id, row.id))
      .run();
    return updateAutonomousTodo(
      deps,
      row.id,
      { spec: `${row.spec}\n\n${added.text.text}` },
      { userSpecAttachmentIds: grants },
    );
  });
}
