import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { step, stepMemoryTrace } from '../../db/schema.js';

export type StepMemoryTrace = {
  memoryTrace: typeof stepMemoryTrace.$inferSelect.memoryTrace | null;
};
export type StepMemoryTracePatch = Partial<StepMemoryTrace>;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select'>;

export const memoryTraceColumns = { memoryTrace: stepMemoryTrace.memoryTrace };

export function readMemoryTrace(db: Reader, stepId: string): StepMemoryTrace {
  return (
    db
      .select(memoryTraceColumns)
      .from(stepMemoryTrace)
      .where(eq(stepMemoryTrace.stepId, stepId))
      .get() ?? { memoryTrace: null }
  );
}

export function readManyMemoryTrace(db: Reader, stepIds: string[]): Map<string, StepMemoryTrace> {
  if (stepIds.length === 0) return new Map();
  return new Map(
    db
      .select({ stepId: stepMemoryTrace.stepId, ...memoryTraceColumns })
      .from(stepMemoryTrace)
      .where(inArray(stepMemoryTrace.stepId, stepIds))
      .all()
      .map(({ stepId, ...row }) => [stepId, row]),
  );
}

export function writeMemoryTrace(
  tx: Transaction,
  stepId: string,
  patch: StepMemoryTracePatch,
): void {
  if (patch.memoryTrace === undefined) return;
  if (patch.memoryTrace === null) {
    tx.delete(stepMemoryTrace).where(eq(stepMemoryTrace.stepId, stepId)).run();
    return;
  }
  tx.insert(stepMemoryTrace)
    .values({ stepId, memoryTrace: patch.memoryTrace })
    .onConflictDoUpdate({ target: stepMemoryTrace.stepId, set: { memoryTrace: patch.memoryTrace } })
    .run();
}

export function writeMemoryTraceGuarded(
  tx: Transaction,
  stepId: string,
  patch: StepMemoryTracePatch,
  guard: SQL,
): void {
  if (patch.memoryTrace === undefined) return;
  if (patch.memoryTrace === null) {
    tx.delete(stepMemoryTrace)
      .where(
        and(
          eq(stepMemoryTrace.stepId, stepId),
          sql`EXISTS (SELECT 1 FROM ${step} WHERE ${and(eq(step.id, stepId), guard)})`,
        ),
      )
      .run();
    return;
  }
  const value = JSON.stringify(patch.memoryTrace);
  tx.run(
    sql`INSERT INTO ${stepMemoryTrace} ("stepId", "memoryTrace") SELECT ${step.id}, ${value} FROM ${step} WHERE ${and(eq(step.id, stepId), guard)} ON CONFLICT ("stepId") DO UPDATE SET "memoryTrace" = excluded."memoryTrace"`,
  );
}
