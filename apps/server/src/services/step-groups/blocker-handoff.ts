import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { step, stepBlockerHandoff } from '../../db/schema.js';

export type StepBlockerHandoff = {
  blockerHandoff: typeof stepBlockerHandoff.$inferSelect.blockerHandoff | null;
};
export type StepBlockerHandoffPatch = Partial<StepBlockerHandoff>;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select'>;

export const blockerHandoffColumns = { blockerHandoff: stepBlockerHandoff.blockerHandoff };

export function readBlockerHandoff(db: Reader, stepId: string): StepBlockerHandoff {
  return (
    db
      .select(blockerHandoffColumns)
      .from(stepBlockerHandoff)
      .where(eq(stepBlockerHandoff.stepId, stepId))
      .get() ?? { blockerHandoff: null }
  );
}

export function readManyBlockerHandoff(
  db: Reader,
  stepIds: string[],
): Map<string, StepBlockerHandoff> {
  if (stepIds.length === 0) return new Map();
  return new Map(
    db
      .select({ stepId: stepBlockerHandoff.stepId, ...blockerHandoffColumns })
      .from(stepBlockerHandoff)
      .where(inArray(stepBlockerHandoff.stepId, stepIds))
      .all()
      .map(({ stepId, ...row }) => [stepId, row]),
  );
}

export function writeBlockerHandoff(
  tx: Transaction,
  stepId: string,
  patch: StepBlockerHandoffPatch,
): void {
  if (patch.blockerHandoff === undefined) return;
  if (patch.blockerHandoff === null) {
    tx.delete(stepBlockerHandoff).where(eq(stepBlockerHandoff.stepId, stepId)).run();
    return;
  }
  tx.insert(stepBlockerHandoff)
    .values({ stepId, blockerHandoff: patch.blockerHandoff })
    .onConflictDoUpdate({
      target: stepBlockerHandoff.stepId,
      set: { blockerHandoff: patch.blockerHandoff },
    })
    .run();
}

export function writeBlockerHandoffGuarded(
  tx: Transaction,
  stepId: string,
  patch: StepBlockerHandoffPatch,
  guard: SQL,
): void {
  if (patch.blockerHandoff === undefined) return;
  if (patch.blockerHandoff === null) {
    tx.delete(stepBlockerHandoff)
      .where(
        and(
          eq(stepBlockerHandoff.stepId, stepId),
          sql`EXISTS (SELECT 1 FROM ${step} WHERE ${and(eq(step.id, stepId), guard)})`,
        ),
      )
      .run();
    return;
  }
  const value = JSON.stringify(patch.blockerHandoff);
  tx.run(
    sql`INSERT INTO ${stepBlockerHandoff} ("stepId", "blockerHandoff") SELECT ${step.id}, ${value} FROM ${step} WHERE ${and(eq(step.id, stepId), guard)} ON CONFLICT ("stepId") DO UPDATE SET "blockerHandoff" = excluded."blockerHandoff"`,
  );
}
