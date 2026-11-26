import {
  BROWSER_AUTH_HEADER,
  BROWSER_SESSION_PATH,
  type PairClaimResponse,
  type PairingRequestView,
} from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { bootServer, type TestServer } from './helpers.js';

const OWNER = 'pair-browser-mark-owner-token-0123456789abcdef';
const ownerHeaders = { authorization: `Bearer ${OWNER}` };
const MARK_COOKIE = 'cairn_browser';

interface Created {
  id: string;
  secret: string;
}

class Browser {
  readonly jar = new Map<string, string>();

  constructor(
    private readonly server: TestServer,
    private readonly peer: string,
  ) {}

  async send(
    method: string,
    path: string,
    options: { headers?: Record<string, string>; body?: unknown; cookies?: string } = {},
  ): Promise<Response> {
    const cookie = options.cookies ?? [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await this.server.app.request(
      path,
      {
        method,
        headers: {
          [BROWSER_AUTH_HEADER]: '1',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie === '' ? {} : { cookie }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      { incoming: { socket: { remoteAddress: this.peer } } },
    );
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair!.indexOf('=');
      this.jar.set(pair!.slice(0, at), pair!.slice(at + 1));
    }
    return res;
  }

  async open(): Promise<void> {
    await this.send('GET', BROWSER_SESSION_PATH);
  }

  async requestPair(cookies?: string): Promise<Created> {
    const res = await this.send('POST', '/api/remote/pair/request', {
      body: { name: 'macOS' },
      ...(cookies === undefined ? {} : { cookies }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as Created;
  }

  async claim(request: Created): Promise<PairClaimResponse> {
    const res = await this.send('POST', '/api/remote/pair/claim', {
      body: { id: request.id, secret: request.secret },
    });
    return (await res.json()) as PairClaimResponse;
  }
}

async function pendingIds(server: TestServer): Promise<string[]> {
  const res = await server.app.request('/api/remote/pairing-requests', { headers: ownerHeaders });
  return ((await res.json()) as PairingRequestView[]).map((row) => row.id);
}

function boot(): TestServer {
  return bootServer({
    authToken: OWNER,
    accessVerifier: async () => ({ kind: 'owner', expiresAt: Date.now() + 60_000 }) as never,
    clerkAuth: {
      publishableKey: 'pk_test_example',
      issuer: 'https://example.clerk.accounts.dev',
      verify: async () => ({ kind: 'owner' }) as never,
    },
  });
}

async function grantCode(server: TestServer): Promise<string> {
  const res = await server.app.request('/api/remote/pairing', {
    method: 'POST',
    headers: ownerHeaders,
  });
  return ((await res.json()) as { code: string }).code;
}

async function pairedDeviceToken(server: TestServer): Promise<string> {
  const elsewhere = new Browser(server, '10.9.9.9');
  const res = await elsewhere.send('POST', '/api/remote/pair', {
    body: { code: await grantCode(server), name: 'other' },
  });
  return ((await res.json()) as { token: string }).token;
}

const SIGN_IN_ROUTES: Array<[string, (b: Browser, s: TestServer) => Promise<Response>]> = [
  [
    'the owner access token',
    (b) => b.send('POST', BROWSER_SESSION_PATH, { headers: ownerHeaders }),
  ],
  [
    'a paired device token',
    async (b, s) =>
      b.send('POST', BROWSER_SESSION_PATH, {
        headers: { authorization: `Bearer ${await pairedDeviceToken(s)}` },
      }),
  ],
  ['Cloudflare Access', (b) => b.send('POST', '/api/auth/access')],
  [
    'an account sign-in',
    (b) => b.send('POST', '/api/auth/clerk', { headers: { authorization: 'Bearer jwt' } }),
  ],
  [
    'a pairing code',
    async (b, s) =>
      b.send('POST', '/api/remote/pair', { body: { code: await grantCode(s), name: 'phone' } }),
  ],
];

describe('signing in withdraws the pairing requests of that browser', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each(SIGN_IN_ROUTES)('by %s, even when the asking window is gone', async (_, signIn) => {
    const server = boot();
    const browser = new Browser(server, '10.0.0.1');
    await browser.open();
    await browser.requestPair();
    const stranger = new Browser(server, '10.0.0.2');
    await stranger.open();
    const strangers = await stranger.requestPair();
    const unmarked = await new Browser(server, '10.0.0.3').requestPair('');
    const res = await signIn(browser, server);
    expect(res.ok).toBe(true);
    expect((await pendingIds(server)).sort()).toEqual([strangers.id, unmarked.id].sort());
  });

  test('by claiming an approved request, which also voids the other request', async () => {
    const server = boot();
    const browser = new Browser(server, '10.0.0.1');
    await browser.open();
    const first = await browser.requestPair();
    await server.app.request(`/api/remote/pairing-requests/${first.id}/approve`, {
      method: 'POST',
      headers: ownerHeaders,
    });
    const proxied = new Browser(server, '10.0.0.7');
    for (const [key, value] of browser.jar) proxied.jar.set(key, value);
    const second = await proxied.requestPair();
    expect((await browser.claim(first)).status).toBe('approved');
    expect(await pendingIds(server)).toEqual([]);
    expect((await proxied.claim(second)).status).toBe('expired');
  });

  test('a request sent before sign-in that arrives after it is never pending', async () => {
    const server = boot();
    const browser = new Browser(server, '10.0.0.1');
    await browser.open();
    const signedOut = [...browser.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    await browser.send('POST', BROWSER_SESSION_PATH, { headers: ownerHeaders });
    const late = await browser.requestPair(signedOut);
    expect(await pendingIds(server)).toEqual([]);
    expect((await browser.claim(late)).status).toBe('expired');
    const approval = await server.app.request(`/api/remote/pairing-requests/${late.id}/approve`, {
      method: 'POST',
      headers: ownerHeaders,
    });
    expect(approval.status).toBe(409);
  });

  test('an approval nobody claimed is void once the browser signs in another way', async () => {
    const server = boot();
    const browser = new Browser(server, '10.0.0.1');
    await browser.open();
    const approved = await browser.requestPair();
    await server.app.request(`/api/remote/pairing-requests/${approved.id}/approve`, {
      method: 'POST',
      headers: ownerHeaders,
    });
    await browser.send('POST', BROWSER_SESSION_PATH, { headers: ownerHeaders });
    expect((await browser.claim(approved)).status).toBe('expired');
  });

  test('a stale sign-in screen asking again long after the browser signed in is never pending', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = boot();
    const browser = new Browser(server, '10.0.0.1');
    await browser.open();
    await browser.send('POST', BROWSER_SESSION_PATH, { headers: ownerHeaders });
    vi.setSystemTime(Date.now() + 31_000);
    const retried = await browser.requestPair();
    expect(await pendingIds(server)).toEqual([]);
    expect((await browser.claim(retried)).status).toBe('expired');
  });

  test('a stale signed-in screen asking again replaces no other request from the same peer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = boot();
    const stale = new Browser(server, '10.0.0.1');
    await stale.open();
    await stale.send('POST', BROWSER_SESSION_PATH, { headers: ownerHeaders });
    vi.setSystemTime(Date.now() + 31_000);
    const neighbour = new Browser(server, '10.0.0.1');
    await neighbour.open();
    const waiting = await neighbour.requestPair();
    await stale.requestPair();
    expect(await pendingIds(server)).toEqual([waiting.id]);
  });

  test('after sign-out the same browser can ask again at once, even with an older session left behind', async () => {
    const server = boot();
    const browser = new Browser(server, '10.0.0.1');
    await browser.open();
    await browser.send('POST', BROWSER_SESSION_PATH, { headers: ownerHeaders });
    await browser.send('POST', BROWSER_SESSION_PATH, { headers: ownerHeaders });
    const signedOut = await browser.send('POST', '/api/auth/signout', {
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    expect(signedOut.ok).toBe(true);
    const next = await browser.requestPair();
    expect(await pendingIds(server)).toEqual([next.id]);
    expect((await browser.claim(next)).status).toBe('pending');
  });

  test('a browser that lost its session but kept the mark can ask again once nothing is in flight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = boot();
    const browser = new Browser(server, '10.0.0.1');
    await browser.open();
    await browser.send('POST', BROWSER_SESSION_PATH, { headers: ownerHeaders });
    browser.jar.delete('cairn_auth');
    vi.setSystemTime(Date.now() + 31_000);
    const next = await browser.requestPair();
    expect(await pendingIds(server)).toEqual([next.id]);
    expect((await browser.claim(next)).status).toBe('pending');
  });

  test('the signed-out probe hands out the mark, hidden from scripts and scoped to the API', async () => {
    const server = boot();
    const res = await new Browser(server, '10.0.0.1').send('GET', BROWSER_SESSION_PATH);
    expect(res.status).toBe(401);
    const line = res.headers.getSetCookie().find((c) => c.startsWith(`${MARK_COOKIE}=`)) ?? '';
    expect(line).toMatch(/^cairn_browser=[A-Za-z0-9_-]{43};/);
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Path=/api');
    expect(line).toContain('SameSite=Lax');
  });
});
