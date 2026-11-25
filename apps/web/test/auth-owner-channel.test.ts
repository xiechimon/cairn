import { afterEach, describe, expect, test, vi } from 'vitest';
import { signInWithOwnerToken } from '../src/api/auth.js';

describe('signInWithOwnerToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('maps 403 owner-channel-required distinctly from invalid tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'owner channel required', code: 'owner-channel-required' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );
    expect(await signInWithOwnerToken('valid-token')).toBe('owner-channel-required');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'owner token required' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await signInWithOwnerToken('device-token')).toBe('invalid');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await signInWithOwnerToken('wrong-token')).toBe('invalid');
  });
});
