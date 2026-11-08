import {
  CHIEF_ROUTER_THREADS_PAGE,
  CHIEF_ROUTER_TOOL_NAMES,
  CHIEF_TOOLS_REMOVED_UNDER_D60,
  type Phase,
  redactSecrets,
  threadMessageBodySchema,
} from '@cairn/shared';
import { and, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, project, todo } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { newRecordId } from '../lib/ids.js';
import { tidyText } from '../lib/tidy-text.js';
import { cancelBuild, stoppedBeforeFirstRun } from './builds.js';
import type { ChiefToolCtx, ChiefToolDeps } from './chief-tools.js';
import { listNeedsYou } from './needs-you.js';
import { PhaseTransitionError } from './phase.js';
import { escalateQuestion } from './question-deadlines.js';
import { answerTaskQuestion, messageThreadAsUser, startThreadBuild } from './thread-message.js';
import { pendingWorkerQuestions } from './worker-question-store.js';

type Params = Record<string, unknown>;
type TodoRow = typeof todo.$inferSelect;

const TITLE_MAX = 160;
const LINE_MAX = 200;
const QUESTION_TEXT_MAX = 400;
const OPTION_LABELS_MAX = 8;
const ANSWER_MAX = 20_000;

const ROUTER_TOOLS: ReadonlySet<string> = new Set(CHIEF_ROUTER_TOOL_NAMES);
const REMOVED_TOOLS: ReadonlyMap<string, string> = new Map(
  Object.entries(CHIEF_TOOLS_REMOVED_UNDER_D60),
);

export function isRouterTool(name: string): boolean {
  return ROUTER_TOOLS.has(name);
}

export function assertToolNotRemoved(name: string): void {
  const replacement = REMOVED_TOOLS.get(name);
  if (replacement !== undefined) {
    throw new HttpError(410, `${name} was removed under D60. Use ${replacement}.`);
  }
}

function json(result: unknown): string {
  return JSON.stringify(result ?? null);
}

function str(params: Params, key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || v === '') {
    throw new HttpError(400, `invalid params.${key}: expected non-empty string`);
  }
  return v;
}

function optStr(params: Params, key: string): string | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new HttpError(400, `invalid params.${key}: expected string`);
  return v;
}

function teamTodo(db: Db, todoId: string, teamId: string): TodoRow {
  const row = db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  return row;
}

function tidy(text: string, max: number): string {
  const clean = tidyText(redactSecrets(text).value as string);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function openThread(deps: ChiefToolDeps, ctx: ChiefToolCtx, params: Params): string {
  const row = teamTodo(deps.db, str(params, 'todoId'), ctx.teamId);
  if (row.latestBuildId !== null && !stoppedBeforeFirstRun(deps.db, row)) {
    throw new HttpError(
      409,
      `thread #${row.seqNum} is already open; use message_thread to talk to it`,
    );
  }
  const projectRow = deps.db.select().from(project).where(eq(project.id, row.projectId)).get();
  if (projectRow?.teamId !== ctx.teamId) throw new HttpError(404, `project ${row.projectId}`);
  try {
    const buildId = startThreadBuild(deps, row, { origin: 'coordinator', actor: 'Coordinator' });
    return json({ todoId: row.id, seqNum: row.seqNum, buildId });
  } catch (error) {
    if (error instanceof PhaseTransitionError) throw new HttpError(409, error.message);
    throw error;
  }
}

async function messageThread(
  deps: ChiefToolDeps,
  ctx: ChiefToolCtx,
  params: Params,
): Promise<string> {
  const body = parseWith(
    threadMessageBodySchema,
    { content: params.content, clientMessageId: newRecordId() },
    'params',
  );
  return json(
    await messageThreadAsUser(deps, ctx.teamId, str(params, 'todoId'), body, {
      origin: 'coordinator',
      actor: 'Coordinator',
    }),
  );
}

async function answerQuestion(
  deps: ChiefToolDeps,
  ctx: ChiefToolCtx,
  params: Params,
): Promise<string> {
  const answer = str(params, 'answer');
  if (answer.length > ANSWER_MAX) {
    throw new HttpError(400, `invalid params.answer: at most ${ANSWER_MAX} characters`);
  }
  return json(
    await answerTaskQuestion(
      deps,
      ctx.teamId,
      { todoId: str(params, 'todoId'), requestId: str(params, 'requestId'), answer },
      'coordinator',
    ),
  );
}

function escalate(deps: ChiefToolDeps, ctx: ChiefToolCtx, params: Params): string {
  return json(
    escalateQuestion(deps, ctx.teamId, {
      todoId: str(params, 'todoId'),
      requestId: str(params, 'requestId'),
      class: str(params, 'class'),
      defaultAnswer: tidy(str(params, 'defaultAnswer'), ANSWER_MAX),
    }),
  );
}

function stopThread(deps: ChiefToolDeps, ctx: ChiefToolCtx, params: Params): string {
  const row = teamTodo(deps.db, str(params, 'todoId'), ctx.teamId);
  str(params, 'reason');
  if (row.latestBuildId === null) {
    throw new HttpError(409, `thread #${row.seqNum} has not started yet`);
  }
  return json({
    todoId: row.id,
    seqNum: row.seqNum,
    stopped: cancelBuild(deps, row.latestBuildId, {
      actor: 'coordinator',
      reason: tidy(str(params, 'reason'), LINE_MAX),
    }),
  });
}

function threads(db: Db, ctx: ChiefToolCtx, params: Params): string {
  const offset = params.offset === undefined || params.offset === null ? 0 : params.offset;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    throw new HttpError(400, 'invalid params.offset: expected non-negative safe integer');
  }
  const projectId = optStr(params, 'projectId');
  const hidden: Phase[] = params.includeDone === true ? ['closed'] : ['closed', 'done'];
  const rows = db
    .select({ row: todo, line: build.reportLine, stop: build.stop })
    .from(todo)
    .leftJoin(build, eq(build.id, todo.latestBuildId))
    .where(
      and(
        eq(todo.teamId, ctx.teamId),
        isNull(todo.archivedAt),
        isNotNull(todo.latestBuildId),
        notInArray(todo.phase, hidden),
        or(ne(todo.phase, 'todo'), isNotNull(build.stop)),
        projectId !== undefined ? eq(todo.projectId, projectId) : undefined,
      ),
    )
    .orderBy(desc(todo.phaseAt), todo.seqNum)
    .all();
  const page = rows.slice(offset, offset + CHIEF_ROUTER_THREADS_PAGE);
  return json({
    threads: page.map(({ row, line, stop }) => ({
      id: row.id,
      seqNum: row.seqNum,
      title: tidy(row.title, TITLE_MAX),
      projectId: row.projectId,
      phase: row.phase,
      line: line === null || line === undefined ? null : tidy(line, LINE_MAX),
      stopped:
        stop === null || stop === undefined ? null : { actor: stop.actor, reason: stop.reason },
    })),
    total: rows.length,
    nextOffset: offset + page.length < rows.length ? offset + page.length : null,
  });
}

function needsYou(deps: ChiefToolDeps, ctx: ChiefToolCtx): string {
  const { db } = deps;
  const lineOf = (buildId: string | null): string | null => {
    if (buildId === null) return null;
    const line = db
      .select({ line: build.reportLine })
      .from(build)
      .where(eq(build.id, buildId))
      .get()?.line;
    return line === undefined || line === null || line === '' ? null : tidy(line, LINE_MAX);
  };
  const asking = db
    .select()
    .from(todo)
    .where(
      and(
        eq(todo.teamId, ctx.teamId),
        isNull(todo.archivedAt),
        inArray(todo.phase, ['needs_input', 'failed', 'building', 'planning']),
        isNotNull(todo.latestBuildId),
      ),
    )
    .orderBy(desc(todo.phaseAt))
    .all()
    .filter((row) => pendingWorkerQuestions(db, row.latestBuildId as string).length > 0);
  const askingIds = new Set(asking.map((row) => row.id));
  const questions = asking.map((row) => ({
    todoId: row.id,
    seqNum: row.seqNum,
    title: tidy(row.title, TITLE_MAX),
    kind: 'question' as const,
    line: lineOf(row.latestBuildId),
    questions: pendingWorkerQuestions(db, row.latestBuildId as string).map((content) => ({
      requestId: content.requestId,
      items: content.questions.map((q) => ({
        header: tidy(q.header, QUESTION_TEXT_MAX),
        question: tidy(q.question, QUESTION_TEXT_MAX),
        options: q.options.slice(0, OPTION_LABELS_MAX).map((o) => tidy(o.label, QUESTION_TEXT_MAX)),
      })),
    })),
  }));
  const waiting = listNeedsYou({ db }, ctx.teamId, 'coordinator');
  const others = [...waiting.current, ...waiting.stale]
    .filter((entry) => !askingIds.has(entry.todo.id))
    .map((entry) => ({
      todoId: entry.todo.id,
      seqNum: entry.todo.seqNum,
      title: tidy(entry.todo.title, TITLE_MAX),
      kind: entry.reason,
      line: lineOf(entry.todo.latestBuildId ?? null),
    }));
  return json({ items: [...questions, ...others] });
}

export async function executeRouterTool(
  deps: ChiefToolDeps,
  ctx: ChiefToolCtx,
  name: string,
  params: Params,
): Promise<string> {
  switch (name) {
    case 'open_thread':
      return openThread(deps, ctx, params);
    case 'message_thread':
      return messageThread(deps, ctx, params);
    case 'stop_thread':
      return stopThread(deps, ctx, params);
    case 'answer_question':
      return answerQuestion(deps, ctx, params);
    case 'escalate_question':
      return escalate(deps, ctx, params);
    case 'threads':
      return threads(deps.db, ctx, params);
    case 'needs_you':
      return needsYou(deps, ctx);
    default:
      throw new HttpError(400, `unknown router tool: ${name}`);
  }
}
