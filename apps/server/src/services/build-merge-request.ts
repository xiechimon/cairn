import {
  ACTIVE_STEP_STATUSES,
  isInfoOutput,
  localFolderActionCommandSchema,
  MERGE_ANNOUNCEMENT,
  parseLocalFolderActionInstruction,
} from '@cairn/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { build, step, todo } from '../db/schema.js';
import { conflict, HttpError, taskArchived } from '../lib/errors.js';
import { systemGitOps } from '../lib/git.js';
import { mergeThroughGithub } from './build-github-merge.js';
import {
  assertDeliveredBuild,
  assertMergeTools,
  type BuildDeps,
  enqueueStep,
  githubPrOf,
  INFO_CARD_MERGE_REFUSAL,
  type MergeRequestOutcome,
  NotFoundError,
  restoreFailedReview,
} from './builds.js';
import { projectOfTodo, readBuildChanges, repoDirFor } from './git.js';
import { buildHostedMergeInstruction } from './hosted-merge-instruction.js';
import { enqueueLocalMerge } from './local-merge.js';
import { assertPhaseTransition } from './phase.js';
import { insertGateAnnouncement } from './transcript.js';

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

function newestMergeStepId(deps: BuildDeps, buildId: string): string | null {
  return (
    deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, buildId), eq(step.kind, 'merge')))
      .orderBy(desc(step.createdAt), desc(sql`rowid`))
      .get()?.id ?? null
  );
}

export async function requestMerge(
  deps: BuildDeps,
  buildId: string,
  actor?: string,
): Promise<MergeRequestOutcome> {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  let todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRow.archivedAt !== null) throw taskArchived();
  if (isInfoOutput(todoRow.output)) throw new HttpError(409, INFO_CARD_MERGE_REFUSAL);
  if (todoRow.latestBuildId !== buildId)
    throw new HttpError(409, 'Only the current delivery can be merged');
  if (!['done', 'review', 'failed'].includes(todoRow.phase))
    throw new HttpError(409, 'Finish the task before requesting a merge');
  assertDeliveredBuild(deps, row);
  assertNoMergeStepInFlight(deps, buildId);
  const projectRow = projectOfTodo(deps.db, todoRow);
  const pr = githubPrOf(deps, todoRow, row.prNumber);
  if (pr !== null) {
    return mergeThroughGithub(deps, row, pr.prNumber, pr.repoRef, actor ?? deps.user.displayName);
  }
  if (projectRow?.repoKind === 'local') {
    if (todoRow.phase === 'failed') assertDeliveredBuild(deps, row);
    else if (todoRow.phase !== 'done') assertPhaseTransition(todoRow.phase, 'done');
    assertMergeTools(deps, todoRow);
    const git = deps.gitOps ?? systemGitOps;
    const localPath = projectRow.localPath;
    if (localPath === null) {
      throw new HttpError(409, '本地项目没有仓库路径，拒绝走未受控合并');
    }
    const current = await readBuildChanges({ db: deps.db, reposDir: deps.reposDir ?? '' }, buildId);
    if (current.plainFolder !== undefined) {
      if (current.plainFolder.mode === 'in-place') {
        throw new HttpError(409, '原地运行的大目录任务直接作用于原目录，无需单独合并');
      }
      if (current.plainFolder.status === 'merged') {
        throw new HttpError(409, '本次本地目录改动已合并，无需重复合并');
      }
      if (current.plainFolder.status === 'undone') {
        throw new HttpError(409, '本次本地目录改动已撤销，如需再次改动请新建或重跑任务');
      }
      const res = enqueueLocalFolderAction(deps, buildId, 'merge');
      insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
      return { state: 'requested', stepId: res.stepId };
    }
    const listing = await git.listBranches(localPath).catch(() => null);
    if (listing === null || listing.defaultBranch === null) {
      throw new HttpError(409, '无法读取本地仓库默认分支，拒绝走未受控合并');
    }
    await enqueueLocalMerge(deps, buildId, projectRow.baseBranch ?? listing.defaultBranch);
    insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
    return { state: 'requested', stepId: newestMergeStepId(deps, buildId) };
  }
  restoreFailedReview(deps, row);
  if (todoRow.phase === 'failed') {
    const restored = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
    if (!restored) throw new NotFoundError(`todo ${row.todoId}`);
    todoRow = restored;
  }
  if (todoRow.phase !== 'done') assertPhaseTransition(todoRow.phase, 'done');
  assertMergeTools(deps, todoRow);
  insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
  let prompt: string | undefined;
  if (projectRow?.repoKind === 'hosted' && projectRow.repoName !== null) {
    if (deps.reposDir === undefined) throw new HttpError(409, 'Hosted repository unavailable');
    const dir = repoDirFor(deps.reposDir, todoRow.teamId, projectRow.repoName);
    const { defaultBranch } = await systemGitOps.listBranches(dir);
    prompt = buildHostedMergeInstruction({
      projectId: projectRow.id,
      repoName: projectRow.repoName,
      baseBranch: projectRow.baseBranch ?? defaultBranch ?? 'main',
      configuredBaseBranch: projectRow.baseBranch,
    });
  }
  const current = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (
    current?.latestBuildId !== buildId ||
    current.archivedAt !== null ||
    !['done', 'review', 'failed'].includes(current.phase) ||
    current.projectId !== todoRow.projectId
  )
    throw new HttpError(409, 'The delivery changed while preparing the merge');
  assertNoMergeStepInFlight(deps, buildId);
  const enqueued = enqueueStep(deps, buildId, 'merge', todoRow.teamId, prompt, false, true);
  return { state: 'requested', stepId: enqueued.id };
}

function assertNoMergeStepInFlight(deps: BuildDeps, buildId: string): void {
  const inFlight = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'merge'),
        inArray(step.status, [...ACTIVE_STEP_STATUSES]),
      ),
    )
    .get();
  if (inFlight) throw new HttpError(409, '这个构建已有一个合并步在排队或正在运行，等它结束再发起');
}
