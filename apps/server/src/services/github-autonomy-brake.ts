import type { AutonomyPauseMarker } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
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

export function pauseTeamGithubRepos(deps: GithubTokenDeps, teamId: string): Promise<void> {
  return pauseTeamGithubReposAutonomously(
    { ...deps, githubWriteTokenForRepo: (teamId) => userTokenOrNull(deps, teamId) },
    teamId,
    'Paused by the team owner.',
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
  const row = deps.db.select().from(team).where(eq(team.id, teamId)).get();
  const prior =
    row?.autonomyPaused === true && row.autonomyPauseReason !== null
      ? { reason: row.autonomyPauseReason, markers: row.autonomyPauseMarkers ?? [] }
      : null;
  const reasonText = prior === null ? reason : `${prior.reason}\n${reason}`;
  deps.db
    .update(team)
    .set({ autonomyPaused: true, autonomyPauseReason: reasonText, autonomyPauseMarkers: [] })
    .where(eq(team.id, teamId))
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
        number: await pauseGithubRepo(deps.githubFetch ?? fetch, token, repo, reason),
      };
    }),
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected'
      ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
      : [],
  );
  const published = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const clearable =
    repos.length > 0 && failures.length === 0 && (prior === null || prior.markers.length > 0);
  const markers = clearable
    ? [...(prior?.markers ?? []), ...published].filter(
        (marker, index, all) =>
          all.findIndex((m) => m.repo === marker.repo && m.number === marker.number) === index,
      )
    : [];
  deps.db
    .update(team)
    .set({
      autonomyPaused: true,
      autonomyPauseReason:
        failures.length === 0
          ? reasonText
          : `${reasonText}\nCouldn't publish brake marker: ${failures.join('; ')}`,
      autonomyPauseMarkers: markers,
    })
    .where(eq(team.id, teamId))
    .run();
  if (failures.length > 0)
    throw new Error(
      'Some GitHub pause markers could not be published; the team stays paused until resumed',
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
  const paused = deps.db.select().from(team).where(eq(team.autonomyPaused, true)).all();
  for (const row of paused) {
    const markers = row.autonomyPauseMarkers ?? [];
    if (markers.length === 0) continue;
    const closed = await Promise.all(markers.map((marker) => markerClosed(deps, row.id, marker)));
    if (!closed.every(Boolean)) continue;
    deps.db
      .update(team)
      .set({ autonomyPaused: false, autonomyPauseReason: null, autonomyPauseMarkers: null })
      .where(
        and(
          eq(team.id, row.id),
          eq(team.autonomyPaused, true),
          eq(team.autonomyPauseReason, row.autonomyPauseReason ?? ''),
        ),
      )
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
