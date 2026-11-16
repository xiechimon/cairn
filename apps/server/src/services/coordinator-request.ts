import {
  type CitedSegment,
  type CoordinatorCreateTodoParams,
  type CoordinatorUpdateTodoParams,
  categoryFreeTaskInputSchema,
  derivePlaceholderTitle,
  isIssueSourcedTask,
  orchestratedTodoIdOf,
  PLACEHOLDER_TITLE_FALLBACK,
  type ProjectBasis,
  parseReplyQuote,
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
import { chiefMessage, chiefThread, project, todo } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { attachmentIdsInUserText } from './attachment-authorization.js';
import { parseChiefTrigger } from './chief.js';
import { askQuestionContentOf, isOwnerAnswered } from './chief-questions.js';
import { listedProjects } from './personal-space.js';
import { resolveTaskReplyContext } from './task-reply-context.js';
import { createAutonomousTodo, type TodoDeps, updateAutonomousTodo } from './todos.js';

type TodoRow = typeof todo.$inferSelect;

export interface RequestCtx {
  teamId: string;
  threadId: string;
  turnMessageIds?: readonly string[];
  turnPrompt?: string | null;
}

type ProjectRow = typeof project.$inferSelect;

function sourceIdOf(segment: TaskSegment): string | null {
  if (segment.source.kind === 'chat') return segment.source.messageId;
  if (segment.source.kind === 'answer') return segment.source.requestId;
  return null;
}

function namesOf(row: ProjectRow): string[] {
  return [row.name, row.repoName, row.githubRepo, row.githubRepo?.split('/').at(-1)]
    .map((name) => (name ?? '').normalize('NFC').trim().toLowerCase())
    .filter((name) => name.length >= 2);
}

const NAME_CHAR = /[A-Za-z0-9_\-/]/;

function namesWord(words: string, name: string): boolean {
  for (let at = words.indexOf(name); at !== -1; at = words.indexOf(name, at + 1)) {
    const before = words[at - 1] ?? '';
    const after = words[at + name.length] ?? '';
    if (!NAME_CHAR.test(before) && !NAME_CHAR.test(after)) return true;
  }
  return false;
}

function ownerBodies(cited: readonly CitedSegment[]): Map<string, string> {
  return new Map(
    cited.flatMap(({ segment }) => {
      const id = sourceIdOf(segment);
      if (id === null || segment.author !== 'owner') return [];
      const body = parseReplyQuote(segment.text)?.body ?? segment.text;
      return [[id, body.normalize('NFC').toLowerCase()] as const];
    }),
  );
}

function quickLaneBasis(
  db: Db,
  ctx: RequestCtx,
  projectId: string,
  cited: readonly CitedSegment[],
  segments: readonly TaskSegment[],
): ProjectBasis {
  const target = db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), listedProjects(ctx.teamId)))
    .get();
  if (target === undefined) throw new HttpError(404, `project ${projectId}`);
  const turn = new Set(ctx.turnMessageIds ?? []);
  const ownerTurn =
    parseChiefTrigger(ctx.turnPrompt ?? null) === 'user' &&
    segments.every((segment) => {
      const id = sourceIdOf(segment);
      return segment.author === 'owner' && id !== null && turn.has(id);
    });
  if (!ownerTurn) {
    throw new HttpError(
      400,
      "lane quick needs an owner turn: cite only the owner's messages of this turn",
    );
  }
  const threadRow = db
    .select({ projectId: chiefThread.projectId })
    .from(chiefThread)
    .where(eq(chiefThread.id, ctx.threadId))
    .get();
  if (threadRow?.projectId === target.id) return { kind: 'channel', threadId: ctx.threadId };
  const chatIds = segments.flatMap((segment) =>
    segment.source.kind === 'chat' ? [segment.source.messageId] : [],
  );
  const picked =
    chatIds.length > 0
      ? db
          .select({ id: chiefMessage.id })
          .from(chiefMessage)
          .where(
            and(
              eq(chiefMessage.threadId, ctx.threadId),
              inArray(chiefMessage.id, chatIds),
              eq(chiefMessage.projectId, target.id),
            ),
          )
          .get()
      : undefined;
  if (picked !== undefined) return { kind: 'composer', messageId: picked.id };
  const names = namesOf(target);
  const bodies = ownerBodies(cited);
  for (const [index, segment] of segments.entries()) {
    const words = bodies.get(sourceIdOf(segment) ?? '') ?? '';
    const name = names.find((candidate) => namesWord(words, candidate));
    if (name === undefined) continue;
    return segment.source.kind === 'answer'
      ? { kind: 'owner-answer', segment: index }
      : { kind: 'owner-named', segment: index, name };
  }
  throw new HttpError(
    400,
    `lane quick needs a checkable destination for project ${target.id}: create it in that project's channel, or have the owner name it or pick it; otherwise ask_user which project`,
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

function requireUnboundMessages(db: Db, ctx: RequestCtx, segments: readonly TaskSegment[]): void {
  const keys = new Set(segments.map((segment) => segmentKey(segment.source)));
  const existing = db
    .select({ id: todo.id, request: todo.request })
    .from(todo)
    .where(and(eq(todo.teamId, ctx.teamId), isNotNull(todo.request)))
    .all();
  for (const row of existing) {
    const bound = row.request?.segments.find((segment) => keys.has(segmentKey(segment.source)));
    if (bound !== undefined) {
      throw new HttpError(
        409,
        `source ${segmentKey(bound.source)} is already bound to todo ${row.id}; use that todo, or explicitly split with quotes or sourceTodoId`,
      );
    }
  }
}

export function createRequestTodo(
  deps: TodoDeps,
  ctx: RequestCtx,
  params: CoordinatorCreateTodoParams & { projectId: string },
  provenance: { createdBy: string | null; ownerId: string },
): TodoRecord & { uncovered?: string[] } {
  parseWith(categoryFreeTaskInputSchema, params, 'params');
  const { db } = deps;
  const messageIds = params.messageIds ?? ctx.turnMessageIds ?? [];
  if (params.sourceTodoId === undefined && messageIds.length === 0) {
    throw new HttpError(400, NO_OWNER_WORDS);
  }
  if (params.lane === 'quick' && params.sourceTodoId !== undefined) {
    throw new HttpError(400, "lane quick cites the owner's messages, not sourceTodoId");
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
  const projectBasis =
    params.lane === 'quick'
      ? quickLaneBasis(db, ctx, params.projectId, cited, segments)
      : undefined;
  const keys = new Set(cited.map((c) => segmentKey(c.quoteSource)));
  const siblings = params.quotes === undefined ? [] : splitSiblings(db, ctx.teamId, keys);
  const request: TaskRequest = {
    segments,
    siblings: siblings.map((row) => row.id),
    difficulty: params.difficulty ?? null,
    titleSource: segments[0]?.author ?? 'owner',
    titleSourceRef: segments[0]?.sourceRef ?? null,
    ...(params.research !== undefined ? { research: params.research } : {}),
    ...(projectBasis !== undefined ? { lane: 'quick', projectBasis } : {}),
  };
  const record = createAutonomousTodo(deps, {
    teamId: ctx.teamId,
    projectId: params.projectId,
    title:
      derivePlaceholderTitle(
        segments[0]?.context?.messages.find((message) => message.role === 'user')?.text ??
          segments[0]?.text ??
          '',
      ) || PLACEHOLDER_TITLE_FALLBACK,
    spec: renderTaskText(request),
    createdBy: provenance.createdBy,
    ownerId: provenance.ownerId,
    orchestration: { threadId: ctx.threadId },
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
  parseWith(categoryFreeTaskInputSchema, params, 'params');
  const { db } = deps;
  const added =
    params.addMessageIds === undefined
      ? null
      : citedMessages(db, ctx, params.addMessageIds).map((c) => c.segment);
  if (added !== null) {
    appendableRow(db, ctx, params.todoId);
    requireUnboundMessages(db, ctx, added);
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
  const request: TaskRequest = { ...row.request, segments: [...row.request.segments, ...added] };
  const grants = [...new Set([...row.userSpecAttachmentIds, ...ownerGrants(added, ctx.teamId)])];
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
