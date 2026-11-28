import {
  AUTOMATIC_RETRY_ROW_KIND,
  BUILD_FAILURE_ROW_KIND,
  chiefTurnErrorContentSchema,
  RUN_TRACE_VALUE_CAP,
  type RunTrace,
  type RunTraceItem,
  type RunTurnPage,
  type RunTurnProblem,
  type RunUsage,
  redactSecrets,
  systemRowOf,
  transcriptPromptRowId,
} from '@cairn/shared';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, chiefTurnUsage, message, step, tokenUsage } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { classifyBuildCause } from '../reliability-report.js';
import { parseChiefTrigger } from './chief.js';
import { CHIEF_STOP_ROW_ID_PREFIX } from './chief-turns.js';
import { messageText } from './conversation-page.js';
import { resolveRunTarget, type TeamBuild, type TeamThread, teamThread } from './run-target.js';

type StepRow = typeof step.$inferSelect;
type Row = { id: string; role: string; content: unknown; createdAt: number };

const FIRST_LINE_MAX = 120;
const ZERO: RunUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const CHIEF_ERROR_PREFIX = 'chief-err-';

function textOf(content: unknown): string {
  return messageText(content).trim();
}

function firstLineOf(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '') ?? '';
  const chars = Array.from(line.trim());
  return chars.length > FIRST_LINE_MAX
    ? `${chars.slice(0, FIRST_LINE_MAX).join('')}…`
    : chars.join('');
}

function capped(raw: unknown, cap: boolean): { value: unknown; cut: boolean } {
  const value = redactSecrets(raw ?? null).value;
  if (!cap || value === null) return { value, cut: false };
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= RUN_TRACE_VALUE_CAP) return { value, cut: false };
  return { value: text.slice(0, RUN_TRACE_VALUE_CAP), cut: true };
}

function toolItem(row: Row, cap: boolean): RunTraceItem | null {
  const content = row.content;
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return null;
  const { kind, call } = content as { kind?: unknown; call?: Record<string, unknown> };
  if (kind !== 'toolcall' || call === undefined || call === null) return null;
  const args = capped(call.arguments, cap);
  const result = capped(call.result, cap);
  return {
    kind: 'tool',
    id: row.id,
    at: typeof call.startedAt === 'number' ? call.startedAt : row.createdAt,
    name: typeof call.name === 'string' ? call.name : 'tool',
    arguments: args.value,
    result: result.value,
    isError: call.isError === true,
    endedAt: typeof call.endedAt === 'number' ? call.endedAt : null,
    truncated: args.cut || result.cut,
  };
}

function assistantItems(row: Row, cap: boolean): RunTraceItem[] {
  const tool = toolItem(row, cap);
  if (tool !== null) return [tool];
  if (!Array.isArray(row.content)) {
    const text = textOf(row.content);
    return text === '' ? [] : [{ kind: 'reply', id: row.id, at: row.createdAt, text }];
  }
  const blocks = row.content as { type?: unknown; text?: unknown; thinking?: unknown }[];
  return blocks.flatMap((block, index): RunTraceItem[] => {
    const id = blocks.length === 1 ? row.id : `${row.id}#${index}`;
    if (
      block?.type === 'thinking' &&
      typeof block.thinking === 'string' &&
      block.thinking.trim() !== ''
    )
      return [{ kind: 'thinking', id, at: row.createdAt, text: block.thinking.trim() }];
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
      return [{ kind: 'reply', id, at: row.createdAt, text: block.text.trim() }];
    return [];
  });
}

function turnErrorText(content: unknown): string {
  try {
    const parsed = chiefTurnErrorContentSchema.safeParse(
      typeof content === 'string' ? JSON.parse(content) : content,
    );
    if (parsed.success) return parsed.data.message;
  } catch {}
  return textOf(content);
}

function sumUsage(rows: readonly RunUsage[]): RunUsage {
  return rows.reduce(
    (sum, u) => ({
      input: sum.input + u.input,
      output: sum.output + u.output,
      cacheRead: sum.cacheRead + u.cacheRead,
      cacheWrite: sum.cacheWrite + u.cacheWrite,
    }),
    ZERO,
  );
}

function boundToStep(id: string, stepId: string): boolean {
  return (
    id === stepId ||
    id === transcriptPromptRowId(stepId) ||
    id === `${CHIEF_ERROR_PREFIX}${stepId}` ||
    id === `${CHIEF_STOP_ROW_ID_PREFIX}${stepId}` ||
    id.startsWith(`msg-${stepId}-`) ||
    id.startsWith(`${stepId}-`) ||
    new RegExp(`^native-[A-Za-z0-9_-]+:${stepId.replace(/[^A-Za-z0-9]/g, '\\$&')}-[et]\\d+$`).test(
      id,
    )
  );
}

function neighbourTurn(db: Db, row: StepRow, direction: 'previous' | 'next') {
  const before = direction === 'previous';
  return db
    .select({ id: step.id, claimedAt: step.claimedAt })
    .from(step)
    .where(
      and(
        eq(step.buildId, row.buildId),
        eq(step.kind, 'chief'),
        before
          ? or(
              lt(step.createdAt, row.createdAt),
              and(eq(step.createdAt, row.createdAt), lt(step.id, row.id)),
            )
          : or(
              gt(step.createdAt, row.createdAt),
              and(eq(step.createdAt, row.createdAt), gt(step.id, row.id)),
            ),
      ),
    )
    .orderBy(
      before ? desc(step.createdAt) : asc(step.createdAt),
      before ? desc(step.id) : asc(step.id),
    )
    .get();
}

function turnWindow(db: Db, row: StepRow) {
  if (row.claimedAt === null) return { start: 0, end: 0 };
  const next = db
    .select({ claimedAt: step.claimedAt })
    .from(step)
    .where(
      and(eq(step.buildId, row.buildId), eq(step.kind, 'chief'), gt(step.claimedAt, row.claimedAt)),
    )
    .orderBy(asc(step.claimedAt))
    .get();
  return { start: row.claimedAt, end: next?.claimedAt ?? Number.MAX_SAFE_INTEGER };
}

function turnTrace(db: Db, thread: TeamThread, stepId: string, capResults: boolean): RunTrace {
  const row = db.select().from(step).where(eq(step.id, stepId)).get();
  if (row === undefined) throw new HttpError(404, `run ${stepId}`);
  const previous = neighbourTurn(db, row, 'previous');
  const next = neighbourTurn(db, row, 'next');
  const { start, end } = turnWindow(db, row);
  const owners = new Set(row.ownerMessageIds ?? []);
  const rows = db
    .select({
      id: chiefMessage.id,
      role: chiefMessage.role,
      content: chiefMessage.content,
      createdAt: chiefMessage.createdAt,
    })
    .from(chiefMessage)
    .where(
      and(
        eq(chiefMessage.threadId, thread.id),
        or(
          and(gt(chiefMessage.createdAt, start), lte(chiefMessage.createdAt, end)),
          inArray(chiefMessage.id, [...owners, stepId, transcriptPromptRowId(stepId)]),
          inArray(chiefMessage.id, [
            `${CHIEF_ERROR_PREFIX}${stepId}`,
            `${CHIEF_STOP_ROW_ID_PREFIX}${stepId}`,
          ]),
          sql`instr(${chiefMessage.id}, ${stepId}) > 0`,
        ),
      ),
    )
    .orderBy(asc(chiefMessage.createdAt), asc(sql`rowid`))
    .all();
  const items: RunTraceItem[] = [];
  for (const m of rows) {
    const bound = boundToStep(m.id, stepId) || owners.has(m.id);
    if (owners.has(m.id) || m.id === stepId) {
      const text = textOf(m.content);
      if (text !== '') items.push({ kind: 'user', id: m.id, at: m.createdAt, text });
      continue;
    }
    if (m.id === transcriptPromptRowId(stepId)) {
      items.push({ kind: 'prompt', id: m.id, at: m.createdAt, text: textOf(m.content) });
      continue;
    }
    if (m.id === `${CHIEF_ERROR_PREFIX}${stepId}`) {
      items.push({ kind: 'error', id: m.id, at: m.createdAt, text: turnErrorText(m.content) });
      continue;
    }
    if (m.id === `${CHIEF_STOP_ROW_ID_PREFIX}${stepId}`) {
      items.push({ kind: 'stopped', id: m.id, at: m.createdAt });
      continue;
    }
    if (m.role !== 'assistant') continue;
    const tool = toolItem(m, capResults);
    if (tool !== null) {
      if (m.createdAt > start && m.createdAt <= end) items.push(tool);
      continue;
    }
    if (bound) items.push(...assistantItems(m, capResults));
  }
  const usageRows = db.select().from(chiefTurnUsage).where(eq(chiefTurnUsage.stepId, stepId)).all();
  const owner = items.find((i) => i.kind === 'user');
  return {
    kind: 'coordinator',
    id: stepId,
    title: owner?.kind === 'user' ? firstLineOf(owner.text) : thread.title,
    threadId: thread.id,
    todoId: null,
    status: row.status,
    startedAt: row.claimedAt ?? row.createdAt,
    finishedAt: row.claimedAt === null ? null : row.finishedAt,
    models: [...new Set(usageRows.map((u) => u.model))],
    usage: sumUsage(usageRows),
    previousId: previous?.id ?? null,
    nextId: next?.id ?? null,
    failure: failureOf(items),
    items,
  };
}

function failureOf(items: readonly RunTraceItem[]): RunTrace['failure'] {
  const errorAt = items.findLastIndex((i) => i.kind === 'error');
  if (errorAt === -1) return null;
  const error = items[errorAt];
  const tool = items.slice(0, errorAt).findLast((i) => i.kind === 'tool' && i.isError);
  return { text: error?.kind === 'error' ? error.text : '', itemId: tool?.id ?? null };
}

function systemItem(row: Row): RunTraceItem | null {
  const parsed = systemRowOf(row.content);
  if (parsed?.kind === BUILD_FAILURE_ROW_KIND) {
    const reason = parsed.reason.trim();
    return reason === '' ? null : { kind: 'error', id: row.id, at: row.createdAt, text: reason };
  }
  if (parsed?.kind === AUTOMATIC_RETRY_ROW_KIND) {
    const detail = parsed.priorError ? `: ${parsed.priorError}` : '';
    return {
      kind: 'note',
      id: row.id,
      at: row.createdAt,
      text: `automatic retry ${parsed.attempt}${detail}`,
    };
  }
  const text = textOf(row.content);
  return text === '' || text.startsWith('{')
    ? null
    : { kind: 'note', id: row.id, at: row.createdAt, text };
}

function buildTrace(db: Db, owner: TeamBuild, capResults: boolean): RunTrace {
  const steps = db
    .select()
    .from(step)
    .where(eq(step.buildId, owner.id))
    .orderBy(asc(step.createdAt), asc(step.id))
    .all();
  const rows = db
    .select({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(eq(message.conversationId, owner.id))
    .orderBy(asc(message.createdAt), asc(sql`rowid`))
    .all();
  const stepIds = new Set(steps.map((s) => s.id));
  const items: RunTraceItem[] = steps.map((s) => ({
    kind: 'step',
    id: `step-${s.id}`,
    at: s.claimedAt ?? s.createdAt,
    stepKind: s.kind,
    status: s.status,
  }));
  for (const m of rows) {
    if (m.role === 'user') {
      const promptOf = m.id.startsWith('user-') && stepIds.has(m.id.slice('user-'.length));
      items.push({
        kind: promptOf ? 'prompt' : 'user',
        id: m.id,
        at: m.createdAt,
        text: textOf(m.content),
      });
      continue;
    }
    if (m.role === 'system') {
      const item = systemItem(m);
      if (item !== null) items.push(item);
      continue;
    }
    items.push(...assistantItems(m, capResults));
  }
  if (owner.errorMessage !== null && owner.errorMessage.trim() !== '')
    items.push({
      kind: 'error',
      id: `build-error-${owner.id}`,
      at: Math.max(owner.createdAt, ...steps.map((s) => s.finishedAt ?? 0)),
      text: owner.errorMessage,
    });
  items.sort((a, b) => a.at - b.at);
  const usage = db
    .select({
      model: tokenUsage.model,
      input: tokenUsage.input,
      output: tokenUsage.output,
      cacheRead: tokenUsage.cacheRead,
      cacheWrite: tokenUsage.cacheWrite,
    })
    .from(tokenUsage)
    .where(eq(tokenUsage.buildId, owner.id))
    .all();
  const last = steps.at(-1);
  const finished = steps.every((s) => s.finishedAt !== null) ? (last?.finishedAt ?? null) : null;
  return {
    kind: 'task',
    id: owner.id,
    title: `#${owner.seqNum} ${owner.title}`,
    threadId: null,
    todoId: owner.todoId,
    status: last?.status ?? 'pending',
    startedAt: steps[0]?.claimedAt ?? owner.createdAt,
    finishedAt: finished,
    models: [...new Set(usage.map((u) => u.model))],
    usage: sumUsage(usage),
    previousId: null,
    nextId: null,
    failure: failureOf(items),
    items,
  };
}

export function readRunTrace(db: Db, teamId: string, id: string, full: boolean): RunTrace {
  const target = resolveRunTarget(db, teamId, id);
  const trace =
    target.kind === 'turn'
      ? turnTrace(db, target.thread, target.stepId, !full)
      : target.kind === 'build' && (target.stepId !== null || target.build.id === id)
        ? buildTrace(db, target.build, !full)
        : null;
  if (trace === null) throw new HttpError(404, `run ${id}`);
  return redactSecrets(trace).value as RunTrace;
}

function turnError(db: Db, stepId: string): string | null {
  const row = db
    .select({ content: chiefMessage.content })
    .from(chiefMessage)
    .where(eq(chiefMessage.id, `${CHIEF_ERROR_PREFIX}${stepId}`))
    .get();
  return row === undefined ? null : turnErrorText(row.content);
}

function problemOf(db: Db, row: StepRow): RunTurnProblem | null {
  if (row.quotaBlock !== null) return 'quota';
  if (row.status === 'stopped') return 'stopped';
  if (row.status !== 'failed') return null;
  const cause = classifyBuildCause({
    errorMessage: turnError(db, row.id) ?? 'turn failed without a recorded error',
    prNumber: null,
    ageMs: nowMs() - row.createdAt,
  });
  return cause === 'quota' ? 'quota' : 'failed';
}

export interface RunTurnsQuery {
  limit: number;
  before?: string | undefined;
  problems: boolean;
}

export function listRunTurns(
  db: Db,
  teamId: string,
  threadId: string,
  query: RunTurnsQuery,
): RunTurnPage {
  const thread = teamThread(db, threadId, teamId);
  if (thread === undefined) throw new HttpError(404, `thread ${threadId}`);
  const conditions: SQL[] = [eq(step.buildId, thread.id), eq(step.kind, 'chief')];
  if (query.problems)
    conditions.push(
      or(inArray(step.status, ['failed', 'stopped']), isNotNull(step.quotaBlock)) as SQL,
    );
  if (query.before !== undefined) {
    const cursor = db
      .select({ createdAt: step.createdAt })
      .from(step)
      .where(and(eq(step.id, query.before), eq(step.buildId, thread.id)))
      .get();
    if (cursor === undefined) throw new HttpError(404, `turn ${query.before}`);
    conditions.push(
      or(
        lt(step.createdAt, cursor.createdAt),
        and(eq(step.createdAt, cursor.createdAt), lt(step.id, query.before)),
      ) as SQL,
    );
  }
  const rows = db
    .select()
    .from(step)
    .where(and(...conditions))
    .orderBy(desc(step.createdAt), desc(step.id))
    .limit(query.limit + 1)
    .all();
  const page = rows.slice(0, query.limit);
  return {
    turns: page.map((row) => {
      const { start, end } = turnWindow(db, row);
      const ownerId = row.ownerMessageIds?.[0] ?? row.id;
      const owner = db
        .select({ content: chiefMessage.content })
        .from(chiefMessage)
        .where(and(eq(chiefMessage.threadId, thread.id), eq(chiefMessage.id, ownerId)))
        .get();
      const toolCount =
        db
          .select({ n: sql<number>`count(*)` })
          .from(chiefMessage)
          .where(
            and(
              eq(chiefMessage.threadId, thread.id),
              gt(chiefMessage.createdAt, start),
              lte(chiefMessage.createdAt, end),
              sql`json_valid(${chiefMessage.content}) and json_extract(${chiefMessage.content}, '$.kind') = 'toolcall'`,
            ),
          )
          .get()?.n ?? 0;
      return {
        stepId: row.id,
        at: row.createdAt,
        problem: problemOf(db, row),
        firstLine: firstLineOf(
          redactSecrets(owner === undefined ? '' : textOf(owner.content)).value as string,
        ),
        woke: parseChiefTrigger(row.prompt) !== 'user',
        toolCount,
        durationMs:
          row.claimedAt !== null && row.finishedAt !== null ? row.finishedAt - row.claimedAt : null,
      };
    }),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}
