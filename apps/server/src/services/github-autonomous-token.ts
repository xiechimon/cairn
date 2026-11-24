import type { GitIdentity } from '@cairn/shared';
import type { AppToken, AppTokenReason, AutonomousToken, UserToken } from '../lib/github-token.js';
import { unattributed } from '../lib/github-token.js';
import { appTokenOrNull } from './github-app-token.js';
import { type GithubTokenDeps, userTokenOrNull } from './github-connection.js';

async function writeToken(
  deps: GithubTokenDeps,
  teamId: string,
  repo: { owner: string; repo: string },
  force: boolean,
  minimumValidityMs: number,
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
  const user = await userTokenOrNull(deps, teamId);
  return user === null
    ? null
    : unattributed(user, reason, {
        ...repo,
        callSite: new Error().stack?.split('\n')[2]?.trim() ?? 'autonomousToken',
      });
}

export function autonomousToken(
  deps: GithubTokenDeps,
  teamId: string,
  repo: { owner: string; repo: string },
  force = false,
  minimumValidityMs = 300_000,
): Promise<AutonomousToken | null> {
  return writeToken(deps, teamId, repo, force, minimumValidityMs);
}

export async function githubReadToken(
  deps: GithubTokenDeps,
  teamId: string,
  repo: { owner: string; repo: string },
  onAppReason?: (reason: AppTokenReason) => void,
): Promise<AppToken | UserToken | null> {
  return (
    (await appTokenOrNull(
      {
        config: {
          githubAppTokenSocket:
            deps.githubAppTokenSocket === undefined ? null : deps.githubAppTokenSocket,
        },
        ...(deps.githubFetch ? { fetchImpl: deps.githubFetch } : {}),
        onReason: ({ reason }) => onAppReason?.(reason),
      },
      repo,
      false,
      300_000,
      'server-read',
    )) ?? (await userTokenOrNull(deps, teamId))
  );
}

export function softwareCommitIdentity(deps: GithubTokenDeps): GitIdentity | null {
  return deps.githubAppIdentity ?? null;
}
