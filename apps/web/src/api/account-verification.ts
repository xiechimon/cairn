import type { SubscriptionCheck } from '@cairn/shared';
import type { AccountState } from './claude-accounts.js';
import { ApiError } from './client.js';

export const VERIFY_FAILURES = [
  'auth',
  'timeout',
  'unavailable',
  'quota',
  'failed',
  'network',
  'rate-limited',
  'missing_local_login',
] as const;
export type VerifyFailure = (typeof VERIFY_FAILURES)[number];

export type Verification =
  | { phase: 'verifying' }
  | { phase: 'passed'; check?: SubscriptionCheck }
  | { phase: 'failed'; reason: VerifyFailure; check?: SubscriptionCheck };

export type VerifyOutcome =
  | { ok: true; check?: SubscriptionCheck }
  | { ok: false; reason: VerifyFailure; check?: SubscriptionCheck };

export function verificationOf(outcome: VerifyOutcome): Verification {
  const check = outcome.check === undefined ? {} : { check: outcome.check };
  return outcome.ok
    ? { phase: 'passed', ...check }
    : { phase: 'failed', reason: outcome.reason, ...check };
}

export type AccountStatus =
  | { kind: 'verifying' }
  | { kind: 'unverified' }
  | { kind: 'verified'; at: number | null }
  | { kind: 'verify-failed'; reason: VerifyFailure }
  | { kind: 'account'; state: Exclude<AccountState, 'ok'> };

export const VERIFY_TIMEOUT_MS = 45_000;

const GATEWAY_STATUSES: readonly number[] = [502, 503, 504];

function failureReason(error: unknown): VerifyFailure {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'rate-limited';
    return GATEWAY_STATUSES.includes(error.status) ? 'network' : 'failed';
  }
  return 'network';
}

export async function runVerification(
  post: () => Promise<{ ok: boolean; reason?: VerifyFailure; check?: SubscriptionCheck }>,
  timeoutMs: number = VERIFY_TIMEOUT_MS,
): Promise<VerifyOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<VerifyOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
  });
  const attempt = post().then(
    (result): VerifyOutcome => {
      const check = result.check === undefined ? {} : { check: result.check };
      return result.ok
        ? { ok: true, ...check }
        : { ok: false, reason: result.reason ?? 'failed', ...check };
    },
    (error): VerifyOutcome => ({ ok: false, reason: failureReason(error) }),
  );
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
