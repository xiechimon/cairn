import {
  conversationBranch,
  type LocalMergeCommand,
  type LocalMergeReport,
  localCommitIdentity,
  localMergeCommandSchema,
  type MachineLocalMergeRecheckBody,
  type MachineLocalMergeRecheckResponse,
  parseGithubIssueSourceRef,
  parseLocalMergeInstruction,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, step, stopPending, todo } from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import { systemGitOps } from '../lib/git.js';
import { nowMs } from '../lib/ids.js';
import { claimAutonomousMerge, settleAutonomousMerge } from './autonomous-merge.js';
import { type BuildDeps, completeStep, enqueueStep, lastPushedCheckpoint } from './builds.js';
import { triggerChiefWakes } from './chief.js';
import { projectOfTodo } from './git.js';
import { softwareCommitIdentity } from './github-autonomous-token.js';
import type { MachineDeps } from './machine-deps.js';
import { ownedStepRow, publishStepStatus, upsertMessage } from './machine-deps.js';
import { announceMergeStepOutcome } from './merge-announcement.js';
import { computePatchDigest } from './merge-gate/digest.js';
import { notifyTodo } from './notifications.js';
import { projectMergeConfigOf } from './projects.js';
import { getTodo } from './todos.js';

export async function enqueueLocalMerge(
  deps: BuildDeps,
  buildId: string,
  defaultBranch: string,
): Promise<{ enqueued: true }> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  if (!buildRow || !todoRow) throw conflict('Local merge requires a build and its todo');
  const projectRow = projectOfTodo(deps.db, todoRow);
  if (projectRow?.repoKind !== 'local' || projectRow.localPath === null)
    throw conflict('Local merge requires a local project');
  const git = deps.gitOps ?? systemGitOps;
  const judgedBase = await git.resolveCommit(projectRow.localPath, `refs/heads/${defaultBranch}`);
  const judgedHead = lastPushedCheckpoint(deps, buildId, { mergeSteps: false });
  if (judgedBase === null || judgedHead === null)
    throw conflict('Local merge requires the base and delivered commit');
  const files = await git.localCompareFiles(projectRow.localPath, judgedBase, judgedHead);
  const patchDigest = computePatchDigest(files).patchDigest;
  if (patchDigest === null) throw conflict('Local merge requires a readable delivered patch');
  const required = [...projectMergeConfigOf(projectRow).localChecks];
  const source = todoRow.sourceRef ? parseGithubIssueSourceRef(todoRow.sourceRef) : null;
  const command = localMergeCommandSchema.parse({
    projectId: todoRow.projectId,
    buildId,
    defaultBranch,
    judgedBase,
    judgedHead,
    judgedPatchDigest: patchDigest,
    workBranch: conversationBranch(buildId),
    localChecks: required,
    message:
      source === null
        ? todoRow.title
        : `${todoRow.title}\n\nCloses ${source.owner}/${source.repo}#${source.issueNumber}`,
    identity: softwareCommitIdentity(deps) ?? localCommitIdentity(deps.user.displayName),
  });
  deps.db.transaction(() => {
    const current = deps.db.select().from(todo).where(eq(todo.id, todoRow.id)).get();
    if (
      current?.latestBuildId !== buildId ||
      current.archivedAt !== null ||
      !['done', 'review', 'failed'].includes(current.phase) ||
      current.projectId !== todoRow.projectId
    )
      throw conflict('Local merge delivery changed while preparing the command');
    const currentProject = projectOfTodo(deps.db, current);
    if (
      currentProject?.repoKind !== 'local' ||
      currentProject.localPath !== projectRow.localPath ||
      currentProject.baseBranch !== projectRow.baseBranch ||
      JSON.stringify(projectMergeConfigOf(currentProject).localChecks) !== JSON.stringify(required)
    )
      throw conflict('Local merge target changed while preparing the command');
    claimAutonomousMerge(deps.db, buildId, true);
    enqueueStep(
      deps,
      buildId,
      'merge',
      todoRow.teamId,
      JSON.stringify({
        kind: 'local-merge',
        command,
      }),
      false,
      true,
    );
  });
  return { enqueued: true };
}

export function localMergeAuthorizationRefusal(
  db: Db,
  command: LocalMergeCommand,
  todoRow: typeof todo.$inferSelect,
): string | null {
  if (todoRow.archivedAt !== null) return 'task-archived';
  if (todoRow.latestBuildId !== command.buildId) return 'build-superseded';
  if (todoRow.projectId !== command.projectId) return 'task-moved';
  if (!['done', 'review', 'failed'].includes(todoRow.phase)) return 'task-phase';
  const target = projectOfTodo(db, todoRow);
  if (target?.repoKind !== 'local' || target.id !== command.projectId) return 'project-target';
  if (
    JSON.stringify(projectMergeConfigOf(target).localChecks) !== JSON.stringify(command.localChecks)
  )
    return 'checks-changed';
  if (target.baseBranch !== null && target.baseBranch !== command.defaultBranch)
    return 'branch-changed';
  return null;
}

export function localMergeRecheckAuthorization(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  body: MachineLocalMergeRecheckBody,
): MachineLocalMergeRecheckResponse {
  const stepRow = ownedStepRow(deps, machineId, stepId);
  if (stepRow.status !== 'claimed') return { authorized: false, reason: 'step-released' };
  const stored = parseLocalMergeInstruction(stepRow.prompt);
  if (stepRow.kind !== 'merge' || stored === null)
    return { authorized: false, reason: 'not-local-merge' };
  if (JSON.stringify(stored) !== JSON.stringify(body.command))
    return { authorized: false, reason: 'command-mismatch' };
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  if (todoRow === undefined) return { authorized: false, reason: 'task-missing' };
  const reason = localMergeAuthorizationRefusal(deps.db, stored, todoRow);
  return reason === null ? { authorized: true } : { authorized: false, reason };
}

export function applyLocalMergeReport(
  deps: MachineDeps,
  row: typeof step.$inferSelect,
  report: LocalMergeReport,
): boolean {
  const command = parseLocalMergeInstruction(row.prompt);
  if (!command) throw conflict('No local merge command was issued for this step');
  if (
    row.kind !== 'merge' ||
    JSON.stringify(command) !== JSON.stringify(report.command) ||
    command.buildId !== row.buildId
  )
    throw conflict('Local merge report does not match its command');
  const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
  const record = buildRow ? getTodo(deps, buildRow.todoId) : null;
  if (!record || record.projectId !== command.projectId)
    throw conflict('Local merge project changed');
  const { result } = report;
  if (result.outcome === 'merged') settleAutonomousMerge(deps.db, row.buildId, 'merged');
  if (row.status !== 'claimed') return true;
  if (result.outcome !== 'merged') {
    settleAutonomousMerge(deps.db, row.buildId, 'refused');
    announceMergeStepOutcome(deps, {
      stepId: row.id,
      buildId: row.buildId,
      text: `合并没有成功：${result.reason}`,
    });
  }
  deps.db
    .update(step)
    .set({
      status: 'done',
      archiveStop: null,
      finishedAt: nowMs(),
      ...(result.outcome === 'merged' ? { checkpointCommit: result.commit } : {}),
    })
    .where(eq(step.id, row.id))
    .run();
  deps.db.delete(stopPending).where(eq(stopPending.stepId, row.id)).run();
  upsertMessage(deps, {
    id: `local-merge-${row.id}`,
    conversationId: row.buildId,
    role: 'system',
    content: JSON.stringify({ kind: 'local-merge-result', ...report }),
    createdAt: nowMs(),
  });
  if (result.outcome === 'merged') {
    completeStep(deps, row.id);
  } else if (record.latestBuildId === row.buildId && record.phase === 'review') {
    const notice = notifyTodo(
      deps,
      record,
      'build_review',
      `Local merge ${result.outcome}: ${result.reason}`,
    );
    upsertMessage(deps, {
      id: `local-merge-notice-${row.id}`,
      conversationId: row.buildId,
      role: 'system',
      content: `Local merge ${result.outcome}: ${result.reason}. Notification ${notice.id}.`,
      createdAt: nowMs(),
    });
    if (result.outcome === 'recheck') triggerChiefWakes(deps, record, 'review');
  }
  publishStepStatus(deps, row.id);
  deps.machineHub.wake(record.teamId);
  return true;
}
