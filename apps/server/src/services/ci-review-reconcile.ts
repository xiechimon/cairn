import { conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build } from '../db/schema.js';
import {
  type GithubBranchPull,
  type GithubPull,
  githubBranchPulls,
  githubPull,
  hasPullFields,
  isOwnPull,
} from '../lib/github.js';
import type { AutonomousToken } from '../lib/github-token.js';
import { nowMs } from '../lib/ids.js';
import {
  type BuildDeps,
  hasActiveStep,
  lastPushedCheckpoint,
  roundStart,
  stopUnclaimedGateSteps,
} from './builds.js';
import type { AnonReadBudget } from './ci-anon-budget.js';
import type { KnownRows } from './ci-known-rows.js';
import {
  failWithMessage,
  freshReviewRow,
  githubTarget,
  pushNotSeen,
  writeSystemRow,
} from './ci-loop-rows.js';
import { MergedCompareCache, mergedCheckpointHint } from './ci-merged-compare.js';
import type { CiPollCandidate, CiPollRun, CiPollTally, PullCacheEntry } from './ci-poll-types.js';
import {
  adoptPull,
  outdatedPullRound,
  pickOwnBranchPull,
  settleMergedPull,
} from './ci-pr-rounds.js';
import { DONE_ROW, prClosedUnmergedRow } from './delivery-rows.js';
import { autonomousToken } from './github-autonomous-token.js';
import { githubText } from './github-text.js';
import { blockingWorkerQuestions } from './worker-question-store.js';

export const CI_ANON_READ_INTERVAL_MS = 300_000;

export const CI_FOREIGN_RELIST_MS = 600_000;

export const CI_FOREIGN_RELIST_ANON_MS = 3_600_000;

export const CI_CLOSED_CONFIRM_MS = 50_000;

type ReviewTarget = NonNullable<ReturnType<typeof githubTarget>>;

type ReadPull = GithubPull & {
  headRef: string;
  baseRef: string;
  defaultBranch: string;
  baseRepoId: number;
};

interface RecordedPull {
  number: number;
  baseRepoId: number;
  defaultBranch: string;
  owner: string;
}

interface ReviewCase {
  cand: CiPollCandidate;
  key: string;
  prNumber: number;
  target: ReviewTarget;
  token: AutonomousToken | null;
  pull: ReadPull;
  teamId: string;
  since: number;
  now: number;
  tally: CiPollTally;
}

export interface ReviewReconciler {
  begin(candidates: CiPollCandidate[]): void;
  reconcile(
    cand: CiPollCandidate,
    now: number,
    sweepStartedAt: number,
    tally: CiPollTally,
  ): Promise<void>;
  retain(candidates: CiPollCandidate[]): void;
}

export function createReviewReconciler(
  deps: BuildDeps,
  rows: KnownRows,
  run: CiPollRun,
  anonBudget: AnonReadBudget,
): ReviewReconciler {
  const pullCache = new Map<string, PullCacheEntry>();
  const anonReadAt = new Map<string, number>();
  const foreignListedAt = new Map<string, number>();
  const listFailures = new Map<string, number>();
  const lastReadByBuild = new Map<string, number>();
  const closedSeenAt = new Map<string, number>();
  const liveKeys = new Set<string>();
  const compares = new MergedCompareCache(run.githubFetch, anonBudget);
  function forgetClose(key: string): void {
    closedSeenAt.delete(key);
    listFailures.delete(key);
  }

  function stillOurs(cand: CiPollCandidate, since: number): boolean {
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

  async function reconcileForeign(review: ReviewCase, recorded: RecordedPull): Promise<void> {
    const { cand, key, prNumber, target, token, teamId, since, now, tally } = review;
    const branch = conversationBranch(cand.buildId);
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
          teamId,
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
  }

  async function reconcileMerged(review: ReviewCase): Promise<void> {
    const { cand, key, prNumber, target, token, pull, since, now, tally } = review;
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
  }

  async function reconcileClosed(
    review: ReviewCase,
    recorded: RecordedPull,
    readAt: number,
  ): Promise<void> {
    const { cand, key, prNumber, target, token, pull, teamId, since, now, tally } = review;
    const branch = conversationBranch(cand.buildId);
    const closedText = prClosedUnmergedRow(prNumber);
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
        teamId,
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
    failWithMessage(deps, cand, teamId, closedText);
    tally.closedUnmerged += 1;
  }

  async function reconcileOne(
    cand: CiPollCandidate,
    now: number,
    sweepStartedAt: number,
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
    const recorded: RecordedPull = {
      number: prNumber,
      baseRepoId: pull.baseRepoId,
      defaultBranch: target.baseBranch ?? pull.defaultBranch,
      owner: pull.baseOwner ?? target.owner,
    };
    const review: ReviewCase = {
      cand,
      key,
      prNumber,
      target,
      token,
      pull,
      teamId: todoRow.teamId,
      since,
      now,
      tally,
    };
    if (foreign) {
      await reconcileForeign(review, recorded);
      return;
    }
    if (rows.has(cand.buildId, pull.merged ? DONE_ROW : closedText, since)) {
      tally.settledBefore += 1;
      return;
    }
    if (pull.merged) {
      await reconcileMerged(review);
      return;
    }
    await reconcileClosed(review, recorded, readAt);
  }

  function begin(candidates: CiPollCandidate[]): void {
    liveKeys.clear();
    candidates.sort(
      (a, b) => (lastReadByBuild.get(a.buildId) ?? 0) - (lastReadByBuild.get(b.buildId) ?? 0),
    );
  }

  function retain(candidates: CiPollCandidate[]): void {
    for (const k of pullCache.keys()) if (!liveKeys.has(k)) pullCache.delete(k);
    for (const k of anonReadAt.keys()) if (!liveKeys.has(k)) anonReadAt.delete(k);
    compares.retain(liveKeys);
    for (const k of closedSeenAt.keys()) if (!liveKeys.has(k)) closedSeenAt.delete(k);
    const reviewBuilds = new Set(candidates.map((c) => c.buildId));
    for (const k of lastReadByBuild.keys()) if (!reviewBuilds.has(k)) lastReadByBuild.delete(k);
    for (const k of foreignListedAt.keys())
      if (!liveKeys.has(k.slice(k.indexOf('\u0000') + 1))) foreignListedAt.delete(k);
    for (const k of listFailures.keys()) if (!liveKeys.has(k)) listFailures.delete(k);
  }

  return { begin, reconcile: reconcileOne, retain };
}
