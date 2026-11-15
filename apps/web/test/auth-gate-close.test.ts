import { afterEach, describe, expect, it, vi } from 'vitest';
import { authSnapshot, demandGate, passGate } from '../src/api/auth.js';
import { api } from '../src/api/client.js';

afterEach(() => {
  passGate();
  vi.unstubAllGlobals();
});

describe('the sign-in gate', () => {
  it('a request that succeeds closes a gate an earlier request opened', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    demandGate();
    expect(authSnapshot().gateOpen).toBe(true);
    await api.get('/api/teams');
    expect(authSnapshot().gateOpen).toBe(false);
  });

  it('closing the gate after a success bumps the generation so signed-out queries refetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    demandGate();
    const opened = authSnapshot().generation;
    await api.get('/api/teams');
    expect(authSnapshot().generation).toBeGreaterThan(opened);
  });
});
