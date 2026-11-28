import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { stepSchedule } from '../../db/schema.js';

export type StepSchedule = Omit<typeof stepSchedule.$inferSelect, 'stepId'>;
export type StepSchedulePatch = Partial<StepSchedule>;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select'>;

export const scheduleColumns = {
  scheduleId: stepSchedule.scheduleId,
  scheduledBy: stepSchedule.scheduledBy,
};

export function readSchedule(db: Reader, stepId: string): StepSchedule {
  return (
    db.select(scheduleColumns).from(stepSchedule).where(eq(stepSchedule.stepId, stepId)).get() ?? {
      scheduleId: null,
      scheduledBy: null,
    }
  );
}

export function writeSchedule(tx: Transaction, stepId: string, patch: StepSchedulePatch): void {
  const set = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as StepSchedulePatch;
  if (Object.keys(set).length === 0) return;
  tx.insert(stepSchedule)
    .values({ stepId, ...set })
    .onConflictDoUpdate({ target: stepSchedule.stepId, set })
    .run();
  tx.delete(stepSchedule)
    .where(
      and(
        eq(stepSchedule.stepId, stepId),
        isNull(stepSchedule.scheduleId),
        isNull(stepSchedule.scheduledBy),
      ),
    )
    .run();
}
