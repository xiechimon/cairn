import { coordinatorConversationKey, isMailWakeText } from '@cairn/shared';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { StoppedTurn } from '../coordinator/runtime/stopped-turn.js';
import type { Db } from '../db/client.js';
import {
  chiefMessage,
  coordinatorConversation,
  coordinatorEntry,
  coordinatorInput,
  imTurnOrigin,
  step,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { readMemoryTrace, writeMemoryTrace } from './step-groups/memory-trace.js';
import { readQuota, type StepQuota, writeQuota } from './step-groups/quota.js';
import { readSkillInjection, type StepSkillInjection } from './step-groups/skill-injection.js';

export const STEER_WITHDRAW_HOLD = 'steer_withdraw';

type StepRow = typeof step.$inferSelect;
type ChiefMessageRow = typeof chiefMessage.$inferSelect;
export type CoordinatorInput = typeof coordinatorInput.$inferSelect;

export function coordinatorInputs(db: Db, threadId: string): CoordinatorInput[] {
  return db
    .select()
    .from(coordinatorInput)
    .where(eq(coordinatorInput.threadId, threadId))
    .orderBy(asc(coordinatorInput.createdAt), sql`rowid`)
    .all();
}

export function inputRequestId(input: Pick<CoordinatorInput, 'id' | 'attempt'>): string {
  return input.attempt <= 1 ? input.id : `${input.id}#${input.attempt}`;
}

export function inputRequestIds(requestId: string): string[] {
  const { id, attempt } = parseInputRequestId(requestId);
  return Array.from({ length: attempt }, (_, index) => inputRequestId({ id, attempt: index + 1 }));
}

export function parseInputRequestId(requestId: string): { id: string; attempt: number } {
  const hash = requestId.lastIndexOf('#');
  if (hash === -1) return { id: requestId, attempt: 1 };
  const attempt = Number(requestId.slice(hash + 1));
  return Number.isSafeInteger(attempt) && attempt >= 1
    ? { id: requestId.slice(0, hash), attempt }
    : { id: requestId, attempt: 1 };
}

export function stoppedCoordinatorTurns(db: Db, threadId: string): StoppedTurn[] {
  const ended = db
    .select()
    .from(step)
    .where(
      and(
        eq(step.buildId, threadId),
        eq(step.kind, 'chief'),
        inArray(step.status, ['done', 'stopped']),
      ),
    )
    .orderBy(asc(step.finishedAt), sql`rowid`)
    .all();
  const answeredSince = Math.max(
    0,
    ...ended
      .filter(
        (row) =>
          row.status === 'done' && row.machineId === null && !isMailWakeText(row.prompt ?? ''),
      )
      .map((row) => row.claimedAt ?? row.finishedAt ?? 0),
  );
  const inputs = coordinatorInputs(db, threadId);
  return ended
    .filter((row) => row.status === 'stopped' && (row.finishedAt ?? answeredSince) >= answeredSince)
    .map((row) => {
      const requestIds = new Set([row.id]);
      for (const input of inputs.filter((candidate) => candidate.stepId === row.id)) {
        for (const requestId of inputRequestIds(inputRequestId(input))) requestIds.add(requestId);
      }
      return { stepId: row.id, requestIds: [...requestIds] };
    });
}

export function inputForRequestId(
  db: Db,
  requestId: string,
): { batch: CoordinatorInput | undefined; stale: boolean } {
  const ref = parseInputRequestId(requestId);
  const batch = db.select().from(coordinatorInput).where(eq(coordinatorInput.id, ref.id)).get();
  return { batch, stale: batch !== undefined && batch.attempt !== ref.attempt };
}

export function traceDeliveredSteer(db: Db, runningId: string, waiting: StepRow): void {
  db.transaction((tx) => {
    const delivered = readMemoryTrace(tx, waiting.id).memoryTrace?.projectMemoryIds ?? [];
    const trace = readMemoryTrace(tx, runningId).memoryTrace;
    if (!trace || delivered.length === 0) return;
    writeMemoryTrace(tx, runningId, {
      memoryTrace: {
        ...trace,
        projectMemoryIds: [...new Set([...trace.projectMemoryIds, ...delivered])],
      },
    });
  });
}

export function queueCoordinatorInput(
  db: Db,
  target: StepRow,
  waiting: StepRow,
  content: string,
): void {
  if (
    target.kind !== 'chief' ||
    target.machineId !== null ||
    target.status !== 'claimed' ||
    waiting.kind !== 'chief' ||
    waiting.status !== 'pending' ||
    waiting.buildId !== target.buildId ||
    waiting.id === target.id
  ) {
    throw new HttpError(409, 'Coordinator steer has no native claimed target');
  }
  const prior = db.select().from(coordinatorInput).where(eq(coordinatorInput.id, waiting.id)).get();
  if (
    prior !== undefined &&
    (prior.stepId !== target.id || prior.threadId !== target.buildId || prior.kind !== 'steer')
  )
    throw new HttpError(409, 'Coordinator batch identity changed');
  db.transaction(() => {
    db.insert(coordinatorInput)
      .values({
        id: waiting.id,
        threadId: target.buildId,
        stepId: target.id,
        kind: 'steer',
        ownerMessageIds: waiting.ownerMessageIds ?? [],
        content,
        createdAt: nowMs(),
      })
      .onConflictDoNothing()
      .run();
    db.update(step).set({ holdReason: 'steer' }).where(eq(step.id, waiting.id)).run();
  });
}

export function requireCoordinatorConversation(
  db: Db,
  threadId: string,
  conversationId: string,
): void {
  const current = db
    .select()
    .from(coordinatorConversation)
    .where(eq(coordinatorConversation.threadId, threadId))
    .get();
  if (
    current === undefined ||
    (current.storeId === null
      ? current.conversationId
      : coordinatorConversationKey(current.storeId, current.conversationId)) !== conversationId
  )
    throw new HttpError(409, 'Coordinator input conversation changed');
}

export function prepareCoordinatorInput(
  db: Db,
  stepId: string,
  conversationId: string,
  content: string,
  existingEntryId?: string,
  renew = false,
): CoordinatorInput {
  const prior = db
    .select()
    .from(coordinatorInput)
    .where(
      and(
        eq(coordinatorInput.stepId, stepId),
        eq(coordinatorInput.kind, 'initial'),
        eq(coordinatorInput.conversationId, conversationId),
      ),
    )
    .get();
  if (prior !== undefined && (prior.state === 'pending' || (prior.state === 'consumed' && !renew)))
    return { ...prior, id: inputRequestId(prior) };
  const row = db.select().from(step).where(eq(step.id, stepId)).get();
  if (row?.kind !== 'chief' || row.machineId !== null || row.status !== 'claimed')
    throw new HttpError(409, 'Coordinator input has no native claimed step');
  requireCoordinatorConversation(db, row.buildId, conversationId);
  const owners = row.ownerMessageIds ?? [];
  const frozen =
    existingEntryId === undefined
      ? owners
      : owners.filter((id) => {
          const entry = db
            .select()
            .from(coordinatorEntry)
            .where(eq(coordinatorEntry.chiefMessageId, id))
            .get();
          return (
            id === row.id ||
            (entry?.conversationId === conversationId && entry.entryId === existingEntryId)
          );
        });
  if (prior !== undefined) {
    if (prior.state === 'pending') return { ...prior, id: inputRequestId(prior) };
    const renewed: CoordinatorInput = {
      ...prior,
      attempt: prior.attempt + 1,
      ownerMessageIds: frozen,
      content,
      state: 'pending',
      entryId: null,
      successorStepId: null,
      createdAt: nowMs(),
    };
    db.update(coordinatorInput)
      .set({
        attempt: renewed.attempt,
        ownerMessageIds: renewed.ownerMessageIds,
        content: renewed.content,
        state: renewed.state,
        entryId: renewed.entryId,
        successorStepId: renewed.successorStepId,
        createdAt: renewed.createdAt,
      })
      .where(eq(coordinatorInput.id, prior.id))
      .run();
    return { ...renewed, id: inputRequestId(renewed) };
  }
  const input: CoordinatorInput = {
    id:
      db.select().from(coordinatorInput).where(eq(coordinatorInput.id, stepId)).get() === undefined
        ? stepId
        : newRecordId(),
    threadId: row.buildId,
    stepId,
    kind: 'initial',
    ownerMessageIds: frozen,
    content,
    conversationId,
    state: 'pending',
    attempt: 1,
    entryId: null,
    successorStepId: null,
    createdAt: nowMs(),
  };
  db.insert(coordinatorInput).values(input).run();
  return { ...input, id: inputRequestId(input) };
}

export function pullCoordinatorInput(
  db: Db,
  stepId: string,
  conversationId?: string,
  admittedRequestIds: readonly string[] = [],
): CoordinatorInput | null {
  const target = db.select().from(step).where(eq(step.id, stepId)).get();
  if (target?.kind !== 'chief' || target.machineId !== null || target.status !== 'claimed')
    return null;
  if (isMailWakeText(target.prompt ?? '')) return null;
  const current = db
    .select()
    .from(coordinatorConversation)
    .where(eq(coordinatorConversation.threadId, target.buildId))
    .get();
  const bound =
    conversationId ??
    (current === undefined
      ? undefined
      : current.storeId === null
        ? current.conversationId
        : coordinatorConversationKey(current.storeId, current.conversationId));
  if (bound === undefined) throw new HttpError(409, 'Coordinator input conversation is missing');
  requireCoordinatorConversation(db, target.buildId, bound);
  for (const id of admittedRequestIds) {
    const admitted = inputForRequestId(db, id).batch;
    if (
      admitted?.stepId !== stepId ||
      admitted.conversationId !== bound ||
      admitted.kind !== 'steer'
    )
      throw new HttpError(409, 'Invalid Coordinator admission exclusion');
  }

  const batch = db
    .select()
    .from(coordinatorInput)
    .where(
      and(
        eq(coordinatorInput.stepId, stepId),
        eq(coordinatorInput.kind, 'steer'),
        eq(coordinatorInput.state, 'pending'),
        admittedRequestIds.length === 0
          ? undefined
          : notInArray(coordinatorInput.id, [...admittedRequestIds]),
        notInArray(
          coordinatorInput.id,
          db.select({ id: step.id }).from(step).where(eq(step.holdReason, STEER_WITHDRAW_HOLD)),
        ),
      ),
    )
    .orderBy(asc(coordinatorInput.createdAt), sql`rowid`)
    .get();
  if (batch === undefined) return null;
  if (batch.conversationId !== null && batch.conversationId !== bound)
    throw new HttpError(409, 'Coordinator steer is bound to a different conversation');
  db.update(coordinatorInput)
    .set({ conversationId: bound })
    .where(eq(coordinatorInput.id, batch.id))
    .run();
  return { ...batch, conversationId: bound };
}

export function consumeCoordinatorInput(
  db: Db,
  requestId: string,
  conversationId: string,
  entryId: string,
  placedAt?: number,
): { placed: ChiefMessageRow[]; retired: (StepRow & StepQuota & StepSkillInjection) | undefined } {
  const unchanged = { placed: [], retired: undefined };
  const { batch, stale } = inputForRequestId(db, requestId);
  if (batch === undefined || stale) return unchanged;
  if (
    !Number.isSafeInteger(Number(entryId)) ||
    Number(entryId) < 1 ||
    batch.conversationId !== conversationId
  )
    throw new HttpError(409, 'Invalid Coordinator consumption receipt');
  if (batch.state === 'consumed') {
    if (batch.entryId !== entryId)
      throw new HttpError(409, 'Coordinator input already has a different receipt');
    return unchanged;
  }
  if (batch.state !== 'pending') throw new HttpError(409, 'Coordinator input is already released');
  requireCoordinatorConversation(db, batch.threadId, conversationId);
  return db.transaction(() => {
    const producer = db.select().from(step).where(eq(step.id, batch.stepId)).get();
    const owners: string[] = [];
    const placed: ChiefMessageRow[] = [];
    for (const id of batch.ownerMessageIds) {
      const source = db
        .select()
        .from(chiefMessage)
        .where(and(eq(chiefMessage.id, id), eq(chiefMessage.threadId, batch.threadId)))
        .get();
      if (source === undefined) continue;
      if (batch.kind === 'steer' && placedAt !== undefined && placedAt > source.createdAt) {
        db.update(chiefMessage)
          .set({
            createdAt: placedAt,
            typedAt: sql`coalesce(${chiefMessage.typedAt}, ${chiefMessage.createdAt})`,
          })
          .where(eq(chiefMessage.id, id))
          .run();
        placed.push({ ...source, createdAt: placedAt });
      }
      db.insert(coordinatorEntry)
        .values({ chiefMessageId: id, threadId: batch.threadId, conversationId, entryId })
        .onConflictDoUpdate({
          target: coordinatorEntry.chiefMessageId,
          set: { conversationId, entryId },
        })
        .run();
      owners.push(id);
    }
    const delivered =
      batch.kind === 'steer'
        ? db.select().from(step).where(eq(step.id, batch.id)).get()
        : undefined;
    if (producer !== undefined && delivered !== undefined)
      traceDeliveredSteer(db, producer.id, delivered);
    if (producer !== undefined)
      db.update(step)
        .set({ ownerMessageIds: [...new Set([...(producer.ownerMessageIds ?? []), ...owners])] })
        .where(eq(step.id, producer.id))
        .run();
    db.update(coordinatorInput)
      .set({ state: 'consumed', entryId })
      .where(eq(coordinatorInput.id, batch.id))
      .run();
    if (batch.kind !== 'steer') return { placed, retired: undefined };
    // RETURNING cannot join side tables; snapshot event fields before cascade.
    const retiredGroups = { ...readQuota(db, batch.id), ...readSkillInjection(db, batch.id) };
    const retired = db
      .delete(step)
      .where(and(eq(step.id, batch.id), inArray(step.status, ['pending', 'waiting_quota'])))
      .returning()
      .get();
    if (retired !== undefined) {
      db.delete(imTurnOrigin).where(eq(imTurnOrigin.stepId, batch.id)).run();
    }
    return {
      placed,
      retired: retired === undefined ? undefined : { ...retired, ...retiredGroups },
    };
  });
}

export function releaseCoordinatorInput(
  db: Db,
  requestId: string,
  conversationId: string | null,
): void {
  const { batch, stale } = inputForRequestId(db, requestId);
  if (batch === undefined || stale || batch.state !== 'pending') return;
  if (batch.conversationId !== conversationId)
    throw new HttpError(409, 'Coordinator input release has the wrong conversation');
  if (conversationId !== null) requireCoordinatorConversation(db, batch.threadId, conversationId);
  db.transaction((tx) => {
    let successorStepId: string | null = null;
    if (batch.kind === 'steer') {
      const waiting = db.select().from(step).where(eq(step.id, batch.id)).get();
      const waitingForExecution =
        waiting?.status === 'pending' || waiting?.status === 'waiting_quota';
      const imOrigin =
        waiting === undefined
          ? undefined
          : db.select().from(imTurnOrigin).where(eq(imTurnOrigin.stepId, waiting.id)).get();
      if (waitingForExecution && waiting.holdReason === STEER_WITHDRAW_HOLD) {
        db.delete(step).where(eq(step.id, waiting.id)).run();
        if (imOrigin !== undefined) {
          db.delete(imTurnOrigin).where(eq(imTurnOrigin.stepId, waiting.id)).run();
        }
        if (batch.ownerMessageIds.length > 0)
          db.delete(chiefMessage)
            .where(
              and(
                eq(chiefMessage.threadId, batch.threadId),
                inArray(chiefMessage.id, batch.ownerMessageIds),
              ),
            )
            .run();
        db.update(coordinatorInput)
          .set({ state: 'released', successorStepId: null })
          .where(eq(coordinatorInput.id, batch.id))
          .run();
        return;
      }
      const surviving = batch.ownerMessageIds.filter(
        (id) =>
          db
            .select()
            .from(chiefMessage)
            .where(and(eq(chiefMessage.id, id), eq(chiefMessage.threadId, batch.threadId)))
            .get() !== undefined,
      );
      const keepImTurn = batch.ownerMessageIds.length === 0 && imOrigin !== undefined;
      if (waitingForExecution && (surviving.length > 0 || keepImTurn)) {
        if (surviving.length > 0) {
          db.update(chiefMessage)
            .set({ delivery: 'steer_missed' })
            .where(inArray(chiefMessage.id, surviving))
            .run();
        }
        successorStepId = newRecordId();
        db.insert(step)
          .values({
            id: successorStepId,
            buildId: batch.threadId,
            kind: 'chief',
            status: waiting.status,
            prompt: batch.content,
            ownerMessageIds: surviving,
            ownerSaid: waiting.ownerSaid,
            freshSession: waiting.freshSession,
            scopeProjectId: waiting.scopeProjectId,
            createdAt: waiting.createdAt,
          })
          .run();
        writeQuota(tx, successorStepId, { quotaBlock: readQuota(tx, waiting.id).quotaBlock });
        if (imOrigin !== undefined) {
          db.insert(imTurnOrigin)
            .values({
              stepId: successorStepId,
              connId: imOrigin.connId,
              chatKey: imOrigin.chatKey,
              senderId: imOrigin.senderId,
              threadId: imOrigin.threadId,
              createdAt: imOrigin.createdAt,
            })
            .run();
          db.delete(imTurnOrigin).where(eq(imTurnOrigin.stepId, waiting.id)).run();
        }
      } else if (waitingForExecution && imOrigin !== undefined) {
        db.delete(imTurnOrigin).where(eq(imTurnOrigin.stepId, waiting.id)).run();
      }
      if (waitingForExecution) db.delete(step).where(eq(step.id, waiting.id)).run();
    }
    db.update(coordinatorInput)
      .set({ state: 'released', successorStepId })
      .where(eq(coordinatorInput.id, batch.id))
      .run();
  });
}

export function coordinatorInputIsLive(db: Db, requestId: string): boolean | undefined {
  const { batch, stale } = inputForRequestId(db, requestId);
  if (batch === undefined) return undefined;
  if (stale) return false;
  const target = db.select().from(step).where(eq(step.id, batch.stepId)).get();
  return (
    batch.state !== 'released' &&
    target?.machineId === null &&
    (target.status === 'claimed' || target.status === 'pending')
  );
}
