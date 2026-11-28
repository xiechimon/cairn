import {
  AUTOMATIC_RETRY_ROW_KIND,
  BUILD_FAILURE_ROW_KIND,
  chiefTurnErrorContentSchema,
  modelCallRowSchema,
  RUN_TRACE_VALUE_CAP,
  type RunListPage,
  type RunListRow,
  type RunStatus,
  type RunTrace,
  type RunTraceItem,
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
  notLike,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';
import {
  build,
  chiefMessage,
  chiefThread,
  chiefTurnUsage,
  message,
  project,
  step,
  stepQuota,
  todo,
  tokenUsage,
} from '../db/schema.js';
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

const PREVIEW_BUDGET_CHARS = 128 * 1024;

function withPreviewBudget(items: RunTraceItem[]): RunTraceItem[] {
  let used = 0;
  return items.map((item) => {
    if (item.kind !== 'tool') return item;
    const argumentsSize = JSON.stringify(item.arguments ?? null).length;
    const size = argumentsSize + JSON.stringify(item.result ?? null).length;
    if (used + size <= PREVIEW_BUDGET_CHARS) {
      used += size;
      return item;
    }
    if (used + argumentsSize <= PREVIEW_BUDGET_CHARS) {
      used += argumentsSize;
      return { ...item, result: null, truncated: true };
    }
    used = PREVIEW_BUDGET_CHARS;
    return { ...item, arguments: null, result: null, truncated: true };
  });
}

function toolCallOf(content: unknown): Record<string, unknown> | null {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return null;
  const { kind, call } = content as { kind?: unknown; call?: unknown };
  return kind === 'toolcall' && call !== null && typeof call === 'object' && !Array.isArray(call)
    ? (call as Record<string, unknown>)
    : null;
}

function toolName(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/^使用\s+/, '')
        .replace(/^mcp__(?:acp_.+|cairn)__/, '')
        .replace(/^cairn\s*\/\s*/, '')
    : 'tool';
}

const RELAY_WRAPPER_RE = /^使用\s+mcp__acp_\w+__([A-Za-z0-9_]+)$/;
const RELAY_DIRECT_RE = /^cairn\s*\/\s*([A-Za-z0-9_]+)$/;

function payloadOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function wrapperArguments(call: Record<string, unknown>): unknown {
  const raw = typeof call.result === 'string' ? call.result : '';
  const section =
    raw === ''
      ? undefined
      : /^入参\s*\n([\s\S]*?)(?:\n(?:出参|输出|结果)(?:\s|$)|$)/.exec(raw)?.[1];
  if (section === undefined) return call.arguments ?? null;
  try {
    return JSON.parse(section) as unknown;
  } catch {
    return null;
  }
}

function relayCalls(rows: readonly Row[]): Set<string> {
  const direct = rows.flatMap((row) => {
    const call = toolCallOf(row.content);
    const match = RELAY_DIRECT_RE.exec(String(call?.name ?? ''));
    return call !== null && match !== null ? [{ id: row.id, tool: match[1] ?? '', call }] : [];
  });
  const wrappers = rows.flatMap((row) => {
    const call = toolCallOf(row.content);
    const match = RELAY_WRAPPER_RE.exec(String(call?.name ?? ''));
    if (call === null || match === null) return [];
    if (typeof call.startedAt !== 'number' || typeof call.endedAt !== 'number') return [];
    return [
      {
        id: row.id,
        tool: match[1] ?? '',
        args: wrapperArguments(call),
        startedAt: call.startedAt,
        endedAt: call.endedAt,
      },
    ];
  });
  const paired = wrappers.flatMap((wrapper) => {
    const matches = direct.filter(
      (candidate) =>
        candidate.tool === wrapper.tool &&
        typeof candidate.call.startedAt === 'number' &&
        typeof candidate.call.endedAt === 'number' &&
        candidate.call.startedAt >= wrapper.startedAt &&
        candidate.call.endedAt <= wrapper.endedAt &&
        payloadOf(candidate.call.arguments) === payloadOf(wrapper.args),
    );
    return matches.length === 1 ? [{ wrapper, direct: matches[0]?.id }] : [];
  });
  return new Set(
    paired
      .filter(
        (item) =>
          paired.filter((other) => other.direct === item.direct).length === 1 &&
          paired.filter((other) => other.wrapper.id === item.wrapper.id).length === 1,
      )
      .map((item) => item.wrapper.id),
  );
}

function toolItem(row: Row, cap: boolean): RunTraceItem | null {
  const call = toolCallOf(row.content);
  if (call === null || /^(?:工具执行完成|搜索工具信息)$/.test(toolName(call.name))) return null;
  const args = capped(call.arguments, cap);
  const result = capped(call.result, cap);
  return {
    kind: 'tool',
    id: row.id,
    at: typeof call.startedAt === 'number' ? call.startedAt : row.createdAt,
    name: toolName(call.name),
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
  const model = modelCallRowSchema.safeParse(row.content);
  if (model.success) {
    const { kind: _kind, ...fields } = model.data;
    return [{ kind: 'model', id: row.id, at: row.createdAt, ...fields }];
  }
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
  const found = db
    .select({ row: step, quotaBlock: stepQuota.quotaBlock, ranModel: stepQuota.ranModel })
    .from(step)
    .leftJoin(stepQuota, eq(stepQuota.stepId, step.id))
    .where(eq(step.id, stepId))
    .get();
  if (found === undefined) throw new HttpError(404, `run ${stepId}`);
  const row = { ...found.row, quotaBlock: found.quotaBlock, ranModel: found.ranModel };
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
  const wakeReason = parseChiefTrigger(row.prompt);
  const relays = relayCalls(rows.filter((m) => m.createdAt > start && m.createdAt <= end));
  for (const m of rows) {
    if (relays.has(m.id)) continue;
    const bound = boundToStep(m.id, stepId) || owners.has(m.id);
    if (owners.has(m.id) || m.id === stepId) {
      const text = textOf(m.content);
      if (wakeReason !== 'user' && !owners.has(m.id))
        items.push({ kind: 'wake', id: m.id, at: m.createdAt, reason: wakeReason });
      else if (text !== '') items.push({ kind: 'user', id: m.id, at: m.createdAt, text });
      continue;
    }
    if (m.id === transcriptPromptRowId(stepId)) {
      const text = textOf(m.content);
      if (wakeReason !== 'user') {
        if (!items.some((item) => item.kind === 'wake'))
          items.push({ kind: 'wake', id: m.id, at: m.createdAt, reason: wakeReason });
      } else items.push({ kind: 'prompt', id: m.id, at: m.createdAt, text });
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
    status: turnStatus(db, row),
    startedAt: row.claimedAt ?? row.createdAt,
    finishedAt: row.claimedAt === null ? null : row.finishedAt,
    models: [
      ...new Set([
        ...usageRows.map((u) => u.model),
        ...items.flatMap((i) => (i.kind === 'model' && i.model ? [i.model] : [])),
        ...(row.ranModel?.modelId ? [row.ranModel.modelId] : []),
      ]),
    ],
    usage: sumUsage(usageRows),
    failure: failureOf(items),
    items: capResults ? withPreviewBudget(items) : items,
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
    .select({ row: step, quotaBlock: stepQuota.quotaBlock, ranModel: stepQuota.ranModel })
    .from(step)
    .leftJoin(stepQuota, eq(stepQuota.stepId, step.id))
    .where(eq(step.buildId, owner.id))
    .orderBy(asc(step.createdAt), asc(step.id))
    .all()
    .map(({ row, quotaBlock, ranModel }) => ({ ...row, quotaBlock, ranModel }));
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
  const relays = relayCalls(rows);
  const items: RunTraceItem[] = steps.map((s) => ({
    kind: 'step',
    id: `step-${s.id}`,
    at: s.claimedAt ?? s.createdAt,
    stepKind: s.kind,
    status: s.status,
  }));
  const toolIds = new Map<string, string>();
  for (const m of rows) {
    if (relays.has(m.id)) continue;
    const content = m.content as { kind?: string; call?: { id?: string } } | null;
    if (content?.kind === 'toolcall' && typeof content.call?.id === 'string')
      toolIds.set(content.call.id, m.id);
  }
  for (const m of rows) {
    if (relays.has(m.id)) continue;
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
    const projected = assistantItems(m, capResults);
    const content = m.content as { call?: { parent?: string } } | null;
    const parentId = content?.call?.parent ? toolIds.get(content.call.parent) : undefined;
    if (parentId && projected[0]?.kind === 'tool') projected[0].parentId = parentId;
    items.push(...projected);
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
    status: buildStatus(steps, owner),
    startedAt: steps[0]?.claimedAt ?? owner.createdAt,
    finishedAt: finished,
    models: [
      ...new Set([
        ...usage.map((u) => u.model),
        ...items.flatMap((i) => (i.kind === 'model' && i.model ? [i.model] : [])),
        ...steps.flatMap((s) => (s.ranModel?.modelId ? [s.ranModel.modelId] : [])),
      ]),
    ],
    usage: sumUsage(usage),
    failure: failureOf(items),
    items: capResults ? withPreviewBudget(items) : items,
  };
}

export function readRunTrace(db: Db, teamId: string, id: string, full: boolean): RunTrace {
  const target = resolveRunTarget(db, teamId, id);
  if (target.kind === 'turn' && /^(chief-digest-|chief-memory-)/.test(target.thread.id))
    throw new HttpError(404, `run ${id}`);
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

type StepWithQuotaBlock = StepRow & { quotaBlock: typeof stepQuota.$inferSelect.quotaBlock };

function turnStatus(db: Db, row: StepWithQuotaBlock): RunStatus {
  if (row.quotaBlock !== null || row.status === 'waiting_quota') return 'quota';
  if (row.status === 'stopped') return 'stopped';
  if (row.status === 'failed') {
    const cause = classifyBuildCause({
      errorMessage: turnError(db, row.id) ?? 'turn failed without a recorded error',
      prNumber: null,
      ageMs: nowMs() - row.createdAt,
    });
    return cause === 'quota' ? 'quota' : 'failed';
  }
  return row.status === 'done' ? 'done' : 'running';
}

export interface RunListQuery {
  thread?: string | undefined;
  todo?: string | undefined;
  limit: number;
  before?: string | undefined;
  problems: boolean;
  includeCounts?: boolean | undefined;
}

type Cursor = { at: number; id: string };

const VISIBLE_THREAD = and(
  notLike(chiefThread.id, 'chief-digest-%'),
  notLike(chiefThread.id, 'chief-memory-%'),
) as SQL;

const stepOf = (column: AnySQLiteColumn) =>
  sql`select 1 from ${step} where ${step.buildId} = ${column}`;
const BUILD_QUOTA = sql`exists (select 1 from ${step} left join ${stepQuota} on ${stepQuota.stepId} = ${step.id} where ${step.buildId} = ${build.id} and (${step.status} = 'waiting_quota' or ${stepQuota.quotaBlock} is not null))`;
const BUILD_STOPPED = sql`(${build.stop} is not null or exists (${stepOf(build.id)} and ${step.status} = 'stopped'))`;
const BUILD_RUNNING = sql`exists (${stepOf(build.id)} and ${step.status} in ('pending', 'claimed'))`;
const BUILD_FAILED = sql`((${build.errorMessage} is not null and ${build.errorMessage} <> '') or exists (${stepOf(build.id)} and ${step.status} = 'failed'))`;

function olderThan(at: AnySQLiteColumn, id: AnySQLiteColumn, cursor: Cursor): SQL {
  return or(lt(at, cursor.at), and(eq(at, cursor.at), lt(id, cursor.id))) as SQL;
}

function parseCursor(value: string): Cursor {
  const match = /^(\d+):(.+)$/.exec(value);
  if (match === null) throw new HttpError(400, `cursor ${value}`);
  return { at: Number(match[1]), id: match[2] ?? '' };
}

function turnRows(
  db: Db,
  teamId: string,
  query: RunListQuery,
  cursor: Cursor | null,
): RunListRow[] {
  const conditions: SQL[] = [
    eq(step.kind, 'chief'),
    eq(chiefThread.teamId, teamId),
    VISIBLE_THREAD,
    ...(query.thread === undefined ? [] : [eq(chiefThread.id, query.thread)]),
  ];
  if (query.problems)
    conditions.push(
      or(
        inArray(step.status, ['failed', 'stopped', 'waiting_quota']),
        isNotNull(stepQuota.quotaBlock),
      ) as SQL,
    );
  if (cursor !== null) conditions.push(olderThan(step.createdAt, step.id, cursor));
  const rows = db
    .select({ row: step, quotaBlock: stepQuota.quotaBlock, source: project.name })
    .from(step)
    .leftJoin(stepQuota, eq(stepQuota.stepId, step.id))
    .innerJoin(chiefThread, eq(chiefThread.id, step.buildId))
    .leftJoin(project, eq(project.id, chiefThread.projectId))
    .where(and(...conditions))
    .orderBy(desc(step.createdAt), desc(step.id))
    .limit(query.limit + 1)
    .all();
  return rows.map(({ row, quotaBlock, source }) => {
    const threadId = row.buildId;
    const woke = parseChiefTrigger(row.prompt) !== 'user' && !row.ownerMessageIds?.length;
    const { start, end } = turnWindow(db, row);
    const ownerId = row.ownerMessageIds?.[0] ?? row.id;
    const owner = db
      .select({ content: chiefMessage.content })
      .from(chiefMessage)
      .where(and(eq(chiefMessage.threadId, threadId), eq(chiefMessage.id, ownerId)))
      .get();
    const toolCount =
      db
        .select({ n: sql<number>`count(*)` })
        .from(chiefMessage)
        .where(
          and(
            eq(chiefMessage.threadId, threadId),
            gt(chiefMessage.createdAt, start),
            lte(chiefMessage.createdAt, end),
            sql`json_valid(${chiefMessage.content}) and json_extract(${chiefMessage.content}, '$.kind') = 'toolcall'`,
          ),
        )
        .get()?.n ?? 0;
    return {
      id: row.id,
      kind: 'coordinator',
      threadId,
      at: row.createdAt,
      status: turnStatus(db, { ...row, quotaBlock }),
      firstLine: (() => {
        const text = owner === undefined ? '' : textOf(owner.content);
        return woke ? '' : firstLineOf(redactSecrets(text).value as string);
      })(),
      woke,
      source,
      toolCount,
      durationMs:
        row.claimedAt !== null && row.finishedAt !== null ? row.finishedAt - row.claimedAt : null,
    };
  });
}

function buildStatus(
  steps: readonly StepWithQuotaBlock[],
  owner: { stop: unknown; errorMessage: string | null },
): RunStatus {
  if (steps.some((s) => s.status === 'waiting_quota' || s.quotaBlock !== null)) return 'quota';
  if (owner.stop !== null || steps.some((s) => s.status === 'stopped')) return 'stopped';
  if (steps.some((s) => s.status === 'pending' || s.status === 'claimed')) return 'running';
  if ((owner.errorMessage ?? '') !== '' || steps.some((s) => s.status === 'failed'))
    return 'failed';
  return 'done';
}

function taskRows(
  db: Db,
  teamId: string,
  query: RunListQuery,
  cursor: Cursor | null,
): RunListRow[] {
  const conditions: SQL[] = [
    eq(todo.teamId, teamId),
    ...(query.todo === undefined ? [] : [eq(todo.id, query.todo)]),
  ];
  if (query.problems)
    conditions.push(
      sql`(${BUILD_QUOTA} or ${BUILD_STOPPED} or (${BUILD_FAILED} and not ${BUILD_RUNNING}))`,
    );
  if (cursor !== null) conditions.push(olderThan(build.createdAt, build.id, cursor));
  const rows = db
    .select({
      id: build.id,
      at: build.createdAt,
      stop: build.stop,
      errorMessage: build.errorMessage,
      title: todo.title,
      source: project.name,
    })
    .from(build)
    .innerJoin(todo, eq(todo.id, build.todoId))
    .innerJoin(project, eq(project.id, todo.projectId))
    .where(and(...conditions))
    .orderBy(desc(build.createdAt), desc(build.id))
    .limit(query.limit + 1)
    .all();
  return rows.map((row) => {
    const steps = db
      .select({ row: step, quotaBlock: stepQuota.quotaBlock })
      .from(step)
      .leftJoin(stepQuota, eq(stepQuota.stepId, step.id))
      .where(eq(step.buildId, row.id))
      .all()
      .map(({ row: stepRow, quotaBlock }) => ({ ...stepRow, quotaBlock }));
    const claims = steps.flatMap((s) => (s.claimedAt === null ? [] : [s.claimedAt]));
    const finished = steps.length > 0 && steps.every((s) => s.finishedAt !== null);
    const toolCount =
      db
        .select({ n: sql<number>`count(*)` })
        .from(message)
        .where(
          and(
            eq(message.conversationId, row.id),
            sql`json_valid(${message.content}) and json_extract(${message.content}, '$.kind') = 'toolcall'`,
          ),
        )
        .get()?.n ?? 0;
    return {
      id: row.id,
      kind: 'task',
      threadId: null,
      at: row.at,
      status: buildStatus(steps, row),
      firstLine: firstLineOf(row.title),
      woke: false,
      source: row.source,
      toolCount,
      durationMs:
        finished && claims.length > 0
          ? Math.max(...steps.map((s) => s.finishedAt ?? 0)) - Math.min(...claims)
          : null,
    };
  });
}

function problemCounts(db: Db, teamId: string): { threadId: string; count: number }[] {
  return db
    .select({ threadId: chiefThread.id, count: sql<number>`count(*)` })
    .from(step)
    .leftJoin(stepQuota, eq(stepQuota.stepId, step.id))
    .innerJoin(chiefThread, eq(chiefThread.id, step.buildId))
    .where(
      and(
        eq(step.kind, 'chief'),
        eq(chiefThread.teamId, teamId),
        VISIBLE_THREAD,
        or(
          inArray(step.status, ['failed', 'stopped', 'waiting_quota']),
          isNotNull(stepQuota.quotaBlock),
        ),
      ),
    )
    .groupBy(chiefThread.id)
    .all();
}

const newestFirst = (a: RunListRow, b: RunListRow) =>
  b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export function listRuns(db: Db, teamId: string, query: RunListQuery): RunListPage {
  if (query.thread !== undefined && teamThread(db, query.thread, teamId) === undefined)
    throw new HttpError(404, `thread ${query.thread}`);
  const cursor = query.before === undefined ? null : parseCursor(query.before);
  const rows = [
    ...(query.todo === undefined ? turnRows(db, teamId, query, cursor) : []),
    ...(query.thread === undefined ? taskRows(db, teamId, query, cursor) : []),
  ].sort(newestFirst);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    runs: page,
    nextCursor: rows.length > query.limit && last !== undefined ? `${last.at}:${last.id}` : null,
    ...(query.includeCounts && cursor === null ? { problemCounts: problemCounts(db, teamId) } : {}),
  };
}
