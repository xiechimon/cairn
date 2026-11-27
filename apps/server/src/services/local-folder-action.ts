import {
  type LocalFolderActionCommand,
  type LocalFolderActionReport,
  parseLocalFolderActionInstruction,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, step, stopPending, type todo } from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { completeStep, publishBuild } from './builds.js';
import { projectOfTodo } from './git.js';
import type { MachineDeps } from './machine-deps.js';
import { publishStepStatus, upsertMessage } from './machine-deps.js';
import { getTodo } from './todos.js';

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
