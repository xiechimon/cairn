import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { step } from '../db/schema.js';
import type { priorSessionOf } from './machine-routing.js';

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
  stepRow: Pick<typeof step.$inferSelect, 'byPerson' | 'claudeSubscriptionId'>,
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
  runtime: 'claude-code' | 'devin' | 'antigravity' = 'claude-code',
): boolean {
  const column =
    runtime === 'devin'
      ? step.devinSubscriptionId
      : runtime === 'antigravity'
        ? step.antigravitySubscriptionId
        : step.claudeSubscriptionId;
  const chiefSteps = and(eq(step.buildId, threadId), eq(step.kind, 'chief'), ne(step.id, stepId));
  const last =
    db
      .select({ subscriptionId: column })
      .from(step)
      .where(and(chiefSteps, isNotNull(step.sessionId)))
      .orderBy(desc(step.createdAt))
      .limit(1)
      .get() ??
    db
      .select({ subscriptionId: column })
      .from(step)
      .where(and(chiefSteps, isNotNull(step.claimedAt)))
      .orderBy(desc(step.claimedAt))
      .limit(1)
      .get();
  const previous = last?.subscriptionId ?? null;
  return previous !== null && previous !== boundSubscriptionId;
}
