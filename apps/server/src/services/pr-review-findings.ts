import { CAIRN_REVIEW_HOLD_LABEL, type PrReviewFinding } from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { message, step, type threadPr } from '../db/schema.js';
import { type FetchLike, GithubRateLimitedError } from '../lib/github.js';
import {
  githubCreateReviewHoldLabel,
  githubPrReviewFindings,
  githubSetPullDraft,
  githubSetReviewHoldLabel,
} from '../lib/github-review-findings.js';
import { type AutonomousToken, githubTokenFetch } from '../lib/github-token.js';
import type { BuildDeps } from './builds.js';
import { blockingWorkerQuestions } from './worker-question-store.js';

export function desiredAction(
  snapshot: {
    humanOverride?: boolean;
    state: string;
    isDraft: boolean;
    labels: readonly string[];
    findings: readonly PrReviewFinding[];
  },
  local: { dismissed: boolean; activeStep: boolean; blockingQuestion: boolean },
): 'addLabel' | 'convertToDraft' | 'markReady' | 'removeLabel' | null {
  if (snapshot.humanOverride || local.dismissed || snapshot.state !== 'OPEN') return null;
  const labelPresent = snapshot.labels.includes(CAIRN_REVIEW_HOLD_LABEL);
  if (snapshot.findings.length > 0) {
    if (snapshot.isDraft) return null;
    return labelPresent ? 'convertToDraft' : 'addLabel';
  }
  if (
    labelPresent &&
    snapshot.isDraft &&
    !snapshot.labels.some((label) => ['coordinator-hold', 'needs-decision'].includes(label)) &&
    !local.activeStep &&
    !local.blockingQuestion
  )
    return 'markReady';
  if (!snapshot.isDraft && labelPresent) return 'removeLabel';
  return null;
}

export async function reconcilePrReviewFindings(
  deps: BuildDeps,
  input: {
    row: typeof threadPr.$inferSelect;
    fetch: FetchLike;
    token: AutonomousToken;
    owner: string;
    repo: string;
    now: number;
  },
): Promise<PrReviewFinding[]> {
  const { row, fetch: inner, token, owner, repo, now } = input;
  const fetch = githubTokenFetch(inner, token, { owner, repo });
  if (row.dismissed) return [];
  const pull = await githubPrReviewFindings(fetch, token, owner, repo, row.number);
  if (pull.state !== 'OPEN') return [];
  const action = desiredAction(pull, {
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
  if (action !== null) {
    try {
      if (action === 'addLabel' && pull.labelId === null)
        await githubCreateReviewHoldLabel(fetch, token, owner, repo);
      else if (action === 'addLabel' || action === 'removeLabel') {
        if (pull.labelId === null) throw new Error('GitHub review hold label missing');
        await githubSetReviewHoldLabel(fetch, token, pull.id, pull.labelId, action === 'addLabel');
      } else await githubSetPullDraft(fetch, token, pull.id, action === 'convertToDraft');
    } catch (error) {
      if (error instanceof GithubRateLimitedError) throw error;
      console.warn('GitHub review hold transition unconfirmed', {
        pullRequestId: pull.id,
        action,
        error,
      });
    }
  }
  if (pull.findings.length > 0 && !pull.humanOverride) {
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
