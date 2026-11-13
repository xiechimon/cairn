import { conversationBranch } from '@cairn/shared';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { build, threadPr, todo } from '../db/schema.js';
import {
  type FetchLike,
  type GithubBranchPull,
  type GithubPull,
  githubBranchPulls,
  githubPull,
  hasPullFields,
  isOwnPull,
} from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { recoverAutonomousMerges } from './autonomous-merge.js';
import {
  type BuildDeps,
  hasActiveStep,
  lastPushedCheckpoint,
  roundStart,
  stopUnclaimedGateSteps,
} from './builds.js';
import { AnonReadBudget } from './ci-anon-budget.js';
import {
  type CheckVerdict,
  type CiCheckFailure,
  latestCompletedCheckRuns,
  verdictOfCheckRuns,
} from './ci-check-verdict.js';
import { drainCiCorrections } from './ci-corrections.js';
import {
  buildCiFixPrompt,
  buildMergeConflictPrompt,
  CI_FIX_ROUNDS_MAX,
  CI_MERGE_CONFLICT_PROMPT_HEAD,
  CI_MERGE_CONFLICT_REVIEW_NOTE,
  CI_MERGE_CONFLICT_VERIFY_NOTE,
  countMarkedRounds,
  deadLoopMessage,
} from './ci-fix-prompts.js';
import { CI_REQUIRED_CHECKS_TTL_MS, GrindCheckReader } from './ci-grind-checks.js';
import { advancePassingGrind, startCiFixRound } from './ci-grind-outcome.js';
import { KnownRows } from './ci-known-rows.js';
import {
  CI_EMPTY_CHECKS_GRACE_MS,
  failWithMessage,
  freshGrindRow,
  freshReviewRow,
  githubTarget,
  pushNotSeen,
  writeSystemRow,
} from './ci-loop-rows.js';
import {
  CI_MISSING_COMPARE_RECHECK_MS,
  MergedCompareCache,
  mergedCheckpointHint,
} from './ci-merged-compare.js';
import {
  adoptPull,
  CI_MERGE_CONFLICT_ROUNDS_MAX,
  mergeConflictRound,
  outdatedPullRound,
  pickOwnBranchPull,
  settleMergedPull,
} from './ci-pr-rounds.js';
import { DONE_ROW, prClosedUnmergedRow } from './delivery-rows.js';
import { autonomousToken } from './github-autonomous-token.js';
import { syncAutonomyPauses } from './github-autonomy-brake.js';
import { recoverRedAutonomousMain } from './github-recovery.js';
import { githubText } from './github-text.js';
import { evaluateMergeGate } from './merge-gate-run.js';
import { CI_FIX_PROMPT_HEAD } from './retry-lessons.js';
import { setTodoPhase } from './todos.js';
import { blockingWorkerQuestions } from './worker-question-store.js';

export const CI_POLL_INTERVAL_MS = 60_000;

export const CI_ANON_READ_INTERVAL_MS = 300_000;

export const CI_ANON_READS_PER_HOUR = 20;

export const CI_ANON_IP_READS_PER_HOUR = 50;

export const CI_FOREIGN_RELIST_MS = 600_000;

export const CI_FOREIGN_RELIST_ANON_MS = 3_600_000;

export const CI_CLOSED_CONFIRM_MS = 50_000;

export {
  buildCiFixPrompt,
  buildMergeConflictPrompt,
  type CheckVerdict,
  CI_EMPTY_CHECKS_GRACE_MS,
  CI_FIX_PROMPT_HEAD,
  CI_FIX_ROUNDS_MAX,
  CI_MERGE_CONFLICT_PROMPT_HEAD,
  CI_MERGE_CONFLICT_REVIEW_NOTE,
  CI_MERGE_CONFLICT_ROUNDS_MAX,
  CI_MERGE_CONFLICT_VERIFY_NOTE,
  CI_MISSING_COMPARE_RECHECK_MS,
  CI_REQUIRED_CHECKS_TTL_MS,
  type CiCheckFailure,
  countMarkedRounds,
  deadLoopMessage,
  latestCompletedCheckRuns,
  verdictOfCheckRuns,
};

export interface CiPollLogger {
  info(obj: object, msg: string): void;
}

export interface CiPoller {
  sweep(now?: number): Promise<void>;
}

interface CiPollTally {
  candidates: number;
  pending: number;
  appended: number;
  advanced: number;
  failed: number;
  skipped: number;
  unreadable: number;
  errors: number;
  reviewCandidates: number;
  reviewPending: number;
  reviewSkipped: number;
  reviewUnreadable: number;
  reviewForeign: number;
  merged: number;
  closedUnmerged: number;
  hinted: number;
  settledBefore: number;
  adopted: number;
}

interface PullCacheEntry {
  etag: string | null;
  pull: GithubPull | null;
}

export function createCiPoller(
  deps: BuildDeps,
  run: {
    githubFetch: FetchLike;
    logger?: CiPollLogger;
    threadPrWakes?: boolean;
    anonReadsPerHour?: number;
    anonIpReadsPerHour?: number;
  },
): CiPoller {
  const pullCache = new Map<string, PullCacheEntry>();
  const grindPullCache = new Map<string, PullCacheEntry>();
  const anonReadAt = new Map<string, number>();
  const foreignListedAt = new Map<string, number>();
  const listFailures = new Map<string, number>();
  const lastReadByBuild = new Map<string, number>();
  const closedSeenAt = new Map<string, number>();
  function forgetClose(key: string): void {
    closedSeenAt.delete(key);
    listFailures.delete(key);
  }
  const rows = new KnownRows(deps);
  const liveKeys = new Set<string>();
  const grindKeys = new Set<string>();
  let sweeping = false;
  let sweepStartedAt = 0;
  const anonBudget = new AnonReadBudget(
    run.anonReadsPerHour ?? CI_ANON_READS_PER_HOUR,
    run.anonIpReadsPerHour ?? CI_ANON_IP_READS_PER_HOUR,
  );
  const compares = new MergedCompareCache(run.githubFetch, anonBudget);
  const grindChecks = new GrindCheckReader(run.githubFetch, anonBudget);

  function stillOurs(cand: { buildId: string; todoId: string }, since: number): boolean {
    return (
      freshReviewRow(deps, cand.todoId, cand.buildId) !== null &&
      !hasActiveStep(deps, cand.buildId) &&
      !rows.has(cand.buildId, DONE_ROW, since)
    );
  }

  async function ownBranchPull(
    branch: string,
    target: { owner: string; repo: string },
    token: string | null,
    recorded: { number: number; baseRepoId: number; defaultBranch: string; owner: string },
    mergedAfter: number,
    now: number,
  ): Promise<GithubBranchPull | null | 'unreadable' | 'skipped'> {
    if (token === null && !anonBudget.take(now)) return 'skipped';
    const list = await githubBranchPulls(run.githubFetch, token, target.owner, target.repo, {
      head: `${recorded.owner}:${branch}`,
      base: recorded.defaultBranch,
    });
    if (list === null) return 'unreadable';
    return pickOwnBranchPull(list, branch, recorded, mergedAfter);
  }

  async function reconcileOne(
    cand: { buildId: string; todoId: string },
    now: number,
    tally: CiPollTally,
  ): Promise<void> {
    const todoRow = freshReviewRow(deps, cand.todoId, cand.buildId);
    const buildRow = deps.db
      .select({ prNumber: build.prNumber, prUrl: build.prUrl })
      .from(build)
      .where(eq(build.id, cand.buildId))
      .get();
    const target = todoRow === null ? null : githubTarget(deps, todoRow);
    if (
      todoRow === null ||
      buildRow === undefined ||
      buildRow.prNumber === null ||
      target === null
    ) {
      tally.reviewSkipped += 1;
      return;
    }
    const prNumber = buildRow.prNumber;
    const key = `${target.fullName}#${prNumber}`;
    liveKeys.add(key);
    if (
      hasActiveStep(deps, cand.buildId) ||
      blockingWorkerQuestions(deps.db, cand.buildId).length > 0
    ) {
      forgetClose(key);
      tally.reviewSkipped += 1;
      return;
    }
    const token = await autonomousToken(
      { ...deps, githubFetch: run.githubFetch },
      target.teamId,
      target,
    );
    const entry = pullCache.get(key) ?? null;
    let pull: GithubPull | null;
    let readAt = now;
    if (entry?.pull?.merged === true) {
      pull = entry.pull;
    } else {
      if (token === null) {
        const last = anonReadAt.get(key);
        if (
          (last !== undefined && now - last < CI_ANON_READ_INTERVAL_MS) ||
          !anonBudget.take(now, 2)
        ) {
          tally.reviewSkipped += 1;
          return;
        }
        anonReadAt.set(key, now);
      }
      lastReadByBuild.set(cand.buildId, now);
      const page = await githubPull(run.githubFetch, token, target.owner, target.repo, prNumber, {
        etag: entry?.etag ?? null,
      });
      readAt = now + (nowMs() - sweepStartedAt);
      if (page === null) {
        forgetClose(key);
        tally.reviewUnreadable += 1;
        return;
      }
      pull = page.notModified ? (entry?.pull ?? null) : page.pull;
      pullCache.set(key, { etag: page.etag, pull });
    }
    const branch = conversationBranch(cand.buildId);
    const foreign = pull !== null && hasPullFields(pull) && !isOwnPull(pull, branch);
    if (pull === null || (pull.state === 'open' && !foreign)) {
      forgetClose(key);
      const state = pull?.mergeableState ?? null;
      if (
        pull !== null &&
        hasPullFields(pull) &&
        isOwnPull(pull, branch) &&
        pull.baseRef === (target.baseBranch ?? pull.defaultBranch) &&
        freshReviewRow(deps, cand.todoId, cand.buildId)?.archivedAt === null &&
        (state === 'dirty' || state === 'behind') &&
        !pushNotSeen(deps, cand.buildId, pull.headSha, now) &&
        freshReviewRow(deps, cand.todoId, cand.buildId) !== null &&
        !hasActiveStep(deps, cand.buildId)
      ) {
        const round = outdatedPullRound(
          deps,
          rows,
          run.threadPrWakes === true,
          cand,
          todoRow.teamId,
          { prNumber, prUrl: buildRow.prUrl },
          target.baseBranch ?? pull.defaultBranch,
          state,
        );
        if (round === 'appended') {
          tally.reviewPending += 1;
          return;
        }
        tally.hinted += 1;
        return;
      }
      tally.reviewPending += 1;
      return;
    }
    if (
      freshReviewRow(deps, cand.todoId, cand.buildId) === null ||
      hasActiveStep(deps, cand.buildId)
    ) {
      forgetClose(key);
      tally.reviewSkipped += 1;
      return;
    }
    const closedText = prClosedUnmergedRow(prNumber);
    const since = roundStart(deps, cand.buildId);
    if (!hasPullFields(pull)) {
      pullCache.delete(key);
      forgetClose(key);
      tally.reviewUnreadable += 1;
      return;
    }
    const recorded = {
      number: prNumber,
      baseRepoId: pull.baseRepoId,
      defaultBranch: target.baseBranch ?? pull.defaultBranch,
      owner: pull.baseOwner ?? target.owner,
    };
    if (foreign) {
      const foreignText = `PR #${prNumber} 的 head 不是本任务在 ${target.fullName} 的工作分支「${branch}」，可能是别人 fork 里同名分支开的 PR。对账不据它收尾或打回；任务留在审核关口，由人核对这张 PR。`;
      const listKey = `${cand.buildId}\u0000${key}`;
      const listedAt = foreignListedAt.get(listKey);
      const relistMs = token === null ? CI_FOREIGN_RELIST_ANON_MS : CI_FOREIGN_RELIST_MS;
      if (listedAt === undefined || now - listedAt >= relistMs) {
        const own = await ownBranchPull(branch, target, token, recorded, 0, now);
        if (own !== 'skipped') foreignListedAt.set(listKey, now);
        if (
          freshReviewRow(deps, cand.todoId, cand.buildId) === null ||
          hasActiveStep(deps, cand.buildId)
        ) {
          tally.reviewSkipped += 1;
          return;
        }
        if (own !== null && own !== 'unreadable' && own !== 'skipped') {
          const adopted = adoptPull(
            deps,
            rows,
            cand.buildId,
            todoRow.teamId,
            target.fullName,
            prNumber,
            own,
            '的 head 不是本任务的工作分支',
            since,
          );
          if (adopted) tally.adopted += 1;
          else tally.reviewSkipped += 1;
          return;
        }
      }
      rows.hint(cand.buildId, foreignText, since);
      tally.reviewForeign += 1;
      return;
    }
    if (rows.has(cand.buildId, pull.merged ? DONE_ROW : closedText, since)) {
      tally.settledBefore += 1;
      return;
    }
    if (pull.merged) {
      if (pull.baseRef !== (target.baseBranch ?? pull.defaultBranch)) {
        rows.hint(
          cand.buildId,
          `PR #${prNumber} 合并进了分支「${githubText(pull.baseRef)}」，不是默认分支「${githubText(target.baseBranch ?? pull.defaultBranch)}」，改动还没进默认分支。任务留在审核关口，由人决定下一步。`,
          since,
        );
        tally.hinted += 1;
        return;
      }
      const checkpoint = lastPushedCheckpoint(deps, cand.buildId, { mergeSteps: false });
      if (checkpoint !== null && pull.headSha === null) {
        pullCache.delete(key);
        tally.reviewUnreadable += 1;
        return;
      }
      if (checkpoint !== null && pull.headSha !== null && checkpoint !== pull.headSha) {
        const read = await compares.read(key, target, token, checkpoint, pull.headSha, now);
        if (read === 'skipped') {
          tally.reviewSkipped += 1;
          return;
        }
        if (read.status === 'unreadable') {
          if (read.failures >= 2 && stillOurs(cand, since)) {
            rows.hint(
              cand.buildId,
              mergedCheckpointHint(prNumber, read.status, checkpoint, pull.headSha),
              since,
            );
          }
          tally.reviewUnreadable += 1;
          return;
        }
        if (!stillOurs(cand, since)) {
          tally.reviewSkipped += 1;
          return;
        }
        if (read.status !== 'ahead' && read.status !== 'identical') {
          rows.hint(
            cand.buildId,
            mergedCheckpointHint(prNumber, read.status, checkpoint, pull.headSha),
            since,
          );
          tally.hinted += 1;
          return;
        }
      }
      settleMergedPull(deps, cand, prNumber, pull, now);
      tally.merged += 1;
      return;
    }
    const seen = closedSeenAt.get(key);
    if (seen === undefined || readAt - seen < CI_CLOSED_CONFIRM_MS) {
      if (seen === undefined) closedSeenAt.set(key, readAt);
      tally.reviewPending += 1;
      return;
    }
    if (pull.baseRef !== (target.baseBranch ?? pull.defaultBranch)) {
      rows.hint(
        cand.buildId,
        `PR #${prNumber} 的目标分支是「${githubText(pull.baseRef)}」，不是默认分支「${githubText(target.baseBranch ?? pull.defaultBranch)}」；它在 GitHub 关闭且未合并，可能是从工作分支往别的分支开的另一张 PR。对账不据它打回；任务留在审核关口，由人核对这张 PR。`,
        since,
      );
      tally.hinted += 1;
      return;
    }
    const sibling = await ownBranchPull(branch, target, token, recorded, prNumber, now);
    if (sibling === 'unreadable') {
      const failures = (listFailures.get(key) ?? 0) + 1;
      if (failures < 2) {
        listFailures.set(key, failures);
        tally.reviewUnreadable += 1;
        return;
      }
    }
    if (sibling === 'skipped') {
      tally.reviewSkipped += 1;
      return;
    }
    const found = sibling === 'unreadable' ? null : sibling;
    forgetClose(key);
    if (
      freshReviewRow(deps, cand.todoId, cand.buildId) === null ||
      hasActiveStep(deps, cand.buildId)
    ) {
      tally.reviewSkipped += 1;
      return;
    }
    if (found?.number === prNumber) {
      tally.reviewPending += 1;
      return;
    }
    if (found !== null) {
      const adopted = adoptPull(
        deps,
        rows,
        cand.buildId,
        todoRow.teamId,
        target.fullName,
        prNumber,
        found,
        '在 GitHub 关闭且未合并',
        since,
      );
      if (adopted) tally.adopted += 1;
      else tally.reviewSkipped += 1;
      return;
    }
    writeSystemRow(deps, cand.buildId, closedText);
    stopUnclaimedGateSteps(deps, cand.buildId);
    failWithMessage(deps, cand, todoRow.teamId, closedText);
    tally.closedUnmerged += 1;
  }

  async function pollOne(
    cand: { buildId: string; todoId: string },
    now: number,
    tally: CiPollTally,
  ): Promise<void> {
    const todoRow = freshGrindRow(deps, cand.todoId);
    if (todoRow === null) {
      tally.skipped += 1;
      return;
    }
    const buildRow = deps.db
      .select({ prNumber: build.prNumber, prUrl: build.prUrl })
      .from(build)
      .where(eq(build.id, cand.buildId))
      .get();
    const target = githubTarget(deps, todoRow);
    if (buildRow === undefined || buildRow.prNumber === null || target === null) {
      tally.skipped += 1;
      return;
    }
    const key = `${target.fullName}#${buildRow.prNumber}`;
    grindKeys.add(key);
    if (
      hasActiveStep(deps, cand.buildId) ||
      blockingWorkerQuestions(deps.db, cand.buildId).length > 0
    ) {
      tally.skipped += 1;
      return;
    }
    const grindToken = await autonomousToken(
      { ...deps, githubFetch: run.githubFetch },
      target.teamId,
      target,
    );
    if (grindToken === null) anonBudget.recordShared(now);
    const pullEntry = grindPullCache.get(key) ?? null;
    const pullPage = await githubPull(
      run.githubFetch,
      grindToken,
      target.owner,
      target.repo,
      buildRow.prNumber,
      { etag: pullEntry?.etag ?? null },
    );
    const pull =
      pullPage === null ? null : pullPage.notModified ? (pullEntry?.pull ?? null) : pullPage.pull;
    if (pullPage === null || pull === null || pull.defaultBranch === null) {
      grindPullCache.delete(key);
      tally.unreadable += 1;
      return;
    }
    grindPullCache.set(key, { etag: pullPage.etag, pull });
    if (pull.state !== 'open') {
      if (freshGrindRow(deps, cand.todoId) === null || hasActiveStep(deps, cand.buildId)) {
        tally.skipped += 1;
        return;
      }
      setTodoPhase(deps, cand.todoId, 'review');
      tally.advanced += 1;
      return;
    }
    const branch = conversationBranch(cand.buildId);
    const baseBranch = target.baseBranch ?? pull.defaultBranch;
    const own =
      hasPullFields(pull) &&
      isOwnPull(pull, branch) &&
      pull.baseRef === baseBranch &&
      pull.state === 'open';
    if (own && pull.headSha === null) {
      tally.unreadable += 1;
      return;
    }
    if (own && pushNotSeen(deps, cand.buildId, pull.headSha, now)) {
      tally.pending += 1;
      return;
    }
    if (own && pull.mergeableState === 'dirty') {
      if (freshGrindRow(deps, cand.todoId) === null || hasActiveStep(deps, cand.buildId)) {
        tally.skipped += 1;
        return;
      }
      const done = mergeConflictRound(
        deps,
        rows,
        run.threadPrWakes === true,
        cand,
        todoRow.teamId,
        { prNumber: buildRow.prNumber, prUrl: buildRow.prUrl },
        baseBranch,
        false,
      );
      if (done === 'failed') tally.failed += 1;
      else tally.appended += 1;
      return;
    }
    const ref = own && pull.headSha !== null ? pull.headSha : branch;
    const checks = await grindChecks.read(target, key, baseBranch, ref, grindToken, now);
    if (checks.kind === 'unreadable') {
      tally.unreadable += 1;
      return;
    }
    if (checks.kind === 'pending') {
      tally.pending += 1;
      return;
    }
    const verdict = checks.verdict;
    if (freshGrindRow(deps, cand.todoId) === null || hasActiveStep(deps, cand.buildId)) {
      tally.skipped += 1;
      return;
    }
    if (verdict.state === 'blocked') {
      const names = verdict.checks
        .map((c) => `「${githubText(c.name)}」（${githubText(c.conclusion)}）`)
        .join('、');
      rows.hint(
        cand.buildId,
        `PR #${buildRow.prNumber} 的 head ${own ? ref.slice(0, 7) : `分支「${githubText(branch)}」`} 上，检查 ${names} 的结论不算通过：磨绿不推进、也不派修复步。等它重跑，或由人处理。`,
        roundStart(deps, cand.buildId),
      );
      tally.pending += 1;
      return;
    }
    if (verdict.state === 'red') {
      if (
        run.threadPrWakes ||
        deps.db.select().from(threadPr).where(eq(threadPr.buildId, cand.buildId)).get()
      )
        return;
      const outcome = startCiFixRound(
        deps,
        cand,
        todoRow.teamId,
        { prNumber: buildRow.prNumber, prUrl: buildRow.prUrl },
        verdict.failures,
        now,
      );
      if (outcome === 'failed') tally.failed += 1;
      else if (outcome === 'held') tally.pending += 1;
      else tally.appended += 1;
      return;
    }
    const advanced = advancePassingGrind(
      deps,
      rows,
      todoRow,
      cand,
      verdict.state === 'green' && own,
    );
    if (advanced === 'pending') tally.pending += 1;
    else tally.advanced += 1;
  }

  async function sweep(now: number = nowMs()): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
      await sweepOnce(now);
    } finally {
      sweeping = false;
    }
  }

  async function sweepOnce(now: number): Promise<void> {
    sweepStartedAt = nowMs();
    await recoverAutonomousMerges(deps, run.githubFetch, now, CI_POLL_INTERVAL_MS);
    try {
      await syncAutonomyPauses({ ...deps, githubFetch: run.githubFetch });
      await recoverRedAutonomousMain(deps, run.githubFetch);
    } catch (error) {
      run.logger?.info(
        { error: error instanceof Error ? error.message : String(error) },
        'autonomous main recovery deferred',
      );
    }
    const candidates = deps.db
      .select({ buildId: build.id, todoId: todo.id })
      .from(build)
      .innerJoin(todo, and(eq(todo.id, build.todoId), eq(todo.latestBuildId, build.id)))
      .where(and(isNotNull(build.prNumber), isNull(todo.archivedAt), eq(todo.phase, 'building')))
      .all();
    const reviewCandidates = deps.db
      .select({ buildId: build.id, todoId: todo.id })
      .from(build)
      .innerJoin(todo, and(eq(todo.id, build.todoId), eq(todo.latestBuildId, build.id)))
      .where(and(isNotNull(build.prNumber), eq(todo.phase, 'review')))
      .all();
    const tally: CiPollTally = {
      candidates: candidates.length,
      pending: 0,
      appended: 0,
      advanced: 0,
      failed: 0,
      skipped: 0,
      unreadable: 0,
      errors: 0,
      reviewCandidates: reviewCandidates.length,
      reviewPending: 0,
      reviewSkipped: 0,
      reviewUnreadable: 0,
      reviewForeign: 0,
      merged: 0,
      closedUnmerged: 0,
      hinted: 0,
      settledBefore: 0,
      adopted: 0,
    };
    grindKeys.clear();
    for (const cand of candidates) {
      try {
        await pollOne(cand, now, tally);
      } catch (err) {
        tally.errors += 1;
        run.logger?.info(
          { err: err instanceof Error ? err.message : String(err) },
          'ci pr-checks poll candidate failed (sweep continues)',
        );
      }
    }
    try {
      await drainCiCorrections(deps, run.githubFetch);
    } catch (err) {
      run.logger?.info(
        { err: err instanceof Error ? err.message : String(err) },
        'ci correction deferred',
      );
    }
    liveKeys.clear();
    reviewCandidates.sort(
      (a, b) => (lastReadByBuild.get(a.buildId) ?? 0) - (lastReadByBuild.get(b.buildId) ?? 0),
    );
    for (const cand of reviewCandidates) {
      try {
        await reconcileOne(cand, now, tally);
      } catch (err) {
        tally.errors += 1;
        run.logger?.info(
          { err: err instanceof Error ? err.message : String(err) },
          'pr reconcile candidate failed (sweep continues)',
        );
      }
    }
    grindChecks.retain(grindKeys, now);
    for (const k of grindPullCache.keys()) if (!grindKeys.has(k)) grindPullCache.delete(k);
    for (const k of pullCache.keys()) if (!liveKeys.has(k)) pullCache.delete(k);
    for (const k of anonReadAt.keys()) if (!liveKeys.has(k)) anonReadAt.delete(k);
    compares.retain(liveKeys);
    for (const k of closedSeenAt.keys()) if (!liveKeys.has(k)) closedSeenAt.delete(k);
    const reviewBuilds = new Set(reviewCandidates.map((c) => c.buildId));
    for (const k of lastReadByBuild.keys()) if (!reviewBuilds.has(k)) lastReadByBuild.delete(k);
    for (const k of foreignListedAt.keys())
      if (!liveKeys.has(k.slice(k.indexOf('\u0000') + 1))) foreignListedAt.delete(k);
    for (const k of listFailures.keys()) if (!liveKeys.has(k)) listFailures.delete(k);
    for (const cand of [...candidates, ...reviewCandidates]) {
      try {
        await evaluateMergeGate(deps, cand.buildId);
      } catch (err) {
        tally.errors += 1;
        run.logger?.info(
          { err: err instanceof Error ? err.message : String(err) },
          'merge gate evaluation failed (sweep continues)',
        );
      }
    }
    const memoBuilds = new Set([...reviewBuilds, ...candidates.map((c) => c.buildId)]);
    rows.retain(memoBuilds);
    run.logger?.info(tally, 'ci pr-checks sweep');
  }

  return { sweep };
}
