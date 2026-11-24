import semver from 'semver';

export const RETRY_PARKED_MARK = 'Task parked';

export const STEP_FAILURE_KINDS = [
  'quota',
  'capacity',
  'model_unavailable',
  'runtime_outdated',
  'network',
  'other',
] as const;
export type StepFailureKind = (typeof STEP_FAILURE_KINDS)[number];

export const WORKFLOW_PUSH_REFUSAL =
  'GitHub refused to push workflow changes: the runner credential lacks Workflows permission. Remove the workflow changes or ask a repository maintainer to push them separately before retrying.';

export const GITHUB_REPOSITORY_RENAMED = {
  reason: 'repo-renamed',
  message: 'GitHub repository was renamed; reconnect it.',
} as const;

const digitBounded = (codes: string): RegExp => new RegExp(`(^|[^0-9])(${codes})([^0-9]|$)`);

const httpQuotaCodeRe = digitBounded('402');
const httpCapacityCodeRe = digitBounded('429|529');

const httpModelNotFoundCodeRe = digitBounded('404');

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

export const RUNTIME_UPDATE_REQUIRED_RE =
  /(?:([A-Za-z][\w .-]*?)\s+(\d+(?:\.\d+)+)\s+does not support this model;\s*)?version\s+(\d+(?:\.\d+)+)\s+or newer is required/i;

export interface RuntimeUpdateRequired {
  runtime: string | null;
  current: string | null;
  required: string;
}

export function runtimeUpdateRequired(rawError: string): RuntimeUpdateRequired | null {
  const match = RUNTIME_UPDATE_REQUIRED_RE.exec(rawError);
  if (match === null || match[3] === undefined) return null;
  const runtime = match[1]?.replace(/^.*\b(?:api error|error):?\s*\d{3}\s+/i, '').trim();
  return {
    runtime: runtime === undefined || runtime === '' ? null : runtime,
    current: match[2] ?? null,
    required: match[3],
  };
}

export function runtimeReportSatisfies(
  current: string | null | undefined,
  required: string,
): boolean {
  const version = semver.coerce(current ?? '')?.version;
  const floor = semver.coerce(required)?.version;
  return version !== undefined && floor !== undefined && semver.gte(version, floor);
}

export function failureEndsStepNow(rawError: string): boolean {
  const kind = classifyStepFailure(rawError);
  return kind === 'model_unavailable' || kind === 'runtime_outdated';
}

export function classifyStepFailure(rawError: string): StepFailureKind {
  const trimmed = rawError.trim();
  if (trimmed === '') return 'other';
  const lower = trimmed.toLowerCase();

  if (RUNTIME_UPDATE_REQUIRED_RE.test(trimmed)) return 'runtime_outdated';

  if (
    /\bmodel\s+[^\n]+?\s+not found\b/.test(lower) ||
    /unsupported[ _-]model/.test(lower) ||
    /\bmodel(?:\s+["'][^"']+["'])?\s+(?:is\s+)?not supported\b/.test(lower) ||
    containsAny(lower, ['model_not_found', 'model_not_supported'])
  )
    return 'model_unavailable';

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

export const CLAUDE_CODE_AUTH_FAILURE_MARKER = '[claude-code-auth-failure]';

export function isProviderAuthFailure(rawError: string): boolean {
  const lower = rawError.trim().toLowerCase();
  if (lower === '') return false;
  if (
    containsAny(lower, [
      CLAUDE_CODE_AUTH_FAILURE_MARKER,
      'failed to authenticate',
      'oauth token revoked',
      'authentication_failed',
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

export function noVisionSignalOf(message: string): boolean {
  return (
    /not a multimodal model/i.test(message) ||
    /does not support images?/i.test(message) ||
    /gemini ACP backend: image capability is not advertised/.test(message)
  );
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

const MISSING_COMMAND_PATTERNS: readonly RegExp[] = [
  /missing command[:\s]+['"]?([^\s'"():]+)['"]?/i,
  /line\s+\d+:\s*['"]?([^\s:'"]+)['"]?:\s*(?:command\s+)?not found/i,
  /:\s*\d+:\s*['"]?([^\s:'"]+)['"]?:\s*(?:command\s+)?not found/i,
  /command not found:\s*['"]?([^\s:'"]+)['"]?/i,
  /unknown command:\s*['"]?([^\s:'"]+)['"]?/i,
  /\benv:\s*['"]?([^\s:'"]+)['"]?:\s*No such file or directory/i,
  /The term\s+['"]([^'"]+)['"]\s+is not recognized/i,
  /['"]([^'"]+)['"]\s+is not recognized as an internal or external command/i,
  /(?:^|[\n—–-])\s*['"]?([^\s:'"]+)['"]?:\s*(?:command\s+)?not found/i,
];

const PLAUSIBLE_COMMAND_NAME = /^[A-Za-z0-9._@/+:-]{1,100}$/;
const SHELL_SCRIPT_NAMES = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'setup', 'resume']);

export function missingSetupCommand(text: string): string | null {
  if (text.trim() === '') return null;
  for (const pattern of MISSING_COMMAND_PATTERNS) {
    const match = pattern.exec(text);
    const raw = match?.[1]?.trim();
    if (raw === undefined || raw === '') continue;
    const cleaned = raw.replace(/^['"`]+|['"`,;.)]+$/g, '');
    if (!PLAUSIBLE_COMMAND_NAME.test(cleaned)) continue;
    const base = cleaned.includes('/') ? (cleaned.split('/').at(-1) ?? cleaned) : cleaned;
    if (base === '' || SHELL_SCRIPT_NAMES.has(base)) continue;
    return cleaned;
  }
  return null;
}

export function isMissingCommandHookNote(note: {
  status: string;
  exitCode: number | null;
  output: string;
}): boolean {
  return (
    note.status === 'failed' && (note.exitCode === 127 || missingSetupCommand(note.output) !== null)
  );
}

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
