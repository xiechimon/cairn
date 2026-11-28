import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { stepSubscription } from '../../db/schema.js';

export type StepSubscription = Omit<typeof stepSubscription.$inferSelect, 'stepId'>;
export type StepSubscriptionPatch = Partial<StepSubscription>;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select'>;

export const subscriptionColumns = {
  claudeSubscriptionId: stepSubscription.claudeSubscriptionId,
  devinSubscriptionId: stepSubscription.devinSubscriptionId,
  antigravitySubscriptionId: stepSubscription.antigravitySubscriptionId,
};

export function readSubscription(db: Reader, stepId: string): StepSubscription {
  return (
    db
      .select(subscriptionColumns)
      .from(stepSubscription)
      .where(eq(stepSubscription.stepId, stepId))
      .get() ?? {
      claudeSubscriptionId: null,
      devinSubscriptionId: null,
      antigravitySubscriptionId: null,
    }
  );
}

export function writeSubscription(
  tx: Transaction,
  stepId: string,
  patch: StepSubscriptionPatch,
): void {
  const set = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as StepSubscriptionPatch;
  if (Object.keys(set).length === 0) return;
  tx.insert(stepSubscription)
    .values({ stepId, ...set })
    .onConflictDoUpdate({ target: stepSubscription.stepId, set })
    .run();
  tx.delete(stepSubscription)
    .where(
      and(
        eq(stepSubscription.stepId, stepId),
        isNull(stepSubscription.claudeSubscriptionId),
        isNull(stepSubscription.devinSubscriptionId),
        isNull(stepSubscription.antigravitySubscriptionId),
      ),
    )
    .run();
}
