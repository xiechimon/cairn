import semver from 'semver';
import { z } from 'zod';
import { trimEndChars, trimStartChars } from './linear-text.js';

export const RETRY_PARKED_MARK = 'Task parked';

export const STEP_FAILURE_KINDS = [
  'disk',
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

const FAILURE_TEXT_SCAN_LIMIT = 8_192;

function scanSlice(text: string): string {
  return text.length <= FAILURE_TEXT_SCAN_LIMIT ? text : text.slice(0, FAILURE_TEXT_SCAN_LIMIT);
}

const MODEL_NOT_FOUND_RE = /\bmodel (?:(?!\bmodel (?!not found\b))[^\n])+? not found\b/;
const MODEL_THEN_ONLY_SPACE_RE = /\bmodel(\s+)not found\b/g;

function namesModelNotFound(lower: string): boolean {
  for (const [, gap = ''] of lower.matchAll(MODEL_THEN_ONLY_SPACE_RE)) {
    if (/[^\n]/.test(gap.slice(1, -1))) return true;
  }
  return MODEL_NOT_FOUND_RE.test(
    lower.replace(/(?<=\S)\s+(?=not found\b)/g, ' ').replace(/(?<=\bmodel)\s+/g, ' '),
  );
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

export const RUNTIME_UPDATE_REQUIRED_RE =
  /(?:([A-Za-z][\w.:-]{0,40}(?: [A-Za-z0-9][\w.:-]{0,40}){0,5})\s+(\d+(?:\.\d+){1,3})\s+does not support this model;\s*)?version\s+(\d+(?:\.\d+){1,3})\s+or newer is required/i;

export interface RuntimeUpdateRequired {
  runtime: string | null;
  current: string | null;
  required: string;
}

export function runtimeUpdateRequired(rawError: string): RuntimeUpdateRequired | null {
  const match = RUNTIME_UPDATE_REQUIRED_RE.exec(scanSlice(rawError));
  if (match === null || match[3] === undefined) return null;
  const runtime = match[1]
    ?.replace(/^.*\b(?:api error|error):?\s*\d{3}\s+/i, '')
    .trim()
    .slice(0, 40);
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
  return kind === 'disk' || kind === 'model_unavailable' || kind === 'runtime_outdated';
}

export const CONNECTION_FAILURE_RE =
  /connection[\s_]*(?:error|failed|reset|refused|closed)|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|socket[\s_]+hang[\s_]+up|fetch[\s_]+failed|error[\s_]+sending[\s_]+request|unable[\s_]+to[\s_]+connect|dial[\s_]+tcp|network[\s_]+error/i;

const URL_OR_HOST_BEFORE_PORT_RE = /\bhttps?:\/\/\S+|(\]|(?<![\w.-])[\w.-]+):(?=\d)/gi;
const PORT_DIGITS_RE = /\d+/y;
const WORD_CHAR_RE = /\w/;

function addressLengthEndingHost(host: string, followsWordChar: boolean): number {
  if (host === ']') return 1;
  const labels = host.split('.');
  const dotted = labels.slice(labels.lastIndexOf('') + 1);
  if (dotted.length >= 2) return dotted.join('.').length;
  const localhost = /\blocalhost$/i.exec(host);
  if (localhost === null || (localhost.index === 0 && followsWordChar)) return 0;
  return localhost[0].length;
}

function withoutAddresses(text: string): string {
  let out = '';
  let copied = 0;
  for (const match of text.matchAll(URL_OR_HOST_BEFORE_PORT_RE)) {
    const run = match[1];
    if (run === undefined) {
      out += text.slice(copied, match.index);
      copied = match.index + match[0].length;
      continue;
    }
    const hostEnd = match.index + run.length;
    const hostStart = Math.max(match.index, copied);
    if (hostStart >= hostEnd) continue;
    const length = addressLengthEndingHost(
      text.slice(hostStart, hostEnd),
      WORD_CHAR_RE.test(text.charAt(hostStart - 1)),
    );
    if (length === 0) continue;
    out += text.slice(copied, hostEnd - length);
    PORT_DIGITS_RE.lastIndex = hostEnd + 1;
    PORT_DIGITS_RE.test(text);
    copied = PORT_DIGITS_RE.lastIndex;
  }
  return out + text.slice(copied);
}

const SERVER_ANSWER_RE =
  /\b[45]\d\d\b(?!\s*m?s\b)|\b(?:unauthorized|unauthenticated|forbidden|permission[_ ]denied)\b/i;

export function isUnansweredFetch(text: string): boolean {
  return /failed to fetch/i.test(text) && !SERVER_ANSWER_RE.test(withoutAddresses(text));
}

export function isConnectionFailure(text: string): boolean {
  return CONNECTION_FAILURE_RE.test(text) || isUnansweredFetch(text);
}

export const DISK_FULL_RE =
  /\bENOSPC\b|no space left on device|insufficient (?:free )?disk space|disk full/i;

export function isDiskFullFailure(text: string): boolean {
  return DISK_FULL_RE.test(scanSlice(text));
}

export function classifyStepFailure(rawError: string): StepFailureKind {
  const trimmed = scanSlice(rawError).trim();
  if (trimmed === '') return 'other';
  const lower = trimmed.toLowerCase();

  if (isDiskFullFailure(trimmed)) return 'disk';
  if (RUNTIME_UPDATE_REQUIRED_RE.test(trimmed)) return 'runtime_outdated';

  if (
    namesModelNotFound(lower) ||
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
    isConnectionFailure(trimmed) ||
    containsAny(lower, [
      'stream disconnected',
      'mid-response',
      'etimedout',
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
  const lower = scanSlice(rawError).trim().toLowerCase();
  if (lower === '') return false;
  if (isDiskFullFailure(lower)) return false;
  if (GIT_ERROR_PREFIX_RE.test(lower) || GIT_PROGRESS_RE.test(lower)) return false;
  if (containsAny(lower, ACCOUNT_EXHAUSTION_PHRASES)) return true;
  return PROVIDER_5XX_PATTERNS.some((re) => re.test(lower));
}

export const CLAUDE_CODE_AUTH_FAILURE_MARKER = '[claude-code-auth-failure]';

export function isProviderAuthFailure(rawError: string): boolean {
  const lower = scanSlice(rawError).trim().toLowerCase();
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
  const text = scanSlice(message);
  return (
    /not a multimodal model/i.test(text) ||
    /does not support images?/i.test(text) ||
    /gemini ACP backend: image capability is not advertised/.test(text)
  );
}

export const AGENT_FAILURE_KINDS = [
  'disk',
  'quota',
  'capacity',
  'provider_network',
  'other',
] as const;
export type AgentFailureKind = (typeof AGENT_FAILURE_KINDS)[number];

const QUOTA_PATTERN =
  /\b402\b|usage[_\s-]?limit|insufficient\s+(?:quota|credit|balance)|(?:quota|credit|balance)\s+is\s+insufficient|quota\s+(?:exceed|exhaust|limit)|credit\s+balance|billing|余额不足|额度(?:不足|用完|耗尽|已用尽)|欠费/i;

const CAPACITY_PATTERN =
  /\b(?:429|529)\b|rate[_\s-]?limit|too\s+many\s+requests|overloaded|请求过于频繁|限流|负载(?:已)?饱和/i;

const NETWORK_PATTERN = /upstream\s+stream\s+disconnected|ETIMEDOUT|temporarily\s+unavailable/i;

export function classifyAgentFailure(message: string): AgentFailureKind {
  const text = scanSlice(message);
  if (text === '') return 'other';
  if (isDiskFullFailure(text)) return 'disk';
  if (QUOTA_PATTERN.test(text)) return 'quota';
  if (CAPACITY_PATTERN.test(text)) return 'capacity';
  if (isConnectionFailure(text) || NETWORK_PATTERN.test(text)) return 'provider_network';
  return 'other';
}

export const RETRY_AFTER_MIN_MS = 5_000;
export const RETRY_AFTER_MAX_MS = 24 * 60 * 60 * 1000;

export const RETRY_FAILURE_CLASSES = ['permanent', 'transient', 'rate_limit', 'unknown'] as const;
export type RetryFailureClass = (typeof RETRY_FAILURE_CLASSES)[number];

export const RETRY_REASON_CODES = [
  'setup_hook',
  'missing_tool',
  'auth',
  'config',
  'model_unavailable',
  'runtime_outdated',
  'gate_rejection',
  'branch_divergence',
  'spend_limit',
  'window_exhausted',
  'retries_exhausted',
  'rate_limit_exhausted',
  'breaker',
  'parked',
  'network',
  'server_error',
  'disk',
  'runner_disconnect',
  'runtime_exited',
  'runtime_startup_timeout',
  'stream_timeout',
  'silent_no_op',
  'rate_limit',
  'quota',
  'unknown',
] as const;
export type RetryReasonCode = (typeof RETRY_REASON_CODES)[number];

export const STEP_FAILURE_CODES = [
  'runtime_exited',
  'runtime_startup_timeout',
  'missing_tool',
  'auth',
  'rate_limit',
  'quota',
  'network',
  'server_error',
  'stream_timeout',
  'silent_no_op',
  'setup_hook',
  'config',
  'model_unavailable',
  'runtime_outdated',
  'gate_rejection',
  'branch_divergence',
  'spend_limit',
  'runner_disconnect',
  'unknown',
] as const;
export type StepFailureCode = (typeof STEP_FAILURE_CODES)[number];

export const stepFailureCodeSchema = z.enum(STEP_FAILURE_CODES);

export const stepFailureDetailSchema = z.object({
  runtime: z.string().max(40).optional(),
  exitCode: z.number().int().optional(),
  signal: z.string().max(24).optional(),
  tool: z.string().max(64).optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type StepFailureDetail = z.infer<typeof stepFailureDetailSchema>;

export const STEP_FAILURE_CLASS_BY_CODE: Readonly<Record<StepFailureCode, RetryFailureClass>> = {
  missing_tool: 'permanent',
  auth: 'permanent',
  setup_hook: 'permanent',
  config: 'permanent',
  model_unavailable: 'permanent',
  runtime_outdated: 'permanent',
  gate_rejection: 'permanent',
  branch_divergence: 'permanent',
  spend_limit: 'permanent',
  rate_limit: 'rate_limit',
  quota: 'rate_limit',
  runtime_exited: 'transient',
  runtime_startup_timeout: 'transient',
  network: 'transient',
  server_error: 'transient',
  stream_timeout: 'transient',
  silent_no_op: 'transient',
  runner_disconnect: 'transient',
  unknown: 'unknown',
};

export function failureClassForCode(code: StepFailureCode): RetryFailureClass {
  return STEP_FAILURE_CLASS_BY_CODE[code];
}

export interface RetryFailureClassification {
  failureClass: RetryFailureClass;
  reasonCode: RetryReasonCode;
  retryAfterMs: number | null;
  resetAt: number | null;
}

const GATE_REJECTION_MARKS = [
  '方案结构不合格',
  '规划未产出方案',
  '信息卡未产出报告',
  '偏离工作分支',
  '构建零改动',
  '转人工处理',
  '死循环闸',
  '请人工复核',
] as const;

const MISSING_CREDENTIAL_MARKS = [
  'no team secret is available',
  'api key is missing',
  'api key is not configured',
  'gemini login',
  'reconnect github',
  '重新连接 github',
  '未配置模型',
  '尚未上报模型清单',
  '未启用',
  'not logged in',
  'please run /login',
  'bad credentials',
  'permission denied (publickey)',
  'could not read username',
  'permission_error',
] as const;

const SPEND_LIMIT_MARKS = [
  'spending limit',
  'spend limit',
  'billing hard limit',
  'monthly budget exceeded',
  'hard limit reached',
] as const;

const SETUP_HOOK_RE =
  /\b(?:workspace\s+hook|setup\s+hook|pre-commit\s+hook|post-checkout\s+hook)\b|\.agents\/setup\b|\bhook\s+[^\n]{0,200}\bexited\b/i;

const MISSING_TOOL_RE =
  /\bcommand not found\b|\bspawn\s+\S{1,120}\s+enoent\b|\benoent\b[^\n]{0,200}\b(?:bin|command|spawn)\b|\bexecutable file not found\b|\bnot found in path\b|\bcannot find module\b|\bis not recognized as an internal or external command\b|\bmissing required tool\b|\bcorepack:\s*(?:command\s+)?not found\b/i;

const CONFIG_ERROR_RE =
  /\binvalid_request_error\b|\bbad protocol\b|\bdoes not support this protocol\b|\binvalid config(?:uration)?\b|\bmissing environment variable\b|\benv(?:ironment)?\s+var(?:iable)?\s+\S+\s+(?:is\s+)?not set\b|\bunable to verify the first certificate\b|\bself-signed certificate\b|\bcert_has_expired\b|\berr_tls_cert_altname_invalid\b|\bcontext_length_exceeded\b|\bmaximum context length\b|\bcontext length exceeded\b|\bprompt is too long\b/i;

const RUNNER_DISCONNECT_MARKS = [
  '这一轮已经结束，但任务没有收到结果',
  'runner disconnected',
  'machine went offline',
  'machine disconnected',
  'heartbeat timed out',
  'claim expired',
  'worker disconnected',
  'runner offline',
  'daemon disconnected',
  'abandoned step',
  'step timed out',
] as const;

const TRANSIENT_NETWORK_RE =
  /\b(?:etimedout|econnreset|econnrefused|epipe|ehostunreach|enetunreach|eai_again|enotfound|tls handshake timeout|gateway timeout|timed out|socket closed|premature close|unexpected eof|body timeout|headers timeout|connection aborted)\b/i;

const TRANSIENT_5XX_RE =
  /(?:^|[^\d])(?:500|502|503|504|520|521|522|524)(?:[^\d]|$)|\b(?:internal server error|bad gateway|service unavailable|gateway timeout|temporarily unavailable)\b/i;

const HTTP_401_403_AUTH_RE =
  /\b401\s+unauthorized\b|\bhttp\s+401\b|\bstatus\s*(?:[:=]\s*)?401\b|\b403\s+forbidden\b/i;

const MISSING_COMMAND_PATTERNS: readonly RegExp[] = [
  /missing command[:\s]+['"]?([^\s'"():]+)['"]?/i,
  /line\s+\d+:\s*['"]?([^\s:'"]+)['"]?:\s*(?:command\s+)?not found/i,
  /:\s*\d+:\s*['"]?([^\s:'"]+)['"]?:\s*(?:command\s+)?not found/i,
  /command not found:\s*['"]?([^\s:'"]+)['"]?/i,
  /unknown command:\s*['"]?([^\s:'"]+)['"]?/i,
  /\benv:\s*['"]?([^\s:'"]+)['"]?:\s*No such file or directory/i,
  /The term\s+['"]([^'"]+)['"]\s+is not recognized/i,
  /['"]([^'"]+)['"]\s+is not recognized as an internal or external command/i,
];

const NOT_FOUND_AFTER_COLON_RE = /:\s*(?:command\s+)?not found/gi;
const COMMAND_TOKEN_BREAK = /[\s:'"]/;
const LINE_OR_DASH = /[\n—–-]/;

function isQuote(char: string): boolean {
  return char === "'" || char === '"';
}

function bareNotFoundCommand(text: string): string | undefined {
  for (const suffix of text.matchAll(NOT_FOUND_AFTER_COLON_RE)) {
    let end = suffix.index;
    if (isQuote(text.charAt(end - 1))) end--;
    let start = end;
    while (start > 0 && !COMMAND_TOKEN_BREAK.test(text.charAt(start - 1))) start--;
    if (start === end) continue;
    let before = isQuote(text.charAt(start - 1)) ? start - 1 : start;
    let startsLine = false;
    while (before > 0 && /\s/.test(text.charAt(before - 1))) {
      startsLine ||= text.charAt(before - 1) === '\n';
      before--;
    }
    const token = text.slice(start, end);
    if (startsLine || before === 0 || LINE_OR_DASH.test(text.charAt(before - 1))) return token;
    const dash = token.search(LINE_OR_DASH);
    if (dash >= 0 && dash < token.length - 1) return token.slice(dash + 1);
  }
  return undefined;
}

const PLAUSIBLE_COMMAND_NAME = /^[A-Za-z0-9._@/+:-]{1,100}$/;
const SHELL_SCRIPT_NAMES = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'setup', 'resume']);

export function missingSetupCommand(text: string): string | null {
  if (text.trim() === '') return null;
  const captures = [
    ...MISSING_COMMAND_PATTERNS.map((pattern) => () => pattern.exec(text)?.[1]),
    () => bareNotFoundCommand(text),
  ];
  for (const capture of captures) {
    const raw = capture()?.trim();
    if (raw === undefined || raw === '') continue;
    const cleaned = trimEndChars(trimStartChars(raw, '\'"`'), '\'"`,;.)');
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

export function parseRetryAfterMs(rawText: string): number | null {
  const text = scanSlice(rawText);
  const match =
    /retry[ _-]?after[ \t:=]+(\d+)(?:[ \t]*(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b)?/i.exec(
      text,
    );
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2]?.toLowerCase() ?? 's';
  const multiplier =
    unit === 'ms' || unit.startsWith('milli') || unit.startsWith('msec')
      ? 1
      : unit.startsWith('m')
        ? 60_000
        : unit.startsWith('h')
          ? 3_600_000
          : 1_000;
  const ms = value * multiplier;
  return ms <= RETRY_AFTER_MAX_MS ? ms : null;
}

export function parseQuotaResetAt(rawText: string, now = Date.now()): number | null {
  const text = scanSlice(rawText);
  const isoMatch =
    /(?:resets?(?:\s+at)?|retry[ _-]?at|available\s+at|until)[\s:=]+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/i.exec(
      text,
    );
  if (isoMatch?.[1] !== undefined) {
    const parsed = Date.parse(isoMatch[1]);
    if (Number.isFinite(parsed) && parsed > now && parsed - now <= RETRY_AFTER_MAX_MS) {
      return parsed;
    }
  }

  const epochMatch = /resets?_?at["'\s:=]+(\d{10,13})\b/i.exec(text);
  if (epochMatch?.[1] !== undefined) {
    const raw = Number(epochMatch[1]);
    const parsed = epochMatch[1].length <= 10 ? raw * 1_000 : raw;
    if (Number.isFinite(parsed) && parsed > now && parsed - now <= RETRY_AFTER_MAX_MS) {
      return parsed;
    }
  }

  const httpDateMatch =
    /retry[ _-]?after[ \t:=]+([A-Za-z]{3},\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT)/i.exec(
      text,
    );
  if (httpDateMatch?.[1] !== undefined) {
    const parsed = Date.parse(httpDateMatch[1]);
    if (Number.isFinite(parsed) && parsed > now && parsed - now <= RETRY_AFTER_MAX_MS) {
      return parsed;
    }
  }

  const clockMatch =
    /(?:resets?(?:\s+at)?|until|after)\s+(\d{1,2})(?::(\d{2}))?[ \t]*(am|pm)?[ \t]*(utc|gmt)?\b/i.exec(
      text,
    );
  if (
    clockMatch?.[1] !== undefined &&
    (clockMatch[2] !== undefined || clockMatch[3] !== undefined)
  ) {
    let hours = Number(clockMatch[1]);
    const minutes = clockMatch[2] !== undefined ? Number(clockMatch[2]) : 0;
    const meridiem = clockMatch[3]?.toLowerCase();
    if (meridiem === 'pm' && hours >= 1 && hours <= 11) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      const candidate = new Date(now);
      if (clockMatch[4] !== undefined) {
        candidate.setUTCHours(hours, minutes, 0, 0);
      } else {
        candidate.setHours(hours, minutes, 0, 0);
      }
      if (candidate.getTime() <= now) {
        candidate.setTime(candidate.getTime() + 24 * 60 * 60 * 1000);
      }
      const ts = candidate.getTime();
      if (ts > now && ts - now <= RETRY_AFTER_MAX_MS) return ts;
    }
  }

  return null;
}

export function parseRetryDelayMs(rawText: string, now = Date.now()): number | null {
  const text = scanSlice(rawText);
  const msHeader = /retry[ _-]?after[ _-]?ms[ \t:=]+(\d+)\b/i.exec(text);
  if (msHeader?.[1] !== undefined) {
    const ms = Number(msHeader[1]);
    if (Number.isFinite(ms) && ms > 0 && ms <= RETRY_AFTER_MAX_MS) return ms;
  }

  const direct = parseRetryAfterMs(text);
  if (direct !== null) return direct;

  const naturalRe =
    /(?:try\s+again|retry|wait|resets?)\s+in\s+(?:(\d+)[ \t]*(?:hours?|hrs?|hr|h)\b[ \t]*)?(?:(\d+)[ \t]*(?:minutes?|mins?|min|m)\b[ \t]*)?(?:(\d+)[ \t]*(milliseconds?|msecs?|ms|seconds?|secs?|sec|s)\b)?/gi;
  for (const natural of text.matchAll(naturalRe)) {
    if (natural[1] === undefined && natural[2] === undefined && natural[3] === undefined) {
      continue;
    }
    const hours = natural[1] !== undefined ? Number(natural[1]) : 0;
    const minutes = natural[2] !== undefined ? Number(natural[2]) : 0;
    const tail = natural[3] !== undefined ? Number(natural[3]) : 0;
    const tailUnit = natural[4]?.toLowerCase() ?? 's';
    const tailMs =
      tailUnit === 'ms' || tailUnit.startsWith('milli') || tailUnit.startsWith('msec')
        ? tail
        : tail * 1_000;
    const total = hours * 3_600_000 + minutes * 60_000 + tailMs;
    if (Number.isFinite(total) && total > 0 && total <= RETRY_AFTER_MAX_MS) return total;
  }

  const resetAt = parseQuotaResetAt(text, now);
  if (resetAt !== null) {
    return Math.max(1_000, Math.min(resetAt - now, RETRY_AFTER_MAX_MS));
  }

  return null;
}

function inferParkedReasonCode(text: string): RetryReasonCode {
  if (runtimeUpdateRequired(text) !== null) return 'runtime_outdated';
  const lower = text.toLowerCase();
  if (lower.includes('model unavailable')) return 'model_unavailable';
  if (
    lower.includes('reconciled with') ||
    lower.includes('remote_branch_diverged') ||
    lower.includes('diverged')
  ) {
    return 'branch_divergence';
  }
  if (SETUP_HOOK_RE.test(text)) return 'setup_hook';
  if (MISSING_TOOL_RE.test(text)) return 'missing_tool';
  if (lower.includes('spend limit') || lower.includes('spending limit')) return 'spend_limit';
  if (lower.includes('failed builds in one hour')) return 'breaker';
  if (lower.includes('retry window exhausted')) return 'window_exhausted';
  if (lower.includes('rate limit wait exhausted')) return 'rate_limit_exhausted';
  if (lower.includes('automatic retries exhausted')) return 'retries_exhausted';
  if (
    isProviderAuthFailure(text) ||
    lower.includes('authentication') ||
    lower.includes('credential') ||
    lower.includes('api key')
  ) {
    return 'auth';
  }
  if (
    lower.includes('pr auto-fix needs you:') ||
    GATE_REJECTION_MARKS.some((mark) => text.includes(mark))
  ) {
    return 'gate_rejection';
  }
  if (CONFIG_ERROR_RE.test(text) || lower.includes('configuration')) return 'config';
  return 'parked';
}

export function classifyRetryFailure(
  rawError: string,
  now = Date.now(),
): RetryFailureClassification {
  const trimmed = scanSlice(rawError).trim();
  if (trimmed === '') {
    return { failureClass: 'unknown', reasonCode: 'unknown', retryAfterMs: null, resetAt: null };
  }
  if (isDiskFullFailure(trimmed)) {
    return { failureClass: 'permanent', reasonCode: 'disk', retryAfterMs: null, resetAt: null };
  }
  if (trimmed.startsWith(RETRY_PARKED_MARK)) {
    return {
      failureClass: 'permanent',
      reasonCode: inferParkedReasonCode(trimmed),
      retryAfterMs: null,
      resetAt: null,
    };
  }
  if (RUNTIME_UPDATE_REQUIRED_RE.test(trimmed)) {
    return {
      failureClass: 'permanent',
      reasonCode: 'runtime_outdated',
      retryAfterMs: null,
      resetAt: null,
    };
  }

  const stepKind = classifyStepFailure(trimmed);
  if (stepKind === 'model_unavailable') {
    return {
      failureClass: 'permanent',
      reasonCode: 'model_unavailable',
      retryAfterMs: null,
      resetAt: null,
    };
  }
  if (
    trimmed.startsWith('PR Auto-fix needs you:') ||
    GATE_REJECTION_MARKS.some((mark) => trimmed.includes(mark))
  ) {
    return {
      failureClass: 'permanent',
      reasonCode: 'gate_rejection',
      retryAfterMs: null,
      resetAt: null,
    };
  }

  const lower = trimmed.toLowerCase();
  const agentKind = classifyAgentFailure(trimmed);
  const isRateOrQuota =
    stepKind === 'quota' ||
    stepKind === 'capacity' ||
    agentKind === 'quota' ||
    agentKind === 'capacity';

  if (
    isProviderAuthFailure(trimmed) ||
    containsAny(lower, MISSING_CREDENTIAL_MARKS) ||
    (!isRateOrQuota && HTTP_401_403_AUTH_RE.test(lower))
  ) {
    return { failureClass: 'permanent', reasonCode: 'auth', retryAfterMs: null, resetAt: null };
  }
  if (containsAny(lower, SPEND_LIMIT_MARKS)) {
    return {
      failureClass: 'permanent',
      reasonCode: 'spend_limit',
      retryAfterMs: null,
      resetAt: null,
    };
  }
  if (SETUP_HOOK_RE.test(trimmed)) {
    return {
      failureClass: 'permanent',
      reasonCode: 'setup_hook',
      retryAfterMs: null,
      resetAt: null,
    };
  }
  if (MISSING_TOOL_RE.test(trimmed)) {
    return {
      failureClass: 'permanent',
      reasonCode: 'missing_tool',
      retryAfterMs: null,
      resetAt: null,
    };
  }
  if (CONFIG_ERROR_RE.test(trimmed)) {
    return { failureClass: 'permanent', reasonCode: 'config', retryAfterMs: null, resetAt: null };
  }

  if (isRateOrQuota) {
    return {
      failureClass: 'rate_limit',
      reasonCode: stepKind === 'quota' || agentKind === 'quota' ? 'quota' : 'rate_limit',
      ...rateLimitTiming(trimmed, now),
    };
  }

  if (containsAny(lower, RUNNER_DISCONNECT_MARKS)) {
    return {
      failureClass: 'transient',
      reasonCode: 'runner_disconnect',
      retryAfterMs: null,
      resetAt: null,
    };
  }
  if (
    stepKind === 'network' ||
    agentKind === 'provider_network' ||
    TRANSIENT_NETWORK_RE.test(lower)
  ) {
    return { failureClass: 'transient', reasonCode: 'network', retryAfterMs: null, resetAt: null };
  }
  if (
    isProviderOutage(trimmed) ||
    (!GIT_ERROR_PREFIX_RE.test(lower) && TRANSIENT_5XX_RE.test(lower))
  ) {
    return {
      failureClass: 'transient',
      reasonCode: 'server_error',
      retryAfterMs: null,
      resetAt: null,
    };
  }

  return { failureClass: 'unknown', reasonCode: 'unknown', retryAfterMs: null, resetAt: null };
}

function rateLimitTiming(
  text: string,
  now: number,
): Pick<RetryFailureClassification, 'retryAfterMs' | 'resetAt'> {
  const parsedResetAt = parseQuotaResetAt(text, now);
  const parsedDelayMs = parseRetryDelayMs(text, now);
  const retryAfterMs =
    parsedDelayMs ??
    (parsedResetAt !== null
      ? Math.max(1_000, Math.min(parsedResetAt - now, RETRY_AFTER_MAX_MS))
      : null);
  const resetAt = parsedResetAt ?? (retryAfterMs !== null ? now + retryAfterMs : null);
  return { retryAfterMs, resetAt };
}

export function classifyRetryFailureWithCode(
  rawError: string,
  code: StepFailureCode | null | undefined,
  now = Date.now(),
): RetryFailureClassification {
  if (isDiskFullFailure(rawError)) {
    return { failureClass: 'permanent', reasonCode: 'disk', retryAfterMs: null, resetAt: null };
  }
  if (code == null) return classifyRetryFailure(rawError, now);
  const failureClass = failureClassForCode(code);
  if (failureClass === 'rate_limit') {
    const trimmed = scanSlice(rawError).trim();
    return { failureClass, reasonCode: code, ...rateLimitTiming(trimmed, now) };
  }
  return { failureClass, reasonCode: code, retryAfterMs: null, resetAt: null };
}
