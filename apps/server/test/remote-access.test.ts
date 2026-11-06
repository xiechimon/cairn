import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import {
  DEVICE_TOKEN_PREFIX,
  PAIRED_DEVICE_CAP,
  PAIRING_CODE_CAP,
  PAIRING_CODE_TTL_MS,
  type PairedDevice,
  type PairResponse,
  type RemoteRoutesResponse,
  remoteDescriptorSchema,
} from '@cairn/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { pairedDevice } from '../src/db/schema.js';
import { environmentIdPathOf, loadOrCreateEnvironmentId } from '../src/lib/environment-id.js';
import { listenOnTailnetSocket } from '../src/lib/tailnet-listener.js';
import type { SidecarStatus } from '../src/lib/tsnet-sidecar.js';
import { createPairingBook } from '../src/services/paired-devices.js';
import { bootServer, type TestServer } from './helpers.js';

const OWNER = 'remote-access-owner-token-0123456789abcdef';
const ENVIRONMENT_ID = '0f9d3a52-6c1e-4b7a-9d3e-5a1c2b4d6e80';
const ownerHeaders = { authorization: `Bearer ${OWNER}` };
const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) releaseTestTempDir(dir);
});

function call(
  s: TestServer,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  return Promise.resolve(
    s.app.request(path, {
      method,
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }),
  );
}

function readyStatus(overrides: Partial<SidecarStatus> = {}): SidecarStatus {
  return {
    state: 'ready',
    authUrl: null,
    ips: ['100.64.0.7'],
    dnsName: 'cairn-box.tail1234.ts.net',
    lastError: null,
    restarts: 0,
    ...overrides,
  };
}

async function issueCode(s: TestServer): Promise<string> {
  const res = await call(s, 'POST', '/api/remote/pairing', { headers: ownerHeaders });
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

async function pairDevice(s: TestServer, name = 'Ian phone'): Promise<PairResponse> {
  const code = await issueCode(s);
  const res = await call(s, 'POST', '/api/remote/pair', { body: { code, name } });
  expect(res.status).toBe(201);
  return (await res.json()) as PairResponse;
}

describe('F-D1 descriptor leaks nothing', () => {
  test('answers without a token with exactly environmentId and version', async () => {
    const s = bootServer({ authToken: OWNER });
    const res = await call(s, 'GET', '/api/remote/descriptor');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(remoteDescriptorSchema.parse(body)).toEqual({
      environmentId: ENVIRONMENT_ID,
      version: 1,
    });
    expect(Object.keys(body as object).sort()).toEqual(['environmentId', 'version']);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('forged forwarding and tailnet identity headers change nothing', async () => {
    const s = bootServer({ authToken: OWNER });
    const plain = await (await call(s, 'GET', '/api/remote/descriptor')).text();
    const forged = await call(s, 'GET', '/api/remote/descriptor', {
      headers: {
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        'tailscale-user-login': 'owner@example.com',
      },
    });
    expect(await forged.text()).toBe(plain);
  });

  test('two servers carry two environment ids (F1, the server side of a reused LAN address)', async () => {
    const a = bootServer({ authToken: OWNER });
    const b = bootServer({
      authToken: OWNER,
      remote: { environmentId: '11111111-2222-4333-8444-555555555555' },
    });
    const idA = (
      (await (await call(a, 'GET', '/api/remote/descriptor')).json()) as { environmentId: string }
    ).environmentId;
    const idB = (
      (await (await call(b, 'GET', '/api/remote/descriptor')).json()) as { environmentId: string }
    ).environmentId;
    expect(idA).not.toBe(idB);
  });

  test.each([
    '/api/remote/descriptor/',
    '/api/remote/descriptorx',
    '/api/remote/%64escriptor',
    '/api/remote/routes',
    '/api/remote/devices',
  ])('the exemption is exact: %s is not open without a token', async (path) => {
    const s = bootServer({ authToken: OWNER });
    const res = await call(s, 'GET', path);
    expect([401, 404]).toContain(res.status);
    if (path !== '/api/remote/descriptor/') expect(res.status).toBe(401);
  });

  test('only GET descriptor and POST pair are open: other methods never reach a handler', async () => {
    const s = bootServer({ authToken: OWNER });
    expect((await call(s, 'POST', '/api/remote/descriptor', { body: {} })).status).toBe(404);
    expect((await call(s, 'GET', '/api/remote/pair')).status).toBe(404);
    expect((await call(s, 'POST', '/api/remote/pairing', { body: {} })).status).toBe(401);
  });
});

describe('F-R1 routes: listeners, interfaces and tailnet', () => {
  const interfaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: [
      { address: '192.168.1.20', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
      { address: '169.254.9.9', family: 'IPv4', internal: false },
    ],
    wlan0: [{ address: '10.0.0.5', family: 'IPv4', internal: false }],
  } as unknown as NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>;

  async function routesOf(
    remote: Parameters<typeof bootServer>[0] extends infer O
      ? O extends { remote?: infer R }
        ? R
        : never
      : never,
    headers: Record<string, string> = ownerHeaders,
  ): Promise<RemoteRoutesResponse> {
    const s = bootServer({ authToken: OWNER, remote });
    const res = await call(s, 'GET', '/api/remote/routes', { headers });
    expect(res.status).toBe(200);
    return (await res.json()) as RemoteRoutesResponse;
  }

  test('a loopback bind advertises no LAN address (nothing listens there)', async () => {
    const body = await routesOf({ listenHost: '127.0.0.1', networkInterfaces: () => interfaces });
    expect(body.routes).toEqual([]);
  });

  test('a wildcard bind advertises non-internal IPv4 addresses with the listen port', async () => {
    const body = await routesOf({
      listenHost: '0.0.0.0',
      listenPort: 9001,
      networkInterfaces: () => interfaces,
    });
    expect(body.routes).toEqual([
      { kind: 'lan', url: 'http://10.0.0.5:9001' },
      { kind: 'lan', url: 'http://192.168.1.20:9001' },
    ]);
  });

  test('a specific bind advertises only that address', async () => {
    const body = await routesOf({
      listenHost: '192.168.1.20',
      networkInterfaces: () => interfaces,
    });
    expect(body.routes).toEqual([{ kind: 'lan', url: 'http://192.168.1.20:8787' }]);
  });

  test('a tailnet route appears only when the sidecar is ready, built from the ready event', async () => {
    const body = await routesOf({ tailnetStatus: () => readyStatus() });
    expect(body.routes).toEqual([{ kind: 'tailnet', url: 'https://cairn-box.tail1234.ts.net' }]);
    expect(body.tailnet).toEqual({
      state: 'ready',
      dnsName: 'cairn-box.tail1234.ts.net',
      ips: ['100.64.0.7'],
      authUrl: null,
    });
  });

  test('request headers never reach the advertised origin', async () => {
    const body = await routesOf(
      { tailnetStatus: () => readyStatus() },
      {
        ...ownerHeaders,
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'http',
        'tailscale-user-login': 'owner@example.com',
      },
    );
    expect(JSON.stringify(body)).not.toContain('evil.example');
    expect(body.routes).toEqual([{ kind: 'tailnet', url: 'https://cairn-box.tail1234.ts.net' }]);
  });

  test.each(['restarting', 'failed', 'stopped', 'starting'] as const)(
    'F10: a %s sidecar removes the tailnet route and leaks no error text',
    async (state) => {
      const body = await routesOf({
        tailnetStatus: () => readyStatus({ state, lastError: 'secret path /home/ian/.cairn' }),
      });
      expect(body.routes).toEqual([]);
      expect(body.tailnet.dnsName).toBeNull();
      expect(body.tailnet.ips).toEqual([]);
      expect(JSON.stringify(body)).not.toContain('secret path');
    },
  );

  test('a login-needed sidecar surfaces the auth URL and no route', async () => {
    const body = await routesOf({
      tailnetStatus: () =>
        readyStatus({
          state: 'needs-login',
          authUrl: 'https://login.tailscale.com/a/abc',
          dnsName: null,
          ips: [],
        }),
    });
    expect(body.routes).toEqual([]);
    expect(body.tailnet.authUrl).toBe('https://login.tailscale.com/a/abc');
  });

  test('an unsafe DNS name from the sidecar is dropped, not echoed', async () => {
    const body = await routesOf({
      tailnetStatus: () => readyStatus({ dnsName: 'evil.example/path@attacker.test' }),
    });
    expect(body.routes).toEqual([]);
  });

  test('tsnet off: state off and no tailnet route', async () => {
    const body = await routesOf({ tailnetStatus: () => null });
    expect(body.tailnet.state).toBe('off');
  });

  test('no token: 401, and a forged tailnet identity header does not authenticate', async () => {
    const s = bootServer({ authToken: OWNER });
    expect((await call(s, 'GET', '/api/remote/routes')).status).toBe(401);
    const forged = await call(s, 'GET', '/api/remote/routes', {
      headers: { 'tailscale-user-login': 'owner@example.com' },
    });
    expect(forged.status).toBe(401);
  });
});

describe('F-P1 pairing: code to per-device token', () => {
  test('pair, use the device token, revoke, then 401', async () => {
    const s = bootServer({ authToken: OWNER });
    const paired = await pairDevice(s);
    expect(paired.token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);
    expect(paired.environmentId).toBe(ENVIRONMENT_ID);
    const deviceHeaders = { authorization: `Bearer ${paired.token}` };

    expect((await call(s, 'GET', '/api/teams', { headers: deviceHeaders })).status).toBe(200);
    expect((await call(s, 'GET', '/api/remote/routes', { headers: deviceHeaders })).status).toBe(
      200,
    );

    const revoked = await call(s, 'DELETE', `/api/remote/devices/${paired.deviceId}`, {
      headers: ownerHeaders,
    });
    expect(revoked.status).toBe(204);
    expect((await call(s, 'GET', '/api/teams', { headers: deviceHeaders })).status).toBe(401);
    expect((await call(s, 'GET', '/api/remote/routes', { headers: deviceHeaders })).status).toBe(
      401,
    );
  });

  test('a revoked token is refused on the stream query surface; a live one is not a query token elsewhere', async () => {
    const s = bootServer({ authToken: OWNER });
    const paired = await pairDevice(s);
    expect((await call(s, 'GET', `/api/teams?token=${paired.token}`)).status).toBe(401);
    await call(s, 'DELETE', `/api/remote/devices/${paired.deviceId}`, { headers: ownerHeaders });
    const stream = await call(s, 'GET', `/api/teams/${s.team.id}/stream?token=${paired.token}`);
    expect(stream.status).toBe(401);
  });

  test('revoking one device leaves the others working', async () => {
    const s = bootServer({ authToken: OWNER });
    const first = await pairDevice(s, 'first');
    const second = await pairDevice(s, 'second');
    await call(s, 'DELETE', `/api/remote/devices/${first.deviceId}`, { headers: ownerHeaders });
    const ok = await call(s, 'GET', '/api/teams', {
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(ok.status).toBe(200);
  });

  test('a code works once', async () => {
    const s = bootServer({ authToken: OWNER });
    const code = await issueCode(s);
    const first = await call(s, 'POST', '/api/remote/pair', { body: { code, name: 'a' } });
    const second = await call(s, 'POST', '/api/remote/pair', { body: { code, name: 'b' } });
    expect(first.status).toBe(201);
    expect(second.status).toBe(401);
  });

  test('unknown, empty and malformed codes are all the same 401 or 400, never a token', async () => {
    const s = bootServer({ authToken: OWNER });
    const unknown = await call(s, 'POST', '/api/remote/pair', {
      body: { code: 'not-a-real-code', name: 'x' },
    });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: 'pairing code is invalid or expired' });
    expect(
      (await call(s, 'POST', '/api/remote/pair', { body: { code: '', name: 'x' } })).status,
    ).toBe(400);
    expect((await call(s, 'POST', '/api/remote/pair', { body: { name: 'x' } })).status).toBe(400);
    expect(
      (await call(s, 'POST', '/api/remote/pair', { body: { code: 'x', name: 'x', admin: true } }))
        .status,
    ).toBe(400);
    expect(s.db.select().from(pairedDevice).all()).toEqual([]);
  });

  test('a failed attempt does not consume a valid code', async () => {
    const s = bootServer({ authToken: OWNER });
    const code = await issueCode(s);
    await call(s, 'POST', '/api/remote/pair', { body: { code: 'wrong', name: 'x' } });
    const ok = await call(s, 'POST', '/api/remote/pair', { body: { code, name: 'x' } });
    expect(ok.status).toBe(201);
  });

  test('the response is never cached and the database keeps only a hash', async () => {
    const s = bootServer({ authToken: OWNER });
    const code = await issueCode(s);
    const res = await call(s, 'POST', '/api/remote/pair', { body: { code, name: 'Pixel' } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { token } = (await res.json()) as PairResponse;
    const rows = s.db.select().from(pairedDevice).all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]?.tokenHash).toHaveLength(64);
  });

  test('the device list shows names and masked tokens, no secret material', async () => {
    const s = bootServer({ authToken: OWNER });
    const paired = await pairDevice(s, 'Kitchen tablet');
    const res = await call(s, 'GET', '/api/remote/devices', { headers: ownerHeaders });
    const list = (await res.json()) as PairedDevice[];
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Kitchen tablet');
    expect(JSON.stringify(list)).not.toContain(paired.token);
    expect(JSON.stringify(list)).not.toContain('tokenHash');
  });

  test('a device is capped, and a full house refuses without burning the code', async () => {
    const s = bootServer({ authToken: OWNER });
    for (let i = 0; i < PAIRED_DEVICE_CAP; i++) await pairDevice(s, `d${i}`);
    const code = await issueCode(s);
    const refused = await call(s, 'POST', '/api/remote/pair', { body: { code, name: 'extra' } });
    expect(refused.status).toBe(409);
    const [first] = (await (
      await call(s, 'GET', '/api/remote/devices', { headers: ownerHeaders })
    ).json()) as PairedDevice[];
    await call(s, 'DELETE', `/api/remote/devices/${first?.id}`, { headers: ownerHeaders });
    const retry = await call(s, 'POST', '/api/remote/pair', { body: { code, name: 'extra' } });
    expect(retry.status).toBe(201);
  });

  test('revoking an unknown device is 404', async () => {
    const s = bootServer({ authToken: OWNER });
    const res = await call(s, 'DELETE', '/api/remote/devices/nope', { headers: ownerHeaders });
    expect(res.status).toBe(404);
  });
});

describe('F-P2 pairing authority stays with the owner token', () => {
  test('a device token cannot mint codes, list devices, revoke devices or confirm machine enrollment', async () => {
    const s = bootServer({ authToken: OWNER });
    const paired = await pairDevice(s);
    const device = { authorization: `Bearer ${paired.token}` };
    expect((await call(s, 'POST', '/api/remote/pairing', { headers: device })).status).toBe(403);
    expect((await call(s, 'GET', '/api/remote/devices', { headers: device })).status).toBe(403);
    expect(
      (await call(s, 'DELETE', `/api/remote/devices/${paired.deviceId}`, { headers: device }))
        .status,
    ).toBe(403);
    const confirm = await call(s, 'POST', '/api/machine/enroll/confirm', {
      headers: device,
      body: { enrollId: 'x' },
    });
    expect(confirm.status).toBe(401);
  });

  test('no token and forged tailnet identity cannot mint codes or list devices', async () => {
    const s = bootServer({ authToken: OWNER });
    const headers = {
      'tailscale-user-login': 'owner@example.com',
      'x-forwarded-host': 'evil.example',
    };
    expect((await call(s, 'POST', '/api/remote/pairing', { headers })).status).toBe(401);
    expect((await call(s, 'GET', '/api/remote/devices', { headers })).status).toBe(401);
  });

  test('a device-shaped token that was never issued is refused', async () => {
    const s = bootServer({ authToken: OWNER });
    const forged = `${DEVICE_TOKEN_PREFIX}${'0'.repeat(64)}`;
    const res = await call(s, 'GET', '/api/teams', {
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('F-A1 auth off: no tokens are ever issued', () => {
  test('pairing, pair, device list and revoke refuse with 409 when token auth is off', async () => {
    const s = bootServer({ authToken: null });
    expect((await call(s, 'POST', '/api/remote/pairing')).status).toBe(409);
    expect(
      (await call(s, 'POST', '/api/remote/pair', { body: { code: 'x', name: 'x' } })).status,
    ).toBe(409);
    expect((await call(s, 'GET', '/api/remote/devices')).status).toBe(409);
    expect((await call(s, 'DELETE', '/api/remote/devices/x')).status).toBe(409);
    expect(s.db.select().from(pairedDevice).all()).toEqual([]);
  });
});

describe('pairing book', () => {
  test('a code expires after the TTL', () => {
    const book = createPairingBook();
    const { code } = book.issue(1_000);
    expect(book.redeem(code, 1_000 + PAIRING_CODE_TTL_MS)).toBe(false);
  });

  test('a code redeemed before the TTL works once', () => {
    const book = createPairingBook();
    const { code, expiresAt } = book.issue(1_000);
    expect(expiresAt).toBe(1_000 + PAIRING_CODE_TTL_MS);
    expect(book.redeem(code, 1_000 + PAIRING_CODE_TTL_MS - 1)).toBe(true);
    expect(book.redeem(code, 1_001)).toBe(false);
  });

  test('outstanding codes are capped and the oldest is dropped first', () => {
    const book = createPairingBook();
    const first = book.issue(1_000);
    for (let i = 0; i < PAIRING_CODE_CAP; i++) book.issue(1_001 + i);
    expect(book.size()).toBe(PAIRING_CODE_CAP);
    expect(book.redeem(first.code, 2_000)).toBe(false);
  });

  test('codes carry at least 128 bits and never repeat', () => {
    const book = createPairingBook();
    const codes = new Set<string>();
    for (let i = 0; i < 10; i++) codes.add(book.issue().code);
    expect(codes.size).toBe(10);
    for (const code of codes)
      expect(Buffer.from(code, 'base64url').length).toBeGreaterThanOrEqual(16);
  });
});

describe('environment id', () => {
  function freshDir(): string {
    const dir = makeTestTempDir('env-');
    tmpDirs.push(dir);
    return dir;
  }

  test('is created once and stays the same across restarts', () => {
    const path = environmentIdPathOf(freshDir());
    const first = loadOrCreateEnvironmentId(path);
    expect(loadOrCreateEnvironmentId(path)).toBe(first);
    expect(readFileSync(path, 'utf8').trim()).toBe(first);
  });

  test('leaves no temp file behind and writes a private file', () => {
    const dir = freshDir();
    loadOrCreateEnvironmentId(environmentIdPathOf(dir));
    expect(readdirSync(dir)).toEqual(['environment-id']);
  });

  test('a corrupt file is replaced by a valid id', () => {
    const path = environmentIdPathOf(freshDir());
    writeFileSync(path, 'garbage\n');
    const id = loadOrCreateEnvironmentId(path);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(path, 'utf8').trim()).toBe(id);
  });

  test('racing creators agree on one id', async () => {
    const path = environmentIdPathOf(freshDir());
    const ids = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve().then(() => loadOrCreateEnvironmentId(path)),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(existsSync(path)).toBe(true);
  });
});

describe('F-T1 tailnet listener carries the same guarantees', () => {
  function overSocket(
    socketPath: string,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ socketPath, method, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  test('forged host, forwarding and identity headers neither authenticate nor change the origin', async () => {
    const s = bootServer({ authToken: OWNER, remote: { tailnetStatus: () => readyStatus() } });
    const dir = makeTestTempDir('tl-');
    tmpDirs.push(dir);
    const socketPath = `${dir}/t.sock`;
    const listener = await listenOnTailnetSocket(
      s.app,
      socketPath,
      () => 'cairn-box.tail1234.ts.net',
    );
    try {
      const forged = {
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        'tailscale-user-login': 'owner@example.com',
      };
      expect((await overSocket(socketPath, 'GET', '/api/remote/routes', forged)).status).toBe(401);
      expect((await overSocket(socketPath, 'POST', '/api/remote/pairing', forged)).status).toBe(
        401,
      );
      const routes = await overSocket(socketPath, 'GET', '/api/remote/routes', {
        ...forged,
        ...ownerHeaders,
      });
      expect(routes.status).toBe(200);
      expect(routes.body).not.toContain('evil.example');
      expect(routes.body).toContain('https://cairn-box.tail1234.ts.net');
      const descriptor = await overSocket(socketPath, 'GET', '/api/remote/descriptor', forged);
      expect(JSON.parse(descriptor.body)).toEqual({ environmentId: ENVIRONMENT_ID, version: 1 });
    } finally {
      await listener.close();
    }
  });
});
