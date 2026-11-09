import type { AutonomyPauseEntry, AutonomyPauseMarker, AutonomyPauseSource } from '@cairn/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { autonomyPause, project } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { githubApiBaseUrl } from '../lib/github-api-base.js';
import { type GithubWriteToken, githubTokenFetch } from '../lib/github-token.js';
import { newRecordId } from '../lib/ids.js';
import { githubRepoOfProject } from './git.js';
import { autonomousToken } from './github-autonomous-token.js';
import { type GithubTokenDeps, userTokenOrNull } from './github-connection.js';
import type { GateReadCache } from './merge-gate/github-facts.js';

export function brakeRequest(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
  path: string,
): Promise<Awaited<ReturnType<FetchLike>>>;
export function brakeRequest(
  fetchImpl: FetchLike,
  token: GithubWriteToken,
  repo: string,
  path: string,
  payload: Record<string, unknown>,
): Promise<Awaited<ReturnType<FetchLike>>>;
export async function brakeRequest(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
  path: string,
  payload?: Record<string, unknown>,
): Promise<Awaited<ReturnType<FetchLike>>> {
  const response = await githubTokenFetch(fetchImpl, token)(
    `${githubApiBaseUrl()}/repos/${repo}/${path}`,
    {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  return response;
}

async function openMarker(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
): Promise<number | null> {
  for (let page = 1; page <= 100; page++) {
    const response = await brakeRequest(
      fetchImpl,
      token,
      repo,
      `issues?state=open&labels=autonomy-paused&per_page=100&page=${page}`,
    );
    if (!response.ok) throw new Error(`Autonomy marker lookup failed: ${response.status}`);
    const issues: unknown = await response.json();
    if (!Array.isArray(issues)) throw new Error('Autonomy marker response is not a list');
    const marker = issues.find(
      (issue): issue is { number: number } =>
        typeof issue === 'object' &&
        issue !== null &&
        !('pull_request' in issue) &&
        typeof (issue as { number?: unknown }).number === 'number',
    );
    if (marker !== undefined) return marker.number;
    if (issues.length < 100) return null;
  }
  throw new Error('Autonomy marker pagination exceeded the read limit');
}

export async function pauseGithubRepo(
  fetchImpl: FetchLike,
  token: GithubWriteToken,
  repo: string,
  reason: string,
): Promise<number> {
  const existing = await openMarker(fetchImpl, token, repo);
  if (existing !== null) return existing;
  const label = await brakeRequest(fetchImpl, token, repo, 'labels/autonomy-paused');
  if (label.status === 404) {
    const created = await brakeRequest(fetchImpl, token, repo, 'labels', {
      name: 'autonomy-paused',
      color: 'b60205',
    });
    if (!created.ok && created.status !== 422) throw new Error('Autonomy label creation failed');
  } else if (!label.ok) throw new Error('Autonomy label lookup failed');
  const issue = await brakeRequest(fetchImpl, token, repo, 'issues', {
    title: 'Autonomous merging paused',
    body: `${reason}\n\nClose this issue to resume autonomous merging.`,
    labels: ['autonomy-paused'],
  });
  if (!issue.ok) throw new Error(`Autonomy marker creation failed: ${issue.status}`);
  const { number } = (await issue.json()) as { number?: unknown };
  if (typeof number !== 'number') throw new Error('Autonomy marker creation returned no number');
  return number;
}

type PauseDeps = GithubTokenDeps & {
  db: Db;
  githubWriteTokenForRepo?: (
    teamId: string,
    repo: { owner: string; repo: string },
  ) => Promise<GithubWriteToken | null>;
};

export function openAutonomyPauses(db: Db, teamId: string): AutonomyPauseEntry[] {
  return db
    .select()
    .from(autonomyPause)
    .where(and(eq(autonomyPause.teamId, teamId), isNull(autonomyPause.resolvedAt)))
    .orderBy(asc(autonomyPause.openedAt))
    .all()
    .map((row) => ({
      id: row.id,
      source: row.source,
      reason: row.reason,
      publishError: row.publishError,
      openedAt: row.openedAt,
    }));
}

export function teamAutonomyPaused(db: Pick<Db, 'select'>, teamId: string): boolean {
  return (
    db
      .select({ id: autonomyPause.id })
      .from(autonomyPause)
      .where(and(eq(autonomyPause.teamId, teamId), isNull(autonomyPause.resolvedAt)))
      .get() !== undefined
  );
}

export function resumeAutonomyPauses(db: Db, teamId: string, now = Date.now()): void {
  db.update(autonomyPause)
    .set({ resolvedAt: now, resolvedBy: 'owner' })
    .where(and(eq(autonomyPause.teamId, teamId), isNull(autonomyPause.resolvedAt)))
    .run();
}

export function pauseTeamGithubRepos(deps: GithubTokenDeps, teamId: string): Promise<void> {
  return pauseTeamAutonomy(
    { ...deps, githubWriteTokenForRepo: (teamId) => userTokenOrNull(deps, teamId) },
    teamId,
    { source: 'settings', reason: 'Paused by the team owner.' },
  );
}

export async function pauseTeamAutonomy(
  deps: PauseDeps,
  teamId: string,
  request: { source: AutonomyPauseSource; reason: string },
): Promise<void> {
  const duplicate = deps.db
    .select({ id: autonomyPause.id })
    .from(autonomyPause)
    .where(
      and(
        eq(autonomyPause.teamId, teamId),
        eq(autonomyPause.source, request.source),
        eq(autonomyPause.reason, request.reason),
        isNull(autonomyPause.resolvedAt),
      ),
    )
    .get();
  if (duplicate !== undefined) return;
  const id = newRecordId();
  deps.db
    .insert(autonomyPause)
    .values({
      id,
      teamId,
      source: request.source,
      reason: request.reason,
      markers: [],
      openedAt: Date.now(),
    })
    .run();
  const repos = teamGithubRepos(deps.db, teamId);
  const results = await Promise.allSettled(
    repos.map(async (ref): Promise<AutonomyPauseMarker> => {
      const token = await (
        deps.githubWriteTokenForRepo ?? ((teamId, ref) => autonomousToken(deps, teamId, ref))
      )(teamId, ref);
      if (token === null)
        throw new Error('GitHub connection required to publish the autonomy pause');
      const repo = `${ref.owner}/${ref.repo}`;
      return {
        repo,
        number: await pauseGithubRepo(deps.githubFetch ?? fetch, token, repo, request.reason),
      };
    }),
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected'
      ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
      : [],
  );
  const publishError =
    repos.length === 0
      ? 'the team has no GitHub repository to publish a marker to'
      : failures.length > 0
        ? failures.join('; ')
        : null;
  deps.db
    .update(autonomyPause)
    .set(
      publishError === null
        ? {
            markers: results.flatMap((result) =>
              result.status === 'fulfilled' ? [result.value] : [],
            ),
          }
        : { publishError },
    )
    .where(eq(autonomyPause.id, id))
    .run();
  if (failures.length > 0)
    throw new Error(
      'Some GitHub pause markers could not be published; the pause stays until the owner resumes it',
    );
}

function teamGithubRepos(db: Db, teamId: string): { owner: string; repo: string }[] {
  const seen = new Map<string, { owner: string; repo: string }>();
  for (const row of db.select().from(project).where(eq(project.teamId, teamId)).all()) {
    const ref = githubRepoOfProject(row);
    if (ref !== null) seen.set(`${ref.owner}/${ref.repo}`, { owner: ref.owner, repo: ref.repo });
  }
  return [...seen.values()];
}

async function markerClosed(
  deps: GithubTokenDeps & { db: Db },
  teamId: string,
  marker: AutonomyPauseMarker,
): Promise<boolean> {
  const [owner, repo] = marker.repo.split('/');
  if (!owner || !repo) return false;
  const token = await autonomousToken(deps, teamId, { owner, repo });
  if (token === null) return false;
  try {
    const response = await brakeRequest(
      deps.githubFetch ?? fetch,
      token,
      marker.repo,
      `issues/${marker.number}`,
    );
    if (!response.ok) return false;
    const issue = (await response.json()) as { state?: unknown };
    return issue.state === 'closed';
  } catch {
    return false;
  }
}

export async function syncAutonomyPauses(deps: GithubTokenDeps & { db: Db }): Promise<void> {
  const open = deps.db
    .select()
    .from(autonomyPause)
    .where(and(isNull(autonomyPause.resolvedAt), isNull(autonomyPause.publishError)))
    .all();
  for (const entry of open) {
    if (entry.markers.length === 0) continue;
    const closed = await Promise.all(
      entry.markers.map((marker) => markerClosed(deps, entry.teamId, marker)),
    );
    if (!closed.every(Boolean)) continue;
    deps.db
      .update(autonomyPause)
      .set({ resolvedAt: Date.now(), resolvedBy: 'markers' })
      .where(and(eq(autonomyPause.id, entry.id), isNull(autonomyPause.resolvedAt)))
      .run();
  }
}

export async function readGithubAutonomyPause(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
  cache?: GateReadCache,
  now = Date.now(),
): Promise<boolean> {
  const cached = cache?.autonomyPause.get(repo);
  if (cached !== undefined && now >= cached.at && now - cached.at < 60_000) return cached.paused;
  let paused = true;
  try {
    paused = (await openMarker(fetchImpl, token, repo)) !== null;
  } catch {
    return true;
  }
  cache?.autonomyPause.set(repo, { at: now, paused });
  return paused;
}
