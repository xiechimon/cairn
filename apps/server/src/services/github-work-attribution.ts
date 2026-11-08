import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { build, githubConnection, message, todo, user } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { githubApiBaseUrl } from '../lib/github-api-base.js';
import { type AutonomousToken, githubAppBotLogin, githubTokenFetch } from '../lib/github-token.js';
import type { BuildDeps } from './builds.js';
import { readTeamAttributionSettings } from './team-attribution-settings.js';

export function humanWorkIdentity(
  db: Db,
  row: typeof todo.$inferSelect,
  trigger?: 'user' | 'chief' | 'schedule',
) {
  if (
    trigger === 'schedule' ||
    row.createdBy === null ||
    ![null, 'github-issue-self', 'orchestration'].includes(row.sourceKind)
  )
    return null;
  if (row.sourceKind === null && row.sourceRef !== null) return null;
  if (!db.select({ id: user.id }).from(user).where(eq(user.id, row.createdBy)).get()) return null;
  const connection = db
    .select()
    .from(githubConnection)
    .where(eq(githubConnection.teamId, row.teamId))
    .get();
  if (!connection || connection.disconnectedReason !== null || connection.githubUserId === null)
    return null;
  const name = connection.githubName?.trim() || connection.login;
  if (
    /[\r\n\0<>]/.test(name + connection.login) ||
    !Number.isSafeInteger(connection.githubUserId) ||
    connection.githubUserId <= 0
  )
    return null;
  return {
    login: connection.login,
    name,
    email: `${connection.githubUserId}+${connection.login}@users.noreply.github.com`,
  };
}

export async function reconcileWorkAttribution(
  deps: BuildDeps,
  inner: FetchLike,
  token: AutonomousToken,
  target: {
    teamId: string;
    threadId: string;
    buildId: string;
    owner: string;
    repo: string;
    prNumber: number;
  },
  head: string,
  now: number,
): Promise<void> {
  const row = deps.db.select().from(todo).where(eq(todo.id, target.threadId)).get();
  const buildRow = deps.db.select().from(build).where(eq(build.id, target.buildId)).get();
  const identity = row ? humanWorkIdentity(deps.db, row, buildRow?.triggerSource) : null;
  if (identity === null) return;
  const settings = readTeamAttributionSettings(deps.db, target.teamId);
  const fetch = githubTokenFetch(inner, token, target);
  const base = `${githubApiBaseUrl()}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/pulls/${target.prNumber}`;
  const request = async (path: string, body?: object): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub attribution request failed: ${response.status}`);
    return response.json();
  };
  const loginSchema = z.object({ login: z.string() });
  const bot = githubAppBotLogin(token);
  const ledgerId = `pr-review-request:${target.teamId}:${target.owner}/${target.repo}#${target.prNumber}:${identity.login.toLowerCase()}`;
  if (
    settings.requestInstructorReview &&
    bot !== null &&
    !deps.db.select({ id: message.id }).from(message).where(eq(message.id, ledgerId)).get()
  ) {
    const pull = z
      .object({ user: loginSchema, requested_reviewers: z.array(loginSchema) })
      .parse(await request(''));
    const author = pull.user.login.toLowerCase();
    if (author === bot && identity.login.toLowerCase() !== author) {
      let reviewed = false;
      for (let page = 1; ; page++) {
        const reviews = z
          .array(z.object({ user: loginSchema.nullable() }))
          .parse(await request(`/reviews?per_page=100&page=${page}`));
        reviewed ||= reviews.some(
          (review) => review.user?.login.toLowerCase() === identity.login.toLowerCase(),
        );
        if (reviews.length < 100) break;
      }
      if (
        !reviewed &&
        !pull.requested_reviewers.some(
          (reviewer) => reviewer.login.toLowerCase() === identity.login.toLowerCase(),
        )
      )
        await request('/requested_reviewers', { reviewers: [identity.login] });
      deps.db
        .insert(message)
        .values({
          id: ledgerId,
          conversationId: target.buildId,
          role: 'system',
          content: `Review routing confirmed for ${identity.login}.`,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  }
  if (!settings.coAuthorTrailer) return;
  const noticeId = `pr-coauthor:${target.teamId}:${target.owner}/${target.repo}#${target.prNumber}:${head}`;
  if (deps.db.select({ id: message.id }).from(message).where(eq(message.id, noticeId)).get())
    return;
  const missing: string[] = [];
  const trailer = `Co-authored-by: ${identity.name} <${identity.email}>`.toLowerCase();
  for (let page = 1; ; page++) {
    const commits = z
      .array(z.object({ sha: z.string(), commit: z.object({ message: z.string() }) }))
      .parse(await request(`/commits?per_page=100&page=${page}`));
    for (const commit of commits)
      if (!commit.commit.message.split('\n').some((line) => line.toLowerCase() === trailer))
        missing.push(commit.sha);
    if (commits.length < 100) break;
  }
  if (missing.length > 0)
    deps.db
      .insert(message)
      .values({
        id: noticeId,
        conversationId: target.buildId,
        role: 'system',
        content: `PR #${target.prNumber} commits missing expected co-author ${identity.login}: ${missing.join(', ')}. Published commits were left unchanged.`,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
}
