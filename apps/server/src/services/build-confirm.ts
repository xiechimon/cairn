import { CONFIRM_ANNOUNCEMENT } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { type BuildDeps, dispatchSplitChildren, enqueueStep, NotFoundError } from './builds.js';
import { planAutoConfirmation } from './plan-auto-confirm.js';
import { assertSplitProposalExecutable } from './split-proposal.js';
import { childrenOfTodo, getTodo, setTodoPhase } from './todos.js';
import { insertGateAnnouncement } from './transcript.js';

export function applyBuildConfirm(deps: BuildDeps, buildId: string, actorName: string): void {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  assertSplitProposalExecutable(row.errorMessage);
  const todoRecord = getTodo(deps, row.todoId);
  if (!todoRecord) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRecord.archivedAt != null) throw new HttpError(409, 'Unarchive to continue');
  if (todoRecord.phase !== 'confirm') {
    throw new HttpError(409, `确认仅适用于待确认（confirm）关口，当前相位 ${todoRecord.phase}`);
  }
  insertGateAnnouncement(deps, buildId, CONFIRM_ANNOUNCEMENT, actorName);
  if (childrenOfTodo(deps.db, todoRecord.id).length > 0) {
    dispatchSplitChildren(deps, todoRecord.id);
    setTodoPhase(deps, todoRecord.id, 'building');
    return;
  }
  setTodoPhase(deps, todoRecord.id, 'building');
  enqueueStep(deps, buildId, 'build', todoRecord.teamId);
}

export function confirmPlanAutomatically(deps: BuildDeps, buildId: string): void {
  try {
    applyBuildConfirm(deps, buildId, 'server');
  } catch (error) {
    if (
      !(
        error instanceof HttpError &&
        error.status === 409 &&
        (error.message.startsWith('agent-label-privileged:') ||
          error.message.startsWith('intake-label-assignment-failed:'))
      )
    )
      throw error;
  }
}

export function sweepPlanAutoConfirm(deps: BuildDeps): void {
  const waiting = deps.db.select().from(todo).where(eq(todo.phase, 'confirm')).all();
  for (const todoRow of waiting) {
    if (todoRow.latestBuildId === null) continue;
    if (planAutoConfirmation(deps, todoRow.latestBuildId).eligible)
      confirmPlanAutomatically(deps, todoRow.latestBuildId);
  }
}
