import type {
  ClaudeRateLimitNotice,
  ClaudeSubscriptionVerifyResult,
  ProviderFailure,
} from '@cairn/shared';
import { CLAUDE_RATE_LIMIT_STATUSES } from '@cairn/shared';
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

type UpstreamOptions = { timeoutMs?: number; fetch?: typeof globalThis.fetch };

function postOneTokenMessage(
  token: string,
  model: string,
  content: string,
  signal: AbortSignal,
  options: UpstreamOptions,
): Promise<Response> {
  return (options.fetch ?? globalThis.fetch)(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content }] }),
    signal,
  });
}

export async function probeClaudeSubscriptionModel(
  token: string,
  model: string,
  options: UpstreamOptions = {},
): Promise<ClaudeSubscriptionVerifyResult> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await postOneTokenMessage(token, model, 'Reply with OK', signal, options);
  } catch {
    return { ok: false, reason: signal.aborted ? 'timeout' : 'unavailable' };
  }
  if (response.ok) return { ok: true };
  return { ok: false, reason: REASON[failureForStatus(response.status)] };
}

const UNIFIED_WINDOWS = [
  ['5h', 'five_hour'],
  ['7d', 'seven_day'],
] as const;

function rateLimitStatusOf(raw: string | null): ClaudeRateLimitNotice['status'] {
  return CLAUDE_RATE_LIMIT_STATUSES.find((status) => status === raw) ?? 'allowed';
}

export function unifiedRateLimitNotices(headers: Headers): ClaudeRateLimitNotice[] {
  const notices: ClaudeRateLimitNotice[] = [];
  const claim = headers.get('anthropic-ratelimit-unified-representative-claim');
  const claimStatus = rateLimitStatusOf(headers.get('anthropic-ratelimit-unified-status'));
  for (const [header, rateLimitType] of UNIFIED_WINDOWS) {
    const prefix = `anthropic-ratelimit-unified-${header}`;
    const raw = headers.get(`${prefix}-utilization`);
    const utilization = raw === null ? Number.NaN : Number(raw);
    if (!Number.isFinite(utilization) || utilization < 0) continue;
    const resetsAt = Number(headers.get(`${prefix}-reset`));
    notices.push({
      status: claim === rateLimitType ? claimStatus : 'allowed',
      rateLimitType,
      utilization,
      ...(Number.isFinite(resetsAt) && resetsAt > 0 ? { resetsAt } : {}),
    });
  }
  return notices;
}

export async function probeClaudeQuota(
  token: string,
  model: string,
  options: UpstreamOptions = {},
): Promise<ClaudeRateLimitNotice[]> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await postOneTokenMessage(token, model, 'quota', signal, options);
    void response.body?.cancel();
    return unifiedRateLimitNotices(response.headers);
  } catch {
    return [];
  }
}
