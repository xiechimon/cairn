import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { step, stepSubscription } from '../../db/schema.js';

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

export function readManySubscription(db: Reader, stepIds: string[]): Map<string, StepSubscription> {
  if (stepIds.length === 0) return new Map();
  return new Map(
    db
      .select({ stepId: stepSubscription.stepId, ...subscriptionColumns })
      .from(stepSubscription)
      .where(inArray(stepSubscription.stepId, stepIds))
      .all()
      .map(({ stepId, ...row }) => [stepId, row]),
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

export function writeSubscriptionGuarded(
  tx: Transaction,
  stepId: string,
  patch: StepSubscriptionPatch,
  guard: SQL,
): void {
  const assignments: SQL[] = [];
  if (patch.claudeSubscriptionId !== undefined)
    assignments.push(sql`"claudeSubscriptionId" = ${patch.claudeSubscriptionId}`);
  if (patch.devinSubscriptionId !== undefined)
    assignments.push(sql`"devinSubscriptionId" = ${patch.devinSubscriptionId}`);
  if (patch.antigravitySubscriptionId !== undefined)
    assignments.push(sql`"antigravitySubscriptionId" = ${patch.antigravitySubscriptionId}`);
  if (assignments.length === 0) return;
  const result = tx.run(
    sql`INSERT INTO ${stepSubscription} ("stepId", "claudeSubscriptionId", "devinSubscriptionId", "antigravitySubscriptionId") SELECT ${step.id}, ${patch.claudeSubscriptionId ?? null}, ${patch.devinSubscriptionId ?? null}, ${patch.antigravitySubscriptionId ?? null} FROM ${step} WHERE ${and(eq(step.id, stepId), guard)} ON CONFLICT ("stepId") DO UPDATE SET ${sql.join(assignments, sql`, `)}`,
  );
  if (result.changes > 0) {
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
}
