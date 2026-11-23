import { afterEach, expect, test, vi } from 'vitest';
import { redeemPairingCode, useAuth } from '../src/api/auth.js';
import { api } from '../src/api/client.js';

vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

afterEach(() => vi.unstubAllGlobals());

test('the private computer cache changes scope only at gate boundaries and confirmed Access replacement', async () => {
  vi.stubGlobal('window', { location: new URL('https://cairn.test/app') });
  vi.stubGlobal('navigator', {});
  let hasCookie = false;
  let allowAccess = true;
  const unauthorized = () => Response.json({}, { status: 401 });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/api/auth/session') {
      return hasCookie ? new Response(null, { status: 204 }) : unauthorized();
    }
    if (path === '/api/auth/access') {
      if (!allowAccess) return unauthorized();
      hasCookie = true;
      return Response.json({ ok: true });
    }
    if (path === '/api/remote/pair') hasCookie = true;
    if (path === '/api/teams' && !hasCookie) return unauthorized();
    return Response.json([]);
  }));

  const initial = useAuth();
  await expect(api.get('/api/teams')).resolves.toEqual([]);
  const replacement = useAuth();
  expect(replacement).toEqual({ ...initial, generation: initial.generation + 1 });
  await expect(api.get('/api/teams')).resolves.toEqual([]);
  expect(useAuth()).toBe(replacement);

  hasCookie = false;
  allowAccess = false;
  await expect(api.get('/api/teams')).rejects.toMatchObject({ status: 401 });
  const gated = useAuth();
  expect(gated).toEqual({ ...replacement, gateOpen: true, generation: replacement.generation + 1 });

  const pairing = redeemPairingCode('test-code');
  expect(useAuth()).toEqual({ ...gated, pairing: true });
  await expect(pairing).resolves.toBe(true);
  expect(useAuth()).toEqual({ ...initial, generation: gated.generation + 1 });
});
