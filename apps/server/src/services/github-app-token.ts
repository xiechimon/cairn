import { request } from 'node:http';
import { GITHUB_REPOSITORY_RENAMED } from '@cairn/shared';
import { z } from 'zod';
import {
  appTokenScopeKey,
  isGithubRepositoryFullName,
  permissionKey,
} from '../../../../ops/app-token-mint/scope-key.mjs';
import { createScopedTokenCache } from '../../../../ops/app-token-mint/scoped-cache.mjs';
import type { ServerConfig } from '../config.js';
import type { FetchLike } from '../lib/github.js';
import { isGithubApiUrl } from '../lib/github-api-base.js';
import {
  type AppToken,
  type AppTokenReason,
  registerAppToken,
  tokenValue,
} from '../lib/github-token.js';

export type { AppTokenReason } from '../lib/github-token.js';

type Repository = { owner: string; repo: string; repositoryId?: number };

export interface GithubAppTokenDeps {
  config: Pick<ServerConfig, 'githubAppTokenSocket'>;
  fetchImpl?: FetchLike;
  onReason?: (failure: Repository & { reason: AppTokenReason }) => void;
}

export type AppTokenPolicy = 'runner' | 'server-read' | 'server-write';

const mintResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  installationId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]),
  appSlug: z.string().min(1),
  repositories: z.array(z.string().min(1)).optional(),
  repositoryId: z.number().int().positive().optional(),
  permissions: z.unknown(),
});

const WRITE_TOKEN_PERMISSIONS = {
  actions: 'read',
  checks: 'read',
  contents: 'write',
  issues: 'write',
  metadata: 'read',
  pull_requests: 'write',
  statuses: 'read',
} as const;

const SERVER_READ_PERMISSIONS = {
  actions: 'read',
  checks: 'read',
  contents: 'read',
  issues: 'read',
  metadata: 'read',
  pull_requests: 'read',
  statuses: 'read',
} as const;

const POLICY_PERMISSIONS: Record<AppTokenPolicy, Readonly<Record<string, string>>> = {
  runner: WRITE_TOKEN_PERMISSIONS,
  'server-read': SERVER_READ_PERMISSIONS,
  'server-write': WRITE_TOKEN_PERMISSIONS,
};

type MintScope = {
  repository: Repository;
  permissions: Readonly<Record<string, string>>;
};

type MintedRepository = { id: number | undefined; fullName: string };
type ScopedEntry = Awaited<ReturnType<typeof mintToken>> | { token: null; expiresAt: number };

const cachedScopedToken = createScopedTokenCache<ScopedEntry>({
  reuseUntil: (entry) => entry.expiresAt - (entry.token === null ? 0 : 300_000),
});

const REPO_NOT_INSTALLED_TTL_MS = 60_000;

class MintRepoNotInstalled extends Error {}
class MintRepoNameMismatch extends Error {
  constructor(readonly fresh: boolean) {
    super();
  }
}

function mintRepoNotInstalled(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      parsed.error === 'repo-not-installed'
    );
  } catch {
    return false;
  }
}

function verifyMintRepository(
  minted: MintedRepository,
  requested: Repository,
  fresh: boolean,
): void {
  const { owner, repo, repositoryId } = requested;
  if (repositoryId !== undefined && minted.id !== repositoryId)
    throw new Error('mint scope unverifiable');
  if (minted.fullName.toLowerCase() !== `${owner}/${repo}`.toLowerCase())
    throw new MintRepoNameMismatch(fresh);
}

function verifyMintPermissions(permissions: unknown, requested: MintScope['permissions']): void {
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions))
    throw new Error('mint scope unverifiable');
  const granted: [string, unknown][] = Object.entries(permissions);
  if (
    granted.length !== Object.keys(requested).length ||
    granted.some(([name, level]) => !Object.hasOwn(requested, name) || level !== requested[name])
  )
    throw new Error('mint scope differs from requested');
}

async function mintToken(socketPath: string, force: boolean, scope: MintScope) {
  const query = new URLSearchParams({ repository: scope.repository.repo });
  query.set('owner', scope.repository.owner);
  query.set('permissions', permissionKey(scope.permissions));
  if (scope.repository.repositoryId !== undefined)
    query.set('repository_id', String(scope.repository.repositoryId));
  const payload = await new Promise<unknown>((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: `/token?${query.toString()}`,
        method: 'GET',
        headers: force ? { 'x-cairn-refresh': '1' } : {},
        signal: AbortSignal.timeout(15_000),
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('error', reject);
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 65_536) req.destroy(new Error('mint response too large'));
        });
        res.on('end', () => {
          if (res.statusCode === 422) {
            reject(
              mintRepoNotInstalled(body)
                ? new MintRepoNotInstalled()
                : new Error('mint unavailable'),
            );
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error('mint unavailable'));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('invalid mint response'));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
  const value = mintResponseSchema.parse(payload);
  if (Date.parse(value.expiresAt) <= Date.now() + 300_000) throw new Error('mint token expiring');
  const [fullName, extraRepository] = value.repositories ?? [];
  if (!isGithubRepositoryFullName(fullName) || extraRepository !== undefined)
    throw new Error('mint scope unverifiable');
  verifyMintPermissions(value.permissions, scope.permissions);
  return {
    token: value.token as AppToken,
    expiresAt: Date.parse(value.expiresAt),
    appSlug: value.appSlug,
    repository: { id: value.repositoryId, fullName },
  };
}

async function scopedToken(
  path: string,
  repo: Repository,
  force: boolean,
  policy: AppTokenPolicy,
): Promise<ScopedEntry> {
  if (!isGithubRepositoryFullName(`${repo.owner}/${repo.repo}`))
    throw new Error('invalid repository name');
  if (
    repo.repositoryId !== undefined &&
    (!Number.isSafeInteger(repo.repositoryId) || repo.repositoryId <= 0)
  )
    throw new Error('invalid repository id');
  const scope = appTokenScopeKey(
    repo.owner,
    repo.repo,
    repo.repositoryId,
    POLICY_PERMISSIONS[policy],
  );
  return cachedScopedToken(`${path}\0${scope}`, force, () =>
    loadScopedToken(path, repo, force, policy),
  );
}

async function loadScopedToken(
  path: string,
  repo: Repository,
  force: boolean,
  policy: AppTokenPolicy,
): Promise<ScopedEntry> {
  try {
    const minted = await mintToken(path, force, {
      repository: repo,
      permissions: POLICY_PERMISSIONS[policy],
    });
    verifyMintRepository(minted.repository, repo, force);
    return minted;
  } catch (error) {
    if (!(error instanceof MintRepoNotInstalled)) throw error;
    return { token: null, expiresAt: Date.now() + REPO_NOT_INSTALLED_TTL_MS };
  }
}

async function repoToken(
  deps: GithubAppTokenDeps,
  repo: Repository,
  force: boolean,
  minimumValidityMs: number,
  policy: AppTokenPolicy,
) {
  let reason: AppTokenReason;
  const path = deps.config.githubAppTokenSocket;
  if (!path) reason = 'app-token-unconfigured';
  else {
    try {
      let scoped = force
        ? null
        : await scopedToken(path, repo, false, policy).catch((error: unknown) => {
            if (error instanceof MintRepoNameMismatch && !error.fresh) return null;
            throw error;
          });
      if (
        scoped === null ||
        (scoped.token !== null && scoped.expiresAt - Date.now() < minimumValidityMs)
      ) {
        scoped = await scopedToken(path, repo, true, policy);
      }
      if (scoped.token !== null) {
        if (scoped.expiresAt - Date.now() < minimumValidityMs)
          throw new Error('mint token expiring');
        registerAppToken(
          scoped.token,
          scoped.expiresAt,
          (inner, target) => async (input, init) => {
            const response = await appGithubFetch(
              { ...deps, fetchImpl: inner },
              target,
              input,
              init,
              policy,
            );
            if (response === null) throw new Error('GitHub App token refresh unavailable');
            return response;
          },
          scoped.appSlug,
        );
        return scoped.token;
      }
      reason = 'repo-not-installed';
    } catch (error) {
      reason =
        error instanceof MintRepoNameMismatch && error.fresh && repo.repositoryId !== undefined
          ? GITHUB_REPOSITORY_RENAMED.reason
          : 'app-token-unavailable';
    }
  }
  try {
    deps.onReason?.({ reason, ...repo });
  } catch {
    return null;
  }
  return null;
}

export function appTokenOrNull(
  deps: GithubAppTokenDeps,
  repo: Repository,
  force = false,
  minimumValidityMs = 300_000,
  policy: AppTokenPolicy,
): Promise<AppToken | null> {
  return repoToken(deps, repo, force, minimumValidityMs, policy);
}

export async function appGithubFetch(
  deps: GithubAppTokenDeps,
  repo: Repository,
  input: string | URL,
  init: (NonNullable<Parameters<FetchLike>[1]> & Pick<RequestInit, 'redirect'>) | undefined = {},
  policy: AppTokenPolicy,
): Promise<Awaited<ReturnType<FetchLike>> | null> {
  if (!isGithubApiUrl(String(input))) throw new Error('App tokens require a GitHub API URL');
  const fetchImpl = deps.fetchImpl ?? fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await repoToken(deps, repo, attempt > 0, 300_000, policy);
    if (token === null) return null;
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${tokenValue(token)}`);
    const response = await fetchImpl(input, {
      ...init,
      headers: Object.fromEntries(headers),
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    if (response.status !== 401 || attempt === 1) return response;
    if (response instanceof Response) await response.body?.cancel();
  }
  return null;
}
