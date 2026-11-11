import { coordinatorConversationKey, isMailWakeText } from '@cairn/shared';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  chiefMessage,
  coordinatorConversation,
  coordinatorEntry,
  coordinatorInput,
  step,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';

type StepRow = typeof step.$inferSelect;
export type CoordinatorInput = typeof coordinatorInput.$inferSelect;

export function coordinatorInputs(db: Db, threadId: string): CoordinatorInput[] {
  return db
    .select()
    .from(coordinatorInput)
    .where(eq(coordinatorInput.threadId, threadId))
    .orderBy(asc(coordinatorInput.createdAt), sql`rowid`)
    .all();
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
  if (prior !== undefined) {
    if (prior.kind !== 'initial' || prior.conversationId !== conversationId)
      throw new HttpError(409, 'Coordinator input identity changed');
    return prior;
  }
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
    entryId: null,
    successorStepId: null,
    createdAt: nowMs(),
  };
  db.insert(coordinatorInput).values(input).run();
  return input;
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
    const admitted = db.select().from(coordinatorInput).where(eq(coordinatorInput.id, id)).get();
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
): void {
  const batch = db.select().from(coordinatorInput).where(eq(coordinatorInput.id, requestId)).get();
  if (batch === undefined) return;
  if (
    !Number.isSafeInteger(Number(entryId)) ||
    Number(entryId) < 1 ||
    batch.conversationId !== conversationId
  )
    throw new HttpError(409, 'Invalid Coordinator consumption receipt');
  if (batch.state === 'consumed') {
    if (batch.entryId !== entryId)
      throw new HttpError(409, 'Coordinator input already has a different receipt');
    return;
  }
  if (batch.state !== 'pending') throw new HttpError(409, 'Coordinator input is already released');
  requireCoordinatorConversation(db, batch.threadId, conversationId);
  db.transaction(() => {
    const producer = db.select().from(step).where(eq(step.id, batch.stepId)).get();
    const owners: string[] = [];
    for (const id of batch.ownerMessageIds) {
      const source = db
        .select()
        .from(chiefMessage)
        .where(and(eq(chiefMessage.id, id), eq(chiefMessage.threadId, batch.threadId)))
        .get();
      if (source === undefined) continue;
      db.insert(coordinatorEntry)
        .values({ chiefMessageId: id, threadId: batch.threadId, conversationId, entryId })
        .onConflictDoUpdate({
          target: coordinatorEntry.chiefMessageId,
          set: { conversationId, entryId },
        })
        .run();
      owners.push(id);
    }
    if (producer !== undefined)
      db.update(step)
        .set({ ownerMessageIds: [...new Set([...(producer.ownerMessageIds ?? []), ...owners])] })
        .where(eq(step.id, producer.id))
        .run();
    db.update(coordinatorInput)
      .set({ state: 'consumed', entryId })
      .where(eq(coordinatorInput.id, batch.id))
      .run();
    if (batch.kind === 'steer')
      db.delete(step)
        .where(and(eq(step.id, batch.id), inArray(step.status, ['pending', 'waiting_quota'])))
        .run();
  });
}

export function releaseCoordinatorInput(
  db: Db,
  requestId: string,
  conversationId: string | null,
): void {
  const batch = db.select().from(coordinatorInput).where(eq(coordinatorInput.id, requestId)).get();
  if (batch === undefined || batch.state !== 'pending') return;
  if (batch.conversationId !== conversationId)
    throw new HttpError(409, 'Coordinator input release has the wrong conversation');
  if (conversationId !== null) requireCoordinatorConversation(db, batch.threadId, conversationId);
  db.transaction(() => {
    let successorStepId: string | null = null;
    if (batch.kind === 'steer') {
      const waiting = db.select().from(step).where(eq(step.id, batch.id)).get();
      const waitingForExecution =
        waiting?.status === 'pending' || waiting?.status === 'waiting_quota';
      const surviving = batch.ownerMessageIds.filter(
        (id) =>
          db
            .select()
            .from(chiefMessage)
            .where(and(eq(chiefMessage.id, id), eq(chiefMessage.threadId, batch.threadId)))
            .get() !== undefined,
      );
      if (waitingForExecution && surviving.length > 0) {
        successorStepId = newRecordId();
        db.insert(step)
          .values({
            id: successorStepId,
            buildId: batch.threadId,
            kind: 'chief',
            status: waiting.status,
            quotaBlock: waiting.quotaBlock,
            prompt: batch.content,
            ownerMessageIds: surviving,
            scopeProjectId: waiting.scopeProjectId,
            createdAt: waiting.createdAt,
          })
          .run();
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
  const batch = db.select().from(coordinatorInput).where(eq(coordinatorInput.id, requestId)).get();
  if (batch === undefined) return undefined;
  const target = db.select().from(step).where(eq(step.id, batch.stepId)).get();
  return (
    batch.state !== 'released' &&
    target?.machineId === null &&
    (target.status === 'claimed' || target.status === 'pending')
  );
}
