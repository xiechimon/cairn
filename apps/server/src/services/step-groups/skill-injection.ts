import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { step, stepSkillInjection } from '../../db/schema.js';

export type StepSkillInjection = {
  skillInjection: typeof stepSkillInjection.$inferSelect.skillInjection | null;
};
export type StepSkillInjectionPatch = Partial<StepSkillInjection>;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select'>;

export const skillInjectionColumns = { skillInjection: stepSkillInjection.skillInjection };

export function readSkillInjection(db: Reader, stepId: string): StepSkillInjection {
  return (
    db
      .select(skillInjectionColumns)
      .from(stepSkillInjection)
      .where(eq(stepSkillInjection.stepId, stepId))
      .get() ?? { skillInjection: null }
  );
}

export function readManySkillInjection(
  db: Reader,
  stepIds: string[],
): Map<string, StepSkillInjection> {
  if (stepIds.length === 0) return new Map();
  return new Map(
    db
      .select({ stepId: stepSkillInjection.stepId, ...skillInjectionColumns })
      .from(stepSkillInjection)
      .where(inArray(stepSkillInjection.stepId, stepIds))
      .all()
      .map(({ stepId, ...row }) => [stepId, row]),
  );
}

export function writeSkillInjection(
  tx: Transaction,
  stepId: string,
  patch: StepSkillInjectionPatch,
): void {
  if (patch.skillInjection === undefined) return;
  if (patch.skillInjection === null) {
    tx.delete(stepSkillInjection).where(eq(stepSkillInjection.stepId, stepId)).run();
    return;
  }
  tx.insert(stepSkillInjection)
    .values({ stepId, skillInjection: patch.skillInjection })
    .onConflictDoUpdate({
      target: stepSkillInjection.stepId,
      set: { skillInjection: patch.skillInjection },
    })
    .run();
}

export function writeSkillInjectionGuarded(
  tx: Transaction,
  stepId: string,
  patch: StepSkillInjectionPatch,
  guard: SQL,
): void {
  if (patch.skillInjection === undefined) return;
  if (patch.skillInjection === null) {
    tx.delete(stepSkillInjection)
      .where(
        and(
          eq(stepSkillInjection.stepId, stepId),
          sql`EXISTS (SELECT 1 FROM ${step} WHERE ${and(eq(step.id, stepId), guard)})`,
        ),
      )
      .run();
    return;
  }
  const value = JSON.stringify(patch.skillInjection);
  tx.run(
    sql`INSERT INTO ${stepSkillInjection} ("stepId", "skillInjection") SELECT ${step.id}, ${value} FROM ${step} WHERE ${and(eq(step.id, stepId), guard)} ON CONFLICT ("stepId") DO UPDATE SET "skillInjection" = excluded."skillInjection"`,
  );
}
