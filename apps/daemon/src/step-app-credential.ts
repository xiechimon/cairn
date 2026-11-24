import { GITHUB_REPOSITORY_RENAMED } from '@cairn/shared';

export class GitHubAppTokenUnavailableError extends Error {
  constructor(body: string) {
    let reason: unknown;
    try {
      const response: unknown = JSON.parse(body);
      if (typeof response === 'object' && response !== null && 'reason' in response)
        reason = response.reason;
    } catch {
      reason = undefined;
    }
    super(
      reason === GITHUB_REPOSITORY_RENAMED.reason
        ? GITHUB_REPOSITORY_RENAMED.message
        : 'GitHub App token service unavailable',
    );
    this.name = 'GitHubAppTokenUnavailableError';
  }
}
