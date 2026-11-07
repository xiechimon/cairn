import { request } from 'node:http';
import { z } from 'zod';
import type { ServerConfig } from '../config.js';
import { githubApiBaseUrl, isGithubApiUrl } from '../lib/github-api-base.js';
import { type AppToken, tokenValue } from '../lib/github-token.js';

export type AppTokenReason =
  | 'app-token-unconfigured'
  | 'app-token-unavailable'
  | 'repo-not-installed';

type Repository = { owner: string; repo: string };

export interface GithubAppTokenDeps {
  config: Pick<ServerConfig, 'githubAppTokenSocket'>;
  onReason?: (failure: Repository & { reason: AppTokenReason }) => void;
}

const mintResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  installationId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]),
  appSlug: z.string().min(1),
});
const repositoriesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(z.object({ full_name: z.string().min(1) })),
});

type CachedInstallation = {
  token: AppToken;
  expiresAt: number;
  repositories: Set<string>;
};

const installations = new WeakMap<GithubAppTokenDeps, CachedInstallation>();

async function mintToken(socketPath: string, force: boolean) {
  const payload = await new Promise<unknown>((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: '/token',
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
  return { token: value.token as AppToken, expiresAt: Date.parse(value.expiresAt) };
}

async function installation(deps: GithubAppTokenDeps, force: boolean) {
  const cached = installations.get(deps);
  if (!force && cached && Date.now() < cached.expiresAt - 300_000) return cached;
  installations.delete(deps);
  const path = deps.config.githubAppTokenSocket;
  if (!path) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const minted = await mintToken(path, force || attempt > 0);
    const repositories = new Set<string>();
    let retry = false;
    for (let page = 1; ; page++) {
      const response = await fetch(
        `${githubApiBaseUrl()}/installation/repositories?per_page=100&page=${page}`,
        {
          headers: {
            authorization: `Bearer ${tokenValue(minted.token)}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'cairn-server',
          },
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.status === 401 && attempt === 0 && !force) {
        retry = true;
        break;
      }
      if (!response.ok) throw new Error('installation unavailable');
      const data = repositoriesSchema.parse(await response.json());
      for (const repository of data.repositories)
        repositories.add(repository.full_name.toLowerCase());
      if (page * 100 >= data.total_count) break;
      if (data.repositories.length === 0 || page >= 10_000)
        throw new Error('invalid repository page');
    }
    if (retry) continue;
    const value = { ...minted, repositories };
    installations.set(deps, value);
    return value;
  }
  return null;
}

async function repoToken(deps: GithubAppTokenDeps, repo: Repository, force: boolean) {
  let reason: AppTokenReason;
  if (!deps.config.githubAppTokenSocket) reason = 'app-token-unconfigured';
  else {
    try {
      const value = await installation(deps, force);
      if (value?.repositories.has(`${repo.owner}/${repo.repo}`.toLowerCase())) return value.token;
      reason = value ? 'repo-not-installed' : 'app-token-unavailable';
    } catch {
      reason = 'app-token-unavailable';
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
): Promise<AppToken | null> {
  return repoToken(deps, repo, false);
}

export async function appGithubFetch(
  deps: GithubAppTokenDeps,
  repo: Repository,
  input: string | URL,
  init: RequestInit = {},
): Promise<Response | null> {
  if (!isGithubApiUrl(String(input))) throw new Error('App tokens require a GitHub API URL');
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await repoToken(deps, repo, attempt > 0);
    if (token === null) return null;
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${tokenValue(token)}`);
    const response = await fetch(input, {
      ...init,
      headers,
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    if (response.status !== 401 || attempt === 1) return response;
    await response.body?.cancel();
  }
  return null;
}
