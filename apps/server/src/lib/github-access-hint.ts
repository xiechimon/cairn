import { isGithubAppUserToken } from './github.js';
import { isAppToken } from './github-token.js';

export type GithubAccessTokenReason =
  | 'no-secret-box'
  | 'no-github-connection'
  | 'token-unreadable'
  | 'github-disconnected';

export interface GithubAccessContext {
  owner: string;
  repo: string;
  token: string | null;
  tokenReason?: GithubAccessTokenReason | null | undefined;
  installUrl?: string | null | undefined;
}

export function isGithubAppScopedToken(token: string | null): boolean {
  return token !== null && (isAppToken(token) || isGithubAppUserToken(token));
}

export function githubAppGrantHint(
  owner: string,
  repo: string,
  installUrl?: string | null,
): string {
  const slug = `${owner}/${repo}`;
  return installUrl
    ? `Only repositories granted to Cairn are accessible through the Cairn GitHub App — grant ${slug} on GitHub (${installUrl})`
    : `Only repositories granted to Cairn are accessible through the Cairn GitHub App — grant ${slug} on GitHub`;
}

export function githubNoTokenHint(reason?: GithubAccessTokenReason | null): string {
  if (reason === 'github-disconnected') {
    return "Cairn's GitHub connection is disconnected — reconnect GitHub in Settings → Apps → GitHub";
  }
  if (reason === 'token-unreadable') {
    return "Cairn's stored GitHub token cannot be read — reconnect GitHub in Settings → Apps → GitHub";
  }
  return 'no GitHub account is connected in Cairn — connect GitHub in Settings → Apps → GitHub';
}

export function githubAccessHint(context: GithubAccessContext, status: number): string {
  if (status === 401) {
    return "Cairn's GitHub connection token was rejected — reconnect GitHub in Settings → Apps → GitHub";
  }
  if (context.token === null) {
    return githubNoTokenHint(context.tokenReason);
  }
  if (isGithubAppScopedToken(context.token)) {
    return githubAppGrantHint(context.owner, context.repo, context.installUrl);
  }
  return `the connected Cairn GitHub account lacks access to ${context.owner}/${context.repo} — check repository access or reconnect GitHub in Settings → Apps → GitHub`;
}
