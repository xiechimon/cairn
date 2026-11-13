import { ACTIVE_STEP_STATUSES, DEFAULT_SHIP_ROUTE, MERGE_ANNOUNCEMENT } from '@cairn/shared';
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
import { projectOfTodo, repoDirFor } from './git.js';
import { buildHostedMergeInstruction } from './hosted-merge-instruction.js';
import { enqueueLocalMerge } from './local-merge.js';
import { resolveNamedPrompt } from './named-prompts.js';
import { assertPhaseTransition } from './phase.js';
import { projectMergeConfigOf, projectShipRouteOf } from './projects.js';
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
  if (todoRow.output === 'info') throw new HttpError(409, INFO_CARD_MERGE_REFUSAL);
  assertNoMergeStepInFlight(deps, buildId);
  const projectRow = projectOfTodo(deps.db, todoRow);
  const shipRoute = projectRow === undefined ? DEFAULT_SHIP_ROUTE : projectShipRouteOf(projectRow);
  if (shipRoute === 'local-merge' && projectRow?.repoKind !== 'local') {
    throw new HttpError(409, 'local-merge requires a local repository project');
  }
  if (shipRoute === 'custom' && !hasGithubPr(deps, buildId))
    throw new HttpError(409, CUSTOM_NEEDS_PR);
  const judged = shipRoute === 'merge-gate' ? null : await judgeShip(deps, buildId);
  const pr = shipRoute === 'custom' ? null : githubPrOf(deps, todoRow, row.prNumber);
  if (pr !== null) {
    return mergeThroughGithub(deps, row, pr.prNumber, pr.repoRef, actor ?? deps.user.displayName);
  }
  if (
    projectRow?.repoKind === 'local' &&
    shipRoute !== 'custom' &&
    (shipRoute === 'local-merge' || projectMergeConfigOf(projectRow).mergePolicy === 'autonomous')
  ) {
    if (todoRow.phase === 'failed') assertDeliveredBuild(deps, row);
    else assertPhaseTransition(todoRow.phase, 'done');
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
    const local = await enqueueLocalMerge(
      deps,
      buildId,
      projectRow.baseBranch ?? listing.defaultBranch,
      shipRoute === 'local-merge',
      todoRow.phase === 'failed',
    );
    if (local.enqueued) {
      insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
      return { delegated: true };
    }
    const blocking = local.readiness?.blockers ?? [];
    if (blocking.length > 0) {
      throw new HttpError(
        409,
        `本地合并未通过关口判定，无法落地：${blocking.map((b) => b.label).join('；')}`,
      );
    }
    throw new HttpError(409, '本地合并未通过关口判定，无法落地');
  }
  restoreFailedReview(deps, row);
  if (todoRow.phase === 'failed') {
    const restored = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
    if (!restored) throw new NotFoundError(`todo ${row.todoId}`);
    todoRow = restored;
  }
  assertPhaseTransition(todoRow.phase, 'done');
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
  if (prompt !== undefined) assertNoMergeStepInFlight(deps, buildId);
  enqueueStep(deps, buildId, 'merge', todoRow.teamId, prompt);
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
