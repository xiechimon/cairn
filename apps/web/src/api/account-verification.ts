import type { SubscriptionCheck } from '@cairn/shared';
import type { AccountState } from './claude-accounts.js';
import { ApiError } from './client.js';

export const VERIFY_FAILURES = [
  'auth',
  'timeout',
  'unavailable',
  'quota',
  'failed',
  'missing_local_login',
] as const;
export type VerifyFailure = (typeof VERIFY_FAILURES)[number];

export type VerifyNotRun = 'forbidden' | 'signed-out' | 'network' | 'rate-limited' | 'error';

export type Verification =
  | { phase: 'verifying' }
  | { phase: 'passed'; check?: SubscriptionCheck }
  | { phase: 'failed'; reason: VerifyFailure; check?: SubscriptionCheck }
  | { phase: 'not-run'; cause: VerifyNotRun };

export type VerifyOutcome = Exclude<Verification, { phase: 'verifying' }>;

export type AccountStatus =
  | { kind: 'verifying' }
  | { kind: 'unverified' }
  | { kind: 'verified'; at: number | null }
  | { kind: 'verify-failed'; reason: VerifyFailure }
  | { kind: 'account'; state: Exclude<AccountState, 'ok'> };

export const VERIFY_TIMEOUT_MS = 45_000;

const GATEWAY_STATUSES: readonly number[] = [502, 503, 504];
export const isPermissionRefusal = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403;

function requestFailure(error: unknown): VerifyOutcome {
  if (isPermissionRefusal(error)) return { phase: 'not-run', cause: 'forbidden' };
  if (!(error instanceof ApiError)) return { phase: 'not-run', cause: 'network' };
  if (error.status === 401) return { phase: 'not-run', cause: 'signed-out' };
  if (error.status === 429) return { phase: 'not-run', cause: 'rate-limited' };
  if (GATEWAY_STATUSES.includes(error.status)) return { phase: 'not-run', cause: 'network' };
  return { phase: 'not-run', cause: 'error' };
}

export async function runVerification(
  post: () => Promise<{ ok: boolean; reason?: VerifyFailure; check?: SubscriptionCheck }>,
  timeoutMs: number = VERIFY_TIMEOUT_MS,
): Promise<VerifyOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<VerifyOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ phase: 'failed', reason: 'timeout' }), timeoutMs);
  });
  const attempt = post().then((result): VerifyOutcome => {
    const check = result.check === undefined ? {} : { check: result.check };
    return result.ok
      ? { phase: 'passed', ...check }
      : { phase: 'failed', reason: result.reason ?? 'failed', ...check };
  }, requestFailure);
  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const isVerifyFailure = (value: string | null): value is VerifyFailure =>
  (VERIFY_FAILURES as readonly (string | null)[]).includes(value);

export function accountStatusOf(
  account: { state: AccountState; lastCheck: SubscriptionCheck | null },
  verification: Verification | undefined,
): AccountStatus {
  if (verification?.phase === 'verifying') return { kind: 'verifying' };
  if (account.state !== 'ok') return { kind: 'account', state: account.state };
  if (verification?.phase === 'failed') {
    return { kind: 'verify-failed', reason: verification.reason };
  }
  const check = account.lastCheck;
  if (verification?.phase === 'passed')
    return { kind: 'verified', at: check?.ok ? check.at : null };
  if (check === null) return { kind: 'unverified' };
  if (check.ok) return { kind: 'verified', at: check.at };
  return { kind: 'verify-failed', reason: isVerifyFailure(check.reason) ? check.reason : 'failed' };
}
