import { describe, expect, it, vi } from 'vitest';
import { accountStatusOf, runVerification } from '../src/api/account-verification.js';
import { ApiError } from '../src/api/client.js';

describe('runVerification', () => {
  it('passes when the server says ok', async () => {
    expect(await runVerification(async () => ({ ok: true }))).toEqual({ phase: 'passed' });
  });

  it('keeps the reason the server gives', async () => {
    expect(await runVerification(async () => ({ ok: false, reason: 'auth' }))).toEqual({
      phase: 'failed',
      reason: 'auth',
    });
  });

  it('fails with a generic reason when the server gives none', async () => {
    expect(await runVerification(async () => ({ ok: false }))).toEqual({
      phase: 'failed',
      reason: 'failed',
    });
  });

  it('a 403 refusal is not a verification result', async () => {
    const outcome = await runVerification(() =>
      Promise.reject(new ApiError(403, 'only the owner token can do this')),
    );
    expect(outcome).toEqual({ phase: 'not-run', cause: 'forbidden' });
  });

  it('a 401 means this device is signed out, not that the check failed', async () => {
    const outcome = await runVerification(() => Promise.reject(new ApiError(401, 'Unauthorized')));
    expect(outcome).toEqual({ phase: 'not-run', cause: 'signed-out' });
  });

  it('a dropped connection is not a verification result', async () => {
    const outcome = await runVerification(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(outcome).toEqual({ phase: 'not-run', cause: 'network' });
  });

  it.each([502, 503, 504])('a %i while the server restarts is not a verification result', async (status) => {
    const outcome = await runVerification(() =>
      Promise.reject(new ApiError(status, 'Bad Gateway')),
    );
    expect(outcome).toEqual({ phase: 'not-run', cause: 'network' });
  });

  it('the 10 second window means the check did not run', async () => {
    const outcome = await runVerification(() => Promise.reject(new ApiError(429, 'Please wait')));
    expect(outcome).toEqual({ phase: 'not-run', cause: 'rate-limited' });
  });

  it('a server error means the check did not run', async () => {
    const outcome = await runVerification(() => Promise.reject(new ApiError(500, 'boom')));
    expect(outcome).toEqual({ phase: 'not-run', cause: 'error' });
  });

  it('never stays verifying when the request hangs', async () => {
    vi.useFakeTimers();
    try {
      const pending = runVerification(() => new Promise(() => {}), 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toEqual({ phase: 'failed', reason: 'timeout' });
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
    expect(accountStatusOf(ok, { phase: 'failed', reason: 'auth' })).toEqual({
      kind: 'verify-failed',
      reason: 'auth',
    });
  });

  it('a check that did not run keeps the stored status', () => {
    const passed = {
      at: 1,
      ok: true,
      reason: null,
      check: 'model-request',
      command: 'claude -p',
      model: null,
      durationMs: 10,
    } as const;
    expect(
      accountStatusOf({ state: 'ok', lastCheck: passed }, { phase: 'not-run', cause: 'forbidden' }),
    ).toEqual({ kind: 'verified', at: 1 });
    expect(accountStatusOf(ok, { phase: 'not-run', cause: 'network' })).toEqual({
      kind: 'unverified',
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
