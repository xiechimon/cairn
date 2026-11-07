import type { PrReviewFinding } from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { message, step, type threadPr } from '../db/schema.js';
import { type FetchLike, GithubRateLimitedError } from '../lib/github.js';
import { githubPrReviewFindings, githubSetPullDraft } from '../lib/github-review-findings.js';
import type { BuildDeps } from './builds.js';
import { blockingWorkerQuestions } from './worker-question-store.js';

export function desiredDraft(
  snapshot: {
    state: string;
    isDraft: boolean;
    cairnHolds: boolean;
    labels: readonly string[];
    findings: readonly PrReviewFinding[];
  },
  local: { dismissed: boolean; activeStep: boolean; blockingQuestion: boolean },
): boolean | null {
  if (local.dismissed || snapshot.state !== 'OPEN') return null;
  if (snapshot.findings.length > 0) return snapshot.isDraft ? null : true;
  if (
    snapshot.cairnHolds &&
    snapshot.isDraft &&
    !snapshot.labels.some((label) => ['coordinator-hold', 'needs-decision'].includes(label)) &&
    !local.activeStep &&
    !local.blockingQuestion
  )
    return false;
  return null;
}

export async function reconcilePrReviewFindings(
  deps: BuildDeps,
  input: {
    row: typeof threadPr.$inferSelect;
    fetch: FetchLike;
    token: string;
    owner: string;
    repo: string;
    now: number;
  },
): Promise<PrReviewFinding[]> {
  const { row, fetch, token, owner, repo, now } = input;
  if (row.dismissed) return [];
  const pull = await githubPrReviewFindings(fetch, token, owner, repo, row.number);
  if (pull.state !== 'OPEN') return [];
  const draft = desiredDraft(pull, {
    dismissed: row.dismissed,
    blockingQuestion: blockingWorkerQuestions(deps.db, row.buildId).length > 0,
    activeStep:
      deps.db
        .select({ id: step.id })
        .from(step)
        .where(
          and(
            eq(step.buildId, row.buildId),
            inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
          ),
        )
        .get() !== undefined,
  });
  if (draft !== null) {
    try {
      await githubSetPullDraft(fetch, token, pull.id, draft);
    } catch (error) {
      if (error instanceof GithubRateLimitedError) throw error;
      console.warn('GitHub review draft transition unconfirmed', {
        pullRequestId: pull.id,
        draft,
        error,
      });
    }
  }
  if (pull.findings.length > 0) {
    if (!row.autoFix) {
      const wakeLedger = deps.db
        .select()
        .from(message)
        .where(eq(message.id, `pr-wakes:${row.teamId}:${row.repo}#${row.number}`))
        .get();
      const { reviews } = z
        .object({ reviews: z.number().int().nonnegative().default(0) })
        .parse(wakeLedger?.content ?? {});
      const capped = reviews >= 3;
      deps.db
        .insert(message)
        .values({
          id: `pr-review-findings:${row.teamId}:${row.repo}#${row.number}:notice:${pull.head}:${capped ? 'cap' : 'disabled'}`,
          conversationId: row.buildId,
          role: 'system',
          content: capped
            ? 'Review round cap (3) reached; rethink or hand to the owner.'
            : `PR #${row.number} held in draft for unresolved review findings. Auto-fix is off; fix or answer and resolve each thread.`,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  }
  return pull.findings;
}
