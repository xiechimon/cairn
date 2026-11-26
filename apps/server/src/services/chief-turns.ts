import {
  ACTIVE_STEP_STATUSES,
  CHIEF_MESSAGE_MERGED,
  CHIEF_MESSAGE_READ,
  CHIEF_TURN_STOPPED_KIND,
  CHIEF_TURN_WAITING_TO_RETRY,
  type ChiefPendingMessage,
  type ChiefTurnStoppedContent,
  isChiefSideThreadId,
  NOTHING_TO_STOP,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
} from '@cairn/shared';
import { and, asc, eq, gt, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { steerWithdrawals } from '../coordinator/steer-withdrawals.js';
import type { Db } from '../db/client.js';
import {
  chiefMessage,
  chiefThread,
  coordinatorInput,
  steerPending,
  step,
  stopPending,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { CHIEF_TURN_END_REASON, cancelPendingQuestions } from './chief-question-store.js';
import { queueCoordinatorInput, STEER_WITHDRAW_HOLD } from './coordinator-inputs.js';
import { signalCoordinator } from './coordinator-signal.js';
import { claimIsDead, isClaimedStepDead } from './dispatch-timeouts.js';
import type { ConversationStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { settleMemoryEditTurn } from './memory-edit-turns.js';
import { stepScopeProjectId } from './picked-project.js';
import { projectTurnContext } from './project-instructions.js';
import { publishStepRow } from './quota-wait.js';
import { coordinatorMemoryOwner } from './routing-rules.js';
import { CHIEF_ABANDONED_STEP_MS } from './turn-provenance.js';

type StepRow = typeof step.$inferSelect;

const STEERED_HOLD = 'steer';
const STEER_SENT_HOLD = 'steer_sent';
export const STEER_HOLDS = [STEERED_HOLD, STEER_SENT_HOLD, STEER_WITHDRAW_HOLD];

export { CHIEF_ABANDONED_STEP_MS } from './turn-provenance.js';

export const CHIEF_TURN_MAX_MS = 30 * 60_000;
export const CHIEF_TURN_STOP_GRACE_MS = 120_000;

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
        inArray(step.status, [...ACTIVE_STEP_STATUSES]),
      ),
    )
    .orderBy(asc(step.createdAt), sql`rowid`)
    .all();
}

export function hasRunningChiefTurn(db: Db, threadId: string): boolean {
  return liveChiefSteps(db, threadId).some((row) => row.status === 'claimed');
}

export function isParkedChiefStep(row: StepRow, now: number): boolean {
  if (row.status === 'waiting_quota') return true;
  return (
    row.status === 'pending' &&
    row.holdReason === 'quota' &&
    row.holdUntil !== null &&
    row.holdUntil > now
  );
}

export function hasEarlierLiveChiefStep(db: Db, candidate: StepRow): boolean {
  const live = liveChiefSteps(db, candidate.buildId);
  const at = live.findIndex((row) => row.id === candidate.id);
  return live.some(
    (row, index) => row.id !== candidate.id && (row.status === 'claimed' || index < at),
  );
}

export function chiefPendingMessages(db: Db, threadId: string): ChiefPendingMessage[] {
  const live = liveChiefSteps(db, threadId);
  const now = nowMs();
  const running = live.some((row) => row.status === 'claimed');
  const out: ChiefPendingMessage[] = [];
  let parked = false;
  live.forEach((row, index) => {
    if (row.status === 'claimed') return;
    const steered = STEER_HOLDS.includes(row.holdReason ?? '');
    if (!steered) parked = parked || isParkedChiefStep(row, now);
    for (const messageId of stepOwners(row)) {
      const userRow = db
        .select({ id: chiefMessage.id })
        .from(chiefMessage)
        .where(
          and(
            eq(chiefMessage.id, messageId),
            eq(chiefMessage.threadId, threadId),
            eq(chiefMessage.role, 'user'),
          ),
        )
        .get();
      if (userRow === undefined) continue;
      if (steered) out.push({ messageId, state: 'steering' });
      else if (parked) out.push({ messageId, state: 'held' });
      else if (running || index > 0) out.push({ messageId, state: 'queued' });
    }
  });
  return out;
}

export function chiefModelLabel(model: {
  provider: string | null;
  modelId: string | null;
}): string | null {
  return model.provider !== null && model.modelId !== null
    ? `${model.provider}/${model.modelId}`
    : null;
}

export function chiefThreadFallbackModel(db: Db, threadId: string): string | null {
  const model = liveChiefSteps(db, threadId)[0]?.fallback?.model;
  return model == null ? null : chiefModelLabel(model);
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
  if (!row || row.teamId !== teamId || isChiefSideThreadId(row.id))
    throw new HttpError(404, `chief thread ${threadId}`);
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

export function stepOwners(row: StepRow): string[] {
  return row.ownerMessageIds !== null && row.ownerMessageIds.length > 0
    ? row.ownerMessageIds
    : [row.id];
}

export function waitingStepOf(db: Db, threadId: string, messageId: string): StepRow {
  const row = liveChiefSteps(db, threadId).find(
    (candidate) =>
      (candidate.status === 'pending' || candidate.status === 'waiting_quota') &&
      stepOwners(candidate).includes(messageId),
  );
  if (row === undefined) {
    throw new HttpError(
      409,
      'chief turn already started (Coordinator 已经开始处理这条了)',
      CHIEF_MESSAGE_READ,
    );
  }
  return row;
}

const READ_ALREADY = 'message already read by the running turn (Coordinator 已经读到这条了)';

function deleteWaitingMessage(
  deps: ChiefTurnDeps,
  threadId: string,
  row: StepRow,
  messageId: string,
  extra: () => void = () => {},
): void {
  const message = requireUserMessage(deps.db, threadId, messageId);
  deps.db.transaction(() => {
    extra();
    deps.db.delete(step).where(eq(step.id, row.id)).run();
    deps.db.delete(chiefMessage).where(eq(chiefMessage.id, messageId)).run();
  });
  settleChiefActiveRun(deps.db, threadId);
  publishStepRow(deps, row);
  deps.convHub?.publishMessage(threadId, message);
}

export async function withdrawChiefMessage(
  deps: ChiefTurnDeps,
  teamId: string,
  threadId: string,
  messageId: string,
): Promise<{ ok: true }> {
  const thread = requireThread(deps.db, teamId, threadId);
  requireUserMessage(deps.db, threadId, messageId);
  if (!liveChiefSteps(deps.db, threadId).some((live) => stepOwners(live).includes(messageId))) {
    throw new HttpError(409, 'the turn for this message already ended', NOTHING_TO_STOP);
  }
  const row = waitingStepOf(deps.db, threadId, messageId);
  if (stepOwners(row).length > 1) {
    throw new HttpError(
      409,
      'message was merged with others (这条已经和其他消息合在一起了)',
      CHIEF_MESSAGE_MERGED,
    );
  }
  if (row.holdReason === STEER_SENT_HOLD)
    throw new HttpError(409, READ_ALREADY, CHIEF_MESSAGE_READ);
  if (row.holdReason !== STEERED_HOLD && row.holdReason !== STEER_WITHDRAW_HOLD) {
    deleteWaitingMessage(deps, threadId, row, messageId);
    return { ok: true };
  }
  const input = deps.db
    .select()
    .from(coordinatorInput)
    .where(and(eq(coordinatorInput.id, row.id), eq(coordinatorInput.state, 'pending')))
    .get();
  if (input === undefined) {
    deleteWaitingMessage(deps, threadId, row, messageId, () =>
      rebuildMachineSteer(deps, thread, row.id),
    );
    return { ok: true };
  }
  if (input.conversationId === null) {
    deleteWaitingMessage(deps, threadId, row, messageId, () =>
      deps.db.delete(coordinatorInput).where(eq(coordinatorInput.id, input.id)).run(),
    );
    return { ok: true };
  }
  const withdraw = steerWithdrawals.get(input.stepId);
  if (withdraw === undefined) throw new HttpError(409, READ_ALREADY, CHIEF_MESSAGE_READ);
  const message = requireUserMessage(deps.db, threadId, messageId);
  deps.db
    .update(step)
    .set({ holdReason: STEER_WITHDRAW_HOLD })
    .where(and(eq(step.id, row.id), eq(step.holdReason, STEERED_HOLD)))
    .run();
  const result = await withdraw(input.id);
  if (result !== 'aborted' && result !== 'not_found') {
    deps.db
      .update(step)
      .set({ holdReason: STEERED_HOLD })
      .where(and(eq(step.id, row.id), eq(step.holdReason, STEER_WITHDRAW_HOLD)))
      .run();
    throw new HttpError(409, READ_ALREADY, CHIEF_MESSAGE_READ);
  }
  deps.db.transaction(() => {
    deps.db
      .update(coordinatorInput)
      .set({ state: 'released', successorStepId: null })
      .where(and(eq(coordinatorInput.id, input.id), eq(coordinatorInput.state, 'pending')))
      .run();
    deps.db.delete(step).where(eq(step.id, row.id)).run();
    deps.db.delete(chiefMessage).where(eq(chiefMessage.id, messageId)).run();
  });
  settleChiefActiveRun(deps.db, threadId);
  publishStepRow(deps, row);
  deps.convHub?.publishMessage(threadId, message);
  return { ok: true };
}

function steerContent(
  db: Db,
  thread: typeof chiefThread.$inferSelect,
  running: StepRow,
  waiting: StepRow,
): string {
  const message = db.select().from(chiefMessage).where(eq(chiefMessage.id, waiting.id)).get();
  const scope = stepScopeProjectId(waiting);
  const projectSection =
    scope !== null && scope !== stepScopeProjectId(running)
      ? projectTurnContext(db, {
          teamId: thread.teamId,
          agentId: coordinatorMemoryOwner(db, thread.teamId) ?? null,
          projectId: scope,
          threadId: thread.id,
        })
      : null;
  return [
    waiting.prompt ?? (typeof message?.content === 'string' ? message.content : ''),
    projectSection,
  ]
    .filter((part) => part)
    .join('\n\n');
}

function rebuildMachineSteer(
  deps: ChiefTurnDeps,
  thread: typeof chiefThread.$inferSelect,
  withdrawnId: string,
): void {
  const live = liveChiefSteps(deps.db, thread.id);
  const running = live.find((row) => row.status === 'claimed');
  const prior = deps.db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, thread.id))
    .get();
  if (running === undefined || prior?.stepId !== running.id) return;
  const content = live
    .filter(
      (row) =>
        row.status === 'pending' && row.holdReason === STEERED_HOLD && row.id !== withdrawnId,
    )
    .map((row) => steerContent(deps.db, thread, running, row))
    .join('\n\n');
  if (content === '') {
    deps.db.delete(steerPending).where(eq(steerPending.conversationId, thread.id)).run();
    return;
  }
  deps.db
    .update(steerPending)
    .set({ content, sentAt: null })
    .where(eq(steerPending.conversationId, thread.id))
    .run();
}

export function steerChiefMessage(
  deps: ChiefTurnDeps,
  teamId: string,
  threadId: string,
  messageId: string,
): { steered: boolean } {
  const thread = requireThread(deps.db, teamId, threadId);
  requireUserMessage(deps.db, threadId, messageId);
  const waiting = waitingStepOf(deps.db, threadId, messageId);
  const running = liveChiefSteps(deps.db, threadId).find((row) => row.status === 'claimed');
  if (running === undefined) return { steered: false };
  if (STEER_HOLDS.includes(waiting.holdReason ?? '')) return { steered: true };
  const content = steerContent(deps.db, thread, running, waiting);
  const markSteered = () =>
    deps.db
      .update(chiefMessage)
      .set({ delivery: 'steer' })
      .where(inArray(chiefMessage.id, stepOwners(waiting)))
      .run();
  if (running.machineId === null) {
    deps.db.transaction(() => {
      queueCoordinatorInput(deps.db, running, waiting, content);
      deps.db.update(step).set({ holdUntil: null }).where(eq(step.id, waiting.id)).run();
      markSteered();
    });
    deps.machineHub?.steerSignal(thread.teamId, running.id);
    signalCoordinator(threadId, 'steer');
    publishStepRow(deps, waiting);
    return { steered: true };
  }
  const now = nowMs();
  const prior = deps.db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, threadId))
    .get();
  const merged =
    prior?.stepId === running.id && prior.sentAt === null
      ? `${prior.content}\n\n${content}`
      : content;
  deps.db.transaction(() => {
    deps.db
      .insert(steerPending)
      .values({ conversationId: threadId, stepId: running.id, content: merged, createdAt: now })
      .onConflictDoUpdate({
        target: steerPending.conversationId,
        set: { stepId: running.id, content: merged, createdAt: now, sentAt: null },
      })
      .run();
    deps.db
      .update(step)
      .set({ holdReason: STEERED_HOLD, holdUntil: null })
      .where(eq(step.id, waiting.id))
      .run();
    markSteered();
  });
  deps.machineHub?.steerSignal(thread.teamId, running.id);
  publishStepRow(deps, waiting);
  return { steered: true };
}

export function addTurnOwnerMessage(db: Db, threadId: string, messageId: string): void {
  const running = liveChiefSteps(db, threadId).find((row) => row.status === 'claimed');
  if (running === undefined) return;
  const current = running.ownerMessageIds ?? [];
  if (current.includes(messageId)) return;
  db.update(step)
    .set({ ownerMessageIds: [...current, messageId] })
    .where(eq(step.id, running.id))
    .run();
}

export function takeChiefSteer(
  db: Db,
  threadId: string,
  options: { batches?: boolean } = {},
): string[] | null {
  const native = new Set(
    db
      .select({ id: coordinatorInput.id })
      .from(coordinatorInput)
      .where(and(eq(coordinatorInput.threadId, threadId), eq(coordinatorInput.state, 'pending')))
      .all()
      .map((input) => input.id),
  );
  const live = liveChiefSteps(db, threadId).filter((row) => !native.has(row.id));
  if (options.batches !== true && live.some((row) => row.holdReason === STEER_SENT_HOLD))
    return null;
  const batch = live.filter((row) => row.status === 'pending' && row.holdReason === STEERED_HOLD);
  for (const waiting of batch) {
    for (const id of waiting.ownerMessageIds ?? []) addTurnOwnerMessage(db, threadId, id);
  }
  const ids = batch.map((row) => row.id);
  if (ids.length > 0)
    db.update(step)
      .set({ holdReason: STEER_SENT_HOLD })
      .where(and(inArray(step.id, ids), eq(step.holdReason, STEERED_HOLD)))
      .run();
  return ids;
}

export function chiefSteerSentBatch(
  db: Db,
  threadId: string,
  running: StepRow,
): { ids: string[]; content: string } {
  const thread = db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (thread === undefined) return { ids: [], content: '' };
  const sent = liveChiefSteps(db, threadId).filter(
    (row) => row.status === 'pending' && row.holdReason === STEER_SENT_HOLD,
  );
  return {
    ids: sent.map((row) => row.id),
    content: sent.map((row) => steerContent(db, thread, running, row)).join('\n\n'),
  };
}

export function steeredMessageScopes(db: Db, running: StepRow): (string | null)[] {
  const native = db
    .select()
    .from(coordinatorInput)
    .where(eq(coordinatorInput.stepId, running.id))
    .all();
  if (native.length > 0) {
    const owners = [
      ...new Set(
        native
          .filter((input) => input.kind === 'steer' && input.state === 'consumed')
          .flatMap((input) => input.ownerMessageIds),
      ),
    ];
    return owners.length === 0
      ? []
      : db
          .select({ projectId: chiefMessage.projectId })
          .from(chiefMessage)
          .where(and(eq(chiefMessage.threadId, running.buildId), inArray(chiefMessage.id, owners)))
          .all()
          .map((message) => message.projectId);
  }
  return steeredMessages(db, running).map((message) => message.projectId);
}

function steeredMessages(db: Db, running: StepRow): { id: string; projectId: string | null }[] {
  if (running.claimedAt === null) return [];
  const claimedAt = running.claimedAt;
  return db
    .select({ id: chiefMessage.id, projectId: chiefMessage.projectId })
    .from(chiefMessage)
    .where(
      and(
        eq(chiefMessage.threadId, running.buildId),
        eq(chiefMessage.role, 'user'),
        or(isNull(chiefMessage.origin), eq(chiefMessage.origin, 'user')),
        gt(chiefMessage.createdAt, claimedAt),
      ),
    )
    .all()
    .filter((message) => !message.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX))
    .filter((message) => {
      const queued = db
        .select({ holdReason: step.holdReason })
        .from(step)
        .where(eq(step.id, message.id))
        .get();
      return queued === undefined || STEER_HOLDS.includes(queued.holdReason ?? '');
    });
}

export function ackChiefSteer(
  deps: Pick<ChiefTurnDeps, 'db' | 'convHub' | 'machineHub'>,
  teamId: string,
  running: StepRow,
  messageIds?: readonly string[],
): void {
  const threadId = running.buildId;
  const native = new Set(
    deps.db
      .select({ id: coordinatorInput.id })
      .from(coordinatorInput)
      .where(and(eq(coordinatorInput.threadId, threadId), eq(coordinatorInput.state, 'pending')))
      .all()
      .map((input) => input.id),
  );
  const sent = liveChiefSteps(deps.db, threadId).filter(
    (row) =>
      row.status === 'pending' &&
      row.holdReason === STEER_SENT_HOLD &&
      !native.has(row.id) &&
      (messageIds === undefined || messageIds.includes(row.id)),
  );
  const now = nowMs();
  for (const row of sent) {
    deps.db.delete(step).where(eq(step.id, row.id)).run();
    deps.db.update(chiefMessage).set({ createdAt: now }).where(eq(chiefMessage.id, row.id)).run();
    const message = deps.db.select().from(chiefMessage).where(eq(chiefMessage.id, row.id)).get();
    if (message) deps.convHub?.publishMessage(threadId, message);
    publishStepRow(deps, row);
  }
  const next = deps.db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, threadId))
    .get();
  if (next?.stepId === running.id) deps.machineHub?.steerSignal(teamId, running.id);
}

export function releaseUnconsumedSteer(db: Db, finished: StepRow): void {
  db.delete(steerPending)
    .where(
      and(eq(steerPending.conversationId, finished.buildId), eq(steerPending.stepId, finished.id)),
    )
    .run();
  const unread = and(
    eq(step.buildId, finished.buildId),
    eq(step.status, 'pending'),
    inArray(step.holdReason, STEER_HOLDS),
    notInArray(
      step.id,
      db
        .select({ id: coordinatorInput.id })
        .from(coordinatorInput)
        .where(eq(coordinatorInput.state, 'pending')),
    ),
  );
  const owners = db.select().from(step).where(unread).all().flatMap(stepOwners);
  if (owners.length > 0)
    db.update(chiefMessage)
      .set({ delivery: 'steer_missed' })
      .where(inArray(chiefMessage.id, owners))
      .run();
  db.update(step).set({ holdReason: null }).where(unread).run();
}

export function endDeadChiefTurn(
  deps: ChiefTurnDeps,
  teamId: string,
  threadId: string,
  now: number = nowMs(),
): boolean {
  const head = liveChiefSteps(deps.db, threadId).find((row) => row.status === 'claimed');
  if (head === undefined || !isClaimedStepDead(deps.db, deps.machineHub, head, now)) return false;
  const thread = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (thread?.teamId !== teamId) return false;
  stopClaimedChiefStep(deps, thread, head, now, { dead: true });
  deps.machineHub?.wake(thread.teamId);
  return true;
}

export function stopChiefTurn(
  deps: ChiefTurnDeps,
  teamId: string,
  threadId: string,
): { delegated: boolean } {
  const thread = requireThread(deps.db, teamId, threadId);
  const live = liveChiefSteps(deps.db, threadId);
  const head = live.find((row) => row.status === 'claimed');
  if (head === undefined) {
    const startedTurnWillRunAgain = live.some((row) => row.claimedAt !== null);
    throw new HttpError(
      409,
      'no chief turn in flight (Coordinator 当前没有在回复)',
      startedTurnWillRunAgain ? CHIEF_TURN_WAITING_TO_RETRY : NOTHING_TO_STOP,
    );
  }
  return stopClaimedChiefStep(deps, thread, head, nowMs());
}

export function sweepOverlongChiefTurns(deps: ChiefTurnDeps, now: number = nowMs()): void {
  const overlong = deps.db
    .select({ step, thread: chiefThread })
    .from(step)
    .innerJoin(chiefThread, eq(chiefThread.id, step.buildId))
    .leftJoin(stopPending, eq(stopPending.stepId, step.id))
    .where(
      and(
        eq(step.kind, 'chief'),
        eq(step.status, 'claimed'),
        or(
          lt(step.claimedAt, now - CHIEF_TURN_MAX_MS),
          lte(stopPending.createdAt, now - CHIEF_TURN_STOP_GRACE_MS),
        ),
      ),
    )
    .all();
  for (const row of overlong) stopClaimedChiefStep(deps, row.thread, row.step, now);
}

export function stopAbandonedChiefTurn(
  deps: ChiefTurnDeps,
  thread: typeof chiefThread.$inferSelect,
  head: StepRow,
  now: number,
): void {
  stopClaimedChiefStep(deps, thread, head, now);
}

function stopClaimedChiefStep(
  deps: ChiefTurnDeps,
  thread: typeof chiefThread.$inferSelect,
  head: StepRow,
  now: number,
  { dead = false }: { dead?: boolean } = {},
): { delegated: boolean } {
  const threadId = thread.id;
  const requested = deps.db
    .select()
    .from(stopPending)
    .where(eq(stopPending.conversationId, threadId))
    .get();
  const abandoned = dead || claimIsDead(deps.db, head, now);
  const ignored =
    requested?.stepId === head.id && now - requested.createdAt >= CHIEF_TURN_STOP_GRACE_MS;
  if (!abandoned && !ignored) {
    deps.db
      .insert(stopPending)
      .values({ conversationId: threadId, stepId: head.id, discard: false, createdAt: now })
      .onConflictDoUpdate({
        target: stopPending.conversationId,
        set: {
          stepId: head.id,
          discard: false,
          createdAt: requested?.stepId === head.id ? requested.createdAt : now,
        },
      })
      .run();
    deps.machineHub?.stopSignal(thread.teamId, head.id);
    signalCoordinator(threadId, 'stop');
    return { delegated: true };
  }
  deps.db
    .update(step)
    .set({ status: 'stopped', finishedAt: now, archiveStop: null })
    .where(eq(step.id, head.id))
    .run();
  deps.db.delete(stopPending).where(eq(stopPending.stepId, head.id)).run();
  releaseUnconsumedSteer(deps.db, head);
  settleMemoryEditTurn(deps.db, head, 'stopped', 'executor lost');
  deps.machineHub?.stopSignal(thread.teamId, head.id);
  signalCoordinator(threadId, 'stop');
  settleChiefActiveRun(deps.db, threadId);
  const stopped = deps.db.select().from(step).where(eq(step.id, head.id)).get();
  if (stopped) publishStepRow(deps, stopped);
  recordChiefStop(deps, head);
  cancelPendingQuestions(deps, threadId, CHIEF_TURN_END_REASON);
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
    projectId: stepScopeProjectId(stepRow),
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
