import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { expect, it, onTestFinished, vi } from 'vitest';
import type { AppContext } from '../src/context.js';
import { registerTokenAuth } from '../src/lib/token-auth.js';
import { registerCoreRoutes } from '../src/routes-core.js';
import { AUTH_COOKIE, type ResolvedBrowserSession } from '../src/services/browser-session.js';
import { issuePairingGrant } from '../src/services/paired-devices.js';
import { bootServer } from './helpers.js';

const PATH = '/api/auth/session';
const browserHeaders = { 'x-cairn-browser-auth': '1' };
const DIRECT_PEER = '192.0.2.15';
const tlsForwarded = { 'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin' };

async function listenHttp(app: Hono, peer?: string): Promise<string> {
  const handle = getRequestListener(app.fetch);
  const server = createServer((incoming, outgoing) => {
    if (peer !== undefined)
      Object.defineProperty(incoming.socket, 'remoteAddress', { value: peer });
    return handle(incoming, outgoing);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('HTTP listener did not bind');
  return `http://127.0.0.1:${address.port}`;
}

function browserServer(accessVerifier?: AppContext['accessVerifier']) {
  const dir = tmpdir();
  return bootServer({
    authToken: 'owner-fixture',
    reposDir: dir,
    attachmentsDir: dir,
    skillsDir: dir,
    skillSourcesPath: join(dir, 'unused-browser-session-test-sources.json'),
    webDir: null,
    ...(accessVerifier === undefined ? {} : { accessVerifier }),
  });
}

function sessionRoutes(
  authEnabled: boolean,
  resolveSession = (cookie: string): ResolvedBrowserSession | null => {
    if (cookie === 'owner-fixture-session') return { kind: 'owner', deviceId: null };
    if (cookie === 'external-fixture-session') return { kind: 'external', deviceId: null };
    if (cookie === 'device-fixture-session') return { kind: 'device', deviceId: 'device-fixture' };
    return null;
  },
) {
  const app = new Hono();
  registerTokenAuth(app, authEnabled ? 'owner-fixture' : null, { resolveSession });
  registerCoreRoutes(app, { user: { id: 'user-fixture' } } as AppContext);
  return app;
}

it.each(['owner', 'external', 'device'])(
  'reports an accepted %s cookie without data or writes',
  async (kind) => {
    const response = await sessionRoutes(true).request(PATH, {
      headers: { ...browserHeaders, cookie: `${AUTH_COOKIE}=${kind}-fixture-session` },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('');
  },
);

it('leaves missing and expired cookies unauthorized', async () => {
  const app = sessionRoutes(true);
  for (const headers of [browserHeaders, { ...browserHeaders, cookie: `${AUTH_COOKIE}=expired` }]) {
    const response = await app.request(PATH, { headers });
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('');
  }
});

it('reports the browser can proceed when auth is off', async () => {
  const response = await sessionRoutes(false).request(PATH, { headers: browserHeaders });
  expect(response.status).toBe(204);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('set-cookie')).toBeNull();
});

const unprovenRequests: [string, Record<string, string>][] = [
  ['no proof', {}],
  ['matching Origin without the custom header', { origin: 'http://localhost' }],
  ['same-origin Fetch Metadata without the custom header', { 'sec-fetch-site': 'same-origin' }],
  ['wrong custom header value', { 'x-cairn-browser-auth': '0', origin: 'http://localhost' }],
  ['foreign Origin', { ...browserHeaders, origin: 'https://other.test' }],
  [
    'foreign Origin with same-origin Fetch Metadata',
    { ...browserHeaders, origin: 'https://other.test', 'sec-fetch-site': 'same-origin' },
  ],
  ['opaque Origin', { ...browserHeaders, origin: 'null', 'sec-fetch-site': 'same-origin' }],
  ['cross-site Fetch Metadata', { ...browserHeaders, 'sec-fetch-site': 'cross-site' }],
  ['same-site Fetch Metadata', { ...browserHeaders, 'sec-fetch-site': 'same-site' }],
  ['navigation Fetch Metadata', { ...browserHeaders, 'sec-fetch-site': 'none' }],
];

it.each(unprovenRequests)('denies a session probe with %s', async (_scenario, headers) => {
  const resolveSession = vi.fn((): ResolvedBrowserSession => ({ kind: 'owner', deviceId: null }));
  for (const [authEnabled, cookie] of [
    [true, `${AUTH_COOKIE}=owner-fixture-session`],
    [true, `${AUTH_COOKIE}=expired`],
    [false, ''],
  ] as const) {
    const response = await sessionRoutes(authEnabled, resolveSession).request(PATH, {
      headers: { ...headers, cookie },
    });
    expect.soft(response.status).toBe(403);
    expect.soft(response.headers.get('cache-control')).toBe('no-store');
    expect.soft(response.headers.get('set-cookie')).toBeNull();
    expect.soft(await response.text()).toBe('');
  }
  expect(resolveSession).not.toHaveBeenCalled();
});

it('uses the HTTP listener scheme for a direct peer regardless of forwarding headers', async () => {
  const origin = await listenHttp(sessionRoutes(false), DIRECT_PEER);
  const rejected = await fetch(`${origin}${PATH}`, {
    headers: { ...browserHeaders, ...tlsForwarded, origin: origin.replace('http:', 'https:') },
  });
  expect.soft(rejected.status).toBe(403);
  expect.soft(rejected.headers.get('cache-control')).toBe('no-store');
  expect.soft(rejected.headers.get('set-cookie')).toBeNull();
  expect.soft(await rejected.text()).toBe('');
  const accepted = await fetch(`${origin}${PATH}`, {
    headers: { ...browserHeaders, ...tlsForwarded, origin },
  });
  expect(accepted.status).toBe(204);
});

it('accepts a matching HTTPS Origin at a trusted TLS terminator', async () => {
  const origin = await listenHttp(sessionRoutes(false));
  const response = await fetch(`${origin}${PATH}`, {
    headers: { ...browserHeaders, ...tlsForwarded, origin: origin.replace('http:', 'https:') },
  });
  expect(response.status).toBe(204);
});

it('keeps the proxy-facing port when a trusted TLS terminator serves HTTPS on port 80', async () => {
  const origin = await listenHttp(sessionRoutes(false));
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      `${origin}${PATH}`,
      {
        headers: {
          ...browserHeaders,
          ...tlsForwarded,
          host: 'cairn.test:80',
          origin: 'https://cairn.test:80',
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.once('error', reject);
    req.end();
  });
  expect(status).toBe(204);
});

it('does not use the request URL scheme instead of the HTTP listener scheme', async () => {
  const origin = 'https://cairn.test';
  const response = await sessionRoutes(false).request(
    `${origin}${PATH}`,
    { headers: { ...browserHeaders, origin } },
    { incoming: { socket: { remoteAddress: DIRECT_PEER } } },
  );
  expect(response.status).toBe(403);
});

it.each([
  { scenario: 'a direct HTTP peer', peer: DIRECT_PEER, secure: false },
  { scenario: 'a trusted TLS terminator', peer: undefined, secure: true },
])('uses the transport for pairing and Access cookies at $scenario', async ({ peer, secure }) => {
  const { app, db } = browserServer(async () => ({
    kind: 'owner',
    email: 'owner@example.test',
    expiresAt: Date.now() + 60_000,
  }));
  const origin = await listenHttp(app, peer);
  const access = await fetch(`${origin}/api/auth/access`, {
    method: 'POST',
    headers: tlsForwarded,
  });
  expect(access.status).toBe(200);

  const pair = await fetch(`${origin}/api/remote/pair`, {
    method: 'POST',
    headers: { ...browserHeaders, ...tlsForwarded, 'content-type': 'application/json' },
    body: JSON.stringify({ code: issuePairingGrant(db).code, name: 'Fixture browser' }),
  });
  expect(pair.status).toBe(201);
  for (const response of [access, pair]) {
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${AUTH_COOKIE}=`));
    expect(cookie).toBeDefined();
    expect.soft(cookie?.includes('; Secure')).toBe(secure);
    await response.arrayBuffer();
  }
});

it.each<{ scenario: string; headers: Record<string, string>; status: number }>([
  ...unprovenRequests.map(([scenario, headers]) => ({ scenario, headers, status: 403 })),
  {
    scenario: 'an oversized body without proof',
    headers: { 'content-length': '2097153' },
    status: 403,
  },
  {
    scenario: 'an oversized body with proof',
    headers: { ...browserHeaders, 'content-length': '2097153' },
    status: 413,
  },
  {
    scenario: 'a non-JSON body with proof',
    headers: { ...browserHeaders, 'content-type': 'text/plain' },
    status: 415,
  },
])('rejects pairing with $scenario without consuming the grant', async ({ headers, status }) => {
  const { app, db } = browserServer();
  const body = JSON.stringify({ code: issuePairingGrant(db).code, name: 'Fixture browser' });
  const redeem = (proof: Record<string, string>) =>
    app.request('/api/remote/pair', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json', ...proof }),
      body,
    });
  const rejected = await redeem(headers);
  expect.soft(rejected.status).toBe(status);
  expect.soft(rejected.headers.has('set-cookie')).toBe(false);
  if (status === 403) {
    expect.soft(rejected.headers.get('cache-control')).toBe('no-store');
    expect.soft((await rejected.text()).length).toBe(0);
  }
  const accepted = await redeem({
    ...browserHeaders,
    origin: 'http://localhost',
    'sec-fetch-site': 'same-origin',
  });
  expect(accepted.status).toBe(201);
  expect(accepted.headers.get('set-cookie')).toContain(`${AUTH_COOKIE}=`);
});
