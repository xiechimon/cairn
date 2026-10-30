import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { githubRepoOfProject } from './git.js';
import { type GithubTokenDeps, teamGithubToken } from './github-connection.js';
import type { GateReadCache } from './merge-gate/github-facts.js';

export async function brakeRequest(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
  path: string,
  payload?: Record<string, unknown>,
): Promise<Awaited<ReturnType<FetchLike>>> {
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/${path}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(10_000),
  });
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
  token: string,
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

export async function pauseTeamGithubRepos(
  deps: GithubTokenDeps & { db: Db },
  teamId: string,
): Promise<void> {
  const repos = new Set(
    deps.db
      .select()
      .from(project)
      .where(eq(project.teamId, teamId))
      .all()
      .flatMap((row) => {
        const repo = githubRepoOfProject(row);
        return repo === null ? [] : [`${repo.owner}/${repo.repo}`];
      }),
  );
  if (repos.size === 0) return;
  const access = await teamGithubToken(deps, teamId);
  if (!('token' in access))
    throw new Error('GitHub connection required to publish the autonomy pause');
  const results = await Promise.allSettled(
    [...repos].map((repo) =>
      pauseGithubRepo(
        deps.githubFetch ?? fetch,
        access.token,
        repo,
        'Autonomous merging paused through Cairn.',
      ),
    ),
  );
  if (results.some((result) => result.status === 'rejected'))
    throw new Error(
      'Some GitHub pause markers could not be published; the local team remains paused',
    );
}

export async function readGithubAutonomyPause(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
  cache: GateReadCache,
  now: number,
): Promise<boolean> {
  const cached = cache.autonomyPause.get(repo);
  if (cached !== undefined && now >= cached.at && now - cached.at < 60_000) return cached.paused;
  let paused = true;
  try {
    paused = await markerOpen(fetchImpl, token, repo);
  } catch {
    return true;
  }
  cache.autonomyPause.set(repo, { at: now, paused });
  return paused;
}
