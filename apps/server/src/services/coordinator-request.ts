import {
  type CitedSegment,
  type CoordinatorCreateTodoParams,
  type CoordinatorUpdateTodoParams,
  derivePlaceholderTitle,
  isInfoOutput,
  isIssueSourcedTask,
  orchestratedTodoIdOf,
  PLACEHOLDER_TITLE_FALLBACK,
  quoteSegments,
  RequestQuoteError,
  renderTaskText,
  segmentKey,
  type TaskRequest,
  type TaskSegment,
  type TodoRecord,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
  uncoveredText,
} from '@cairn/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { attachmentIdsInUserText } from './attachment-authorization.js';
import { askQuestionContentOf, isOwnerAnswered } from './chief-questions.js';
import { resolveTaskReplyContext } from './task-reply-context.js';
import { createAutonomousTodo, type TodoDeps, updateAutonomousTodo } from './todos.js';
import { frequentModelFor } from './top-models.js';

type TodoRow = typeof todo.$inferSelect;

export interface RequestCtx {
  teamId: string;
  threadId: string;
  turnMessageIds?: readonly string[];
}

function sourceIdOf(segment: TaskSegment): string | null {
  if (segment.source.kind === 'chat') return segment.source.messageId;
  if (segment.source.kind === 'answer') return segment.source.requestId;
  return null;
}

export function refuseInfoCardReplacedByCode(
  db: Db,
  ctx: RequestCtx,
  infoCandidateIds: readonly string[],
  replacementOutput: string | null | undefined,
  codeChangeQuote: string | undefined,
): void {
  if (isInfoOutput(replacementOutput ?? 'code') || infoCandidateIds.length === 0) return;
  const infoCards = db
    .select({ id: todo.id, output: todo.output })
    .from(todo)
    .where(and(eq(todo.teamId, ctx.teamId), inArray(todo.id, [...infoCandidateIds])))
    .all()
    .filter((row) => isInfoOutput(row.output));
  if (infoCards.length === 0) return;
  const turnWords = (ctx.turnMessageIds ?? []).length
    ? db
        .select()
        .from(chiefMessage)
        .where(
          and(
            eq(chiefMessage.threadId, ctx.threadId),
            eq(chiefMessage.role, 'user'),
            inArray(chiefMessage.id, [...(ctx.turnMessageIds ?? [])]),
          ),
        )
        .all()
        .flatMap((row) => (typeof row.content === 'string' ? [row.content.normalize('NFC')] : []))
    : [];
  const quote = codeChangeQuote?.normalize('NFC').trim();
  if (quote && turnWords.some((words) => words.includes(quote))) return;
  throw new HttpError(
    409,
    `Refused: info card ${infoCards.map((row) => row.id).join(', ')} cannot be replaced by a todo whose output is not info. Research, survey and report work stays an info card, even when a run failed or the card must reach a signed-in browser on another machine: a failed info card is retried with message_thread, or ask the owner with ask_user. A code task runs on the owner's own machine and cannot do the card's work. Nothing was changed. Only when the owner's own words in this turn explicitly ask for a code change, pass codeChangeQuote with those exact words.`,
  );
}

const NO_OWNER_WORDS =
  "create_todo needs the owner's words: cite owner messages of this thread with messageIds, or a todo with sourceTodoId. Ask the owner with ask_user when there is nothing to cite.";

function citedMessages(db: Db, ctx: RequestCtx, messageIds: readonly string[]): CitedSegment[] {
  if (new Set(messageIds).size !== messageIds.length) {
    throw new HttpError(400, 'message IDs must be unique');
  }
  const rows = db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, ctx.threadId), inArray(chiefMessage.id, [...messageIds])))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return messageIds.map((id) => {
    if (id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX)) {
      throw new HttpError(400, `message ${id} is a transcript prompt, not owner words`);
    }
    const row = byId.get(id);
    const question = row === undefined ? null : askQuestionContentOf(row.content);
    if (question !== null && isOwnerAnswered(question)) {
      const text = (question.answers ?? [])
        .map((answer) => answer.text ?? answer.choices?.join('、') ?? '')
        .filter((line) => line !== '')
        .join('\n');
      const source = {
        kind: 'answer' as const,
        threadId: ctx.threadId,
        requestId: id,
        span: 'whole' as const,
      };
      return { segment: { source, author: 'owner', sourceRef: null, text }, quoteSource: source };
    }
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
    const source = {
      kind: 'chat' as const,
      threadId: ctx.threadId,
      messageId: id,
      span: 'whole' as const,
    };
    const context = resolveTaskReplyContext(db, ctx.threadId, id, row.content);
    return {
      segment: {
        source,
        author: 'owner',
        sourceRef: null,
        text: row.content,
        ...(context === undefined ? {} : { context }),
      },
      quoteSource: source,
    };
  });
}

function citedTodo(db: Db, ctx: RequestCtx, todoId: string): CitedSegment[] {
  const row = db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, ctx.teamId)))
    .get();
  if (row === undefined) throw new HttpError(404, `todo ${todoId}`);
  if (row.request !== null) {
    return row.request.segments.map((segment, index) => ({
      segment,
      quoteSource: { kind: 'todo', todoId, segment: index, span: 'whole' },
    }));
  }
  const thirdParty = isIssueSourcedTask(row);
  const source = { kind: 'todo' as const, todoId, segment: null, span: 'whole' as const };
  return [
    {
      segment: {
        source,
        author: thirdParty ? 'third-party' : 'owner',
        sourceRef: thirdParty ? row.sourceRef : null,
        text: row.spec,
      },
      quoteSource: source,
    },
  ];
}

function quoted(cited: readonly CitedSegment[], quotes: readonly string[]): TaskSegment[] {
  try {
    return quoteSegments(cited, quotes);
  } catch (error) {
    if (error instanceof RequestQuoteError) throw new HttpError(400, error.message);
    throw error;
  }
}

function ownerGrants(segments: readonly TaskSegment[], teamId: string): string[] {
  return [
    ...new Set(
      segments
        .filter((segment) => segment.author === 'owner')
        .flatMap((segment) => [
          segment.text,
          ...(segment.context?.messages ?? [])
            .filter((message) => message.role === 'user')
            .map((message) => message.text),
        ])
        .flatMap((text) => attachmentIdsInUserText(text, teamId)),
    ),
  ];
}

function splitSiblings(db: Db, teamId: string, keys: ReadonlySet<string>): TodoRow[] {
  return db
    .select()
    .from(todo)
    .where(and(eq(todo.teamId, teamId), isNotNull(todo.request)))
    .all()
    .filter((row) =>
      (row.request?.segments ?? []).some(
        (segment) => segment.source.span === 'quote' && keys.has(segmentKey(segment.source)),
      ),
    );
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

function requireUnboundMessages(
  db: Db,
  ctx: RequestCtx,
  segments: readonly TaskSegment[],
  exceptTodoId?: string,
): void {
  const keys = new Set(segments.map((segment) => segmentKey(segment.source)));
  const existing = db
    .select({ id: todo.id, request: todo.request })
    .from(todo)
    .where(and(eq(todo.teamId, ctx.teamId), isNotNull(todo.request)))
    .all();
  for (const row of existing) {
    if (row.id === exceptTodoId) continue;
    const bound = row.request?.segments.find((segment) => keys.has(segmentKey(segment.source)));
    if (bound !== undefined) {
      throw new HttpError(
        409,
        `source ${segmentKey(bound.source)} is already bound to todo ${row.id}; use that todo, or explicitly split with quotes or sourceTodoId`,
      );
    }
  }
}

const CANDIDATE_PREVIEW_CHARS = 80;

function defaultQuoteIds(db: Db, ctx: RequestCtx): string[] {
  const turn = ctx.turnMessageIds ?? [];
  if (turn.length === 0) return [];
  const boundKeys = new Set(
    db
      .select({ request: todo.request })
      .from(todo)
      .where(and(eq(todo.teamId, ctx.teamId), isNotNull(todo.request)))
      .all()
      .flatMap((row) => row.request?.segments ?? [])
      .map((segment) => sourceIdOf(segment))
      .filter((id): id is string => id !== null),
  );
  const rows = db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, ctx.threadId), eq(chiefMessage.role, 'user')))
    .orderBy(chiefMessage.createdAt, chiefMessage.id)
    .all();
  const lastBound = rows.findLast((row) => boundKeys.has(row.id));
  const turnSet = new Set(turn);
  const picked = rows.filter(
    (row) =>
      turnSet.has(row.id) ||
      (typeof row.content === 'string' &&
        !boundKeys.has(row.id) &&
        !row.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX) &&
        orchestratedTodoIdOf(row.content) === null &&
        (lastBound === undefined || row.createdAt > lastBound.createdAt)),
  );
  const answered = turn.filter((id) => !rows.some((row) => row.id === id));
  const ids = [...picked.map((row) => row.id), ...answered];
  if (picked.length <= 1) return ids;
  const preview = (id: string) => {
    const content = picked.find((row) => row.id === id)?.content;
    const text = typeof content === 'string' ? content.replace(/\s+/g, ' ').trim() : '(answer)';
    return `- ${id}: ${text.slice(0, CANDIDATE_PREVIEW_CHARS)}`;
  };
  throw new HttpError(
    400,
    `messageIds omitted, but ${picked.length} owner messages since the last task could be this task's request. Nothing was created. Pass messageIds with the ones that state this task's request:\n${picked.map((row) => preview(row.id)).join('\n')}`,
  );
}

export function createRequestTodo(
  deps: TodoDeps,
  ctx: RequestCtx,
  params: CoordinatorCreateTodoParams & { projectId: string },
  provenance: { createdBy: string | null; ownerId: string; withoutSelfIssue?: boolean },
): TodoRecord & { uncovered?: string[] } {
  const { db } = deps;
  if (params.sourceTodoId !== undefined) {
    refuseInfoCardReplacedByCode(
      db,
      ctx,
      [params.sourceTodoId],
      params.output,
      params.codeChangeQuote,
    );
  }
  const model =
    params.model === undefined ? undefined : frequentModelFor(db, ctx.teamId, params.model);
  const messageIds = params.messageIds ?? defaultQuoteIds(db, ctx);
  if (params.sourceTodoId === undefined && messageIds.length === 0) {
    throw new HttpError(400, NO_OWNER_WORDS);
  }
  const cited =
    params.sourceTodoId !== undefined
      ? citedTodo(db, ctx, params.sourceTodoId)
      : citedMessages(db, ctx, messageIds);
  const segments =
    params.quotes === undefined ? cited.map((c) => c.segment) : quoted(cited, params.quotes);
  if (params.quotes === undefined && params.sourceTodoId === undefined) {
    requireUnboundMessages(db, ctx, segments);
  }
  requireTeamTodos(db, ctx.teamId, params.dependsOn ?? []);
  const keys = new Set(cited.map((c) => segmentKey(c.quoteSource)));
  const siblings = params.quotes === undefined ? [] : splitSiblings(db, ctx.teamId, keys);
  const summaryTitle = params.title === undefined ? '' : derivePlaceholderTitle(params.title);
  const request: TaskRequest = {
    segments,
    siblings: siblings.map((row) => row.id),
    difficulty: params.difficulty ?? null,
    titleSource: summaryTitle !== '' ? 'coordinator' : (segments[0]?.author ?? 'owner'),
    titleSourceRef: summaryTitle !== '' ? null : (segments[0]?.sourceRef ?? null),
    ...(params.briefing !== undefined ? { briefing: params.briefing } : {}),
    ...(model !== undefined ? { model } : {}),
  };
  const record = createAutonomousTodo(deps, {
    teamId: ctx.teamId,
    projectId: params.projectId,
    title:
      summaryTitle ||
      derivePlaceholderTitle(
        segments[0]?.context?.messages.find((message) => message.role === 'user')?.text ??
          segments[0]?.text ??
          '',
      ) ||
      PLACEHOLDER_TITLE_FALLBACK,
    spec: renderTaskText(request),
    createdBy: provenance.createdBy,
    ownerId: provenance.ownerId,
    orchestration: { threadId: ctx.threadId },
    ...(provenance.withoutSelfIssue === true ? { withoutSelfIssue: true } : {}),
    request,
    userSpecAttachmentIds: ownerGrants(segments, ctx.teamId),
    ...(params.dependsOn !== undefined || params.blockedBy !== undefined
      ? { blockedBy: [...(params.dependsOn ?? []), ...(params.blockedBy ?? [])] }
      : {}),
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
  if (params.quotes === undefined) return record;
  const allQuoted = [...siblings.flatMap((row) => row.request?.segments ?? []), ...segments];
  return { ...record, uncovered: uncoveredText(cited, allQuoted) };
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
  const citedIds = params.replaceMessageIds ?? params.addMessageIds;
  const added =
    citedIds === undefined ? null : citedMessages(db, ctx, citedIds).map((c) => c.segment);
  if (added !== null) {
    appendableRow(db, ctx, params.todoId);
    requireUnboundMessages(
      db,
      ctx,
      added,
      params.replaceMessageIds === undefined ? undefined : params.todoId,
    );
  }
  const summaryTitle =
    params.title === undefined ? undefined : derivePlaceholderTitle(params.title);
  if (params.title !== undefined && summaryTitle === '') {
    throw new HttpError(400, 'invalid params.title: expected non-empty summary');
  }
  if (summaryTitle !== undefined) {
    const existing = db
      .select({ id: todo.id, request: todo.request })
      .from(todo)
      .where(and(eq(todo.id, params.todoId), eq(todo.teamId, ctx.teamId)))
      .get();
    if (existing === undefined) throw new HttpError(404, `todo ${params.todoId}`);
    if (existing.request === null) {
      throw new HttpError(
        409,
        `todo ${params.todoId} has no cited request; summary titles are only for Coordinator-created request tasks`,
      );
    }
  }
  const routed = updateAutonomousTodo(
    deps,
    params.todoId,
    {
      ...(summaryTitle !== undefined ? { title: summaryTitle } : {}),
      ...(params.blockedBy !== undefined ? { blockedBy: params.blockedBy } : {}),
      ...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
    },
    summaryTitle !== undefined ? { textWriter: 'coordinator-title' } : {},
  );
  if (added === null || routed === null) return routed;
  const row = appendableRow(db, ctx, params.todoId);
  const replacing = params.replaceMessageIds !== undefined;
  const request: TaskRequest = {
    ...row.request,
    segments: replacing ? added : [...row.request.segments, ...added],
  };
  const grants = [
    ...new Set([
      ...(replacing ? [] : row.userSpecAttachmentIds),
      ...ownerGrants(added, ctx.teamId),
    ]),
  ];
  return db.transaction(() => {
    db.update(todo).set({ request }).where(eq(todo.id, row.id)).run();
    return updateAutonomousTodo(
      deps,
      row.id,
      { spec: renderTaskText(request) },
      { userSpecAttachmentIds: grants, textWriter: 'request-service' },
    );
  });
}
