import type { PrReviewFinding } from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { message, step, type threadPr } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { githubPrReviewFindings, githubSetPullDraft } from '../lib/github-review-findings.js';
import type { BuildDeps } from './builds.js';

const holdSchema = z.object({ head: z.string() });

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
  const pull = await githubPrReviewFindings(fetch, token, owner, repo, row.number);
  if (pull.state !== 'OPEN') return [];
  const id = `pr-review-findings:${row.teamId}:${row.repo}#${row.number}`;
  const stored = deps.db.select().from(message).where(eq(message.id, id)).get();
  const hold = stored ? holdSchema.parse(stored.content) : null;
  if (pull.findings.length > 0) {
    if (!pull.isDraft) {
      await githubSetPullDraft(fetch, token, pull.id, true);
      deps.db
        .insert(message)
        .values({
          id,
          conversationId: id,
          role: 'system',
          content: { head: pull.head },
          createdAt: now,
        })
        .onConflictDoUpdate({ target: message.id, set: { content: { head: pull.head } } })
        .run();
    }
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
          id: `${id}:notice:${pull.head}:${capped ? 'cap' : 'disabled'}`,
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
    return pull.findings;
  }
  if (
    pull.isDraft &&
    hold &&
    !pull.labels.some((label) => ['coordinator-hold', 'needs-decision'].includes(label)) &&
    !deps.db
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, row.buildId),
          inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
        ),
      )
      .get()
  ) {
    await githubSetPullDraft(fetch, token, pull.id, false);
    deps.db.delete(message).where(eq(message.id, id)).run();
  }
  return [];
}
