import { conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build, threadPr } from '../db/schema.js';
import { githubPull, hasPullFields, isOwnPull } from '../lib/github.js';
import { type BuildDeps, hasActiveStep, roundStart } from './builds.js';
import type { AnonReadBudget } from './ci-anon-budget.js';
import { GrindCheckReader } from './ci-grind-checks.js';
import { advancePassingGrind, startCiFixRound } from './ci-grind-outcome.js';
import type { KnownRows } from './ci-known-rows.js';
import { freshGrindRow, githubTarget, pushNotSeen } from './ci-loop-rows.js';
import type { CiPollCandidate, CiPollRun, CiPollTally, PullCacheEntry } from './ci-poll-types.js';
import { mergeConflictRound } from './ci-pr-rounds.js';
import { autonomousToken } from './github-autonomous-token.js';
import { githubText } from './github-text.js';
import { setTodoPhase } from './todos.js';
import { blockingWorkerQuestions } from './worker-question-store.js';

export interface GrindPoller {
  begin(): void;
  poll(cand: CiPollCandidate, now: number, tally: CiPollTally): Promise<void>;
  retain(now: number): void;
}

export function createGrindPoller(
  deps: BuildDeps,
  rows: KnownRows,
  run: CiPollRun,
  anonBudget: AnonReadBudget,
): GrindPoller {
  const grindPullCache = new Map<string, PullCacheEntry>();
  const grindKeys = new Set<string>();
  const grindChecks = new GrindCheckReader(run.githubFetch, anonBudget);

  async function pollOne(cand: CiPollCandidate, now: number, tally: CiPollTally): Promise<void> {
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

  function retain(now: number): void {
    grindChecks.retain(grindKeys, now);
    for (const k of grindPullCache.keys()) if (!grindKeys.has(k)) grindPullCache.delete(k);
  }

  return { begin: () => grindKeys.clear(), poll: pollOne, retain };
}
