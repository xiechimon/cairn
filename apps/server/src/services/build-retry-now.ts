import { eq } from 'drizzle-orm';
import { build } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId } from '../lib/ids.js';
import { applyBuildStepAction } from './build-step-action.js';
import { type BuildDeps, NotFoundError } from './builds.js';
import { retryQuotaWaitNow } from './quota-wait.js';
import { getTodo } from './todos.js';

export async function retryBuildNow(
  deps: BuildDeps,
  buildId: string,
  clientMessageId?: string,
): Promise<{ mode: 'quota_resumed' | 'restarted' }> {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  const todoRecord = getTodo(deps, row.todoId);
  if (!todoRecord) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRecord.archivedAt != null) throw new HttpError(409, 'Unarchive to continue');
  if (todoRecord.latestBuildId !== buildId) {
    throw new HttpError(409, 'This run is no longer the latest build');
  }
  if (
    todoRecord.phase === 'done' ||
    todoRecord.phase === 'closed' ||
    todoRecord.phase === 'stopped'
  ) {
    throw new HttpError(409, 'Task is not waiting to retry');
  }
  if (retryQuotaWaitNow(deps, buildId)) {
    return { mode: 'quota_resumed' };
  }
  if (todoRecord.phase === 'failed') {
    await applyBuildStepAction(
      deps,
      buildId,
      { action: 'restart', feedback: '', clientMessageId: clientMessageId ?? newRecordId() },
      deps.user.displayName,
      'person',
    );
    return { mode: 'restarted' };
  }
  throw new HttpError(409, 'Task is not waiting to retry');
}
