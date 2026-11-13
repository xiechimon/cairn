import { conversationBranch } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { build, step, threadPr } from '../db/schema.js';
import { type GithubBranchPull, WRITE_AUTHOR_ASSOCIATIONS } from '../lib/github.js';
import { settleAutonomousMerge } from './autonomous-merge.js';
import {
  type BuildDeps,
  enqueueStep,
  finishTodoDone,
  roundStart,
  stopUnclaimedGateSteps,
  toBuildRecord,
} from './builds.js';
import {
  buildMergeConflictPrompt,
  CI_MERGE_CONFLICT_PROMPT_HEAD,
  CI_MERGE_CONFLICT_REVIEW_NOTE,
  CI_MERGE_CONFLICT_VERIFY_NOTE,
  countMarkedRounds,
} from './ci-fix-prompts.js';
import type { KnownRows } from './ci-known-rows.js';
import { failWithMessage, writeSystemRow } from './ci-loop-rows.js';
import { githubText } from './github-text.js';
import { setTodoPhase } from './todos.js';

export const CI_MERGE_CONFLICT_ROUNDS_MAX = 2;

export function mergeConflictRound(
  deps: BuildDeps,
  rows: KnownRows,
  threadPrWakes: boolean,
  cand: { buildId: string; todoId: string },
  teamId: string,
  pr: { prNumber: number; prUrl: string | null },
  defaultBranch: string,
  fromReview: boolean,
): 'appended' | 'failed' | 'hinted' {
  if (
    threadPrWakes ||
    deps.db.select().from(threadPr).where(eq(threadPr.buildId, cand.buildId)).get()
  )
    return 'hinted';
  const rounds = countMarkedRounds(deps.db, cand.buildId, CI_MERGE_CONFLICT_PROMPT_HEAD);
  if (rounds >= CI_MERGE_CONFLICT_ROUNDS_MAX) {
    const text = `PR #${pr.prNumber} 与默认分支「${githubText(defaultBranch)}」冲突，已自动解冲突 ${rounds} 轮仍冲突：不再派解冲突步，由人处理（在 GitHub 上解决冲突，或打回重做）。`;
    if (!fromReview) {
      failWithMessage(deps, cand, teamId, text);
      return 'failed';
    }
    rows.hint(cand.buildId, text, roundStart(deps, cand.buildId));
    return 'hinted';
  }
  const reverify =
    deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, cand.buildId), eq(step.kind, 'verify')))
      .get() !== undefined;
  const stopsReview = stopUnclaimedGateSteps(deps, cand.buildId).includes('review');
  if (fromReview) setTodoPhase(deps, cand.todoId, 'queued');
  enqueueStep(
    deps,
    cand.buildId,
    'build',
    teamId,
    buildMergeConflictPrompt({ ...pr, defaultBranch, round: rounds + 1 }),
    undefined,
    undefined,
    { kind: 'merge-conflict', round: rounds + 1, roundsMax: CI_MERGE_CONFLICT_ROUNDS_MAX },
  );
  if (reverify) writeSystemRow(deps, cand.buildId, CI_MERGE_CONFLICT_VERIFY_NOTE);
  if (stopsReview) writeSystemRow(deps, cand.buildId, CI_MERGE_CONFLICT_REVIEW_NOTE);
  return 'appended';
}

export function adoptPull(
  deps: BuildDeps,
  rows: KnownRows,
  buildId: string,
  teamId: string,
  fullName: string,
  from: number,
  to: GithubBranchPull,
  reason: string,
  since: number,
): boolean {
  const changed = deps.db
    .update(build)
    .set({ prNumber: to.number, prUrl: `https://github.com/${fullName}/pull/${to.number}` })
    .where(and(eq(build.id, buildId), eq(build.prNumber, from)))
    .run().changes;
  if (changed === 0) return false;
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (row) deps.hub.publishBuildDoc(teamId, toBuildRecord(row));
  rows.hint(
    buildId,
    `PR #${from} ${reason}；本任务工作分支「${conversationBranch(buildId)}」上${to.state === 'open' ? '开着' : '已合并'}的 PR #${to.number} 改记为本任务的 PR，对账接着读它。`,
    since,
  );
  return true;
}

export function pickOwnBranchPull(
  list: GithubBranchPull[],
  branch: string,
  recorded: { number: number; baseRepoId: number; defaultBranch: string },
  mergedAfter: number,
): GithubBranchPull | null {
  const own = list.filter(
    (p) =>
      p.headRepoId === recorded.baseRepoId &&
      p.baseRepoId === recorded.baseRepoId &&
      p.headRef === branch &&
      p.baseRef === recorded.defaultBranch,
  );
  const changed = own.find((p) => p.number === recorded.number && (p.state === 'open' || p.merged));
  if (changed !== undefined) return changed;
  const adoptable = own.filter((p) => WRITE_AUTHOR_ASSOCIATIONS.has(p.authorAssociation ?? ''));
  const open = adoptable.filter((p) => p.state === 'open');
  const rejected = own.reduce(
    (n, p) => (p.state === 'closed' && !p.merged && p.number > n ? p.number : n),
    mergedAfter,
  );
  const pool = open.length > 0 ? open : adoptable.filter((p) => p.merged && p.number > rejected);
  return pool.reduce<GithubBranchPull | null>(
    (best, p) => (best === null || p.number > best.number ? p : best),
    null,
  );
}

export function outdatedPullRound(
  deps: BuildDeps,
  rows: KnownRows,
  threadPrWakes: boolean,
  cand: { buildId: string; todoId: string },
  teamId: string,
  pr: { prNumber: number; prUrl: string | null },
  defaultBranch: string,
  state: 'dirty' | 'behind',
): 'appended' | 'hinted' {
  if (state === 'dirty') {
    const done = mergeConflictRound(
      deps,
      rows,
      threadPrWakes,
      cand,
      teamId,
      pr,
      defaultBranch,
      true,
    );
    return done === 'appended' ? 'appended' : 'hinted';
  }
  rows.hint(
    cand.buildId,
    `PR #${pr.prNumber} 落后于默认分支「${githubText(defaultBranch)}」。cairn 不替人更新分支，合并由人做：在 GitHub 上点 Update branch（即 PUT pulls/${pr.prNumber}/update-branch，带 expected_head_sha 为当前 head），CI 重跑后再合并。`,
    roundStart(deps, cand.buildId),
  );
  return 'hinted';
}

export function settleMergedPull(
  deps: BuildDeps,
  cand: { buildId: string; todoId: string },
  prNumber: number,
  pull: { mergedAt: string | null; mergeCommitSha: string | null; mergedBy: string | null },
  now: number,
): void {
  const mergedAt = pull.mergedAt === null ? NaN : Date.parse(pull.mergedAt);
  settleAutonomousMerge(
    deps.db,
    cand.buildId,
    'merged',
    Number.isFinite(mergedAt) ? mergedAt : now,
  );
  const detail = [
    pull.mergeCommitSha === null ? null : `合并提交 ${githubText(pull.mergeCommitSha).slice(0, 7)}`,
    pull.mergedBy === null ? null : `由 ${githubText(pull.mergedBy)} 合并`,
  ].filter((x) => x !== null);
  writeSystemRow(
    deps,
    cand.buildId,
    `PR #${prNumber} 已在 GitHub 合并${detail.length > 0 ? `（${detail.join('，')}）` : ''}`,
  );
  finishTodoDone(deps, cand.todoId, cand.buildId);
}
