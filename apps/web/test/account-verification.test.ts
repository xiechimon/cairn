import { describe, expect, it, vi } from 'vitest';
import { accountStatusOf, runVerification } from '../src/api/account-verification.js';
import { ApiError } from '../src/api/client.js';

describe('runVerification', () => {
  it('passes when the server says ok', async () => {
    expect(await runVerification(async () => ({ ok: true }))).toEqual({ ok: true });
  });

  it('keeps the reason the server gives', async () => {
    expect(await runVerification(async () => ({ ok: false, reason: 'auth' }))).toEqual({
      ok: false,
      reason: 'auth',
    });
  });

  it('fails with a generic reason when the server gives none', async () => {
    expect(await runVerification(async () => ({ ok: false }))).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('turns a dropped connection into a retryable network failure', async () => {
    const outcome = await runVerification(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(outcome).toEqual({ ok: false, reason: 'network' });
  });

  it.each([502, 503, 504])('treats a %i while the server restarts as a network failure', async (status) => {
    const outcome = await runVerification(() =>
      Promise.reject(new ApiError(status, 'Bad Gateway')),
    );
    expect(outcome).toEqual({ ok: false, reason: 'network' });
  });

  it('reports the 10 second window as rate-limited', async () => {
    const outcome = await runVerification(() => Promise.reject(new ApiError(429, 'Please wait')));
    expect(outcome).toEqual({ ok: false, reason: 'rate-limited' });
  });

  it('never stays verifying when the request hangs', async () => {
    vi.useFakeTimers();
    try {
      const pending = runVerification(() => new Promise(() => {}), 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toEqual({ ok: false, reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('accountStatusOf', () => {
  const ok = { state: 'ok' } as const;

  it('shows one status: verifying replaces available', () => {
    expect(accountStatusOf(ok, { phase: 'verifying' })).toEqual({ kind: 'verifying' });
  });

  it('shows the failure and its reason instead of available', () => {
    expect(accountStatusOf(ok, { phase: 'failed', reason: 'network' })).toEqual({
      kind: 'verify-failed',
      reason: 'network',
    });
  });

  it('falls back to the account state when nothing is being verified', () => {
    expect(accountStatusOf(ok, undefined)).toEqual({ kind: 'account', state: 'ok' });
    expect(accountStatusOf({ state: 'cooling' }, undefined)).toEqual({
      kind: 'account',
      state: 'cooling',
    });
  });

  it('keeps an expired account expired, not a stale verification failure', () => {
    expect(accountStatusOf({ state: 'expired' }, { phase: 'failed', reason: 'auth' })).toEqual({
      kind: 'account',
      state: 'expired',
    });
  });
});
