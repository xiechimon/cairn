import { and, eq, inArray, isNull } from 'drizzle-orm';
import { LEASE_STALE_MS } from '../coordinator/lease.js';
import type { Db } from '../db/client.js';
import {
  chiefMessage,
  coordinatorInput,
  coordinatorLease,
  steerPending,
  step,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { releaseCoordinatorInput } from './coordinator-inputs.js';

export function migrateUnfetchedCoordinatorInputs(db: Db, threadId: string, owner: string): number {
  return db.transaction(() => {
    const buffer = db
      .select()
      .from(steerPending)
      .where(eq(steerPending.conversationId, threadId))
      .get();
    const held = db
      .select()
      .from(step)
      .where(
        and(
          eq(step.buildId, threadId),
          eq(step.kind, 'chief'),
          eq(step.status, 'pending'),
          inArray(step.holdReason, ['steer', 'steer_sent']),
        ),
      )
      .all();
    const inputs = db
      .select()
      .from(coordinatorInput)
      .where(eq(coordinatorInput.threadId, threadId))
      .all();
    const waiting = held.filter((row) => !inputs.some((input) => input.id === row.id));
    const native = db
      .select()
      .from(step)
      .where(and(eq(step.buildId, threadId), eq(step.kind, 'chief'), isNull(step.machineId)))
      .all()
      .filter((target) => !waiting.some((row) => row.id === target.id));
    if (buffer === undefined) {
      if (waiting.length === 0) return 0;
      if (
        native.some(
          (target) =>
            target.status === 'claimed' ||
            waiting.some((row) =>
              (row.ownerMessageIds ?? []).some((id) => target.ownerMessageIds?.includes(id)),
            ),
        )
      )
        throw new HttpError(
          409,
          'Legacy Coordinator sent history is unresolved: input buffer is missing',
        );
      return 0;
    }
    const target = db.select().from(step).where(eq(step.id, buffer.stepId)).get();
    if (target?.kind !== 'chief' || target.buildId !== threadId)
      throw new HttpError(409, 'Legacy Coordinator input target is unknown');
    if (target.machineId !== null) return 0;
    const lease = db
      .select()
      .from(coordinatorLease)
      .where(eq(coordinatorLease.storeKey, threadId))
      .get();
    if (lease?.owner !== owner || Date.now() - lease.heartbeatAt > LEASE_STALE_MS)
      throw new HttpError(409, 'Legacy Coordinator migration requires the current thread lease');
    if (waiting.some((row) => row.holdReason === 'steer_sent'))
      throw new HttpError(409, 'Legacy Coordinator sent admission is unresolved');
    if (waiting.length === 0 || waiting.length !== held.length)
      throw new HttpError(409, 'Legacy Coordinator buffer members are unknown');
    for (const row of waiting) {
      const source = db
        .select()
        .from(chiefMessage)
        .where(
          and(
            eq(chiefMessage.id, row.id),
            eq(chiefMessage.threadId, threadId),
            eq(chiefMessage.role, 'user'),
          ),
        )
        .get();
      if (
        source === undefined ||
        row.prompt === null ||
        row.ownerMessageIds?.length !== 1 ||
        row.ownerMessageIds[0] !== row.id
      )
        throw new HttpError(409, 'Legacy Coordinator buffer member identity is incomplete');
      if (
        native.some((target) => target.ownerMessageIds?.includes(row.id)) ||
        inputs.some((input) => input.ownerMessageIds.includes(row.id))
      )
        throw new HttpError(409, 'Legacy Coordinator sent history is unresolved');
    }
    for (const row of waiting) {
      db.insert(coordinatorInput)
        .values({
          id: row.id,
          threadId,
          stepId: target.id,
          kind: 'steer',
          ownerMessageIds: row.ownerMessageIds ?? [],
          content: row.prompt ?? '',
          conversationId: null,
          createdAt: row.createdAt,
        })
        .run();
      releaseCoordinatorInput(db, row.id, null);
    }
    db.delete(steerPending)
      .where(and(eq(steerPending.conversationId, threadId), eq(steerPending.stepId, target.id)))
      .run();
    return waiting.length;
  });
}
