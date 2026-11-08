import type { AppToken, AppTokenReason, AutonomousToken, UserToken } from '../lib/github-token.js';
import { unattributed } from '../lib/github-token.js';
import { appCommitIdentity, appTokenOrNull } from './github-app-token.js';
import { type GithubTokenDeps, userTokenOrNull } from './github-connection.js';

export async function autonomousToken(
  deps: GithubTokenDeps,
  teamId: string,
  repo: { owner: string; repo: string },
  force = false,
  minimumValidityMs = 300_000,
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

export async function githubReadToken(
  deps: GithubTokenDeps,
  teamId: string,
  repo: { owner: string; repo: string },
): Promise<AppToken | UserToken | null> {
  return (
    (await appTokenOrNull(
      {
        config: {
          githubAppTokenSocket:
            deps.githubAppTokenSocket === undefined ? null : deps.githubAppTokenSocket,
        },
        ...(deps.githubFetch ? { fetchImpl: deps.githubFetch } : {}),
      },
      repo,
    )) ?? (await userTokenOrNull(deps, teamId))
  );
}

export function softwareCommitIdentity(deps: GithubTokenDeps) {
  return appCommitIdentity({
    config: {
      githubAppTokenSocket:
        deps.githubAppTokenSocket === undefined ? null : deps.githubAppTokenSocket,
    },
    ...(deps.githubFetch ? { fetchImpl: deps.githubFetch } : {}),
  });
}
