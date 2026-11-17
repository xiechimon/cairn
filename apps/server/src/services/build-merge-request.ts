import {
  ACTIVE_STEP_STATUSES,
  DEFAULT_SHIP_ROUTE,
  isInfoOutput,
  MERGE_ANNOUNCEMENT,
} from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { build, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { systemGitOps } from '../lib/git.js';
import { mergeThroughGithub } from './build-github-merge.js';
import {
  assertDeliveredBuild,
  assertMergeTools,
  type BuildDeps,
  enqueueStep,
  githubPrOf,
  INFO_CARD_MERGE_REFUSAL,
  NotFoundError,
  restoreFailedReview,
} from './builds.js';
import { quickLaneRefusal } from './coordinator-request.js';
import { projectOfTodo, repoDirFor } from './git.js';
import { buildHostedMergeInstruction } from './hosted-merge-instruction.js';
import { enqueueLocalMerge } from './local-merge.js';
import { resolveNamedPrompt } from './named-prompts.js';
import { assertPhaseTransition } from './phase.js';
import { projectShipRouteOf } from './projects.js';
import { appendShipGateInstruction, CUSTOM_NEEDS_PR, hasGithubPr, judgeShip } from './ship-gate.js';
import { insertGateAnnouncement } from './transcript.js';

export async function requestMerge(
  deps: BuildDeps,
  buildId: string,
  actor?: string,
): Promise<{ delegated: true }> {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  let todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRow.archivedAt !== null) throw new HttpError(409, 'Unarchive to continue');
  if (isInfoOutput(todoRow.output)) throw new HttpError(409, INFO_CARD_MERGE_REFUSAL);
  if (todoRow.latestBuildId !== buildId)
    throw new HttpError(409, 'Only the current delivery can be merged');
  if (!['done', 'review', 'failed'].includes(todoRow.phase))
    throw new HttpError(409, 'Finish the task before requesting a merge');
  assertDeliveredBuild(deps, row);
  const laneRefusal = quickLaneRefusal(deps.db, todoRow);
  if (laneRefusal !== null) throw new HttpError(409, laneRefusal);
  assertNoMergeStepInFlight(deps, buildId);
  const projectRow = projectOfTodo(deps.db, todoRow);
  const shipRoute = projectRow === undefined ? DEFAULT_SHIP_ROUTE : projectShipRouteOf(projectRow);
  if (shipRoute === 'local-merge' && projectRow?.repoKind !== 'local') {
    throw new HttpError(409, 'local-merge requires a local repository project');
  }
  if (shipRoute === 'custom' && !hasGithubPr(deps, buildId))
    throw new HttpError(409, CUSTOM_NEEDS_PR);
  const judged = shipRoute === 'custom' ? await judgeShip(deps, buildId) : null;
  const pr = shipRoute === 'custom' ? null : githubPrOf(deps, todoRow, row.prNumber);
  if (pr !== null) {
    return mergeThroughGithub(deps, row, pr.prNumber, pr.repoRef, actor ?? deps.user.displayName);
  }
  if (projectRow?.repoKind === 'local' && shipRoute !== 'custom') {
    if (todoRow.phase === 'failed') assertDeliveredBuild(deps, row);
    else if (todoRow.phase !== 'done') assertPhaseTransition(todoRow.phase, 'done');
    assertMergeTools(deps, todoRow);
    const git = deps.gitOps ?? systemGitOps;
    const localPath = projectRow.localPath;
    if (localPath === null) {
      throw new HttpError(409, '本地项目没有仓库路径，拒绝走未受控合并');
    }
    const listing = await git.listBranches(localPath).catch(() => null);
    if (listing === null || listing.defaultBranch === null) {
      throw new HttpError(409, '无法读取本地仓库默认分支，拒绝走未受控合并');
    }
    await enqueueLocalMerge(deps, buildId, projectRow.baseBranch ?? listing.defaultBranch);
    insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
    return { delegated: true };
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
  if (shipRoute === 'custom' && judged !== null) {
    prompt = appendShipGateInstruction(resolveNamedPrompt(deps.db, todoRow.teamId, 'ship').text, {
      buildId,
      judgedHead: judged.headSha,
    });
  } else if (projectRow?.repoKind === 'hosted' && projectRow.repoName !== null) {
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
  enqueueStep(deps, buildId, 'merge', todoRow.teamId, prompt, false, true);
  return { delegated: true };
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
  if (inFlight) throw new HttpError(409, '这个构建已有一个合并步在排队或在跑，等它结束再发起');
}
