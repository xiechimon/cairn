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
  const ok = { state: 'ok', lastCheck: null } as const;

  it('shows one status: verifying replaces available', () => {
    expect(accountStatusOf(ok, { phase: 'verifying' })).toEqual({ kind: 'verifying' });
  });

  it('shows the failure and its reason instead of available', () => {
    expect(accountStatusOf(ok, { phase: 'failed', reason: 'network' })).toEqual({
      kind: 'verify-failed',
      reason: 'network',
    });
  });

  it('never calls an unchecked account available', () => {
    expect(accountStatusOf(ok, undefined)).toEqual({ kind: 'unverified' });
  });

  it('reads the stored check when this page has not verified', () => {
    const check = {
      at: 1,
      ok: true,
      reason: null,
      check: 'model-request',
      command: 'claude -p',
      model: null,
      durationMs: 10,
    } as const;
    expect(accountStatusOf({ state: 'ok', lastCheck: check }, undefined)).toEqual({
      kind: 'verified',
      at: 1,
    });
    expect(
      accountStatusOf({ state: 'ok', lastCheck: { ...check, ok: false, reason: 'auth' } }, undefined),
    ).toEqual({ kind: 'verify-failed', reason: 'auth' });
    expect(accountStatusOf({ state: 'ok', lastCheck: null }, { phase: 'passed' })).toEqual({
      kind: 'verified',
      at: null,
    });
  });

  it('keeps the account state when it is not ok', () => {
    expect(accountStatusOf({ state: 'cooling', lastCheck: null }, undefined)).toEqual({
      kind: 'account',
      state: 'cooling',
    });
  });

  it('a passed check leaves the summary to the account, so an exhausted account stays exhausted', () => {
    expect(accountStatusOf({ state: 'exhausted', lastCheck: null }, { phase: 'passed' })).toEqual({
      kind: 'account',
      state: 'exhausted',
    });
  });

  it('keeps an expired account expired, not a stale verification failure', () => {
    expect(accountStatusOf({ state: 'expired', lastCheck: null }, { phase: 'failed', reason: 'auth' })).toEqual({
      kind: 'account',
      state: 'expired',
    });
  });
});
