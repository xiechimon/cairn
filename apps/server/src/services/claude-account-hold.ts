import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { step, stepSubscription } from '../db/schema.js';
import type { priorSessionOf } from './machine-routing.js';
import type { StepSubscription } from './step-groups/subscription.js';

export function chiefLastRanOnOtherMachine(
  db: Pick<Db, 'select'>,
  threadId: string,
  sessionId: string,
  stepId: string,
  machineId: string,
): boolean {
  if (sessionId === '') return false;
  const last = db
    .select({ machineId: step.machineId })
    .from(step)
    .where(
      and(
        eq(step.buildId, threadId),
        eq(step.kind, 'chief'),
        eq(step.sessionId, sessionId),
        ne(step.id, stepId),
      ),
    )
    .orderBy(desc(step.createdAt), desc(sql`rowid`))
    .limit(1)
    .get();
  return last?.machineId != null && last.machineId !== machineId;
}

export function accountHeld(
  stepRow: Pick<typeof step.$inferSelect, 'byPerson'> &
    Pick<StepSubscription, 'claudeSubscriptionId'>,
  prior: ReturnType<typeof priorSessionOf>,
  enabledSubscriptionId: string | null,
): boolean {
  if (stepRow.byPerson) return false;
  const differs = (id: string | null) => id !== null && id !== enabledSubscriptionId;
  const continuesSession = !prior.freshSession && prior.priorSessionId !== null;
  return (
    differs(stepRow.claudeSubscriptionId) ||
    (continuesSession && differs(prior.priorSubscriptionId))
  );
}

export function chiefLastRanOnOtherAccount(
  db: Pick<Db, 'select'>,
  threadId: string,
  stepId: string,
  boundSubscriptionId: string | null,
  runtime: 'claude-code' | 'devin' | 'antigravity' | 'doubao' = 'claude-code',
): boolean {
  const column =
    runtime === 'devin'
      ? stepSubscription.devinSubscriptionId
      : runtime === 'antigravity'
        ? stepSubscription.antigravitySubscriptionId
        : runtime === 'doubao'
          ? step.doubaoSubscriptionId
          : stepSubscription.claudeSubscriptionId;
  const chiefSteps = and(eq(step.buildId, threadId), eq(step.kind, 'chief'), ne(step.id, stepId));
  const last =
    db
      .select({ subscriptionId: column })
      .from(step)
      .leftJoin(stepSubscription, eq(stepSubscription.stepId, step.id))
      .where(and(chiefSteps, isNotNull(step.sessionId)))
      .orderBy(desc(step.createdAt))
      .limit(1)
      .get() ??
    db
      .select({ subscriptionId: column })
      .from(step)
      .leftJoin(stepSubscription, eq(stepSubscription.stepId, step.id))
      .where(and(chiefSteps, isNotNull(step.claimedAt)))
      .orderBy(desc(step.claimedAt))
      .limit(1)
      .get();
  const previous = last?.subscriptionId ?? null;
  return previous !== null && previous !== boundSubscriptionId;
}

export function chiefLastSessionBefore(
  db: Pick<Db, 'select'>,
  threadId: string,
  stepId: string,
  cutoffMs: number | undefined,
): boolean {
  if (cutoffMs === undefined) return false;
  const last = db
    .select({ createdAt: step.createdAt, claimedAt: step.claimedAt })
    .from(step)
    .where(
      and(
        eq(step.buildId, threadId),
        eq(step.kind, 'chief'),
        ne(step.id, stepId),
        isNotNull(step.sessionId),
      ),
    )
    .orderBy(desc(step.createdAt))
    .limit(1)
    .get();
  if (last === undefined) return false;
  return (last.claimedAt ?? last.createdAt) < cutoffMs;
}
