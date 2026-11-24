import type { GITHUB_REPOSITORY_RENAMED } from '@cairn/shared';
import type { FetchLike } from './github.js';

export type AppToken = string & { readonly __githubTokenKind: 'app' };
export type UserToken = string & { readonly __githubTokenKind: 'user' };
export type UnattributedToken = string & { readonly __githubTokenKind: 'unattributed' };
export type AutonomousToken = AppToken | UnattributedToken;
export type GithubWriteToken = AutonomousToken | UserToken;
export type AppTokenReason =
  | 'app-token-unconfigured'
  | 'app-token-unavailable'
  | 'repo-not-installed'
  | typeof GITHUB_REPOSITORY_RENAMED.reason
  | 'app-permission-missing';

type Repository = { owner: string; repo: string };
type AppFetch = {
  expiresAt: number;
  appSlug?: string;
  fetch: (inner: FetchLike, repo: Repository) => FetchLike;
};
const APP_FETCH_CAPACITY = 256;
const APP_FETCH_SWEEP_MS = 60_000;
const appFetches = new Map<string, AppFetch>();
let appFetchSweep: ReturnType<typeof setInterval> | undefined;
const scopes = new WeakMap<FetchLike, Repository>();
const fallbackCounts = new Map<AppTokenReason, number>();

function sweepAppFetches(): void {
  const now = Date.now();
  for (const [token, entry] of appFetches) {
    if (entry.expiresAt <= now) appFetches.delete(token);
  }
  if (appFetches.size === 0) {
    clearInterval(appFetchSweep);
    appFetchSweep = undefined;
  }
}

function appFetchFor(token: string): AppFetch | undefined {
  const entry = appFetches.get(token);
  if (entry === undefined) return undefined;
  appFetches.delete(token);
  if (entry.expiresAt <= Date.now()) return undefined;
  appFetches.set(token, entry);
  return entry;
}

export function registerAppToken(
  token: AppToken,
  expiresAt: number,
  fetch: (inner: FetchLike, repo: Repository) => FetchLike,
  appSlug?: string,
): void {
  appFetches.delete(token);
  if (expiresAt <= Date.now()) return;
  if (appFetches.size >= APP_FETCH_CAPACITY) {
    sweepAppFetches();
    const oldest = appFetches.keys().next();
    if (appFetches.size >= APP_FETCH_CAPACITY && !oldest.done) appFetches.delete(oldest.value);
  }
  appFetches.set(token, { expiresAt, fetch, appSlug });
  appFetchSweep ??= setInterval(sweepAppFetches, APP_FETCH_SWEEP_MS).unref();
}

export function isAppToken(token: string): token is AppToken {
  return appFetchFor(token) !== undefined;
}

export function githubTokenFetch(
  inner: FetchLike,
  token: string | null,
  scope?: Repository,
): FetchLike {
  const entry = token === null ? undefined : appFetchFor(token);
  if (entry === undefined) return inner;
  if (scope === undefined && scopes.has(inner)) return inner;
  const scoped = scope ?? scopes.get(inner);
  const request: FetchLike = (input, init) => {
    const path = new URL(String(input)).pathname.match(/^\/repos\/([^/]+)\/([^/]+)(?:\/|$)/);
    let repo =
      scoped ??
      (path?.[1] && path[2]
        ? { owner: decodeURIComponent(path[1]), repo: decodeURIComponent(path[2]) }
        : undefined);
    if (repo === undefined && init?.body) {
      const variables = (
        JSON.parse(init.body) as { variables?: { owner?: unknown; name?: unknown } }
      ).variables;
      if (typeof variables?.owner === 'string' && typeof variables.name === 'string')
        repo = { owner: variables.owner, repo: variables.name };
    }
    if (repo === undefined) throw new Error('GitHub App request requires repository context');
    return entry.fetch(inner, repo)(input, init);
  };
  if (scoped !== undefined) scopes.set(request, scoped);
  return request;
}

export function unattributed(
  user: UserToken,
  reason: AppTokenReason,
  context: { owner: string; repo: string; callSite: string },
): UnattributedToken {
  const count = (fallbackCounts.get(reason) ?? 0) + 1;
  fallbackCounts.set(reason, count);
  console.warn('github write unattributed', { reason, ...context, count });
  return user as string as UnattributedToken;
}

export function tokenValue(token: GithubWriteToken): string {
  return token;
}

export function githubUnattributedCounts(): ReadonlyMap<AppTokenReason, number> {
  return new Map(fallbackCounts);
}

export function githubAppBotLogin(token: string): string | null {
  const slug = appFetchFor(token)?.appSlug;
  return slug ? `${slug}[bot]`.toLowerCase() : null;
}

export function githubAppTokenExpiry(token: AppToken): number | undefined {
  return appFetchFor(token)?.expiresAt;
}
