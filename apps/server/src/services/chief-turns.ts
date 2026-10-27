import {
  CHIEF_TURN_STOPPED_KIND,
  type ChiefOutage,
  type ChiefPendingMessage,
  type ChiefTurnStoppedContent,
} from '@cairn/shared';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  chief,
  chiefMessage,
  chiefThread,
  steerPending,
  step,
  stopPending,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { ConversationStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { publishStepRow } from './quota-wait.js';

type StepRow = typeof step.$inferSelect;

const LIVE_STATUSES = ['pending', 'claimed', 'waiting_quota'] as const;

const STEERED_HOLD = 'steer';

export const CHIEF_ABANDONED_STEP_MS = 120_000;

export interface ChiefTurnDeps {
  db: Db;
  machineHub?: MachineWakeHub;
  convHub?: ConversationStreamHub;
}

function liveChiefSteps(db: Db, threadId: string): StepRow[] {
  return db
    .select()
    .from(step)
    .where(
      and(
        eq(step.buildId, threadId),
        eq(step.kind, 'chief'),
        inArray(step.status, [...LIVE_STATUSES]),
      ),
    )
    .orderBy(asc(step.createdAt), sql`rowid`)
    .all();
}

function isParked(row: StepRow, now: number): boolean {
  if (row.status === 'waiting_quota') return true;
  return (
    row.status === 'pending' &&
    row.holdReason === 'quota' &&
    row.holdUntil !== null &&
    row.holdUntil > now
  );
}

export function hasEarlierLiveChiefStep(db: Db, candidate: StepRow): boolean {
  return liveChiefSteps(db, candidate.buildId).some(
    (row) =>
      row.id !== candidate.id &&
      (row.status === 'claimed' ||
        row.createdAt < candidate.createdAt ||
        (row.createdAt === candidate.createdAt && row.id < candidate.id)),
  );
}

export function chiefPendingMessages(db: Db, threadId: string): ChiefPendingMessage[] {
  const live = liveChiefSteps(db, threadId);
  const now = nowMs();
  const running = live.some((row) => row.status === 'claimed');
  const out: ChiefPendingMessage[] = [];
  let parked = false;
  live.forEach((row, index) => {
    if (row.status === 'claimed' || row.holdReason === STEERED_HOLD) return;
    parked = parked || isParked(row, now);
    const userRow = db
      .select({ id: chiefMessage.id })
      .from(chiefMessage)
      .where(
        and(
          eq(chiefMessage.id, row.id),
          eq(chiefMessage.threadId, threadId),
          eq(chiefMessage.role, 'user'),
        ),
      )
      .get();
    if (userRow === undefined) return;
    if (parked) out.push({ messageId: row.id, state: 'held' });
    else if (running || index > 0) out.push({ messageId: row.id, state: 'queued' });
  });
  return out;
}

function modelLabel(model: { provider: string | null; modelId: string | null }): string | null {
  return model.provider !== null && model.modelId !== null
    ? `${model.provider}/${model.modelId}`
    : null;
}

export function chiefThreadFallbackModel(db: Db, threadId: string): string | null {
  const model = liveChiefSteps(db, threadId)[0]?.fallback?.model;
  return model == null ? null : modelLabel(model);
}

export function chiefOutage(db: Db, chiefId: string): ChiefOutage | null {
  const now = nowMs();
  const rows = db
    .select({ stepRow: step })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .where(
      and(
        eq(chiefThread.chiefId, chiefId),
        eq(step.kind, 'chief'),
        inArray(step.status, ['pending', 'waiting_quota']),
      ),
    )
    .orderBy(sql`${step.createdAt} desc`)
    .all()
    .map((r) => r.stepRow)
    .filter((row) => isParked(row, now));
  const latest = rows[0];
  if (latest === undefined) return null;
  const chiefRow = db.select().from(chief).where(eq(chief.id, chiefId)).get();
  const agentRow = chiefRow?.agentId
    ? db.select().from(agent).where(eq(agent.id, chiefRow.agentId)).get()
    : undefined;
  const ran = latest.fallback?.model ?? {
    provider: agentRow?.provider ?? null,
    modelId: agentRow?.modelId ?? null,
  };
  return {
    reason: latest.status === 'waiting_quota' ? (latest.quotaBlock?.kind ?? 'quota') : 'quota',
    model: modelLabel(ran),
    retryAt:
      latest.status === 'waiting_quota'
        ? (latest.quotaBlock?.probeAt ?? null)
        : (latest.holdUntil ?? null),
  };
}

export function settleChiefActiveRun(db: Db, threadId: string): void {
  if (liveChiefSteps(db, threadId).length > 0) return;
  db.update(chiefThread)
    .set({ activeRun: null, updatedAt: nowMs() })
    .where(eq(chiefThread.id, threadId))
    .run();
}

function requireThread(db: Db, teamId: string, threadId: string) {
  const row = db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (!row || row.teamId !== teamId) throw new HttpError(404, `chief thread ${threadId}`);
  return row;
}

function requireUserMessage(db: Db, threadId: string, messageId: string) {
  const row = db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.id, messageId), eq(chiefMessage.threadId, threadId)))
    .get();
  if (row?.role !== 'user') throw new HttpError(404, `chief message ${messageId}`);
  return row;
}

function waitingStepOf(db: Db, threadId: string, messageId: string): StepRow {
  const row = db
    .select()
    .from(step)
    .where(and(eq(step.id, messageId), eq(step.buildId, threadId)))
    .get();
  if (row === undefined || (row.status !== 'pending' && row.status !== 'waiting_quota')) {
    throw new HttpError(409, 'chief turn already started (总管已经开始处理这条了)');
  }
  return row;
}

export function withdrawChiefMessage(
  deps: ChiefTurnDeps,
  teamId: string,
  threadId: string,
  messageId: string,
): { ok: true } {
  requireThread(deps.db, teamId, threadId);
  requireUserMessage(deps.db, threadId, messageId);
  const row = waitingStepOf(deps.db, threadId, messageId);
  const message = requireUserMessage(deps.db, threadId, messageId);
  deps.db.delete(step).where(eq(step.id, row.id)).run();
  deps.db.delete(chiefMessage).where(eq(chiefMessage.id, messageId)).run();
  settleChiefActiveRun(deps.db, threadId);
  publishStepRow(deps, row);
  deps.convHub?.publishMessage(threadId, message);
  return { ok: true };
}

export function steerChiefMessage(
  deps: ChiefTurnDeps,
  teamId: string,
  threadId: string,
  messageId: string,
): { steered: boolean } {
  const thread = requireThread(deps.db, teamId, threadId);
  const message = requireUserMessage(deps.db, threadId, messageId);
  const waiting = waitingStepOf(deps.db, threadId, messageId);
  const running = liveChiefSteps(deps.db, threadId).find((row) => row.status === 'claimed');
  if (running === undefined) return { steered: false };
  const content = typeof message.content === 'string' ? message.content : (waiting.prompt ?? '');
  const now = nowMs();
  const prior = deps.db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, threadId))
    .get();
  const merged = prior?.stepId === running.id ? `${prior.content}\n\n${content}` : content;
  deps.db
    .insert(steerPending)
    .values({ conversationId: threadId, stepId: running.id, content: merged, createdAt: now })
    .onConflictDoUpdate({
      target: steerPending.conversationId,
      set: { stepId: running.id, content: merged, createdAt: now },
    })
    .run();
  deps.db.update(step).set({ holdReason: STEERED_HOLD }).where(eq(step.id, waiting.id)).run();
  deps.machineHub?.steerSignal(thread.teamId, running.id);
  publishStepRow(deps, waiting);
  return { steered: true };
}

export function consumeChiefSteer(deps: Pick<ChiefTurnDeps, 'db' | 'convHub'>, threadId: string) {
  const steered = liveChiefSteps(deps.db, threadId).filter(
    (row) => row.status === 'pending' && row.holdReason === STEERED_HOLD,
  );
  const now = nowMs();
  for (const row of steered) {
    deps.db.delete(step).where(eq(step.id, row.id)).run();
    deps.db.update(chiefMessage).set({ createdAt: now }).where(eq(chiefMessage.id, row.id)).run();
    const message = deps.db.select().from(chiefMessage).where(eq(chiefMessage.id, row.id)).get();
    if (message) deps.convHub?.publishMessage(threadId, message);
  }
}

export function releaseUnconsumedSteer(db: Db, finished: StepRow): void {
  db.delete(steerPending)
    .where(
      and(eq(steerPending.conversationId, finished.buildId), eq(steerPending.stepId, finished.id)),
    )
    .run();
  db.update(step)
    .set({ holdReason: null })
    .where(
      and(
        eq(step.buildId, finished.buildId),
        eq(step.status, 'pending'),
        eq(step.holdReason, STEERED_HOLD),
      ),
    )
    .run();
}

export function stopChiefTurn(
  deps: ChiefTurnDeps,
  teamId: string,
  threadId: string,
): { delegated: boolean } {
  const thread = requireThread(deps.db, teamId, threadId);
  const head = liveChiefSteps(deps.db, threadId).find((row) => row.status === 'claimed');
  if (head === undefined) {
    throw new HttpError(409, 'no chief turn in flight (总管当前没有在回复)');
  }
  const now = nowMs();
  const abandoned =
    head.lastHeartbeatAt !== null && now - head.lastHeartbeatAt > CHIEF_ABANDONED_STEP_MS;
  if (!abandoned) {
    deps.db
      .insert(stopPending)
      .values({ conversationId: threadId, stepId: head.id, discard: false, createdAt: now })
      .onConflictDoUpdate({
        target: stopPending.conversationId,
        set: { stepId: head.id, discard: false, createdAt: now },
      })
      .run();
    deps.machineHub?.stopSignal(thread.teamId, head.id);
    return { delegated: true };
  }
  deps.db
    .update(step)
    .set({ status: 'stopped', finishedAt: now })
    .where(eq(step.id, head.id))
    .run();
  releaseUnconsumedSteer(deps.db, head);
  recordChiefStop(deps, head);
  settleChiefActiveRun(deps.db, threadId);
  const stopped = deps.db.select().from(step).where(eq(step.id, head.id)).get();
  if (stopped) publishStepRow(deps, stopped);
  return { delegated: false };
}

function createdTodoIdOf(content: unknown): string | null {
  if (content === null || typeof content !== 'object') return null;
  const call = (content as { kind?: unknown; call?: Record<string, unknown> }).call;
  if ((content as { kind?: unknown }).kind !== 'toolcall' || call == null) return null;
  if (call.name !== 'create_todo' || call.isError === true) return null;
  let result = call.result;
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result) as unknown;
    } catch {
      return null;
    }
  }
  const id = (result as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : null;
}

export function recordChiefStop(
  deps: Pick<ChiefTurnDeps, 'db' | 'convHub'>,
  stepRow: StepRow,
): void {
  const { db } = deps;
  const since = stepRow.claimedAt;
  const toolRows =
    since === null
      ? []
      : db
          .select({ content: chiefMessage.content })
          .from(chiefMessage)
          .where(
            and(
              eq(chiefMessage.threadId, stepRow.buildId),
              eq(chiefMessage.role, 'assistant'),
              gt(chiefMessage.createdAt, since - 1),
            ),
          )
          .orderBy(asc(chiefMessage.createdAt))
          .all();
  const todos: ChiefTurnStoppedContent['todos'] = [];
  for (const row of toolRows) {
    const todoId = createdTodoIdOf(row.content);
    if (todoId === null || todos.some((t) => t.id === todoId)) continue;
    const todoRow = db.select().from(todo).where(eq(todo.id, todoId)).get();
    if (todoRow) todos.push({ id: todoRow.id, seq: todoRow.seqNum, title: todoRow.title });
  }
  const content: ChiefTurnStoppedContent = { kind: CHIEF_TURN_STOPPED_KIND, todos };
  const row = {
    id: `chief-stop-${stepRow.id}`,
    threadId: stepRow.buildId,
    role: 'system' as const,
    content: JSON.stringify(content),
    createdAt: nowMs(),
  };
  db.insert(chiefMessage)
    .values(row)
    .onConflictDoUpdate({
      target: chiefMessage.id,
      set: { content: row.content, createdAt: row.createdAt },
    })
    .run();
  deps.convHub?.publishMessage(stepRow.buildId, row);
}
