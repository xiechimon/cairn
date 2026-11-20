import type { ClaudeSubscriptionVerifyResult, ProviderFailure } from '@cairn/shared';
import { failureForStatus, fetchAnthropicOAuthModels } from './upstream-models.js';

const DEFAULT_TIMEOUT_MS = 30_000;
export const CLAUDE_CHECK_COMMAND = 'GET https://api.anthropic.com/v1/models';
export const CLAUDE_MODEL_TEST_COMMAND = 'POST https://api.anthropic.com/v1/messages';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

const REASON: Record<ProviderFailure, NonNullable<ClaudeSubscriptionVerifyResult['reason']>> = {
  auth: 'auth',
  'rate-limit': 'quota',
  timeout: 'timeout',
  network: 'unavailable',
  upstream: 'unavailable',
  'not-found': 'unavailable',
  invalid: 'failed',
  'no-model': 'failed',
};

export async function verifyClaudeSubscription(
  token: string,
  options: { timeoutMs?: number; fetch?: typeof globalThis.fetch } = {},
): Promise<ClaudeSubscriptionVerifyResult> {
  const listed = await fetchAnthropicOAuthModels({
    oauthToken: token,
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!listed.ok) return { ok: false, reason: REASON[listed.failure] };
  if (listed.models.length === 0) return { ok: false, reason: 'failed' };
  return { ok: true };
}

export async function probeClaudeSubscriptionModel(
  token: string,
  model: string,
  options: { timeoutMs?: number; fetch?: typeof globalThis.fetch } = {},
): Promise<ClaudeSubscriptionVerifyResult> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Reply with OK' }],
      }),
      signal,
    });
  } catch {
    return { ok: false, reason: signal.aborted ? 'timeout' : 'unavailable' };
  }
  if (response.ok) return { ok: true };
  return { ok: false, reason: REASON[failureForStatus(response.status)] };
}
