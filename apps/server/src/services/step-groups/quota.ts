import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { step, stepQuota } from '../../db/schema.js';

export type StepQuota = Omit<typeof stepQuota.$inferSelect, 'stepId'>;
export type StepQuotaPatch = Partial<StepQuota>;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select'>;

export const quotaColumns = {
  quotaBlock: stepQuota.quotaBlock,
  fallback: stepQuota.fallback,
  ranModel: stepQuota.ranModel,
};

export function readQuota(db: Reader, stepId: string): StepQuota {
  return (
    db.select(quotaColumns).from(stepQuota).where(eq(stepQuota.stepId, stepId)).get() ?? {
      quotaBlock: null,
      fallback: null,
      ranModel: null,
    }
  );
}

export function readManyQuota(db: Reader, stepIds: string[]): Map<string, StepQuota> {
  if (stepIds.length === 0) return new Map();
  return new Map(
    db
      .select({ stepId: stepQuota.stepId, ...quotaColumns })
      .from(stepQuota)
      .where(inArray(stepQuota.stepId, stepIds))
      .all()
      .map(({ stepId, ...row }) => [stepId, row]),
  );
}

export function writeQuota(tx: Transaction, stepId: string, patch: StepQuotaPatch): void {
  const set = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as StepQuotaPatch;
  if (Object.keys(set).length === 0) return;
  tx.insert(stepQuota)
    .values({ stepId, ...set })
    .onConflictDoUpdate({ target: stepQuota.stepId, set })
    .run();
  tx.delete(stepQuota)
    .where(
      and(
        eq(stepQuota.stepId, stepId),
        isNull(stepQuota.quotaBlock),
        isNull(stepQuota.fallback),
        isNull(stepQuota.ranModel),
      ),
    )
    .run();
}

export function writeQuotaGuarded(
  tx: Transaction,
  stepId: string,
  patch: StepQuotaPatch,
  guard: SQL,
): void {
  const assignments: SQL[] = [];
  if (patch.quotaBlock !== undefined)
    assignments.push(
      sql`"quotaBlock" = ${patch.quotaBlock === null ? null : JSON.stringify(patch.quotaBlock)}`,
    );
  if (patch.fallback !== undefined)
    assignments.push(
      sql`"fallback" = ${patch.fallback === null ? null : JSON.stringify(patch.fallback)}`,
    );
  if (patch.ranModel !== undefined)
    assignments.push(
      sql`"ranModel" = ${patch.ranModel === null ? null : JSON.stringify(patch.ranModel)}`,
    );
  if (assignments.length === 0) return;
  const result = tx.run(
    sql`INSERT INTO ${stepQuota} ("stepId", "quotaBlock", "fallback", "ranModel") SELECT ${step.id}, ${patch.quotaBlock == null ? null : JSON.stringify(patch.quotaBlock)}, ${patch.fallback == null ? null : JSON.stringify(patch.fallback)}, ${patch.ranModel == null ? null : JSON.stringify(patch.ranModel)} FROM ${step} WHERE ${and(eq(step.id, stepId), guard)} ON CONFLICT ("stepId") DO UPDATE SET ${sql.join(assignments, sql`, `)}`,
  );
  if (result.changes > 0) {
    tx.delete(stepQuota)
      .where(
        and(
          eq(stepQuota.stepId, stepId),
          isNull(stepQuota.quotaBlock),
          isNull(stepQuota.fallback),
          isNull(stepQuota.ranModel),
        ),
      )
      .run();
  }
}
