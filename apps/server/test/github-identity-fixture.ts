import { vi } from 'vitest';
import { type AppToken, type AppTokenReason, registerAppToken } from '../src/lib/github-token.js';
import * as provider from '../src/services/github-app-token.js';

export function stubGithubApp(reason: AppTokenReason | null) {
  const token = 'identity-test-installation' as AppToken;
  if (reason === null) registerAppToken(token, Date.now() + 3_600_000, (inner) => inner);
  vi.spyOn(provider, 'appTokenOrNull').mockImplementation(async (deps, repo) => {
    if (reason === null) return token;
    deps.onReason?.({ ...repo, reason });
    return null;
  });
  return token;
}
