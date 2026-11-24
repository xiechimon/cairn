import type { DesktopUpdateState } from '@cairn/shared';

const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENETDOWN',
  'EHOSTDOWN',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ERR_INTERNET_DISCONNECTED',
]);

const NETWORK_ERROR_PATTERN =
  /net::ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|ADDRESS_UNREACHABLE|CONNECTION_TIMED_OUT|CONNECTION_RESET|CONNECTION_CLOSED|TIMED_OUT|PROXY_CONNECTION_FAILED)/;

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inspectNetworkError(error: unknown, depth: number): boolean {
  if (depth > 5 || error === null || error === undefined) return false;
  if (typeof error === 'string') return NETWORK_ERROR_PATTERN.test(error);
  if (typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  if (typeof candidate.code === 'string' && NETWORK_ERROR_CODES.has(candidate.code)) return true;
  if (typeof candidate.message === 'string') {
    if (NETWORK_ERROR_PATTERN.test(candidate.message)) return true;
    if (candidate.name === 'TypeError' && candidate.message === 'fetch failed') return true;
  }
  if (Array.isArray(candidate.errors)) {
    for (const inner of candidate.errors) {
      if (inspectNetworkError(inner, depth + 1)) return true;
    }
  }
  return inspectNetworkError(candidate.cause, depth + 1);
}

export function isNetworkUnavailableError(error: unknown): boolean {
  return inspectNetworkError(error, 0);
}

export function updateFailureState(
  error: unknown,
  stagedVersion: string | null,
): DesktopUpdateState {
  if (isNetworkUnavailableError(error)) {
    return stagedVersion === null
      ? { status: 'offline' }
      : { status: 'ready', version: stagedVersion };
  }
  return { status: 'error', message: messageOf(error) };
}
