import {
  renderAttachmentTokensToLabels,
  VERIFY_VERDICT_KIND,
  verifyVerdictSchema,
} from '@cairn/shared';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { build, gateVerdict, githubConnection, message, step, todo } from '../db/schema.js';
import { githubComment, githubIssueComments } from '../lib/github.js';
import { githubAppBotLogin } from '../lib/github-token.js';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { autonomousToken } from './github-autonomous-token.js';

const verifyAnswerSchema = z.object({
  kind: z.literal(VERIFY_VERDICT_KIND),
  stepId: z.string(),
  verdict: verifyVerdictSchema,
});

const inFlight = new WeakMap<Db, Set<string>>();

export async function publishVerifyPrComment(
  deps: BuildDeps,
  buildId: string,
  headSha: string | null,
  patchDigest: string | null,
): Promise<void> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (
    buildRow?.evidenceStore !== 'attachments' ||
    buildRow.prNumber === null ||
    headSha === null ||
    patchDigest === null
  )
    return;
  const verdicts = deps.db
    .select()
    .from(gateVerdict)
    .where(
      and(
        eq(gateVerdict.buildId, buildId),
        eq(gateVerdict.kind, 'verify'),
        eq(gateVerdict.outcome, 'pass'),
        eq(gateVerdict.headSha, headSha),
        eq(gateVerdict.expectedHeadSha, headSha),
        eq(gateVerdict.patchDigest, patchDigest),
      ),
    )
    .all();
  if (verdicts.length === 0) return;
  const answers = deps.db
    .select()
    .from(message)
    .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
    .orderBy(asc(message.createdAt))
    .all();
  let conclusion: string | null = null;
  for (const row of answers) {
    let content: unknown = row.content;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {
        continue;
      }
    }
    const parsedAnswer = verifyAnswerSchema.safeParse(content);
    if (!parsedAnswer.success) continue;
    const answer = parsedAnswer.data;
    const bound = verdicts.find((verdict) => verdict.stepId === answer.stepId);
    if (bound === undefined) continue;
    const verifyStep = deps.db.select().from(step).where(eq(step.id, bound.stepId)).get();
    if (verifyStep?.status !== 'done' || verifyStep.buildId !== buildId) continue;
    if (answer.verdict.passed) {
      conclusion = renderAttachmentTokensToLabels(answer.verdict.conclusion)
        .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
        .replace(/[&<>\\`*_{}[\]#!|@]/g, (char) => `&#${char.charCodeAt(0)};`);
      break;
    }
  }
  if (conclusion === null) return;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow === undefined) return;
  const repo = githubRepoOfProject(projectOfTodo(deps.db, todoRow));
  if (repo === null) return;
  const key =
    `${todoRow.teamId}:${repo.owner}/${repo.repo}#${buildRow.prNumber}:${headSha}`.toLowerCase();
  let pending = inFlight.get(deps.db);
  if (pending === undefined) {
    pending = new Set();
    inFlight.set(deps.db, pending);
  }
  if (pending.has(key)) return;
  pending.add(key);
  try {
    const token = await autonomousToken(deps, todoRow.teamId, repo);
    if (token === null) throw new Error('GitHub token unavailable');
    const comments = await githubIssueComments(
      deps.githubFetch ?? fetch,
      token,
      repo.owner,
      repo.repo,
      buildRow.prNumber,
    );
    if (comments === null) throw new Error('GitHub comments unreadable');
    const own = new Set(
      [
        githubAppBotLogin(token),
        deps.githubAppIdentity?.name,
        deps.db
          .select()
          .from(githubConnection)
          .where(eq(githubConnection.teamId, todoRow.teamId))
          .get()?.login,
      ].flatMap((login) => (login ? [login.toLowerCase()] : [])),
    );
    const marker = `<!-- cairn:verify:${headSha} -->`;
    if (
      comments.some(
        (comment) => own.has(comment.author.toLowerCase()) && comment.body.startsWith(marker),
      )
    )
      return;
    const thread = `${deps.vapidKeys?.webOrigin ?? 'https://cairn.local'}/app?thread=${encodeURIComponent(todoRow.id)}`;
    await githubComment(
      deps.githubFetch ?? fetch,
      token,
      repo.owner,
      repo.repo,
      buildRow.prNumber,
      [
        marker,
        'Verify verdict: PASS',
        `Judged head: ${headSha}`,
        '',
        `What was checked: ${conclusion}`,
        '',
        `Cairn thread: ${thread}`,
      ].join('\n'),
    );
  } catch (error) {
    console.warn('Verify PR comment not posted; retrying on the next poll', {
      buildId,
      headSha,
      error,
    });
  } finally {
    pending.delete(key);
  }
}
