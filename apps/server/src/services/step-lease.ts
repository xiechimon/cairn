import type { BlockerHandoffRecord, SkillInjectionRecord } from '@cairn/shared';
import { and, eq, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  claudeSubscription,
  coordinatorInput,
  devinSubscription,
  type StepFallbackRow,
  type StepRanModel,
  step,
} from '../db/schema.js';
import { HttpError, NotFoundError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { writeBlockerHandoff } from './step-groups/blocker-handoff.js';
import { writeQuota } from './step-groups/quota.js';
import { writeSkillInjection } from './step-groups/skill-injection.js';
import { writeSubscription } from './step-groups/subscription.js';

export function pendingClaimPredicate(
  stepRow: Pick<typeof step.$inferSelect, 'id' | 'claimedAt'>,
  now: number,
) {
  return and(
    eq(step.id, stepRow.id),
    eq(step.status, 'pending'),
    stepRow.claimedAt === null ? isNull(step.claimedAt) : eq(step.claimedAt, stepRow.claimedAt),
    or(isNull(step.holdUntil), lte(step.holdUntil, now)),
  );
}

export function nextClaimGeneration(
  stepRow: Pick<typeof step.$inferSelect, 'claimedAt'>,
  now: number = nowMs(),
): number {
  return Math.max(now, (stepRow.claimedAt ?? 0) + 1);
}

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface WorkerStepLeaseInput {
  machineId: string;
  claimedAt: number;
  claimedRepo: string | null;
  claimedRepoId: number | null;
  skillInjection: SkillInjectionRecord;
  blockerHandoff: BlockerHandoffRecord | null;
  claudeSubscriptionId: string | null;
  devinSubscriptionId: string | null;
  antigravitySubscriptionId: string | null;
  doubaoSubscriptionId: string | null;
  ranModel: StepRanModel | null;
  fallback?: StepFallbackRow | null;
  mcpGrant: string[] | null;
  routedFromMachineId?: string | null;
  routedReason?: 'offline' | 'busy' | 'manual-switch' | null;
}

export function acquireWorkerStepLease(
  tx: Transaction,
  stepRow: Pick<typeof step.$inferSelect, 'id' | 'claimedAt'>,
  input: WorkerStepLeaseInput,
): { claimedAt: number } | null {
  const res = tx
    .update(step)
    .set({
      status: 'claimed',
      machineId: input.machineId,
      claimedAt: input.claimedAt,
      claimedRepo: input.claimedRepo,
      claimedRepoId: input.claimedRepoId,
      lastHeartbeatAt: input.claimedAt,
      doubaoSubscriptionId: input.doubaoSubscriptionId,
      holdReason: null,
      holdUntil: null,
      mcpGrant: input.mcpGrant,
      ...(input.routedFromMachineId !== undefined
        ? { routedFromMachineId: input.routedFromMachineId }
        : {}),
      ...(input.routedReason !== undefined ? { routedReason: input.routedReason } : {}),
    })
    .where(pendingClaimPredicate(stepRow, input.claimedAt))
    .run();
  if (res.changes === 0) return null;
  writeSubscription(tx, stepRow.id, {
    claudeSubscriptionId: input.claudeSubscriptionId,
    devinSubscriptionId: input.devinSubscriptionId,
    antigravitySubscriptionId: input.antigravitySubscriptionId,
  });
  writeQuota(tx, stepRow.id, { ranModel: input.ranModel, fallback: input.fallback });
  writeSkillInjection(tx, stepRow.id, { skillInjection: input.skillInjection });
  writeBlockerHandoff(tx, stepRow.id, { blockerHandoff: input.blockerHandoff });
  return { claimedAt: input.claimedAt };
}

export interface ChiefStepLeaseInput {
  machineId: string | null;
  claimedAt: number;
  bind: { runtime: 'claude-code' | 'devin' | 'antigravity' | 'doubao'; teamId: string } | null;
  antigravitySubscriptionId: string | null;
  doubaoSubscriptionId: string | null;
  model: StepRanModel | null;
  fallback?: StepFallbackRow | null;
  mcpGrant: string[] | null;
  routedFromMachineId?: string | null;
  routedReason?: 'offline' | 'busy' | 'manual-switch' | null;
}

export function acquireChiefStepLease(
  tx: Transaction,
  stepRow: Pick<typeof step.$inferSelect, 'id' | 'claimedAt'>,
  input: ChiefStepLeaseInput,
): { claimedAt: number } | null {
  const res = tx
    .update(step)
    .set({
      status: 'claimed',
      machineId: input.machineId,
      doubaoSubscriptionId: input.doubaoSubscriptionId,
      claimedAt: input.claimedAt,
      lastHeartbeatAt: input.claimedAt,
      holdReason: null,
      holdUntil: null,
      mcpGrant: input.mcpGrant,
      ...(input.routedFromMachineId !== undefined
        ? { routedFromMachineId: input.routedFromMachineId }
        : {}),
      ...(input.routedReason !== undefined ? { routedReason: input.routedReason } : {}),
    })
    .where(
      and(
        pendingClaimPredicate(stepRow, input.claimedAt),
        notInArray(
          step.id,
          tx
            .select({ id: coordinatorInput.id })
            .from(coordinatorInput)
            .where(eq(coordinatorInput.state, 'pending')),
        ),
      ),
    )
    .run();
  if (res.changes === 0) return null;
  const claudeSubscriptionId =
    input.bind?.runtime === 'claude-code'
      ? (tx
          .select({ id: claudeSubscription.id })
          .from(claudeSubscription)
          .where(
            and(
              eq(claudeSubscription.teamId, input.bind.teamId),
              sql`${claudeSubscription.enabledAt} is not null`,
              sql`(${claudeSubscription.expiresAt} is null or ${claudeSubscription.expiresAt} > ${input.claimedAt})`,
            ),
          )
          .get()?.id ?? null)
      : null;
  const devinSubscriptionId =
    input.bind?.runtime === 'devin'
      ? (tx
          .select({ id: devinSubscription.id })
          .from(devinSubscription)
          .where(
            and(
              eq(devinSubscription.teamId, input.bind.teamId),
              sql`${devinSubscription.enabledAt} is not null`,
              sql`(${devinSubscription.expiresAt} is null or ${devinSubscription.expiresAt} > ${input.claimedAt})`,
            ),
          )
          .get()?.id ?? null)
      : null;
  writeSubscription(tx, stepRow.id, {
    claudeSubscriptionId,
    devinSubscriptionId,
    antigravitySubscriptionId: input.antigravitySubscriptionId,
  });
  writeQuota(tx, stepRow.id, { ranModel: input.model, fallback: input.fallback });
  return { claimedAt: input.claimedAt };
}

export function heartbeatStep<T extends { db: Db; assertClaim?: () => void }>(
  deps: T,
  machineId: string | null,
  stepId: string,
): void {
  if (!deps.db.select({ id: step.id }).from(step).where(eq(step.id, stepId)).get()) {
    throw new HttpError(410, `step ${stepId} no longer exists`);
  }
  deps.assertClaim?.();
  const row = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row) throw new NotFoundError(`step ${stepId}`);
  if (row.machineId !== machineId) throw new NotFoundError(`step ${stepId} (not yours)`);
  if (row.status !== 'claimed') throw new NotFoundError(`step ${stepId} (not running)`);
  deps.db.update(step).set({ lastHeartbeatAt: nowMs() }).where(eq(step.id, row.id)).run();
}

export interface ReleaseStepLeaseOptions {
  claimCount?: number;
  expectedMachineId?: string | null;
  expectedClaimedAt?: number | null;
}

export function releaseStepLease(
  db: Db,
  stepId: string,
  options: ReleaseStepLeaseOptions = {},
): boolean {
  const guards = [eq(step.id, stepId), eq(step.status, 'claimed')];
  if (options.expectedMachineId !== undefined) {
    guards.push(
      options.expectedMachineId === null
        ? isNull(step.machineId)
        : eq(step.machineId, options.expectedMachineId),
    );
  }
  if (options.expectedClaimedAt !== undefined) {
    guards.push(
      options.expectedClaimedAt === null
        ? isNull(step.claimedAt)
        : eq(step.claimedAt, options.expectedClaimedAt),
    );
  }
  const res = db
    .update(step)
    .set({
      status: 'pending',
      machineId: null,
      mcpGrant: null,
      ...(options.claimCount !== undefined ? { claimCount: options.claimCount } : {}),
    })
    .where(and(...guards))
    .run();
  return res.changes > 0;
}
