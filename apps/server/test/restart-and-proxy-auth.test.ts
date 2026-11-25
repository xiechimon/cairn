import { createHmac } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  BROWSER_AUTH_HEADER,
  DEVICE_TOKEN_PREFIX,
  LOCAL_PROOF_PATH,
  LOCAL_PROOF_PREFIX,
  type PairClaimResponse,
  type PairingRequestView,
} from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import { bootServer, type TestServer } from './helpers.js';

const OWNER = 'restart-proxy-owner-token-0123456789abcdef';
const ownerHeaders = { authorization: `Bearer ${OWNER}` };

const dirs: string[] = [];

function tempDir(): string {
  const dir = makeTestTempDir('cairn-restart-proxy-');
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function call(
  s: TestServer,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown; peer?: string } = {},
): Promise<Response> {
  const openPair =
    method === 'POST' &&
    (path === '/api/remote/pair' ||
      path === '/api/remote/pair/request' ||
      path === '/api/remote/pair/claim');
  return Promise.resolve(
    s.app.request(
      path,
      {
        method,
        headers: {
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(openPair ? { [BROWSER_AUTH_HEADER]: '1' } : {}),
          ...options.headers,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      },
      options.peer === undefined
        ? undefined
        : { incoming: { socket: { remoteAddress: options.peer } } },
    ),
  );
}

function authCookieOf(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const pair = header.split(';')[0] ?? '';
  expect(pair.startsWith('cairn_auth=')).toBe(true);
  return pair;
}

describe('session persistence across server restart', () => {
  test('paired device cookie and bearer token survive full server restart against same SQLite DB', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'server.db');

    const firstHandle = openDbWithHandle(dbPath);
    const first = bootServer({ db: firstHandle.db, authToken: OWNER });
    const reqRes = await call(first, 'POST', '/api/remote/pair/request', {
      body: { name: 'macOS', detail: 'Chrome 156' },
      peer: '100.83.149.60',
    });
    expect(reqRes.status).toBe(201);
    const created = (await reqRes.json()) as { id: string; secret: string };

    const approveRes = await call(
      first,
      'POST',
      `/api/remote/pairing-requests/${created.id}/approve`,
      {
        headers: ownerHeaders,
      },
    );
    expect(approveRes.status).toBe(200);

    const claimRes = await call(first, 'POST', '/api/remote/pair/claim', {
      body: { id: created.id, secret: created.secret },
      peer: '100.83.149.60',
    });
    expect(claimRes.status).toBe(200);
    const cookie = authCookieOf(claimRes);
    const claimed = (await claimRes.json()) as PairClaimResponse;
    expect(claimed.status).toBe('approved');
    if (claimed.status !== 'approved') return;
    expect(claimed.token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);

    first.dispose();
    firstHandle.close();

    const secondHandle = openDbWithHandle(dbPath);
    const second = bootServer({ db: secondHandle.db, authToken: OWNER });
    try {
      const sessionRes = await call(second, 'GET', '/api/auth/session', {
        headers: { [BROWSER_AUTH_HEADER]: '1', cookie },
      });
      expect(sessionRes.status).toBe(204);

      const teamsRes = await call(second, 'GET', '/api/teams', {
        headers: { cookie },
      });
      expect(teamsRes.status).toBe(200);

      const ticketRes = await call(second, 'POST', '/api/auth/stream-ticket', {
        headers: { cookie, 'sec-fetch-site': 'same-origin' },
      });
      expect(ticketRes.status).toBe(200);

      const bearerRes = await call(second, 'GET', '/api/teams', {
        headers: { authorization: `Bearer ${claimed.token}` },
      });
      expect(bearerRes.status).toBe(200);
    } finally {
      second.dispose();
      secondHandle.close();
    }
  });
});

describe('reverse proxy origin and peer classification', () => {
  test('loopback reverse proxy rewriting Host to 127.0.0.1:8787 with X-Forwarded-Host allows pairing and never labels request as local', async () => {
    const s = bootServer({ authToken: OWNER });
    const proxyHeaders = {
      host: '127.0.0.1:8787',
      'x-forwarded-host': 'app.instabox.example',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.42',
      origin: 'https://app.instabox.example',
      'sec-fetch-site': 'same-origin',
    };

    const reqRes = await call(s, 'POST', '/api/remote/pair/request', {
      headers: proxyHeaders,
      body: { name: 'Browser', detail: 'Chrome 158' },
      peer: '127.0.0.1',
    });
    expect(reqRes.status).toBe(201);
    const created = (await reqRes.json()) as { id: string; secret: string };

    const listRes = await call(s, 'GET', '/api/remote/pairing-requests', { headers: ownerHeaders });
    const rows = (await listRes.json()) as PairingRequestView[];
    const row = rows.find((item) => item.id === created.id);
    expect(row?.source).toBe('public');

    const approveRes = await call(s, 'POST', `/api/remote/pairing-requests/${created.id}/approve`, {
      headers: ownerHeaders,
    });
    expect(approveRes.status).toBe(200);

    const claimRes = await call(s, 'POST', '/api/remote/pair/claim', {
      headers: proxyHeaders,
      body: { id: created.id, secret: created.secret },
      peer: '127.0.0.1',
    });
    expect(claimRes.status).toBe(200);
    expect(claimRes.headers.get('set-cookie')).toContain('; Secure');
    const cookie = authCookieOf(claimRes);

    const sessionRes = await call(s, 'GET', '/api/auth/session', {
      headers: { ...proxyHeaders, [BROWSER_AUTH_HEADER]: '1', cookie },
      peer: '127.0.0.1',
    });
    expect(sessionRes.status).toBe(204);
  });

  test('proxied loopback requests without X-Forwarded-For or with spoofed 127.0.0.1 are never labeled loopback', async () => {
    const s = bootServer({ authToken: OWNER });
    const cases: Array<Record<string, string>> = [
      {
        host: '127.0.0.1:8787',
        'x-forwarded-host': 'app.instabox.example',
        'x-forwarded-proto': 'https',
        origin: 'https://app.instabox.example',
      },
      {
        host: '127.0.0.1:8787',
        'x-forwarded-host': 'app.instabox.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '127.0.0.1, 203.0.113.55',
        origin: 'https://app.instabox.example',
      },
      {
        host: '127.0.0.1:8787',
        'x-forwarded-host': 'app.instabox.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '127.0.0.1',
        origin: 'https://app.instabox.example',
      },
    ];
    for (const headers of cases) {
      const reqRes = await call(s, 'POST', '/api/remote/pair/request', {
        headers,
        body: { name: 'Browser' },
        peer: '127.0.0.1',
      });
      expect(reqRes.status).toBe(201);
      const { id } = (await reqRes.json()) as { id: string };
      const listRes = await call(s, 'GET', '/api/remote/pairing-requests', {
        headers: ownerHeaders,
      });
      const rows = (await listRes.json()) as PairingRequestView[];
      expect(rows.find((row) => row.id === id)?.source).toBe('public');
    }
  });

  test('forwarded host is accepted from a configured trusted proxy and rejected from an untrusted peer', async () => {
    const trustedProxy = '172.17.0.1';
    const untrustedPeer = '203.0.113.9';
    const s = bootServer({
      authToken: OWNER,
      trustedProxies: new Set([trustedProxy]),
    });

    const trustedHeaders = {
      host: '127.0.0.1:8787',
      'x-forwarded-host': 'box.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '198.51.100.7',
      origin: 'https://box.example.com',
      'sec-fetch-site': 'same-origin',
    };

    const allowed = await call(s, 'POST', '/api/remote/pair/request', {
      headers: trustedHeaders,
      body: { name: 'Browser' },
      peer: trustedProxy,
    });
    expect(allowed.status).toBe(201);
    const { id } = (await allowed.json()) as { id: string };
    const listRes = await call(s, 'GET', '/api/remote/pairing-requests', { headers: ownerHeaders });
    const rows = (await listRes.json()) as PairingRequestView[];
    expect(rows.find((row) => row.id === id)?.source).toBe('public');

    const spoofed = await call(s, 'POST', '/api/remote/pair/request', {
      headers: {
        host: '127.0.0.1:8787',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '10.0.0.1',
        origin: 'https://evil.example',
        'sec-fetch-site': 'same-origin',
      },
      body: { name: 'Browser' },
      peer: untrustedPeer,
    });
    expect(spoofed.status).toBe(403);
  });

  test('ignores spoofed X-Forwarded-Host when Host is non-loopback and aborts X-Forwarded-For scan at non-IP or header boundary', async () => {
    const s = bootServer({ authToken: OWNER });

    const nonLoopbackHostOverride = await call(s, 'POST', '/api/remote/pair/request', {
      headers: {
        host: 'real.example.com',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '203.0.113.10',
        origin: 'https://evil.example',
        'sec-fetch-site': 'same-origin',
      },
      body: { name: 'Browser' },
      peer: '127.0.0.1',
    });
    expect(nonLoopbackHostOverride.status).toBe(403);

    const unknownBoundary = await call(s, 'POST', '/api/remote/pair/request', {
      headers: {
        host: '127.0.0.1:8787',
        'x-forwarded-host': 'app.instabox.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '100.64.0.1, unknown',
        origin: 'https://app.instabox.example',
      },
      body: { name: 'Browser' },
      peer: '127.0.0.1',
    });
    expect(unknownBoundary.status).toBe(201);
    const { id: id1 } = (await unknownBoundary.json()) as { id: string };

    const noFallthrough = await call(s, 'POST', '/api/remote/pair/request', {
      headers: {
        host: '127.0.0.1:8787',
        'x-forwarded-host': 'app.instabox.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '0:0:0:0:0:0:0:1',
        'x-real-ip': '100.64.0.9',
        origin: 'https://app.instabox.example',
      },
      body: { name: 'Browser' },
      peer: '127.0.0.2',
    });
    expect(noFallthrough.status).toBe(201);
    const { id: id2 } = (await noFallthrough.json()) as { id: string };

    const listRes = await call(s, 'GET', '/api/remote/pairing-requests', { headers: ownerHeaders });
    const rows = (await listRes.json()) as PairingRequestView[];
    expect(rows.find((row) => row.id === id1)?.source).toBe('public');
    expect(rows.find((row) => row.id === id2)?.source).toBe('public');
  });

  test('local-proof endpoint proves owner token possession via HMAC and refuses proxied callers', async () => {
    const s = bootServer({ authToken: OWNER });
    const nonce = 'a'.repeat(48);
    const direct = await call(s, 'POST', LOCAL_PROOF_PATH, {
      body: { nonce },
      peer: '127.0.0.1',
    });
    expect(direct.status).toBe(200);
    const { proof } = (await direct.json()) as { proof: string };
    const expected = createHmac('sha256', OWNER)
      .update(`${LOCAL_PROOF_PREFIX}0f9d3a52-6c1e-4b7a-9d3e-5a1c2b4d6e80:${nonce}`)
      .digest('hex');
    expect(proof).toBe(expected);

    const proxied = await call(s, 'POST', LOCAL_PROOF_PATH, {
      headers: { 'x-forwarded-for': '203.0.113.9' },
      body: { nonce },
      peer: '127.0.0.1',
    });
    expect(proxied.status).toBe(403);
  });
});

describe('paired device cookie session approving pairing popup', () => {
  test('paired device cookie session approves a pending pairing request over plain HTTP and behind a trusted reverse proxy', async () => {
    const s = bootServer({ authToken: OWNER });
    const grantRes = await call(s, 'POST', '/api/remote/pairing', { headers: ownerHeaders });
    const { code } = (await grantRes.json()) as { code: string };
    const pairedRes = await call(s, 'POST', '/api/remote/pair', {
      body: { code, name: 'owner-laptop' },
    });
    expect(pairedRes.status).toBe(201);
    const deviceCookie = authCookieOf(pairedRes);

    const httpReq = await call(s, 'POST', '/api/remote/pair/request', {
      body: { name: 'Browser', detail: 'Chrome 156' },
      peer: '100.83.149.60',
    });
    expect(httpReq.status).toBe(201);
    const req1 = (await httpReq.json()) as { id: string; secret: string };

    const approveHttp = await call(s, 'POST', `/api/remote/pairing-requests/${req1.id}/approve`, {
      headers: {
        cookie: deviceCookie,
        host: 'mac-mini.tail.ts.net:8787',
        origin: 'http://mac-mini.tail.ts.net:8787',
      },
      body: {},
      peer: '100.125.21.46',
    });
    expect(approveHttp.status).toBe(200);
    const claim1 = (await (
      await call(s, 'POST', '/api/remote/pair/claim', {
        body: { id: req1.id, secret: req1.secret },
      })
    ).json()) as PairClaimResponse;
    expect(claim1.status).toBe('approved');

    const proxyReq = await call(s, 'POST', '/api/remote/pair/request', {
      headers: {
        host: '127.0.0.1:8787',
        'x-forwarded-host': 'app.instabox.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '203.0.113.88',
        origin: 'https://app.instabox.example',
      },
      body: { name: 'Browser', detail: 'Chrome 158' },
      peer: '127.0.0.1',
    });
    expect(proxyReq.status).toBe(201);
    const req2 = (await proxyReq.json()) as { id: string; secret: string };

    const approveProxy = await call(s, 'POST', `/api/remote/pairing-requests/${req2.id}/approve`, {
      headers: {
        cookie: deviceCookie,
        host: '127.0.0.1:8787',
        'x-forwarded-host': 'app.instabox.example',
        'x-forwarded-proto': 'https',
        origin: 'https://app.instabox.example',
      },
      body: {},
      peer: '127.0.0.1',
    });
    expect(approveProxy.status).toBe(200);
  });
});
