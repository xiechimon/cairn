import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { step } from '../db/schema.js';
import type { priorSessionOf } from './machine-routing.js';

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
): boolean {
  const chiefSteps = and(eq(step.buildId, threadId), eq(step.kind, 'chief'), ne(step.id, stepId));
  const last =
    db
      .select({ subscriptionId: step.claudeSubscriptionId })
      .from(step)
      .where(and(chiefSteps, isNotNull(step.sessionId)))
      .orderBy(desc(step.createdAt))
      .limit(1)
      .get() ??
    db
      .select({ subscriptionId: step.claudeSubscriptionId })
      .from(step)
      .where(and(chiefSteps, isNotNull(step.claimedAt)))
      .orderBy(desc(step.claimedAt))
      .limit(1)
      .get();
  const previous = last?.subscriptionId ?? null;
  return previous !== null && previous !== boundSubscriptionId;
}
