import type { GitIdentity } from '@cairn/shared';
import type { AppToken, AppTokenReason, AutonomousToken, UserToken } from '../lib/github-token.js';
import { unattributed } from '../lib/github-token.js';
import { appTokenOrNull } from './github-app-token.js';
import {
  type GithubTokenDeps,
  type GithubTokenReason,
  teamUserToken,
  userTokenOrNull,
} from './github-connection.js';

export type GithubReadTokenAccess =
  | { token: AppToken | UserToken; reason: null }
  | { token: null; reason: GithubTokenReason };

async function writeToken(
  deps: GithubTokenDeps,
  teamId: string,
  repo: { owner: string; repo: string },
  force = false,
  minimumValidityMs = 300_000,
  options?: { forceUserRefresh?: boolean },
): Promise<AutonomousToken | null> {
  let reason: AppTokenReason = 'app-token-unavailable';
  const app = await appTokenOrNull(
    {
      config: {
        githubAppTokenSocket:
          deps.githubAppTokenSocket === undefined ? null : deps.githubAppTokenSocket,
      },
      ...(deps.githubFetch ? { fetchImpl: deps.githubFetch } : {}),
      onReason: (failure) => {
        reason = failure.reason;
      },
    },
    repo,
    force,
    minimumValidityMs,
    'server-write',
  );
  if (app !== null) return app;
  const user = await userTokenOrNull(deps, teamId, {
    minimumValidityMs,
    ...(options?.forceUserRefresh === true ? { forceRefresh: true } : {}),
  });
  return user === null
    ? null
    : unattributed(user, reason, {
        ...repo,
        callSite: new Error().stack?.split('\n')[2]?.trim() ?? 'autonomousToken',
      });
}

export async function githubReadTokenAccess(
  deps: GithubTokenDeps,
  teamId: string,
  repo: { owner: string; repo: string },
  onAppReason?: (reason: AppTokenReason) => void,
): Promise<GithubReadTokenAccess> {
  const app = await appTokenOrNull(
    {
      config: {
        githubAppTokenSocket:
          deps.githubAppTokenSocket === undefined ? null : deps.githubAppTokenSocket,
      },
      ...(deps.githubFetch ? { fetchImpl: deps.githubFetch } : {}),
      ...(onAppReason ? { onReason: ({ reason }: { reason: AppTokenReason }) => onAppReason(reason) } : {}),
    },
    repo,
    false,
    300_000,
    'server-read',
  );
  if (app !== null) return { token: app, reason: null };
  const user = await teamUserToken(deps, teamId);
  return 'token' in user
    ? { token: user.token, reason: null }
    : { token: null, reason: user.reason };
}

export function autonomousToken(
  deps: GithubTokenDeps,
  teamId: string,
  repo: { owner: string; repo: string },
  force = false,
  minimumValidityMs = 300_000,
  options?: { forceUserRefresh?: boolean },
): Promise<AutonomousToken | null> {
  return writeToken(deps, teamId, repo, force, minimumValidityMs, options);
}

export async function githubReadToken(
  deps: GithubTokenDeps,
  teamId: string,
  repo: { owner: string; repo: string },
  onAppReason?: (reason: AppTokenReason) => void,
): Promise<AppToken | UserToken | null> {
  return (await githubReadTokenAccess(deps, teamId, repo, onAppReason)).token;
}

export function softwareCommitIdentity(deps: GithubTokenDeps): GitIdentity | null {
  return deps.githubAppIdentity ?? null;
}
