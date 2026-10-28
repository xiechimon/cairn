import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, plan, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

export const REJECTED_SPLIT_PROPOSAL_PREFIX = 'split-proposal-rejected:v1\n';
export const SPLIT_PROPOSAL_CORRECTION =
  'Resubmit split_todo for this parent with corrected agent IDs and dependency indexes. This rejected proposal cannot be confirmed or executed.';

export function assertSplitProposalExecutable(errorMessage: string | null): void {
  if (errorMessage?.startsWith(REJECTED_SPLIT_PROPOSAL_PREFIX)) {
    throw new HttpError(409, SPLIT_PROPOSAL_CORRECTION);
  }
}

export function canResubmitRejectedSplit(
  db: Db,
  parent: Pick<typeof todo.$inferSelect, 'id' | 'phase' | 'latestBuildId'>,
): boolean {
  if (parent.phase !== 'confirm' || parent.latestBuildId === null) return false;
  const current = db
    .select()
    .from(build)
    .where(and(eq(build.id, parent.latestBuildId), eq(build.todoId, parent.id)))
    .get();
  if (
    current === undefined ||
    !current.withPlan ||
    current.triggerSource !== 'chief' ||
    !current.errorMessage?.startsWith(REJECTED_SPLIT_PROPOSAL_PREFIX) ||
    current.planDocId === null
  )
    return false;
  const savedPlan = db
    .select({ id: plan.id })
    .from(plan)
    .where(and(eq(plan.id, current.planDocId), eq(plan.buildId, current.id)))
    .get();
  if (savedPlan === undefined) return false;
  const child = db.select({ id: todo.id }).from(todo).where(eq(todo.sourceTodo, parent.id)).get();
  if (child !== undefined) return false;
  const execution = db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .where(eq(build.todoId, parent.id))
    .get();
  return execution === undefined;
}
