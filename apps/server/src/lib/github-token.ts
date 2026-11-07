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
  | 'app-permission-missing';

type Repository = { owner: string; repo: string };
const appFetches = new Map<
  string,
  { expiresAt: number; appSlug?: string; fetch: (inner: FetchLike, repo: Repository) => FetchLike }
>();
const scopes = new WeakMap<FetchLike, Repository>();
const fallbackCounts = new Map<AppTokenReason, number>();

export function registerAppToken(
  token: AppToken,
  expiresAt: number,
  fetch: (inner: FetchLike, repo: Repository) => FetchLike,
  appSlug?: string,
): void {
  for (const [value, entry] of appFetches) {
    if (entry.expiresAt <= Date.now()) appFetches.delete(value);
  }
  appFetches.set(token, { expiresAt, fetch, appSlug });
}

export function isAppToken(token: string): token is AppToken {
  return appFetches.has(token);
}

export function githubTokenFetch(
  inner: FetchLike,
  token: string | null,
  scope?: Repository,
): FetchLike {
  const entry = token === null ? undefined : appFetches.get(token);
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
  const slug = appFetches.get(token)?.appSlug;
  return slug ? `${slug}[bot]`.toLowerCase() : null;
}

export function githubAppTokenExpiry(token: AppToken): number | undefined {
  return appFetches.get(token)?.expiresAt;
}
