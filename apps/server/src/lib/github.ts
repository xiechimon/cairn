import { setTimeout as sleep } from 'node:timers/promises';
import {
  acquireGithubCreateSlot,
  parseGithubCreateRateLimit,
} from '@cairn/shared/github-create-gate';
// Node fetch ignores http_proxy/https_proxy unless the server starts with NODE_USE_ENV_PROXY=1 (Node >= 24.5).
import { HttpError } from './errors.js';

export type FetchLike = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

const FETCH_TIMEOUT_MS = 15_000;

// GitHub rejects API requests without a user-agent.
const API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'cairn-server',
} as const;

const USER_AGENT = 'cairn-server';

async function readJsonFull(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string> = API_HEADERS,
): Promise<{ data: unknown; getHeader: (name: string) => string | null }> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw mapFetchThrow(url, err);
  }
  if (!res.ok) throw mapUpstreamStatus(url, res);
  try {
    return { data: await res.json(), getHeader: (name) => res.headers.get(name) };
  } catch {
    throw new HttpError(502, `github response not json: ${url}`);
  }
}

async function readJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string> = API_HEADERS,
): Promise<unknown> {
  return (await readJsonFull(fetchImpl, url, headers)).data;
}

export interface GithubPullState {
  state: 'open' | 'closed';
  merged: boolean;
}

export async function githubPullState(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  prNumber: number,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<GithubPullState | null> {
  const page = await githubPull(fetchImpl, token, owner, repo, prNumber, { timeoutMs });
  return page?.pull ? { state: page.pull.state, merged: page.pull.merged } : null;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

export function isFullSha(value: string): boolean {
  return FULL_SHA.test(value);
}

export interface GithubPull extends GithubPullState {
  mergeCommitSha: string | null;
  mergedBy: string | null;
  headSha: string | null;
  headRef: string | null;
  headRepoId: number | null;
  baseRef: string | null;
  baseRepoId: number | null;
  defaultBranch: string | null;
  baseOwner: string | null;
  title: string | null;
  authorAssociation: string | null;
  mergeableState: string | null;
}

export function hasPullFields(p: GithubPull): p is GithubPull & {
  headRef: string;
  baseRef: string;
  defaultBranch: string;
  baseRepoId: number;
} {
  return (
    p.headRef !== null && p.baseRepoId !== null && p.baseRef !== null && p.defaultBranch !== null
  );
}

export function isOwnPull(pull: GithubPull, branch: string): boolean {
  return pull.headRepoId !== null && pull.headRepoId === pull.baseRepoId && pull.headRef === branch;
}

export function isOwnOpenDefaultPull(
  p: GithubPull,
  branch: string,
): p is GithubPull & {
  headRef: string;
  baseRef: string;
  defaultBranch: string;
  baseRepoId: number;
} {
  return (
    hasPullFields(p) && isOwnPull(p, branch) && p.baseRef === p.defaultBranch && p.state === 'open'
  );
}

export interface GithubPullPage {
  notModified: boolean;
  etag: string | null;
  pull: GithubPull | null;
}

async function conditionalGetJson(
  fetchImpl: FetchLike,
  url: string,
  token: string | null,
  etag: string | null | undefined,
  timeoutMs: number,
  absent: ((status: number, text: string) => boolean) | null = null,
): Promise<
  { notModified: true } | { notModified: false; etag: string | null; data: object } | null
> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      headers: {
        ...API_HEADERS,
        ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
        ...(etag != null ? { 'if-none-match': etag } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (res.status === 304) return { notModified: true };
  if (!res.ok) {
    if (absent === null || res.headers.get('x-github-sso') !== null) return null;
    const text = await res.text().catch(() => '');
    if (isRateLimitedText(res, text) || !absent(res.status, text)) return null;
    return { notModified: false, etag: null, data: [] };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  return { notModified: false, etag: res.headers.get('etag'), data };
}

export async function githubPull(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  prNumber: number,
  opts: { etag?: string | null; timeoutMs?: number } = {},
): Promise<GithubPullPage | null> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/pulls/${prNumber}`;
  const got = await conditionalGetJson(
    fetchImpl,
    url,
    token,
    opts.etag,
    opts.timeoutMs ?? FETCH_TIMEOUT_MS,
  );
  if (got === null) return null;
  if (got.notModified) return { notModified: true, etag: opts.etag ?? null, pull: null };
  const raw = got.data as {
    state?: unknown;
    merged?: unknown;
    title?: unknown;
    author_association?: unknown;
    mergeable_state?: unknown;
    merge_commit_sha?: unknown;
    merged_by?: { login?: unknown } | null;
    head?: { sha?: unknown; ref?: unknown; repo?: { id?: unknown } | null } | null;
    base?: {
      ref?: unknown;
      repo?: { id?: unknown; default_branch?: unknown; owner?: { login?: unknown } | null } | null;
    } | null;
  };
  if ((raw.state !== 'open' && raw.state !== 'closed') || typeof raw.merged !== 'boolean') {
    return null;
  }
  const merged = raw.merged;
  return {
    notModified: false,
    etag: got.etag,
    pull: {
      state: raw.state,
      merged,
      mergeCommitSha:
        merged && typeof raw.merge_commit_sha === 'string' ? raw.merge_commit_sha : null,
      mergedBy: merged && typeof raw.merged_by?.login === 'string' ? raw.merged_by.login : null,
      headSha: typeof raw.head?.sha === 'string' ? raw.head.sha : null,
      headRef: typeof raw.head?.ref === 'string' ? raw.head.ref : null,
      headRepoId: typeof raw.head?.repo?.id === 'number' ? raw.head.repo.id : null,
      baseRef: typeof raw.base?.ref === 'string' ? raw.base.ref : null,
      baseRepoId: typeof raw.base?.repo?.id === 'number' ? raw.base.repo.id : null,
      defaultBranch:
        typeof raw.base?.repo?.default_branch === 'string' ? raw.base.repo.default_branch : null,
      baseOwner: optString(raw.base?.repo?.owner?.login),
      title: optString(raw.title),
      authorAssociation: optString(raw.author_association),
      mergeableState: optString(raw.mergeable_state),
    },
  };
}

export async function githubCompareStatus(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<string | 'missing' | 'invalid' | null> {
  if (!isFullSha(base) || !isFullSha(head)) return 'invalid';
  const url = `https://api.github.com/${repoPath(owner, repo)}/compare/${base}...${head}?per_page=1`;
  try {
    const res = await fetchImpl(url, {
      headers: {
        ...API_HEADERS,
        ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return 'missing';
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: unknown } | null;
    return typeof data?.status === 'string' ? data.status : null;
  } catch {
    return null;
  }
}

export interface GithubBranchPull {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  headRef: string | null;
  headRepoId: number | null;
  baseRef: string | null;
  baseRepoId: number | null;
  authorAssociation: string | null;
}

export const WRITE_AUTHOR_ASSOCIATIONS: ReadonlySet<string> = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
]);

export async function githubBranchPulls(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  opts: { head: string; base?: string; state?: 'open' | 'all' },
): Promise<GithubBranchPull[] | null> {
  const url = listUrl(owner, repo, 'pulls', {
    state: opts.state ?? 'all',
    head: opts.head,
    base: opts.base,
    per_page: 10,
  });
  const got = await conditionalGetJson(fetchImpl, url, token, null, FETCH_TIMEOUT_MS);
  if (got === null || got.notModified) return null;
  const page = projectArray<GithubBranchPull>(
    { ok: true, data: got.data, hasMore: false },
    (raw) => {
      const p = raw as {
        number?: unknown;
        state?: unknown;
        merged_at?: unknown;
        author_association?: unknown;
        head?: { ref?: unknown; repo?: { id?: unknown } | null } | null;
        base?: { ref?: unknown; repo?: { id?: unknown } | null } | null;
      };
      if (typeof p.number !== 'number' || (p.state !== 'open' && p.state !== 'closed')) return null;
      return {
        number: p.number,
        state: p.state,
        merged: typeof p.merged_at === 'string',
        headRef: optString(p.head?.ref),
        headRepoId: typeof p.head?.repo?.id === 'number' ? p.head.repo.id : null,
        baseRef: optString(p.base?.ref),
        baseRepoId: typeof p.base?.repo?.id === 'number' ? p.base.repo.id : null,
        authorAssociation: optString(p.author_association),
      };
    },
  );
  return page.ok ? page.items : null;
}

export interface GithubRepoProbe {
  reachable: boolean;
  fullName: string | null;
}

export async function githubRepoReachable(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
): Promise<GithubRepoProbe> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const data = (await readJson(fetchImpl, url, {
      ...API_HEADERS,
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
    })) as { full_name?: unknown };
    return {
      reachable: true,
      fullName: typeof data.full_name === 'string' ? data.full_name : null,
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return { reachable: false, fullName: null };
    throw err;
  }
}

function mapFetchThrow(url: string, err: unknown): HttpError {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new HttpError(502, `github fetch timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`);
  }
  if (err instanceof TypeError) {
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    return new HttpError(
      502,
      `github fetch network error: ${err.message}${cause ? ` (${cause})` : ''}: ${url}`,
    );
  }
  return new HttpError(502, `github fetch failed: ${String(err)}: ${url}`);
}

function mapUpstreamStatus(
  url: string,
  res: { status: number; headers: { get(n: string): string | null } },
): HttpError {
  if (res.status === 404) {
    return new HttpError(404, `github repo not found (or private without auth): ${url}`);
  }
  if (isRateLimited(res)) {
    return new HttpError(
      429,
      'github api rate limit exceeded (unauthenticated 60 req/h per IP); retry later',
    );
  }
  if (res.status === 409) {
    return new HttpError(502, `github repo is empty (no commits): ${url}`);
  }
  return new HttpError(502, `github api ${res.status}: ${url}`);
}

function isRateLimited(res: { status: number; headers: { get(n: string): string | null } }) {
  return (
    res.status === 429 ||
    (res.status === 403 &&
      (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after') !== null))
  );
}

async function isRateLimitedResponse(res: Awaited<ReturnType<FetchLike>>): Promise<boolean> {
  if (isRateLimited(res)) return true;
  return res.status === 403 && isRateLimitedText(res, await res.text().catch(() => ''));
}

function isRateLimitedText(
  res: { status: number; headers: { get(n: string): string | null } },
  text: string,
): boolean {
  return isRateLimited(res) || (res.status === 403 && /rate limit/i.test(text));
}

function headerSeconds(headers: { get(name: string): string | null }, name: string): number | null {
  const v = headers.get(name)?.trim() ?? '';
  return /^\d+$/.test(v) ? Number(v) : null;
}

export class GithubRateLimitedError extends Error {
  constructor(
    url: string,
    readonly status: number,
    readonly resetAt: number | null,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`github api rate limited (${status}): ${url}`);
    this.name = 'GithubRateLimitedError';
  }

  retryAt(now: number): number | null {
    if (this.retryAfterSeconds !== null) return now + this.retryAfterSeconds * 1000;
    return this.resetAt;
  }
}

function rateLimitOf(
  url: string,
  res: { status: number; headers: { get(n: string): string | null } },
): GithubRateLimitedError {
  const seconds = (name: string): number | null => {
    const v = res.headers.get(name)?.trim() ?? '';
    return /^\d{1,10}$/.test(v) ? Number(v) : null;
  };
  const reset = seconds('x-ratelimit-reset');
  return new GithubRateLimitedError(
    url,
    res.status,
    reset === null ? null : reset * 1000,
    seconds('retry-after'),
  );
}

export interface GithubUserRepo {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
}

const USER_REPOS_PER_PAGE = 100;

export async function githubUserRepos(
  fetchImpl: FetchLike,
  token: string,
): Promise<GithubUserRepo[]> {
  const url = `https://api.github.com/user/repos?per_page=${USER_REPOS_PER_PAGE}&sort=pushed`;
  const data = await readJson(fetchImpl, url, {
    ...API_HEADERS,
    authorization: `Bearer ${token}`,
  });
  if (!Array.isArray(data)) {
    throw new HttpError(502, 'github user repos response not an array');
  }
  const repos: GithubUserRepo[] = [];
  for (const raw of data as Array<Record<string, unknown>>) {
    const owner = raw.owner as { login?: unknown } | null | undefined;
    if (
      typeof raw.id !== 'number' ||
      typeof raw.name !== 'string' ||
      typeof raw.full_name !== 'string' ||
      typeof owner?.login !== 'string'
    ) {
      continue;
    }
    repos.push({
      id: raw.id,
      owner: owner.login,
      name: raw.name,
      fullName: raw.full_name,
      isPrivate: raw.private === true,
    });
  }
  return repos;
}

export async function githubUserLogin(fetchImpl: FetchLike, token: string): Promise<string> {
  const data = (await readJson(fetchImpl, 'https://api.github.com/user', {
    ...API_HEADERS,
    authorization: `Bearer ${token}`,
  })) as { login?: unknown };
  if (typeof data.login !== 'string' || data.login === '') {
    throw new HttpError(502, 'github user response missing login');
  }
  return data.login;
}

export interface GithubLabel {
  name: string;
  color: string | null;
}

export interface GithubIssueSummary {
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: GithubLabel[];
}

export interface GithubIssueDetail extends GithubIssueSummary {
  body: string | null;
}

const ISSUES_PER_PAGE = 30;

const LABELS_PER_PAGE = 100;

function repoPath(owner: string, repo: string): string {
  return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function authHeaders(token: string): Record<string, string> {
  return { ...API_HEADERS, authorization: `Bearer ${token}` };
}

function parseLabels(raw: unknown): GithubLabel[] {
  if (!Array.isArray(raw)) return [];
  const labels: GithubLabel[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (typeof entry?.name !== 'string' || entry.name === '') continue;
    labels.push({
      name: entry.name,
      color: typeof entry.color === 'string' ? entry.color : null,
    });
  }
  return labels;
}

function projectIssue(raw: Record<string, unknown>): GithubIssueSummary | null {
  if (raw.pull_request !== undefined) return null;
  if (typeof raw.number !== 'number' || typeof raw.title !== 'string') return null;
  if (raw.state !== 'open' && raw.state !== 'closed') return null;
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    labels: parseLabels(raw.labels),
  };
}

export async function githubRepoIssues(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  opts: { state: 'open' | 'closed' | 'all'; page: number },
): Promise<{ issues: GithubIssueSummary[]; hasMore: boolean }> {
  const url =
    `https://api.github.com/${repoPath(owner, repo)}/issues` +
    `?state=${opts.state}&page=${opts.page}&per_page=${ISSUES_PER_PAGE}`;
  const { data, getHeader } = await readJsonFull(fetchImpl, url, authHeaders(token));
  if (!Array.isArray(data)) {
    throw new HttpError(502, 'github issues response not an array');
  }
  const issues: GithubIssueSummary[] = [];
  for (const raw of data as Array<Record<string, unknown>>) {
    const projected = projectIssue(raw);
    if (projected) issues.push(projected);
  }
  const link = getHeader('link');
  return { issues, hasMore: (link ?? '').includes('rel="next"') };
}

export async function githubRepoIssue(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GithubIssueDetail> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/issues/${issueNumber}`;
  const data = (await readJson(fetchImpl, url, authHeaders(token))) as Record<string, unknown>;
  const projected = projectIssue(data);
  if (!projected) {
    throw new HttpError(502, `github issue response malformed: ${url}`);
  }
  return {
    ...projected,
    body: typeof data.body === 'string' ? data.body : null,
  };
}

export type GithubListFailure =
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'rate-limited'; status: number }
  | { kind: 'status'; status: number }
  | { kind: 'malformed' };

export type GithubListResult<T> =
  | { ok: true; items: T[]; hasMore: boolean }
  | { ok: false; failure: GithubListFailure };

export interface GithubIssueListEntry extends GithubIssueSummary {
  author: string | null;
  authorAssociation: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GithubPullListEntry {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  mergedAt: string | null;
  headRef: string | null;
  baseRef: string | null;
  author: string | null;
}

export interface GithubWorkflowRunEntry {
  id: number;
  name: string | null;
  headBranch: string | null;
  headSha: string | null;
  status: string | null;
  conclusion: string | null;
  event: string | null;
  createdAt: string | null;
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

async function getListPage(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  timeoutMs: number,
): Promise<
  { ok: true; data: unknown; hasMore: boolean } | { ok: false; failure: GithubListFailure }
> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, failure: { kind: isAbort(err) ? 'timeout' : 'network' } };
  }
  if (!res.ok) {
    return {
      ok: false,
      failure: (await isRateLimitedResponse(res))
        ? { kind: 'rate-limited', status: res.status }
        : { kind: 'status', status: res.status },
    };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    return { ok: false, failure: { kind: isAbort(err) ? 'timeout' : 'malformed' } };
  }
  return { ok: true, data, hasMore: (res.headers.get('link') ?? '').includes('rel="next"') };
}

function optString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function loginOf(user: unknown): string | null {
  return optString((user as { login?: unknown } | null | undefined)?.login);
}

function listUrl(
  owner: string,
  repo: string,
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return `https://api.github.com/${repoPath(owner, repo)}/${path}?${query}`;
}

function projectArray<T>(
  page: Awaited<ReturnType<typeof getListPage>>,
  project: (raw: Record<string, unknown>) => T | null,
  container?: string,
): GithubListResult<T> {
  if (!page.ok) return page;
  let entries: unknown = page.data;
  if (container !== undefined) {
    entries =
      typeof entries === 'object' && entries !== null && !Array.isArray(entries)
        ? (entries as Record<string, unknown>)[container]
        : undefined;
  }
  if (!Array.isArray(entries)) return { ok: false, failure: { kind: 'malformed' } };
  const items: T[] = [];
  for (const raw of entries as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const projected = project(raw as Record<string, unknown>);
    if (projected !== null) items.push(projected);
  }
  return { ok: true, items, hasMore: page.hasMore };
}

export async function githubListIssues(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  opts: { state: 'open' | 'closed' | 'all'; page: number; perPage: number; timeoutMs: number },
): Promise<GithubListResult<GithubIssueListEntry>> {
  const url = listUrl(owner, repo, 'issues', {
    state: opts.state,
    page: opts.page,
    per_page: opts.perPage,
  });
  return projectArray(await getListPage(fetchImpl, url, token, opts.timeoutMs), (raw) => {
    const issue = projectIssue(raw);
    if (issue === null) return null;
    return {
      ...issue,
      author: loginOf(raw.user),
      authorAssociation: optString(raw.author_association),
      createdAt: optString(raw.created_at),
      updatedAt: optString(raw.updated_at),
    };
  });
}

export async function githubListPulls(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  opts: { state: 'open' | 'closed' | 'all'; page: number; perPage: number; timeoutMs: number },
): Promise<GithubListResult<GithubPullListEntry>> {
  const url = listUrl(owner, repo, 'pulls', {
    state: opts.state,
    page: opts.page,
    per_page: opts.perPage,
  });
  return projectArray(await getListPage(fetchImpl, url, token, opts.timeoutMs), (raw) => {
    if (typeof raw.number !== 'number' || typeof raw.title !== 'string') return null;
    if (raw.state !== 'open' && raw.state !== 'closed') return null;
    return {
      number: raw.number,
      title: raw.title,
      state: raw.state,
      draft: raw.draft === true,
      mergedAt: optString(raw.merged_at),
      headRef: optString((raw.head as { ref?: unknown } | null | undefined)?.ref),
      baseRef: optString((raw.base as { ref?: unknown } | null | undefined)?.ref),
      author: loginOf(raw.user),
    };
  });
}

export async function githubListWorkflowRuns(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  opts: { branch?: string; status?: string; page: number; perPage: number; timeoutMs: number },
): Promise<GithubListResult<GithubWorkflowRunEntry>> {
  const url = listUrl(owner, repo, 'actions/runs', {
    branch: opts.branch,
    status: opts.status,
    exclude_pull_requests: 'true',
    page: opts.page,
    per_page: opts.perPage,
  });
  return projectArray(
    await getListPage(fetchImpl, url, token, opts.timeoutMs),
    (raw) => {
      if (typeof raw.id !== 'number') return null;
      return {
        id: raw.id,
        name: optString(raw.name),
        headBranch: optString(raw.head_branch),
        headSha: optString(raw.head_sha),
        status: optString(raw.status),
        conclusion: optString(raw.conclusion),
        event: optString(raw.event),
        createdAt: optString(raw.created_at),
      };
    },
    'workflow_runs',
  );
}

export async function githubRepoLabels(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
): Promise<GithubLabel[]> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/labels?per_page=${LABELS_PER_PAGE}`;
  const data = await readJson(fetchImpl, url, authHeaders(token));
  if (!Array.isArray(data)) {
    throw new HttpError(502, 'github labels response not an array');
  }
  return parseLabels(data);
}

export type GithubConditionalRead<T> =
  | { notModified: true }
  | { notModified: false; etag: string | null; data: T };

const INTAKE_PER_PAGE = 100;

async function intakeGet(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  etag: string | null | undefined,
  init?: { method?: 'POST'; body?: string },
): Promise<{ status: number; etag: string | null; link: string | null; data: unknown } | null> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      ...(init?.method !== undefined ? { method: init.method } : {}),
      headers: {
        ...authHeaders(token),
        ...(etag != null ? { 'if-none-match': etag } : {}),
        ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init?.body !== undefined ? { body: init.body } : {}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  const head = { status: res.status, etag: res.headers.get('etag'), link: res.headers.get('link') };
  if (!res.ok) {
    if (await isRateLimitedResponse(res)) {
      throw rateLimitOf(url, res);
    }
    return { ...head, data: undefined };
  }
  try {
    return { ...head, data: await res.json() };
  } catch {
    return null;
  }
}

async function intakeConditionalGet(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  etag: string | null | undefined,
): Promise<GithubConditionalRead<{ link: string | null; body: unknown }> | null> {
  const got = await intakeGet(fetchImpl, url, token, etag);
  if (got === null) return null;
  if (got.status === 304) return etag != null ? { notModified: true } : null;
  if (got.status < 200 || got.status >= 300) return null;
  return { notModified: false, etag: got.etag, data: { link: got.link, body: got.data } };
}

function nextPageUrl(link: string | null): string | null {
  for (const part of (link ?? '').split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m?.[1]?.startsWith('https://api.github.com/')) return m[1];
  }
  return null;
}

export interface GithubLabeledIssuesPage {
  issues: GithubIssueSummary[];
  next: string | null;
  full: boolean;
}

export async function githubOpenIssuesWithLabel(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  label: string,
  opts: { url?: string | null; etag?: string | null } = {},
): Promise<GithubConditionalRead<GithubLabeledIssuesPage> | null> {
  const url =
    opts.url ??
    `https://api.github.com/${repoPath(owner, repo)}/issues?state=open` +
      `&labels=${encodeURIComponent(label)}&sort=created&direction=asc&per_page=${INTAKE_PER_PAGE}`;
  const got = await intakeConditionalGet(fetchImpl, url, token, opts.etag);
  if (got === null || got.notModified) return got;
  if (!Array.isArray(got.data.body)) return null;
  const issues: GithubIssueSummary[] = [];
  for (const raw of got.data.body as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const projected = projectIssue(raw as Record<string, unknown>);
    if (projected) issues.push(projected);
  }
  return {
    notModified: false,
    etag: got.etag,
    data: {
      issues,
      next: nextPageUrl(got.data.link),
      full: got.data.body.length >= INTAKE_PER_PAGE,
    },
  };
}

export interface GithubIssueEvent {
  id: number;
  event: 'labeled' | 'unlabeled' | 'closed';
  label: string | null;
  actor: string | null;
  viaApp: string | null;
  at: number;
}

export interface GithubIssueEventsPage {
  events: GithubIssueEvent[];
  more: boolean;
  next: string | null;
  full: boolean;
}

export async function githubIssueEvents(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  opts: { url?: string | null; etag?: string | null } = {},
): Promise<GithubConditionalRead<GithubIssueEventsPage> | null> {
  const url =
    opts.url ??
    `https://api.github.com/${repoPath(owner, repo)}/issues/${issueNumber}/events` +
      `?per_page=${INTAKE_PER_PAGE}`;
  const got = await intakeConditionalGet(fetchImpl, url, token, opts.etag);
  if (got === null || got.notModified) return got;
  if (!Array.isArray(got.data.body)) return null;
  const events: GithubIssueEvent[] = [];
  for (const raw of got.data.body as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const entry = raw as Record<string, unknown>;
    const event = entry.event;
    if (event !== 'labeled' && event !== 'unlabeled' && event !== 'closed') continue;
    const label = entry.label as { name?: unknown } | null | undefined;
    const actor = entry.actor as { login?: unknown } | null | undefined;
    const app = entry.performed_via_github_app as { slug?: unknown } | null | undefined;
    const at = typeof entry.created_at === 'string' ? Date.parse(entry.created_at) : Number.NaN;
    const labelName = typeof label?.name === 'string' ? label.name : null;
    if (typeof entry.id !== 'number' || !Number.isFinite(at)) return null;
    if (event !== 'closed' && labelName === null) return null;
    events.push({
      id: entry.id,
      event,
      label: event === 'closed' ? null : labelName,
      actor: typeof actor?.login === 'string' ? actor.login : null,
      viaApp:
        typeof app !== 'object' || app === null
          ? null
          : typeof app.slug === 'string'
            ? app.slug
            : 'unknown',
      at,
    });
  }
  return {
    notModified: false,
    etag: got.etag,
    data: {
      events,
      more: (got.data.link ?? '').includes('rel="next"'),
      next: nextPageUrl(got.data.link),
      full: got.data.body.length >= INTAKE_PER_PAGE,
    },
  };
}

export interface GithubLinkedPull {
  number: number;
  repo: string;
  state: 'open' | 'closed';
  merged: boolean;
}

export interface GithubIssueTimelinePage {
  pulls: GithubLinkedPull[];
  more: boolean;
  next: string | null;
  full: boolean;
}

export async function githubIssueTimeline(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  opts: { url?: string | null; etag?: string | null } = {},
): Promise<GithubConditionalRead<GithubIssueTimelinePage> | null> {
  const url =
    opts.url ??
    `https://api.github.com/${repoPath(owner, repo)}/issues/${issueNumber}/timeline` +
      `?per_page=${INTAKE_PER_PAGE}`;
  const got = await intakeConditionalGet(fetchImpl, url, token, opts.etag);
  if (got === null || got.notModified) return got;
  if (!Array.isArray(got.data.body)) return null;
  const pulls: GithubLinkedPull[] = [];
  for (const raw of got.data.body as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const entry = raw as Record<string, unknown>;
    const event = entry.event;
    if (event !== 'cross-referenced' && event !== 'connected') continue;
    const candidates: unknown[] = [];
    const source = entry.source;
    if (typeof source === 'object' && source !== null && 'issue' in source) {
      candidates.push((source as { issue?: unknown }).issue);
    }
    const subject = entry.subject;
    if (typeof subject === 'object' && subject !== null) {
      if ('issue' in subject) candidates.push((subject as { issue?: unknown }).issue);
      else candidates.push(subject);
    }
    if (candidates.length === 0) {
      if (event === 'cross-referenced') return null;
      continue;
    }
    for (const candidate of candidates) {
      if (typeof candidate !== 'object' || candidate === null) return null;
      const issue = candidate as Record<string, unknown>;
      const pr = issue.pull_request;
      if (pr === undefined || pr === null) continue;
      if (typeof pr !== 'object') return null;
      const number = issue.number;
      const state = issue.state;
      const fullName = (issue.repository as { full_name?: unknown } | undefined)?.full_name;
      const mergedAt = (pr as { merged_at?: unknown }).merged_at;
      if (typeof number !== 'number' || (state !== 'open' && state !== 'closed')) return null;
      if (typeof fullName !== 'string' || fullName === '') return null;
      pulls.push({
        number,
        repo: fullName,
        state,
        merged: typeof mergedAt === 'string' && mergedAt !== '',
      });
    }
  }
  return {
    notModified: false,
    etag: got.etag,
    data: {
      pulls,
      more: (got.data.link ?? '').includes('rel="next"'),
      next: nextPageUrl(got.data.link),
      full: got.data.body.length >= INTAKE_PER_PAGE,
    },
  };
}

const ISSUE_CLOSING_PULLS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){' +
  'issue(number:$number){closedByPullRequestsReferences(first:100,includeClosedPrs:true){' +
  'pageInfo{hasNextPage}nodes{number state merged repository{nameWithOwner}}}}}}';

export interface GithubClosingPulls {
  pulls: GithubLinkedPull[];
  complete: boolean;
}

export async function githubIssueClosingPulls(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GithubClosingPulls | null> {
  const url = 'https://api.github.com/graphql';
  const got = await intakeGet(fetchImpl, url, token, null, {
    method: 'POST',
    body: JSON.stringify({
      query: ISSUE_CLOSING_PULLS_QUERY,
      variables: { owner, name: repo, number: issueNumber },
    }),
  });
  if (got === null || got.status < 200 || got.status >= 300) return null;
  if (typeof got.data !== 'object' || got.data === null) return null;
  const data = (got.data as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const repository = (data as { repository?: unknown }).repository;
  if (typeof repository !== 'object' || repository === null) return null;
  const issue = (repository as { issue?: unknown }).issue;
  if (typeof issue !== 'object' || issue === null) return null;
  const conn = (issue as { closedByPullRequestsReferences?: unknown })
    .closedByPullRequestsReferences;
  if (typeof conn !== 'object' || conn === null) return null;
  const pageInfo = (conn as { pageInfo?: unknown; nodes?: unknown }).pageInfo;
  const nodes = (conn as { nodes?: unknown }).nodes;
  if (typeof pageInfo !== 'object' || pageInfo === null || !Array.isArray(nodes)) return null;
  const hasNext = (pageInfo as { hasNextPage?: unknown }).hasNextPage;
  if (typeof hasNext !== 'boolean') return null;
  const pulls: GithubLinkedPull[] = [];
  for (const node of nodes) {
    if (node === null) continue;
    if (typeof node !== 'object') return null;
    const row = node as Record<string, unknown>;
    const number = row.number;
    const state = typeof row.state === 'string' ? row.state.toLowerCase() : '';
    const merged = row.merged;
    const nameWithOwner = (row.repository as { nameWithOwner?: unknown } | undefined)
      ?.nameWithOwner;
    if (typeof number !== 'number' || (state !== 'open' && state !== 'closed')) return null;
    if (typeof merged !== 'boolean' || typeof nameWithOwner !== 'string' || nameWithOwner === '') {
      return null;
    }
    pulls.push({ number, repo: nameWithOwner, state, merged });
  }
  return { pulls, complete: !hasNext };
}

export interface GithubRepoPermission {
  permission: string;
  roleName: string | null;
  triage: boolean | null;
}

export async function githubCollaboratorPermission(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  login: string,
): Promise<GithubRepoPermission | null> {
  const url =
    `https://api.github.com/${repoPath(owner, repo)}/collaborators/` +
    `${encodeURIComponent(login)}/permission`;
  const got = await intakeGet(fetchImpl, url, token, null);
  if (got === null) return null;
  if (got.status === 404) return { permission: 'none', roleName: null, triage: false };
  if (got.status < 200 || got.status >= 300) return null;
  const body = got.data as
    | { permission?: unknown; role_name?: unknown; user?: { permissions?: { triage?: unknown } } }
    | null
    | undefined;
  if (typeof body?.permission !== 'string') return null;
  const triage = body.user?.permissions?.triage;
  return {
    permission: body.permission,
    roleName: typeof body.role_name === 'string' ? body.role_name : null,
    triage: typeof triage === 'boolean' ? triage : null,
  };
}

export async function githubIssueState(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  opts: { etag?: string | null } = {},
): Promise<GithubConditionalRead<{ state: 'open' | 'closed' }> | null> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/issues/${issueNumber}`;
  const got = await intakeConditionalGet(fetchImpl, url, token, opts.etag);
  if (got === null || got.notModified) return got;
  const state = (got.data.body as { state?: unknown } | null | undefined)?.state;
  if (state !== 'open' && state !== 'closed') return null;
  return { notModified: false, etag: got.etag, data: { state } };
}

async function writeJson(
  fetchImpl: FetchLike,
  method: 'POST' | 'PATCH',
  url: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw mapFetchThrow(url, err);
  }
  if (!res.ok) {
    const delay =
      method === 'POST' ? parseGithubCreateRateLimit(res, await res.text().catch(() => '')) : null;
    if (delay !== null) throw new GithubRateLimitedError(url, res.status, Date.now() + delay, null);
    throw mapUpstreamStatus(url, res);
  }
  try {
    return await res.json();
  } catch {
    throw new HttpError(502, `github response not json: ${url}`);
  }
}

export async function githubCreateIssue(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  input: { title: string; body: string; labels?: string[] },
): Promise<{ number: number }> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/issues`;
  let data: Record<string, unknown>;
  for (let attempt = 0; ; attempt++) {
    await acquireGithubCreateSlot();
    try {
      data = (await writeJson(fetchImpl, 'POST', url, token, input)) as Record<string, unknown>;
      break;
    } catch (error) {
      if (!(error instanceof GithubRateLimitedError) || attempt >= 3) throw error;
      const delay =
        Math.max(1000, (error.retryAt(Date.now()) ?? Date.now() + 60000) - Date.now()) *
        2 ** attempt;
      console.warn(`GitHub create rate limited; retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  if (typeof data.number !== 'number') {
    throw new HttpError(502, `github create issue response missing number: ${url}`);
  }
  return { number: data.number };
}

export async function githubUpdateIssueTitle(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  title: string,
): Promise<void> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/issues/${issueNumber}`;
  await writeJson(fetchImpl, 'PATCH', url, token, { title });
}

export async function githubCloseIssue(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/issues/${issueNumber}`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      method: 'PATCH',
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw mapFetchThrow(url, err);
  }
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  if (isRateLimitedText(res, text)) throw rateLimitOf(url, res);
  throw mapUpstreamStatus(url, res);
}

export type GithubMergeResult =
  | { kind: 'merged'; sha: string }
  | { kind: 'refused'; status: number; message: string }
  | { kind: 'rate-limited'; message: string; limit: GithubRateLimitedError }
  | {
      kind: 'unknown';
      reason: 'timeout' | 'network' | 'status' | 'malformed';
      status: number | null;
    };

export async function githubMergePull(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  input: { sha: string; commitTitle: string; commitMessage: string },
): Promise<GithubMergeResult> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/pulls/${prNumber}/merge`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      method: 'PUT',
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify({
        sha: input.sha,
        merge_method: 'squash',
        commit_title: input.commitTitle,
        commit_message: input.commitMessage,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: 'unknown', reason: isAbort(err) ? 'timeout' : 'network', status: null };
  }
  let text: string | null;
  try {
    text = await res.text();
  } catch {
    text = null;
  }
  let data: { merged?: unknown; sha?: unknown; message?: unknown } | null = null;
  try {
    const parsed: unknown = text === null ? null : JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) data = parsed;
  } catch {
    data = null;
  }
  const message = optString(data?.message) ?? '';
  if (isRateLimitedText(res, text ?? '')) {
    return { kind: 'rate-limited', message, limit: rateLimitOf(url, res) };
  }
  if (res.status >= 500) return { kind: 'unknown', reason: 'status', status: res.status };
  if (res.ok) {
    if (data?.merged === true && typeof data.sha === 'string') {
      return { kind: 'merged', sha: data.sha };
    }
    if (data?.merged === false) return { kind: 'refused', status: res.status, message };
    return { kind: 'unknown', reason: 'malformed', status: res.status };
  }
  if (res.status >= 400) return { kind: 'refused', status: res.status, message };
  return { kind: 'unknown', reason: 'status', status: res.status };
}

export interface GithubCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  outputTitle: string | null;
  outputSummary: string | null;
}

export interface GithubCheckRunsPage {
  notModified: boolean;
  etag: string | null;
  checkRuns: GithubCheckRun[];
}

const CHECK_RUNS_PER_PAGE = 100;

export async function githubCommitCheckRuns(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  ref: string,
  opts: { etag?: string | null } = {},
): Promise<GithubCheckRunsPage | null> {
  const url =
    `https://api.github.com/${repoPath(owner, repo)}/commits/${encodeURIComponent(ref)}` +
    `/check-runs?per_page=${CHECK_RUNS_PER_PAGE}`;
  const got = await conditionalGetJson(fetchImpl, url, token, opts.etag, FETCH_TIMEOUT_MS);
  if (got === null) return null;
  if (got.notModified) {
    return { notModified: true, etag: opts.etag ?? null, checkRuns: [] };
  }
  const raw = (got.data as { check_runs?: unknown }).check_runs;
  if (!Array.isArray(raw)) return null;
  const checkRuns: GithubCheckRun[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (typeof entry?.name !== 'string' || typeof entry.status !== 'string') continue;
    const output = (entry.output ?? null) as Record<string, unknown> | null;
    checkRuns.push({
      name: entry.name,
      status: entry.status,
      conclusion: typeof entry.conclusion === 'string' ? entry.conclusion : null,
      outputTitle: typeof output?.title === 'string' ? output.title : null,
      outputSummary: typeof output?.summary === 'string' ? output.summary : null,
    });
  }
  return { notModified: false, etag: got.etag, checkRuns };
}

const RULESETS_NOT_ON_PLAN = /upgrade to github|enable this feature/i;

export async function githubRequiredChecks(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  branch: string,
): Promise<string[] | null> {
  const base = `https://api.github.com/${repoPath(owner, repo)}`;
  const seg = encodedPath(branch);
  if (seg === null) return null;
  const [branchRead, rulesRead] = await Promise.all([
    conditionalGetJson(fetchImpl, `${base}/branches/${seg}`, token, null, FETCH_TIMEOUT_MS),
    conditionalGetJson(
      fetchImpl,
      `${base}/rules/branches/${seg}?per_page=100`,
      token,
      null,
      FETCH_TIMEOUT_MS,
      (status, text) => status === 404 || (status === 403 && RULESETS_NOT_ON_PLAN.test(text)),
    ),
  ]);
  if (branchRead === null || branchRead.notModified) return null;
  if (rulesRead === null || rulesRead.notModified || !Array.isArray(rulesRead.data)) return null;
  const names = new Set<string>();
  const status = (
    branchRead.data as {
      protection?: {
        required_status_checks?: {
          enforcement_level?: unknown;
          contexts?: unknown;
          checks?: unknown;
        } | null;
      } | null;
    }
  ).protection?.required_status_checks;
  const classic = status?.enforcement_level === 'off' ? null : status;
  if (Array.isArray(classic?.contexts)) {
    for (const c of classic.contexts) if (typeof c === 'string') names.add(c);
  }
  if (Array.isArray(classic?.checks)) {
    for (const c of classic.checks as Array<{ context?: unknown } | null>) {
      if (typeof c?.context === 'string') names.add(c.context);
    }
  }
  for (const rule of rulesRead.data as Array<{
    type?: unknown;
    parameters?: { required_status_checks?: unknown } | null;
  } | null>) {
    const checks =
      rule?.type === 'required_status_checks' ? rule.parameters?.required_status_checks : null;
    if (!Array.isArray(checks)) continue;
    for (const c of checks as Array<{ context?: unknown } | null>) {
      if (typeof c?.context === 'string') names.add(c.context);
    }
  }
  return [...names];
}

export type GithubRawFailure =
  | { kind: 'invalid'; field: string }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | {
      kind: 'rate-limited';
      status: number;
      resetAt: number | null;
      retryAfterSeconds: number | null;
    }
  | { kind: 'status'; status: number; message: string | null }
  | { kind: 'not-json' };

export type GithubRawResult =
  | { kind: 'ok'; status: number; etag: string | null; link: string | null; body: unknown }
  | { kind: 'not-modified' }
  | { kind: 'failed'; failure: GithubRawFailure };

export interface GithubRawOpts {
  timeoutMs: number;
}

export interface GithubConditionalOpts extends GithubRawOpts {
  etag: string | null;
}

export interface GithubPageOpts {
  page: number;
  perPage: number;
}

export const GITHUB_COMMIT_STATUS_STATES = ['error', 'failure', 'pending', 'success'] as const;
export type GithubCommitStatusState = (typeof GITHUB_COMMIT_STATUS_STATES)[number];

const HEADER_TOKEN = /^[\x21-\x7e]+$/;
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;
const UNSAFE_SEGMENT = /[\p{Cc}?#]/u;
const UNSAFE_MESSAGE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const MESSAGE_MAX = 200;
const TIMER_MAX_MS = 2_147_483_647;

const invalidResult = (field: string): GithubRawResult => ({
  kind: 'failed',
  failure: { kind: 'invalid', field },
});
const failedResult = (failure: GithubRawFailure): GithubRawResult => ({ kind: 'failed', failure });

const isPositiveInt = (n: number) => Number.isSafeInteger(n) && n >= 1;

function encodedPath(path: string): string | null {
  if (typeof path !== 'string') return null;
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || UNSAFE_SEGMENT.test(s))) {
    return null;
  }
  try {
    return segments.map((s) => encodeURIComponent(s)).join('/');
  } catch {
    return null;
  }
}

function commonInvalid(
  token: string,
  owner: string,
  repo: string,
  opts: { timeoutMs: number; etag?: string | null },
): string | null {
  if (typeof token !== 'string' || !HEADER_TOKEN.test(token)) return 'token';
  for (const [field, name] of [
    ['owner', owner],
    ['repo', repo],
  ] as const) {
    if (typeof name !== 'string' || !GITHUB_NAME.test(name) || name === '.' || name === '..') {
      return field;
    }
  }
  if (!isPositiveInt(opts.timeoutMs) || opts.timeoutMs > TIMER_MAX_MS) return 'timeoutMs';
  if (opts.etag !== undefined && opts.etag !== null && !HEADER_TOKEN.test(opts.etag)) return 'etag';
  return null;
}

function pageInvalid(opts: GithubPageOpts): string | null {
  if (!isPositiveInt(opts.page)) return 'page';
  if (!Number.isSafeInteger(opts.perPage) || opts.perPage < 1 || opts.perPage > 100) {
    return 'perPage';
  }
  return null;
}

function githubMessage(text: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const message = (data as { message?: unknown } | null)?.message;
  if (typeof message !== 'string') return null;
  const clean = Array.from(message.replace(UNSAFE_MESSAGE, ' ').trim())
    .slice(0, MESSAGE_MAX)
    .join('');
  return clean === '' ? null : clean;
}

async function gateRequest(
  fetchImpl: FetchLike,
  token: string,
  url: string,
  req: {
    method: 'GET' | 'POST';
    etag: string | null;
    payload: Record<string, unknown> | null;
    timeoutMs: number;
  },
): Promise<GithubRawResult> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      method: req.method,
      headers: {
        ...authHeaders(token),
        ...(req.etag !== null ? { 'if-none-match': req.etag } : {}),
        ...(req.payload !== null ? { 'content-type': 'application/json' } : {}),
      },
      ...(req.payload !== null ? { body: JSON.stringify(req.payload) } : {}),
      signal: AbortSignal.timeout(req.timeoutMs),
    });
  } catch (err) {
    return failedResult({ kind: isAbort(err) ? 'timeout' : 'network' });
  }
  if (res.status === 304 && req.etag !== null) return { kind: 'not-modified' };
  if (!res.ok) {
    let text = '';
    try {
      text = await res.text();
    } catch (err) {
      if (isAbort(err) && !isRateLimited(res)) return failedResult({ kind: 'timeout' });
    }
    if (isRateLimited(res) || (res.status === 403 && /rate limit/i.test(text))) {
      const reset = headerSeconds(res.headers, 'x-ratelimit-reset');
      return failedResult({
        kind: 'rate-limited',
        status: res.status,
        resetAt: reset === null ? null : reset * 1000,
        retryAfterSeconds: headerSeconds(res.headers, 'retry-after'),
      });
    }
    return failedResult({ kind: 'status', status: res.status, message: githubMessage(text) });
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return failedResult({ kind: isAbort(err) ? 'timeout' : 'not-json' });
  }
  return {
    kind: 'ok',
    status: res.status,
    etag: res.headers.get('etag'),
    link: res.headers.get('link'),
    body,
  };
}

const gateGet = (
  fetchImpl: FetchLike,
  token: string,
  url: string,
  etag: string | null,
  timeoutMs: number,
) => gateRequest(fetchImpl, token, url, { method: 'GET', etag, payload: null, timeoutMs });

const gateUrl = (
  owner: string,
  repo: string,
  path: string,
  query?: Record<string, string | number>,
) =>
  `https://api.github.com/${repoPath(owner, repo)}/${path}` +
  (query === undefined
    ? ''
    : `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`);

export async function githubPullRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  opts: GithubConditionalOpts,
): Promise<GithubRawResult> {
  const bad =
    commonInvalid(token, owner, repo, opts) ?? (isPositiveInt(prNumber) ? null : 'prNumber');
  if (bad !== null) return invalidResult(bad);
  return gateGet(
    fetchImpl,
    token,
    gateUrl(owner, repo, `pulls/${prNumber}`),
    opts.etag,
    opts.timeoutMs,
  );
}

export async function githubBranchRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  branch: string,
  opts: GithubConditionalOpts,
): Promise<GithubRawResult> {
  const bad = commonInvalid(token, owner, repo, opts);
  if (bad !== null) return invalidResult(bad);
  const path = encodedPath(branch);
  if (path === null) return invalidResult('branch');
  return gateGet(
    fetchImpl,
    token,
    gateUrl(owner, repo, `branches/${path}`),
    opts.etag,
    opts.timeoutMs,
  );
}

export async function githubBranchRulesRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  branch: string,
  opts: GithubConditionalOpts & GithubPageOpts,
): Promise<GithubRawResult> {
  const bad = commonInvalid(token, owner, repo, opts) ?? pageInvalid(opts);
  if (bad !== null) return invalidResult(bad);
  const path = encodedPath(branch);
  if (path === null) return invalidResult('branch');
  const url = gateUrl(owner, repo, `rules/branches/${path}`, {
    per_page: opts.perPage,
    page: opts.page,
  });
  return gateGet(fetchImpl, token, url, opts.etag, opts.timeoutMs);
}

export async function githubCompareRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  opts: GithubRawOpts & GithubPageOpts,
): Promise<GithubRawResult> {
  const bad =
    commonInvalid(token, owner, repo, opts) ??
    (isFullSha(baseSha) ? null : 'base') ??
    (isFullSha(headSha) ? null : 'head') ??
    pageInvalid(opts);
  if (bad !== null) return invalidResult(bad);
  const url = gateUrl(owner, repo, `compare/${baseSha}...${headSha}`, {
    per_page: opts.perPage,
    page: opts.page,
  });
  return gateGet(fetchImpl, token, url, null, opts.timeoutMs);
}

export async function githubCheckRunsRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  sha: string,
  opts: GithubConditionalOpts & GithubPageOpts & { filter: 'latest' | 'all' },
): Promise<GithubRawResult> {
  const bad =
    commonInvalid(token, owner, repo, opts) ??
    (isFullSha(sha) ? null : 'sha') ??
    pageInvalid(opts) ??
    (opts.filter === 'latest' || opts.filter === 'all' ? null : 'filter');
  if (bad !== null) return invalidResult(bad);
  const url = gateUrl(owner, repo, `commits/${sha}/check-runs`, {
    filter: opts.filter,
    per_page: opts.perPage,
    page: opts.page,
  });
  return gateGet(fetchImpl, token, url, opts.etag, opts.timeoutMs);
}

export async function githubCombinedStatusRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  sha: string,
  opts: GithubConditionalOpts & GithubPageOpts,
): Promise<GithubRawResult> {
  const bad =
    commonInvalid(token, owner, repo, opts) ?? (isFullSha(sha) ? null : 'sha') ?? pageInvalid(opts);
  if (bad !== null) return invalidResult(bad);
  const url = gateUrl(owner, repo, `commits/${sha}/status`, {
    per_page: opts.perPage,
    page: opts.page,
  });
  return gateGet(fetchImpl, token, url, opts.etag, opts.timeoutMs);
}

export async function githubContentsRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  opts: GithubRawOpts,
): Promise<GithubRawResult> {
  const bad = commonInvalid(token, owner, repo, opts) ?? (isFullSha(ref) ? null : 'ref');
  if (bad !== null) return invalidResult(bad);
  const encoded = encodedPath(path);
  if (encoded === null) return invalidResult('path');
  return gateGet(
    fetchImpl,
    token,
    gateUrl(owner, repo, `contents/${encoded}`, { ref }),
    null,
    opts.timeoutMs,
  );
}

export async function githubCreateCommitStatus(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  sha: string,
  status: { state: GithubCommitStatusState; context: string; description: string },
  opts: GithubRawOpts,
): Promise<GithubRawResult> {
  const states: readonly string[] = GITHUB_COMMIT_STATUS_STATES;
  const bad =
    commonInvalid(token, owner, repo, opts) ??
    (isFullSha(sha) ? null : 'sha') ??
    (states.includes(status.state) ? null : 'state') ??
    (typeof status.context === 'string' && status.context !== '' ? null : 'context') ??
    (typeof status.description === 'string' ? null : 'description');
  if (bad !== null) return invalidResult(bad);
  return gateRequest(fetchImpl, token, gateUrl(owner, repo, `statuses/${sha}`), {
    method: 'POST',
    etag: null,
    payload: { state: status.state, context: status.context, description: status.description },
    timeoutMs: opts.timeoutMs,
  });
}

export interface OAuthExchangeInput {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

export interface OAuthTokenExchange {
  accessToken: string;
  scope: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
}

function projectTokenPayload(payload: unknown, what: string): OAuthTokenExchange {
  const token = (payload as { access_token?: unknown }).access_token;
  if (typeof token !== 'string' || token === '') {
    throw new HttpError(502, `${what} returned no access_token`);
  }
  const scope = (payload as { scope?: unknown }).scope;
  const refreshToken = (payload as { refresh_token?: unknown }).refresh_token;
  const expiresIn = (payload as { expires_in?: unknown }).expires_in;
  return {
    accessToken: token,
    scope: typeof scope === 'string' ? scope : '',
    refreshToken: typeof refreshToken === 'string' && refreshToken !== '' ? refreshToken : null,
    expiresInSeconds: typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : null,
  };
}

export interface OAuthRefreshInput {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export async function refreshOAuthAccessToken(
  fetchImpl: FetchLike,
  input: OAuthRefreshInput,
): Promise<OAuthTokenExchange> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  }).toString();
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(input.tokenUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new HttpError(502, `oauth token refresh unreachable: ${why}`);
  }
  if (!res.ok) {
    throw new HttpError(502, `oauth token refresh upstream ${res.status}`);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new HttpError(502, 'oauth token refresh returned non-json');
  }
  return projectTokenPayload(payload, 'oauth token refresh');
}

export async function exchangeOAuthCode(
  fetchImpl: FetchLike,
  input: OAuthExchangeInput,
): Promise<OAuthTokenExchange> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  }).toString();
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(input.tokenUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new HttpError(502, `oauth token exchange unreachable: ${why}`);
  }
  if (!res.ok) {
    throw new HttpError(502, `oauth token exchange upstream ${res.status}`);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new HttpError(502, 'oauth token exchange returned non-json');
  }
  return projectTokenPayload(payload, 'oauth token exchange');
}
