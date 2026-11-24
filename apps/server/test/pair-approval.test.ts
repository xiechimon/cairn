import {
  BROWSER_AUTH_HEADER,
  DEVICE_TOKEN_PREFIX,
  PAIRED_DEVICE_CAP,
  PAIRING_REQUEST_CAP,
  PAIRING_REQUEST_RATE_CAP,
  PAIRING_REQUEST_RATE_WINDOW_MS,
  type PairClaimResponse,
  type PairingRequestView,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { pairedDevice, pairingRequest } from '../src/db/schema.js';
import { claimPairRequest } from '../src/services/pairing-requests.js';
import { bootServer, type TestServer } from './helpers.js';

const OWNER = 'pair-approval-owner-token-0123456789abcdef';
const ENVIRONMENT_ID = '0f9d3a52-6c1e-4b7a-9d3e-5a1c2b4d6e80';
const ownerHeaders = { authorization: `Bearer ${OWNER}` };

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

interface CreatedRequest {
  id: string;
  secret: string;
  code: string;
  expiresAt: number;
}

async function requestPair(
  s: TestServer,
  opts: { name?: string; detail?: string; peer?: string } = {},
): Promise<CreatedRequest> {
  const res = await call(s, 'POST', '/api/remote/pair/request', {
    body: { name: opts.name ?? 'macOS', detail: opts.detail ?? 'Chrome 131' },
    ...(opts.peer === undefined ? {} : { peer: opts.peer }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as CreatedRequest;
}

async function listRequests(
  s: TestServer,
  headers: Record<string, string> = ownerHeaders,
): Promise<PairingRequestView[]> {
  const res = await call(s, 'GET', '/api/remote/pairing-requests', { headers });
  expect(res.status).toBe(200);
  return (await res.json()) as PairingRequestView[];
}

async function decide(
  s: TestServer,
  id: string,
  decision: 'approve' | 'deny',
  headers: Record<string, string> = ownerHeaders,
): Promise<Response> {
  return call(s, 'POST', `/api/remote/pairing-requests/${id}/${decision}`, { headers });
}

async function claim(s: TestServer, id: string, secret: string): Promise<PairClaimResponse> {
  const res = await call(s, 'POST', '/api/remote/pair/claim', { body: { id, secret } });
  expect(res.status).toBe(200);
  return (await res.json()) as PairClaimResponse;
}

async function pairDeviceViaGrant(s: TestServer, name = 'grant-device'): Promise<void> {
  const issued = await call(s, 'POST', '/api/remote/pairing', { headers: ownerHeaders });
  const { code } = (await issued.json()) as { code: string };
  const res = await call(s, 'POST', '/api/remote/pair', { body: { code, name } });
  expect(res.status).toBe(201);
}

describe('F-P3 pair by approval', () => {
  test('request -> listed -> approve -> claim signs the device in once', async () => {
    const s = bootServer({ authToken: OWNER });
    const req = await requestPair(s, { name: 'macOS', detail: 'Chrome 131', peer: '192.168.1.44' });

    const [row] = await listRequests(s);
    expect(row).toMatchObject({
      id: req.id,
      code: req.code,
      name: 'macOS',
      detail: 'Chrome 131',
      source: 'lan',
    });
    expect(JSON.stringify(row)).not.toContain(req.secret);

    expect(await claim(s, req.id, req.secret)).toEqual({ status: 'pending' });
    expect((await decide(s, req.id, 'approve')).status).toBe(200);

    const claimed = await claim(s, req.id, req.secret);
    expect(claimed.status).toBe('approved');
    if (claimed.status !== 'approved') return;
    expect(claimed.token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);
    expect(claimed.environmentId).toBe(ENVIRONMENT_ID);
    expect(
      (
        await call(s, 'GET', '/api/teams', {
          headers: { authorization: `Bearer ${claimed.token}` },
        })
      ).status,
    ).toBe(200);

    const claimResponse = await call(s, 'POST', '/api/remote/pair/claim', {
      body: { id: req.id, secret: req.secret },
    });
    expect(claimResponse.status).toBe(404);
  });

  test('claim sets the session cookie like the grant path does', async () => {
    const s = bootServer({ authToken: OWNER });
    const req = await requestPair(s);
    await decide(s, req.id, 'approve');
    const res = await call(s, 'POST', '/api/remote/pair/claim', {
      body: { id: req.id, secret: req.secret },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('cairn_auth=');
  });

  test('deny tells the requester, and a decided request refuses a second decision', async () => {
    const s = bootServer({ authToken: OWNER });
    const req = await requestPair(s);
    expect((await decide(s, req.id, 'deny')).status).toBe(200);
    expect(await claim(s, req.id, req.secret)).toEqual({ status: 'denied' });
    expect((await decide(s, req.id, 'approve')).status).toBe(409);
    expect((await decide(s, req.id, 'deny')).status).toBe(409);
  });

  test('two racing decisions have exactly one winner', async () => {
    const s = bootServer({ authToken: OWNER });
    const req = await requestPair(s);
    const results = await Promise.all([decide(s, req.id, 'approve'), decide(s, req.id, 'deny')]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
  });

  test('two racing claims on an approved request produce one token', async () => {
    const s = bootServer({ authToken: OWNER });
    const req = await requestPair(s);
    await decide(s, req.id, 'approve');
    const [a, b] = await Promise.all([
      call(s, 'POST', '/api/remote/pair/claim', { body: { id: req.id, secret: req.secret } }),
      call(s, 'POST', '/api/remote/pair/claim', { body: { id: req.id, secret: req.secret } }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 404]);
    expect(s.db.select().from(pairedDevice).all()).toHaveLength(1);
  });

  test('unknown ids get 404 everywhere; a wrong secret claims nothing', async () => {
    const s = bootServer({ authToken: OWNER });
    const req = await requestPair(s);
    expect((await decide(s, 'missing-id', 'approve')).status).toBe(404);
    expect((await decide(s, 'missing-id', 'deny')).status).toBe(404);
    expect(
      (
        await call(s, 'POST', '/api/remote/pair/claim', {
          body: { id: 'missing-id', secret: 'x' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(s, 'POST', '/api/remote/pair/claim', {
          body: { id: req.id, secret: 'not-the-secret' },
        })
      ).status,
    ).toBe(404);
    expect((await decide(s, req.id, 'approve')).status).toBe(200);
    const claimed = await claim(s, req.id, req.secret);
    expect(claimed.status).toBe('approved');
  });

  test('an expired pending request is expired on claim and absent from the list', async () => {
    const s = bootServer({ authToken: OWNER });
    const req = await requestPair(s);
    s.db.update(pairingRequest).set({ expiresAt: 0 }).where(eq(pairingRequest.id, req.id)).run();
    expect(await claim(s, req.id, req.secret)).toEqual({ status: 'expired' });
    expect(await listRequests(s)).toEqual([]);
    expect((await decide(s, req.id, 'approve')).status).toBe(409);
  });

  test('a newer request from the same source supersedes the old one', async () => {
    const s = bootServer({ authToken: OWNER });
    const first = await requestPair(s, { peer: '192.168.1.44' });
    const second = await requestPair(s, { peer: '192.168.1.44' });
    expect(second.id).not.toBe(first.id);
    expect(await claim(s, first.id, first.secret)).toEqual({ status: 'expired' });
    const rows = await listRequests(s);
    expect(rows.map((row) => row.id)).toEqual([second.id]);
  });

  test('a source is rate limited while other sources are not', async () => {
    const s = bootServer({ authToken: OWNER });
    for (let i = 0; i < PAIRING_REQUEST_RATE_CAP; i++) {
      await requestPair(s, { peer: '192.168.1.44' });
    }
    const limited = await call(s, 'POST', '/api/remote/pair/request', {
      body: { name: 'macOS' },
      peer: '192.168.1.44',
    });
    expect(limited.status).toBe(429);
    await requestPair(s, { peer: '192.168.1.45' });
  });

  test('superseded rows past the claim grace still count against the rate cap', async () => {
    const s = bootServer({ authToken: OWNER });
    for (let i = 0; i < PAIRING_REQUEST_RATE_CAP; i++) {
      await requestPair(s, { peer: '192.168.1.44' });
    }
    s.db
      .update(pairingRequest)
      .set({ decidedAt: 0 })
      .where(eq(pairingRequest.peer, '192.168.1.44'))
      .run();
    const limited = await call(s, 'POST', '/api/remote/pair/request', {
      body: { name: 'macOS' },
      peer: '192.168.1.44',
    });
    expect(limited.status).toBe(429);
  });

  test('rows leave the rate window and a capped source can request again', async () => {
    const s = bootServer({ authToken: OWNER });
    for (let i = 0; i < PAIRING_REQUEST_RATE_CAP; i++) {
      await requestPair(s, { peer: '192.168.1.44' });
    }
    s.db
      .update(pairingRequest)
      .set({ createdAt: Date.now() - PAIRING_REQUEST_RATE_WINDOW_MS - 1, expiresAt: 0 })
      .where(eq(pairingRequest.peer, '192.168.1.44'))
      .run();
    await requestPair(s, { peer: '192.168.1.44' });
  });

  test('live pending requests are capped globally', async () => {
    const s = bootServer({ authToken: OWNER });
    for (let i = 0; i < PAIRING_REQUEST_CAP; i++) {
      await requestPair(s, { peer: `192.168.1.${100 + i}` });
    }
    const limited = await call(s, 'POST', '/api/remote/pair/request', {
      body: { name: 'macOS' },
      peer: '10.0.0.9',
    });
    expect(limited.status).toBe(429);
  });

  test('source classification: loopback, lan, tailnet subnet and unknown', async () => {
    const s = bootServer({ authToken: OWNER });
    const cases: [string | undefined, string][] = [
      ['127.0.0.1', 'loopback'],
      ['::1', 'loopback'],
      ['10.0.0.8', 'lan'],
      ['100.80.0.1', 'tailnet'],
      ['203.0.113.9', 'public'],
      [undefined, 'unknown'],
    ];
    for (const [peer, source] of cases) {
      const req = await requestPair(s, peer === undefined ? {} : { peer });
      const rows = await listRequests(s);
      expect(rows.find((row) => row.id === req.id)?.source).toBe(source);
    }
  });

  test('a full device list holds the claim at 409 until a slot frees', async () => {
    const s = bootServer({ authToken: OWNER });
    for (let i = 0; i < PAIRED_DEVICE_CAP; i++) await pairDeviceViaGrant(s, `d${i}`);
    const req = await requestPair(s);
    await decide(s, req.id, 'approve');
    const refused = await call(s, 'POST', '/api/remote/pair/claim', {
      body: { id: req.id, secret: req.secret },
    });
    expect(refused.status).toBe(409);
    const [first] = await call(s, 'GET', '/api/remote/devices', { headers: ownerHeaders }).then(
      (res) => res.json() as Promise<{ id: string }[]>,
    );
    await call(s, 'DELETE', `/api/remote/devices/${first?.id}`, { headers: ownerHeaders });
    const claimed = await claim(s, req.id, req.secret);
    expect(claimed.status).toBe('approved');
  });

  test('a failed device insert keeps the approval claimable', async () => {
    const s = bootServer({ authToken: OWNER });
    const req = await requestPair(s);
    await decide(s, req.id, 'approve');
    expect(() =>
      claimPairRequest(s.db, { id: req.id, secret: req.secret, teamId: 'missing-team' }),
    ).toThrow();
    const claimed = await claim(s, req.id, req.secret);
    expect(claimed.status).toBe('approved');
  });

  test('paired devices and anonymous callers cannot see or decide requests', async () => {
    const s = bootServer({ authToken: OWNER });
    const req = await requestPair(s);
    const grantRes = await call(s, 'POST', '/api/remote/pairing', { headers: ownerHeaders });
    const { code } = (await grantRes.json()) as { code: string };
    const pairRes = await call(s, 'POST', '/api/remote/pair', { body: { code, name: 'phone' } });
    const { token } = (await pairRes.json()) as { token: string };
    const device = { authorization: `Bearer ${token}` };

    expect((await call(s, 'GET', '/api/remote/pairing-requests', { headers: device })).status).toBe(
      403,
    );
    expect((await decide(s, req.id, 'approve', device)).status).toBe(403);
    expect((await decide(s, req.id, 'deny', device)).status).toBe(403);
    expect((await call(s, 'GET', '/api/remote/pairing-requests')).status).toBe(401);
    expect((await decide(s, req.id, 'approve', {})).status).toBe(401);
  });

  test('the open requester routes still require the browser-origin proof header', async () => {
    const s = bootServer({ authToken: OWNER });
    const bare = await s.app.request('/api/remote/pair/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'macOS' }),
    });
    expect(bare.status).toBe(403);
    const req = await requestPair(s);
    const bareClaim = await s.app.request('/api/remote/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: req.id, secret: req.secret }),
    });
    expect(bareClaim.status).toBe(403);
  });

  test('token auth off refuses every route of the flow', async () => {
    const s = bootServer({ authToken: null });
    expect(
      (await call(s, 'POST', '/api/remote/pair/request', { body: { name: 'x' } })).status,
    ).toBe(409);
    expect(
      (await call(s, 'POST', '/api/remote/pair/claim', { body: { id: 'x', secret: 'x' } })).status,
    ).toBe(409);
    expect(
      (await call(s, 'GET', '/api/remote/pairing-requests', { headers: ownerHeaders })).status,
    ).toBe(409);
    expect(
      (await call(s, 'POST', '/api/remote/pairing-requests/x/approve', { headers: ownerHeaders }))
        .status,
    ).toBe(409);
  });

  test('the database keeps only the secret hash', async () => {
    const s = bootServer({ authToken: OWNER });
    const req = await requestPair(s);
    const rows = s.db.select().from(pairingRequest).all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(req.secret);
    expect(rows[0]?.secretHash).toHaveLength(64);
  });
});
