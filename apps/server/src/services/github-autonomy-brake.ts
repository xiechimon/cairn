import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, team } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { githubApiBaseUrl } from '../lib/github-api-base.js';
import { type GithubWriteToken, githubTokenFetch } from '../lib/github-token.js';
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

async function markerOpen(fetchImpl: FetchLike, token: string, repo: string): Promise<boolean> {
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
    if (
      issues.some(
        (issue) => typeof issue === 'object' && issue !== null && !('pull_request' in issue),
      )
    )
      return true;
    if (issues.length < 100) return false;
  }
  throw new Error('Autonomy marker pagination exceeded the read limit');
}

export async function pauseGithubRepo(
  fetchImpl: FetchLike,
  token: GithubWriteToken,
  repo: string,
  reason: string,
): Promise<void> {
  if (await markerOpen(fetchImpl, token, repo)) return;
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
  if (!issue.ok) throw new Error('Autonomy marker creation failed');
}

export function pauseTeamGithubRepos(deps: GithubTokenDeps, teamId: string): Promise<void> {
  return pauseTeamGithubReposAutonomously(
    { ...deps, githubWriteTokenForRepo: (teamId) => userTokenOrNull(deps, teamId) },
    teamId,
  );
}

export async function pauseTeamGithubReposAutonomously(
  deps: GithubTokenDeps & {
    db: Db;
    githubWriteTokenForRepo?: (
      teamId: string,
      repo: { owner: string; repo: string },
    ) => Promise<GithubWriteToken | null>;
  },
  teamId: string,
  reason = 'Autonomous merging paused through Cairn.',
): Promise<void> {
  deps.db.update(team).set({ autonomyPaused: true }).where(eq(team.id, teamId)).run();
  const repos = teamGithubRepos(deps.db, teamId);
  if (repos.length === 0) return;
  const results = await Promise.allSettled(
    repos.map(async (ref) => {
      const token = await (
        deps.githubWriteTokenForRepo ?? ((teamId, ref) => autonomousToken(deps, teamId, ref))
      )(teamId, ref);
      if (token === null)
        throw new Error('GitHub connection required to publish the autonomy pause');
      return pauseGithubRepo(deps.githubFetch ?? fetch, token, `${ref.owner}/${ref.repo}`, reason);
    }),
  );
  if (results.some((result) => result.status === 'rejected'))
    throw new Error(
      'Some GitHub pause markers could not be published; the local team remains paused',
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

async function resumeWhenMarkersClosed(
  deps: GithubTokenDeps & { db: Db },
  teamId: string,
): Promise<void> {
  const repos = teamGithubRepos(deps.db, teamId);
  if (repos.length === 0) return;
  const open = await Promise.all(
    repos.map(async (ref) => {
      const token = await autonomousToken(deps, teamId, ref);
      if (token === null) return null;
      return markerOpen(deps.githubFetch ?? fetch, token, `${ref.owner}/${ref.repo}`).catch(
        () => null,
      );
    }),
  );
  if (open.every((state) => state === false))
    deps.db.update(team).set({ autonomyPaused: false }).where(eq(team.id, teamId)).run();
}

export async function syncAutonomyPauses(deps: GithubTokenDeps & { db: Db }): Promise<void> {
  const paused = deps.db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.autonomyPaused, true))
    .all();
  for (const row of paused) await resumeWhenMarkersClosed(deps, row.id);
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
    paused = await markerOpen(fetchImpl, token, repo);
  } catch {
    return true;
  }
  cache?.autonomyPause.set(repo, { at: now, paused });
  return paused;
}
