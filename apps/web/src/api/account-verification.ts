import type { ClaudeSubscriptionVerifyResult } from '@cairn/shared';
import type { AccountState } from './claude-accounts.js';
import { ApiError } from './client.js';

export const VERIFY_FAILURES = [
  'auth',
  'timeout',
  'unavailable',
  'failed',
  'network',
  'rate-limited',
] as const;
export type VerifyFailure = (typeof VERIFY_FAILURES)[number];

export type Verification = { phase: 'verifying' } | { phase: 'failed'; reason: VerifyFailure };

export type VerifyOutcome = { ok: true } | { ok: false; reason: VerifyFailure };

export type AccountStatus =
  | { kind: 'verifying' }
  | { kind: 'verify-failed'; reason: VerifyFailure }
  | { kind: 'account'; state: AccountState };

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
  post: () => Promise<ClaudeSubscriptionVerifyResult>,
  timeoutMs: number = VERIFY_TIMEOUT_MS,
): Promise<VerifyOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<VerifyOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
  });
  const attempt = post().then(
    (result): VerifyOutcome =>
      result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'failed' },
    (error): VerifyOutcome => ({ ok: false, reason: failureReason(error) }),
  );
  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function accountStatusOf(
  account: { state: AccountState },
  verification: Verification | undefined,
): AccountStatus {
  if (verification?.phase === 'verifying') return { kind: 'verifying' };
  if (account.state === 'expired') return { kind: 'account', state: 'expired' };
  if (verification?.phase === 'failed') {
    return { kind: 'verify-failed', reason: verification.reason };
  }
  return { kind: 'account', state: account.state };
}
