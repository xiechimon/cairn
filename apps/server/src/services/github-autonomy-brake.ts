import type {
  AutonomyAutoResume,
  AutonomyPauseEntry,
  AutonomyPauseMarker,
  AutonomyPauseResolver,
  AutonomyPauseSource,
} from '@cairn/shared';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { autonomyPause, project } from '../db/schema.js';
import { type FetchLike, isFullSha } from '../lib/github.js';
import { githubApiBaseUrl } from '../lib/github-api-base.js';
import { type GithubWriteToken, githubTokenFetch } from '../lib/github-token.js';
import { newRecordId } from '../lib/ids.js';
import { githubRepoOfProject } from './git.js';
import { autonomousToken, githubReadToken } from './github-autonomous-token.js';
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
  method?: 'POST' | 'PATCH',
): Promise<Awaited<ReturnType<FetchLike>>>;
export async function brakeRequest(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
  path: string,
  payload?: Record<string, unknown>,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<Awaited<ReturnType<FetchLike>>> {
  const response = await githubTokenFetch(fetchImpl, token)(
    `${githubApiBaseUrl()}/repos/${repo}${path === '' ? '' : `/${path}`}`,
    {
      method: payload === undefined ? 'GET' : method,
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
  allowed?: ReadonlyMap<number, string>,
): Promise<{ number: number; node_id?: unknown } | null> {
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
      (issue): issue is { number: number; node_id?: unknown } =>
        typeof issue === 'object' &&
        issue !== null &&
        !('pull_request' in issue) &&
        typeof (issue as { number?: unknown }).number === 'number' &&
        (allowed === undefined ||
          (typeof issue.node_id === 'string' && allowed.get(issue.number) === issue.node_id)),
    );
    if (marker !== undefined) return marker;
    if (issues.length < 100) return null;
  }
  throw new Error('Autonomy marker pagination exceeded the read limit');
}

export async function pauseGithubRepo(
  fetchImpl: FetchLike,
  token: GithubWriteToken,
  repo: string,
  reason: string,
  owned: ReadonlyMap<number, string>,
): Promise<{ number: number; nodeId: string }> {
  const existing = owned.size === 0 ? null : await openMarker(fetchImpl, token, repo, owned);
  if (existing !== null && typeof existing.node_id === 'string')
    return { number: existing.number, nodeId: existing.node_id };
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
  const { number, node_id: nodeId } = (await issue.json()) as {
    number?: unknown;
    node_id?: unknown;
  };
  if (!positiveId(number) || typeof nodeId !== 'string' || nodeId === '')
    throw new Error('Autonomy marker creation returned no issue identity');
  return { number, nodeId };
}

type PauseDeps = GithubTokenDeps & {
  db: Db;
  githubWriteTokenForRepo?: (
    teamId: string,
    repo: { owner: string; repo: string },
  ) => Promise<GithubWriteToken | null>;
};

function openAutonomyPauses(db: Db, teamId: string): AutonomyPauseEntry[] {
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
      waitsFor:
        row.waitsFor === null
          ? null
          : {
              kind: row.waitsFor.kind,
              repo: row.waitsFor.repo,
              failedSha: row.waitsFor.failedSha,
            },
    }));
}

export function teamAutonomy(
  db: Db,
  teamId: string,
): { pauses: AutonomyPauseEntry[]; autoResume: AutonomyAutoResume | null } {
  return { pauses: openAutonomyPauses(db, teamId), autoResume: latestAutoResume(db, teamId) };
}

function latestAutoResume(db: Db, teamId: string): AutonomyAutoResume | null {
  const row = db
    .select()
    .from(autonomyPause)
    .where(and(eq(autonomyPause.teamId, teamId), isNotNull(autonomyPause.resolvedAt)))
    .orderBy(desc(autonomyPause.resolvedAt))
    .get();
  if (
    row?.resolvedBy !== 'condition' ||
    row.resolvedAt === null ||
    row.resolvedReason === null ||
    row.waitsFor === null
  )
    return null;
  return {
    id: row.id,
    repo: row.waitsFor.repo,
    resolvedReason: row.resolvedReason,
    resolvedAt: row.resolvedAt,
  };
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

type PauseRow = typeof autonomyPause.$inferSelect;
type StoredMarker = PauseRow['markers'][number];

const markerWrites = new WeakMap<Db, Promise<unknown>>();

function orderMarkerWrite<T>(db: Db, write: () => Promise<T>): Promise<T> {
  const previous = markerWrites.get(db);
  const next = previous === undefined ? Promise.resolve().then(write) : previous.then(write, write);
  markerWrites.set(db, next);
  const clear = () => {
    if (markerWrites.get(db) === next) markerWrites.delete(db);
  };
  void next.then(clear, clear);
  return next;
}

async function closeMarker(
  deps: GithubTokenDeps,
  teamId: string,
  marker: StoredMarker,
  comment: string,
): Promise<void> {
  if (marker.nodeId === undefined) return;
  const [owner, repo] = marker.repo.split('/');
  if (!owner || !repo) return;
  const token = await autonomousToken(deps, teamId, { owner, repo });
  if (token === null) return;
  const fetchImpl = deps.githubFetch ?? fetch;
  const path = `issues/${marker.number}`;
  const current = await brakeRequest(fetchImpl, token, marker.repo, path);
  if (!current.ok) return;
  const issue = (await current.json()) as {
    pull_request?: unknown;
    state?: unknown;
    node_id?: unknown;
  };
  if (issue.pull_request !== undefined || issue.state !== 'open' || issue.node_id !== marker.nodeId)
    return;
  await brakeRequest(fetchImpl, token, marker.repo, `${path}/comments`, { body: comment });
  const closed = await brakeRequest(
    fetchImpl,
    token,
    marker.repo,
    path,
    { state: 'closed' },
    'PATCH',
  );
  if (!closed.ok) throw new Error(`Autonomy marker close failed: ${closed.status}`);
}

function resolvePauses(
  deps: GithubTokenDeps & { db: Db },
  teamId: string,
  rows: PauseRow[],
  by: AutonomyPauseResolver,
  reason: string,
  sourceRepo?: string,
): Promise<void> {
  const resolvedAt = Date.now();
  const resolved = deps.db.transaction((tx) =>
    rows.filter(
      (row) =>
        tx
          .update(autonomyPause)
          .set({ resolvedAt, resolvedBy: by, resolvedReason: reason })
          .where(and(eq(autonomyPause.id, row.id), isNull(autonomyPause.resolvedAt)))
          .run().changes > 0,
    ),
  );
  if (resolved.length === 0 || by === 'markers') return Promise.resolve();
  return orderMarkerWrite(deps.db, async () => {
    const key = (marker: AutonomyPauseMarker) => `${marker.repo.toLowerCase()}#${marker.number}`;
    const candidates = new Map<string, StoredMarker>();
    for (const row of resolved) {
      const published = deps.db
        .select({ markers: autonomyPause.markers })
        .from(autonomyPause)
        .where(eq(autonomyPause.id, row.id))
        .get();
      for (const marker of published?.markers ?? []) {
        if (marker.nodeId !== undefined) candidates.set(key(marker), marker);
      }
    }
    if (candidates.size === 0) return;
    const open = deps.db
      .select({ markers: autonomyPause.markers })
      .from(autonomyPause)
      .where(isNull(autonomyPause.resolvedAt))
      .all();
    for (const row of open) for (const marker of row.markers) candidates.delete(key(marker));
    await Promise.allSettled(
      [...candidates.values()].map((marker) =>
        closeMarker(
          deps,
          teamId,
          marker,
          by === 'condition' && marker.repo.toLowerCase() !== sourceRepo?.toLowerCase()
            ? 'A team repository’s default branch check passed.'
            : reason,
        ),
      ),
    );
  });
}

export async function resumeAutonomyPauses(
  deps: GithubTokenDeps & { db: Db },
  teamId: string,
): Promise<void> {
  const open = deps.db
    .select()
    .from(autonomyPause)
    .where(and(eq(autonomyPause.teamId, teamId), isNull(autonomyPause.resolvedAt)))
    .all();
  await resolvePauses(deps, teamId, open, 'owner', 'Resumed by the team owner.');
}

async function readDefaultHead(fetchImpl: FetchLike, token: string, repo: string) {
  const metadata = await brakeRequest(fetchImpl, token, repo, '');
  if (!metadata.ok) return null;
  const branch = ((await metadata.json()) as { default_branch?: unknown }).default_branch;
  if (typeof branch !== 'string' || branch === '') return null;
  const response = await brakeRequest(
    fetchImpl,
    token,
    repo,
    `branches/${encodeURIComponent(branch)}`,
  );
  if (!response.ok) return null;
  const sha = ((await response.json()) as { commit?: { sha?: unknown } }).commit?.sha;
  return typeof sha === 'string' && isFullSha(sha) ? { branch, sha } : null;
}

type CheckTarget = { branch: string; sha: string; workflowId?: number };
type WorkflowExecution = { id: number; attempt: number; workflowId: number };

function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

async function readCheckExecutions(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
  { branch, sha, workflowId }: CheckTarget,
): Promise<WorkflowExecution[] | null> {
  const query = new URLSearchParams({
    branch,
    head_sha: sha,
    event: 'push',
    per_page: workflowId === undefined ? '100' : '1',
  });
  const path = workflowId === undefined ? 'actions/runs' : `actions/workflows/${workflowId}/runs`;
  const response = await brakeRequest(fetchImpl, token, repo, `${path}?${query}`);
  if (!response.ok) return null;
  const { total_count: total, workflow_runs: runs } = (await response.json()) as {
    total_count?: number;
    workflow_runs?: {
      id?: unknown;
      run_attempt?: unknown;
      workflow_id?: unknown;
      head_sha?: unknown;
      head_branch?: unknown;
      event?: unknown;
    }[];
  };
  if (!Array.isArray(runs) || (workflowId === undefined && (total ?? runs.length) > runs.length))
    return null;
  const latest = new Map<number, WorkflowExecution>();
  for (const run of runs) {
    if (
      run?.head_sha !== sha ||
      run.head_branch !== branch ||
      run.event !== 'push' ||
      !positiveId(run.id) ||
      !positiveId(run.run_attempt) ||
      !positiveId(run.workflow_id) ||
      (workflowId !== undefined && run.workflow_id !== workflowId)
    )
      return null;
    if (!latest.has(run.workflow_id))
      latest.set(run.workflow_id, {
        id: run.id,
        attempt: run.run_attempt,
        workflowId: run.workflow_id,
      });
  }
  return [...latest.values()];
}

export async function readDefaultBranchCheck(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
  target: CheckTarget,
) {
  const executions = await readCheckExecutions(fetchImpl, token, repo, target);
  if (executions === null) return null;
  const observed = await Promise.all(
    executions.map(async (execution) => {
      const response = await brakeRequest(
        fetchImpl,
        token,
        repo,
        `actions/runs/${execution.id}/attempts/${execution.attempt}/jobs?per_page=100`,
      );
      if (!response.ok) return null;
      const { total_count: total, jobs } = (await response.json()) as {
        total_count?: number;
        jobs?: { name?: unknown; status?: unknown; conclusion?: unknown }[];
      };
      if (!Array.isArray(jobs) || (total ?? jobs.length) > jobs.length) return null;
      const checks = jobs.filter((job) => job?.name === 'check');
      if (checks.length > 1) return null;
      return { execution, job: checks[0] };
    }),
  );
  if (observed.includes(null)) return null;
  const matches = observed.filter((result) => result?.job !== undefined);
  const match = matches.length === 1 ? matches[0] : null;
  if (match?.job?.status !== 'completed') return null;
  const { conclusion } = match.job;
  return conclusion === 'success' || conclusion === 'failure'
    ? { ...match.execution, conclusion }
    : null;
}

async function readMainCheck(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
  condition?: NonNullable<PauseRow['waitsFor']>,
) {
  const head = await readDefaultHead(fetchImpl, token, repo);
  if (head === null) return null;
  let workflowId = condition?.workflowId;
  if (workflowId === undefined && condition !== undefined && condition.failedSha !== head.sha) {
    const historical = await readDefaultBranchCheck(fetchImpl, token, repo, {
      branch: head.branch,
      sha: condition.failedSha,
    });
    if (historical === null) return null;
    workflowId = historical.workflowId;
  }
  const check = await readDefaultBranchCheck(fetchImpl, token, repo, {
    ...head,
    ...(workflowId === undefined ? {} : { workflowId }),
  });
  if (check === null) return null;
  const latest = (
    await readCheckExecutions(fetchImpl, token, repo, { ...head, workflowId: check.workflowId })
  )?.[0];
  if (latest?.id !== check.id || latest.attempt !== check.attempt) return null;
  const current = await readDefaultHead(fetchImpl, token, repo);
  return current?.branch === head.branch && current.sha === head.sha ? { ...head, ...check } : null;
}

export async function readTeamMainCheck(
  deps: GithubTokenDeps,
  teamId: string,
  repo: string,
  token: string,
  condition?: NonNullable<PauseRow['waitsFor']>,
) {
  const fetchImpl = deps.githubFetch ?? fetch;
  const check = await readMainCheck(fetchImpl, token, repo, condition).catch(() => null);
  if (check !== null) return { ...check, readToken: token };
  const fallback = await userTokenOrNull(deps, teamId);
  if (fallback === null || fallback === token) return null;
  const result = await readMainCheck(fetchImpl, fallback, repo, condition).catch(() => null);
  return result === null ? null : { ...result, readToken: fallback };
}

export async function resumeClearedAutonomyPauses(
  deps: GithubTokenDeps & { db: Db },
): Promise<void> {
  const waiting = deps.db
    .select()
    .from(autonomyPause)
    .where(and(isNull(autonomyPause.resolvedAt), isNotNull(autonomyPause.waitsFor)))
    .all();
  const groups = new Map<
    string,
    { teamId: string; condition: NonNullable<PauseRow['waitsFor']>; rows: PauseRow[] }
  >();
  for (const row of waiting) {
    if (row.source !== 'main-red' || row.waitsFor?.kind !== 'main-green') continue;
    const fullName = row.waitsFor.repo;
    const key = `${row.teamId}:${fullName.toLowerCase()}:${row.waitsFor.workflowId ?? row.waitsFor.failedSha}`;
    const group = groups.get(key);
    if (group === undefined)
      groups.set(key, { teamId: row.teamId, condition: row.waitsFor, rows: [row] });
    else group.rows.push(row);
  }
  const cleanup: Promise<void>[] = [];
  for (const { teamId, condition, rows } of groups.values()) {
    const fullName = condition.repo;
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) continue;
    const token = await githubReadToken(deps, teamId, { owner, repo });
    if (token === null) continue;
    const main = await readTeamMainCheck(deps, teamId, fullName, token, condition);
    if (main?.conclusion !== 'success') continue;
    cleanup.push(
      resolvePauses(
        deps,
        teamId,
        rows,
        'condition',
        `Main check passed at ${main.sha} in ${fullName}.`,
        fullName,
      ),
    );
  }
  await Promise.all(cleanup);
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
  request: {
    source: AutonomyPauseSource;
    reason: string;
    requestKey?: string;
    waitsFor?: NonNullable<PauseRow['waitsFor']>;
  },
): Promise<void> {
  const id = newRecordId();
  const inserted = deps.db
    .insert(autonomyPause)
    .values({
      id,
      teamId,
      source: request.source,
      reason: request.reason,
      markers: [],
      openedAt: Date.now(),
      requestKey: request.requestKey ?? null,
      waitsFor: request.waitsFor ?? null,
    })
    .onConflictDoNothing()
    .run();
  if (inserted.changes === 0) return;
  await orderMarkerWrite(deps.db, async () => {
    const stillOpen = deps.db
      .select({ id: autonomyPause.id })
      .from(autonomyPause)
      .where(and(eq(autonomyPause.id, id), isNull(autonomyPause.resolvedAt)))
      .get();
    if (stillOpen === undefined) return;
    const repos = teamGithubRepos(deps.db, teamId);
    const owned = new Map<string, Map<number, string>>();
    const open = deps.db
      .select({ markers: autonomyPause.markers })
      .from(autonomyPause)
      .where(isNull(autonomyPause.resolvedAt))
      .all();
    for (const row of open)
      for (const marker of row.markers) {
        if (marker.nodeId === undefined) continue;
        const repo = marker.repo.toLowerCase();
        const numbers = owned.get(repo);
        if (numbers === undefined) owned.set(repo, new Map([[marker.number, marker.nodeId]]));
        else numbers.set(marker.number, marker.nodeId);
      }
    const results = await Promise.allSettled(
      repos.map(async (ref): Promise<StoredMarker> => {
        const token = await (
          deps.githubWriteTokenForRepo ?? ((teamId, ref) => autonomousToken(deps, teamId, ref))
        )(teamId, ref);
        if (token === null)
          throw new Error('GitHub connection required to publish the autonomy pause');
        const repo = `${ref.owner}/${ref.repo}`;
        const foreign =
          request.waitsFor !== undefined &&
          request.waitsFor.repo.toLowerCase() !== repo.toLowerCase();
        return {
          repo,
          ...(await pauseGithubRepo(
            deps.githubFetch ?? fetch,
            token,
            repo,
            foreign ? 'A team repository’s default branch check failed.' : request.reason,
            owned.get(repo.toLowerCase()) ?? new Map(),
          )),
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
      .set({
        markers: results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
        publishError,
      })
      .where(eq(autonomyPause.id, id))
      .run();
    if (failures.length > 0) throw new Error('Some GitHub pause markers could not be published');
  });
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
  marker: StoredMarker,
): Promise<boolean> {
  if (marker.nodeId === undefined) return false;
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
    const issue = (await response.json()) as { state?: unknown; node_id?: unknown };
    return issue.state === 'closed' && issue.node_id === marker.nodeId;
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
    await resolvePauses(
      deps,
      entry.teamId,
      [entry],
      'markers',
      'Every GitHub pause marker was closed.',
    );
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
