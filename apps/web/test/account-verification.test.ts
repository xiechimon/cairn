import { describe, expect, it, vi } from 'vitest';
import { runVerification } from '../src/api/account-verification.js';
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

  it('a residual 403 is still not a verification result', async () => {
    const outcome = await runVerification(() =>
      Promise.reject(new ApiError(403, 'only the owner token can do this')),
    );
    expect(outcome).toEqual({ phase: 'not-run', cause: 'error' });
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
