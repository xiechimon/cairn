import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';

const ACCESS = '/api/auth/access';
const SESSION = '/api/auth/session';
const TEAMS = '/api/teams';

function onPage(hostname = 'app.example.com') {
  vi.stubGlobal('window', { location: new URL(`https://${hostname}/app`) });
}

function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

afterEach(() => vi.unstubAllGlobals());

it('shares Access recovery and confirms the new cookie before retrying the requests', async () => {
  onPage();
  let finishAccess!: (response: Response) => void;
  const access = new Promise<Response>((resolve) => {
    finishAccess = resolve;
  });
  let probes = 0;
  let requests = 0;
  const fetch = vi.fn(async (path: string) => {
    if (path === ACCESS) return access;
    if (path === SESSION) return ++probes === 1 ? unauthorized() : new Response(null, { status: 204 });
    return ++requests <= 2 ? unauthorized() : Response.json([]);
  });
  vi.stubGlobal('fetch', fetch);

  const first = api.get(TEAMS);
  await vi.waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(ACCESS, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    }),
  );
  const second = api.get(TEAMS);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([TEAMS, SESSION, ACCESS, TEAMS]);
  finishAccess(Response.json({ ok: true }));
  await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([
    TEAMS, SESSION, ACCESS, TEAMS, SESSION, TEAMS, TEAMS,
  ]);
});

it.each([401, 403, 404, 503, 'network'] as const)('does not retry if Access fails with %s', async (failure) => {
  onPage();
  const fetch = vi.fn(async (path: string) => {
    if (path !== ACCESS) return unauthorized();
    if (failure === 'network') throw new TypeError('network down');
    return new Response(null, { status: failure });
  });
  vi.stubGlobal('fetch', fetch);
  await expect(api.get(TEAMS)).rejects.toMatchObject({ status: 401 });
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([TEAMS, SESSION, ACCESS]);
});

it('does not exchange Access on loopback', async () => {
  onPage('127.0.0.1');
  const fetch = vi.fn(async (_path: string) => unauthorized());
  vi.stubGlobal('fetch', fetch);
  await expect(api.get(TEAMS)).rejects.toMatchObject({ status: 401 });
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([TEAMS, SESSION]);
});
