import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { stepSkillInjection } from '../../db/schema.js';

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
