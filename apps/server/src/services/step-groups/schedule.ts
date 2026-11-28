import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { step, stepSchedule } from '../../db/schema.js';

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

export function readManySchedule(db: Reader, stepIds: string[]): Map<string, StepSchedule> {
  if (stepIds.length === 0) return new Map();
  return new Map(
    db
      .select({ stepId: stepSchedule.stepId, ...scheduleColumns })
      .from(stepSchedule)
      .where(inArray(stepSchedule.stepId, stepIds))
      .all()
      .map(({ stepId, ...row }) => [stepId, row]),
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

export function writeScheduleGuarded(
  tx: Transaction,
  stepId: string,
  patch: StepSchedulePatch,
  guard: SQL,
): void {
  const assignments: SQL[] = [];
  if (patch.scheduleId !== undefined) assignments.push(sql`"scheduleId" = ${patch.scheduleId}`);
  if (patch.scheduledBy !== undefined) assignments.push(sql`"scheduledBy" = ${patch.scheduledBy}`);
  if (assignments.length === 0) return;
  const result = tx.run(
    sql`INSERT INTO ${stepSchedule} ("stepId", "scheduleId", "scheduledBy") SELECT ${step.id}, ${patch.scheduleId ?? null}, ${patch.scheduledBy ?? null} FROM ${step} WHERE ${and(eq(step.id, stepId), guard)} ON CONFLICT ("stepId") DO UPDATE SET ${sql.join(assignments, sql`, `)}`,
  );
  if (result.changes > 0) {
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
}
