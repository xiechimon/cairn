import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { stepBlockerHandoff } from '../../db/schema.js';

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
