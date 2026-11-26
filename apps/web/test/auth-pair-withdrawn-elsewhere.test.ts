import { afterEach, describe, expect, test, vi } from 'vitest';
import { authSnapshot, ensurePairRequest, requestNewPairAttempt } from '../src/api/auth.js';

const CLAIM_WAIT = { timeout: 5_000 };

function fakeServer(claimStatus: 'expired' | 'denied', sessionStatus: number) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input);
    calls.push(path);
    if (path === '/api/remote/pair/request') {
      return Response.json(
        { id: 'own-request', secret: 's', code: 'ABCD1234', expiresAt: Date.now() + 60_000 },
        { status: 201 },
      );
    }
    if (path === '/api/remote/pair/claim') return Response.json({ status: claimStatus });
    return new Response(null, { status: sessionStatus });
  });
  return calls;
}

const count = (calls: string[], path: string) => calls.filter((call) => call === path).length;

describe('a sign-in screen whose pairing request the server withdrew', () => {
  afterEach(() => {
    requestNewPairAttempt();
    vi.restoreAllMocks();
  });

  for (const status of ['expired', 'denied'] as const) {
    test(`closes when the claim answers ${status} and the browser is signed in`, async () => {
      fakeServer(status, 204);
      ensurePairRequest();
      await vi.waitFor(() => expect(authSnapshot().pair?.phase).toBe('pending'));
      await vi.waitFor(() => expect(authSnapshot().pair).toBeNull(), CLAIM_WAIT);
      expect(authSnapshot().gateOpen).toBe(false);
    });
  }

  for (const sessionStatus of [401, 503]) {
    test(`keeps showing expired, asking once, when the session answers ${sessionStatus}`, async () => {
      const calls = fakeServer('expired', sessionStatus);
      ensurePairRequest();
      await vi.waitFor(() => expect(authSnapshot().pair?.phase).toBe('expired'), CLAIM_WAIT);
      await vi.waitFor(() => expect(count(calls, '/api/auth/session')).toBe(1));
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(count(calls, '/api/auth/session')).toBe(1);
      expect(count(calls, '/api/remote/pair/request')).toBe(1);
      expect(authSnapshot().retrying).toBe(false);
    });
  }
});
