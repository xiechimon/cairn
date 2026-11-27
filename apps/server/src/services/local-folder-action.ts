import {
  ACTIVE_STEP_STATUSES,
  type LocalFolderActionCommand,
  type LocalFolderActionReport,
  localFolderActionCommandSchema,
  parseLocalFolderActionInstruction,
} from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, step, stopPending, todo } from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { type BuildDeps, completeStep, enqueueStep, publishBuild } from './builds.js';
import { projectOfTodo } from './git.js';
import type { MachineDeps } from './machine-deps.js';
import { ownedStepRow, publishStepStatus, upsertMessage } from './machine-deps.js';
import { getTodo } from './todos.js';

export function enqueueLocalFolderAction(
  deps: BuildDeps,
  buildId: string,
  action: 'undo' | 'merge',
): { enqueued: true; stepId: string } {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  if (!buildRow || !todoRow) throw conflict('Local folder action requires a build and its todo');
  if (todoRow.archivedAt !== null) throw conflict('Cannot act on an archived task');
  if (todoRow.latestBuildId !== buildId) {
    throw conflict('Only the current delivery can run this action');
  }
  const projectRow = projectOfTodo(deps.db, todoRow);
  if (projectRow?.repoKind !== 'local' || projectRow.localPath === null) {
    throw conflict('Action requires a local folder project');
  }
  const command = localFolderActionCommandSchema.parse({
    action,
    projectId: todoRow.projectId,
    buildId,
  });
  return deps.db.transaction(() => {
    const active = deps.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, buildId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
      .all();
    for (const existing of active) {
      const parsed = parseLocalFolderActionInstruction(existing.prompt);
      if (parsed?.action === action) {
        return { enqueued: true as const, stepId: existing.id };
      }
      throw conflict('Task has an active step running; wait for it to finish first');
    }
    const enqueued = enqueueStep(
      deps,
      buildId,
      'merge',
      todoRow.teamId,
      JSON.stringify({ kind: 'local-folder-action', command }),
      false,
      true,
    );
    return { enqueued: true as const, stepId: enqueued.id };
  });
}

export function localFolderActionAuthorizationRefusal(
  db: Db,
  command: LocalFolderActionCommand,
  todoRow: typeof todo.$inferSelect,
): string | null {
  if (todoRow.archivedAt !== null) return 'task-archived';
  if (todoRow.latestBuildId !== command.buildId) return 'build-superseded';
  if (todoRow.projectId !== command.projectId) return 'task-moved';
  const target = projectOfTodo(db, todoRow);
  if (target?.repoKind !== 'local' || target.id !== command.projectId) return 'project-target';
  return null;
}

export function applyLocalFolderActionReport(
  deps: MachineDeps,
  row: typeof step.$inferSelect,
  report: LocalFolderActionReport,
): boolean {
  const command = parseLocalFolderActionInstruction(row.prompt);
  if (!command) throw conflict('No local folder action command was issued for this step');
  if (
    row.kind !== 'merge' ||
    JSON.stringify(command) !== JSON.stringify(report.command) ||
    command.buildId !== row.buildId
  ) {
    throw conflict('Local folder action report does not match its command');
  }
  const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
  const record = buildRow ? getTodo(deps, buildRow.todoId) : null;
  if (!record || record.projectId !== command.projectId) {
    throw conflict('Local folder action project changed');
  }
  if (row.status !== 'claimed') return true;
  const { result } = report;
  deps.db
    .update(step)
    .set({
      status: 'done',
      archiveStop: null,
      finishedAt: nowMs(),
      ...(result.commit !== undefined ? { checkpointCommit: result.commit } : {}),
    })
    .where(eq(step.id, row.id))
    .run();
  deps.db.delete(stopPending).where(eq(stopPending.stepId, row.id)).run();
  upsertMessage(deps, {
    id: `local-folder-action-${row.id}`,
    conversationId: row.buildId,
    role: 'system',
    content: JSON.stringify({ kind: 'local-folder-action-result', ...report }),
    createdAt: nowMs(),
  });
  if (
    command.action === 'merge' &&
    (result.outcome === 'merged' || result.outcome === 'already-merged')
  ) {
    completeStep(deps, row.id);
  }
  if (buildRow) publishBuild(deps, buildRow);
  publishStepStatus(deps, row.id);
  deps.machineHub.wake(record.teamId);
  return true;
}

export function requireOwnedActionStep(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
): typeof step.$inferSelect {
  return ownedStepRow(deps, machineId, stepId);
}
