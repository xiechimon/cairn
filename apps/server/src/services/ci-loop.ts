import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { build, todo } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { recoverAutonomousMerges } from './autonomous-merge.js';
import type { BuildDeps } from './builds.js';
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
import { CI_REQUIRED_CHECKS_TTL_MS } from './ci-grind-checks.js';
import { createGrindPoller } from './ci-grind-poll.js';
import { KnownRows } from './ci-known-rows.js';
import { CI_EMPTY_CHECKS_GRACE_MS } from './ci-loop-rows.js';
import { CI_MISSING_COMPARE_RECHECK_MS } from './ci-merged-compare.js';
import type { CiPollTally } from './ci-poll-types.js';
import { CI_MERGE_CONFLICT_ROUNDS_MAX } from './ci-pr-rounds.js';
import {
  CI_ANON_READ_INTERVAL_MS,
  CI_CLOSED_CONFIRM_MS,
  CI_FOREIGN_RELIST_ANON_MS,
  CI_FOREIGN_RELIST_MS,
  createReviewReconciler,
} from './ci-review-reconcile.js';
import { syncAutonomyPauses } from './github-autonomy-brake.js';
import { recoverRedAutonomousMain } from './github-recovery.js';
import { evaluateMergeGate } from './merge-gate-run.js';
import { CI_FIX_PROMPT_HEAD } from './retry-lessons.js';

export const CI_POLL_INTERVAL_MS = 60_000;

export const CI_ANON_READS_PER_HOUR = 20;

export const CI_ANON_IP_READS_PER_HOUR = 50;

export {
  buildCiFixPrompt,
  buildMergeConflictPrompt,
  type CheckVerdict,
  CI_ANON_READ_INTERVAL_MS,
  CI_CLOSED_CONFIRM_MS,
  CI_EMPTY_CHECKS_GRACE_MS,
  CI_FIX_PROMPT_HEAD,
  CI_FIX_ROUNDS_MAX,
  CI_FOREIGN_RELIST_ANON_MS,
  CI_FOREIGN_RELIST_MS,
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
  const rows = new KnownRows(deps);
  let sweeping = false;
  const anonBudget = new AnonReadBudget(
    run.anonReadsPerHour ?? CI_ANON_READS_PER_HOUR,
    run.anonIpReadsPerHour ?? CI_ANON_IP_READS_PER_HOUR,
  );
  const grind = createGrindPoller(deps, rows, run, anonBudget);
  const reviews = createReviewReconciler(deps, rows, run, anonBudget);

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
    const sweepStartedAt = nowMs();
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
    grind.begin();
    for (const cand of candidates) {
      try {
        await grind.poll(cand, now, tally);
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
    reviews.begin(reviewCandidates);
    for (const cand of reviewCandidates) {
      try {
        await reviews.reconcile(cand, now, sweepStartedAt, tally);
      } catch (err) {
        tally.errors += 1;
        run.logger?.info(
          { err: err instanceof Error ? err.message : String(err) },
          'pr reconcile candidate failed (sweep continues)',
        );
      }
    }
    grind.retain(now);
    reviews.retain(reviewCandidates);
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
    const memoBuilds = new Set([...reviewCandidates, ...candidates].map((c) => c.buildId));
    rows.retain(memoBuilds);
    run.logger?.info(tally, 'ci pr-checks sweep');
  }

  return { sweep };
}
