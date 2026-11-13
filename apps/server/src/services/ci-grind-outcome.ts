import { ACTIVE_STEP_STATUSES } from '@cairn/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { step, type todo } from '../db/schema.js';
import {
  type BuildDeps,
  enqueueStep,
  hasMessageRow,
  maybeEnqueueIndependentReview,
  maybeEnqueueVerifyStep,
} from './builds.js';
import type { CiCheckFailure } from './ci-check-verdict.js';
import { CI_FIX_GREEN_EVENT } from './ci-corrections.js';
import {
  buildCiFixPrompt,
  CI_FIX_ROUNDS_MAX,
  CI_MERGE_CONFLICT_VERIFY_NOTE,
  countMarkedRounds,
  deadLoopMessage,
} from './ci-fix-prompts.js';
import type { KnownRows } from './ci-known-rows.js';
import { failWithMessage } from './ci-loop-rows.js';
import { holdLastCiFixForResearch } from './research-stuck.js';
import { CI_FIX_PROMPT_HEAD, retryLessonsOf } from './retry-lessons.js';
import { setTodoPhase } from './todos.js';

type Cand = { buildId: string; todoId: string };

export function startCiFixRound(
  deps: BuildDeps,
  cand: Cand,
  teamId: string,
  pr: { prNumber: number; prUrl: string | null },
  failures: CiCheckFailure[],
  now: number,
): 'failed' | 'held' | 'appended' {
  const rounds = countMarkedRounds(deps.db, cand.buildId, CI_FIX_PROMPT_HEAD);
  if (rounds >= CI_FIX_ROUNDS_MAX) {
    failWithMessage(deps, cand, teamId, deadLoopMessage(rounds));
    return 'failed';
  }
  if (holdLastCiFixForResearch(deps, cand.buildId, rounds, CI_FIX_ROUNDS_MAX, now)) return 'held';
  const lessons = retryLessonsOf(deps.db, cand.buildId);
  const fixPrompt = buildCiFixPrompt({
    prNumber: pr.prNumber,
    prUrl: pr.prUrl,
    round: rounds + 1,
    failures,
  });
  enqueueStep(
    deps,
    cand.buildId,
    'build',
    teamId,
    lessons === null ? fixPrompt : `${fixPrompt}\n\n${lessons}`,
    undefined,
    undefined,
    { kind: 'ci-fix', trigger: 'ci-checks', round: rounds + 1, roundsMax: CI_FIX_ROUNDS_MAX },
  );
  return 'appended';
}

export function advancePassingGrind(
  deps: BuildDeps,
  rows: KnownRows,
  todoRow: typeof todo.$inferSelect,
  cand: Cand,
  greenOwnHead: boolean,
): 'pending' | 'advanced' {
  if (greenOwnHead && countMarkedRounds(deps.db, cand.buildId, CI_FIX_PROMPT_HEAD) > 0) {
    rows.hint(cand.buildId, CI_FIX_GREEN_EVENT, 0);
  }
  maybeEnqueueIndependentReview(deps, todoRow, cand.buildId);
  const lastVerifyAt = deps.db
    .select({ at: step.createdAt })
    .from(step)
    .where(and(eq(step.buildId, cand.buildId), eq(step.kind, 'verify')))
    .orderBy(desc(step.createdAt))
    .get()?.at;
  maybeEnqueueVerifyStep(deps, todoRow, cand.buildId, {
    reverify:
      lastVerifyAt !== undefined &&
      hasMessageRow(deps, cand.buildId, 'system', CI_MERGE_CONFLICT_VERIFY_NOTE, lastVerifyAt + 1),
  });
  const gateStepQueued = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, cand.buildId),
        inArray(step.kind, ['review', 'verify']),
        inArray(step.status, [...ACTIVE_STEP_STATUSES]),
      ),
    )
    .get();
  if (gateStepQueued !== undefined) return 'pending';
  setTodoPhase(deps, cand.todoId, 'review');
  return 'advanced';
}
