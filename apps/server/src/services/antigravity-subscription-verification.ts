import type { AntigravitySubscriptionVerifyResult } from '@cairn/shared';

const DEFAULT_TIMEOUT_MS = 30_000;
export const ANTIGRAVITY_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function verifyAntigravitySubscription(
  token: string,
  options: { timeoutMs?: number } = {},
): Promise<AntigravitySubscriptionVerifyResult> {
  try {
    const response = await fetch(ANTIGRAVITY_MODELS_URL, {
      headers: { 'x-goog-api-key': token },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (response.ok || response.status === 429) return { ok: true };
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'auth' };
    }
    return { ok: false, reason: 'failed' };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return {
      ok: false,
      reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable',
    };
  }
}
