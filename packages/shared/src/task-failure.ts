export const STEP_FAILURE_KINDS = [
  'quota',
  'capacity',
  'model_unavailable',
  'network',
  'other',
] as const;
export type StepFailureKind = (typeof STEP_FAILURE_KINDS)[number];

const digitBounded = (codes: string): RegExp => new RegExp(`(^|[^0-9])(${codes})([^0-9]|$)`);

const httpQuotaCodeRe = digitBounded('402');
const httpCapacityCodeRe = digitBounded('429|529');

const httpModelNotFoundCodeRe = digitBounded('404');

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

export function classifyStepFailure(rawError: string): StepFailureKind {
  const trimmed = rawError.trim();
  if (trimmed === '') return 'other';
  const lower = trimmed.toLowerCase();

  if (lower.includes('concurrent request limit')) return 'capacity';

  if (
    containsAny(lower, [
      'context length',
      'context_length_exceeded',
      'maximum context',
      'prompt is too long',
      'context size has been exceeded',
    ]) ||
    (lower.includes('token') && lower.includes('limit'))
  ) {
    return 'other';
  }

  if (
    httpQuotaCodeRe.test(lower) ||
    containsAny(lower, [
      'insufficient_balance',
      'balance is too low',
      'monthly usage limit',
      'usage limit',
      "you've hit your limit",
      'you’ve hit your limit',
      'quota',
      'credits',
    ])
  ) {
    return 'quota';
  }

  if (lower.includes('/v1/messages') && httpModelNotFoundCodeRe.test(lower)) {
    return 'model_unavailable';
  }
  if (
    containsAny(lower, [
      'model not found',
      'model_not_found',
      'model unavailable',
      'model is not available',
      'no such model',
    ]) ||
    (httpModelNotFoundCodeRe.test(lower) &&
      (lower.includes('model') || lower.includes('not found')))
  ) {
    return 'model_unavailable';
  }

  if (
    httpCapacityCodeRe.test(lower) ||
    containsAny(lower, ['rate limit', 'overloaded', 'no capacity available'])
  ) {
    return 'capacity';
  }

  if (
    containsAny(lower, [
      'stream disconnected',
      'connection closed',
      'mid-response',
      'connection error',
      'fetch failed',
      'connection reset',
      'econnreset',
      'etimedout',
      'socket hang up',
      'error sending request',
      'unable to connect',
      'dial tcp',
      'connection refused',
      'connectionrefused',
      'dns',
      'i/o timeout',
      'deadline exceeded',
      'timeout exceeded while awaiting',
      'request timed out',
    ])
  ) {
    return 'network';
  }

  return 'other';
}

const httpAuthCodeRe = digitBounded('401');

const PROVIDER_5XX_PATTERNS: readonly RegExp[] = [
  /\bhttp(?:\s+status)?[ :]?5xx\b/,
  /\b(?:error|status|returned)[:\s]+(?:http\s+)?5xx\b/,
  /\bhttp(?:\s+status)?[ :]?5\d\d\b/,
  /\bstatus[ :]5\d\d\b/,
  /\b5\d\d\s+(?:internal server error|bad gateway|service unavailable|gateway timeout|server error)/,
  /->\s*(?:http\s+)?5(?:xx|\d\d)\b/,
  /\bprovider response:.*\b5\d\d\b/,
];

const GIT_ERROR_PREFIX_RE = /^git \w+ failed \([^)]*\)/;

const GIT_PROGRESS_RE =
  /\b(?:enumerating|counting|compressing|writing|receiving|resolving) objects:/;

const ACCOUNT_EXHAUSTION_PHRASES = [
  'quota exhausted',
  'quota has been exhausted',
  'credits exhausted',
  'credit exhausted',
  'insufficient balance',
  'insufficient_balance',
  'no credits left',
  'all available accounts exhausted',
  'accounts exhausted',
] as const;

export function isProviderOutage(rawError: string): boolean {
  const lower = rawError.trim().toLowerCase();
  if (lower === '') return false;
  if (GIT_ERROR_PREFIX_RE.test(lower) || GIT_PROGRESS_RE.test(lower)) return false;
  if (containsAny(lower, ACCOUNT_EXHAUSTION_PHRASES)) return true;
  return PROVIDER_5XX_PATTERNS.some((re) => re.test(lower));
}

export function isProviderAuthFailure(rawError: string): boolean {
  const lower = rawError.trim().toLowerCase();
  if (lower === '') return false;
  if (
    containsAny(lower, [
      'authentication_error',
      'invalid api key',
      'invalid_api_key',
      'invalid x-api-key',
      'incorrect api key',
      'api key expired',
    ])
  ) {
    return true;
  }
  return httpAuthCodeRe.test(lower) && containsAny(lower, ['api key', 'api_key', 'x-api-key']);
}

export const AGENT_FAILURE_KINDS = ['quota', 'capacity', 'provider_network', 'other'] as const;
export type AgentFailureKind = (typeof AGENT_FAILURE_KINDS)[number];

const QUOTA_PATTERN =
  /\b402\b|usage[_\s-]?limit|insufficient\s+(?:quota|credit|balance)|(?:quota|credit|balance)\s+is\s+insufficient|quota\s+(?:exceed|exhaust|limit)|credit\s+balance|billing|余额不足|额度(?:不足|用完|耗尽|已用尽)|欠费/i;

const CAPACITY_PATTERN =
  /\b(?:429|529)\b|rate[_\s-]?limit|too\s+many\s+requests|overloaded|请求过于频繁|限流|负载(?:已)?饱和/i;

const NETWORK_PATTERN =
  /connection\s+(?:error|reset|refused|closed)|upstream\s+stream\s+disconnected|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket\s+hang\s+up|fetch\s+failed|network\s+error|temporarily\s+unavailable/i;

export function classifyAgentFailure(message: string): AgentFailureKind {
  if (message === '') return 'other';
  if (QUOTA_PATTERN.test(message)) return 'quota';
  if (CAPACITY_PATTERN.test(message)) return 'capacity';
  if (NETWORK_PATTERN.test(message)) return 'provider_network';
  return 'other';
}

export const RETRY_AFTER_MAX_MS = 24 * 60 * 60 * 1000;

export function parseRetryAfterMs(text: string): number | null {
  const match = /retry[ _-]?after[\s:=]+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?)?/i.exec(
    text,
  );
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2]?.toLowerCase() ?? 's';
  const multiplier = unit.startsWith('m') ? 60_000 : unit.startsWith('h') ? 3_600_000 : 1_000;
  const ms = value * multiplier;
  return ms <= RETRY_AFTER_MAX_MS ? ms : null;
}
