import { createServer as createHttpServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PAIRING_CODE_CAP, parseOwnerFragment } from '@cairn/shared';
import { runTokenLinkCommand } from '@cairn/shared/token-command';
import { getRequestListener } from '@hono/node-server';
import { afterEach, expect, test } from 'vitest';
import {
  createPairedDevice,
  issueOwnerLink,
  issuePairingGrant,
} from '../src/services/paired-devices.js';
import { ownerLinkOrigin } from '../src/startup-log.js';
import { bootServer } from './helpers.js';

const TOKEN = 'test-owner-link-secret';
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function listenMacShaped() {
  const s = bootServer({ authToken: TOKEN, loopbackOwner: null });
  const server = createHttpServer(getRequestListener(s.app.fetch));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return { port: (server.address() as AddressInfo).port, db: s.db, teamId: s.team.id };
}

function call(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown>; cookie: string | null }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: {
          host: `127.0.0.1:${port}`,
          'content-type': 'application/json',
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          const cookie =
            (res.headers['set-cookie'] ?? [])
              .map((value) => value.split(';')[0] ?? '')
              .find((value) => value.startsWith('cairn_auth=')) ?? null;
          resolve({
            status: res.statusCode ?? 0,
            body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
            cookie,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}

function redeem(port: number, code: string, headers: Record<string, string> = SAME_ORIGIN) {
  return call(port, '/api/auth/owner-link/redeem', { method: 'POST', headers, body: { code } });
}

function createApiKey(port: number, teamId: string, headers: Record<string, string>) {
  return call(port, `/api/teams/${teamId}/api-keys`, {
    method: 'POST',
    headers: { ...SAME_ORIGIN, ...headers },
    body: {
      name: 'RUNNER',
      gitAccess: false,
      mcpAccess: false,
      machineAccess: true,
      toolGrants: { read: [], write: [] },
    },
  });
}

async function mint(port: number): Promise<string> {
  const res = await call(port, '/api/auth/owner-link', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(res.status).toBe(201);
  return String(res.body.code);
}

test('without loopback proof, a browser has no owner session and a paired device cannot do owner work', async () => {
  const { port, db, teamId } = await listenMacShaped();
  expect((await call(port, '/api/auth/bootstrap', { method: 'POST' })).status).toBe(401);
  const device = createPairedDevice(db, { teamId, name: 'laptop browser' });
  expect(
    (await createApiKey(port, teamId, { authorization: `Bearer ${device.token}` })).status,
  ).toBe(403);
});

test('an owner link signs the browser in as the owner, once', async () => {
  const { port, teamId } = await listenMacShaped();
  const code = await mint(port);
  const signedIn = await redeem(port, code);
  expect(signedIn.status).toBe(200);
  expect(signedIn.cookie).toMatch(/^cairn_auth=.+/);
  expect((await createApiKey(port, teamId, { cookie: signedIn.cookie ?? '' })).status).toBe(201);
  const again = await redeem(port, code);
  expect(again.status).toBe(401);
  expect(again.cookie).toBeNull();
});

test('an expired owner link is refused', async () => {
  const { port, db } = await listenMacShaped();
  const { code } = issueOwnerLink(db, Date.now() - 10 * 60_000 - 1);
  expect((await redeem(port, code)).status).toBe(401);
});

test('owner links and device pairing codes only redeem on their own path', async () => {
  const { port, db } = await listenMacShaped();
  const device = issuePairingGrant(db);
  expect((await redeem(port, device.code)).status).toBe(401);
  const owner = await mint(port);
  const paired = await call(port, '/api/remote/pair', {
    method: 'POST',
    headers: SAME_ORIGIN,
    body: { code: owner, name: 'phone' },
  });
  expect(paired.status).toBe(401);
  expect((await redeem(port, owner)).status).toBe(200);
});

test('device pairing codes neither list nor evict owner links', async () => {
  const { port, db } = await listenMacShaped();
  const owner = await mint(port);
  for (let i = 0; i < PAIRING_CODE_CAP + 1; i += 1) issuePairingGrant(db);
  const listed = await call(port, '/api/remote/pairing', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(listed.status).toBe(200);
  expect(listed.body).toHaveLength(PAIRING_CODE_CAP);
  expect((await redeem(port, owner)).status).toBe(200);
});

test('two concurrent redeems of one link sign in exactly one browser', async () => {
  const { port } = await listenMacShaped();
  const code = await mint(port);
  const results = await Promise.all([redeem(port, code), redeem(port, code)]);
  expect(results.map((res) => res.status).sort()).toEqual([200, 401]);
});

test.each<[string, Record<string, string>]>([
  ['no fetch metadata', {}],
  ['a cross-site request', { 'sec-fetch-site': 'cross-site' }],
  ['a same-site request', { 'sec-fetch-site': 'same-site' }],
  ['a direct navigation', { 'sec-fetch-site': 'none' }],
  ['a foreign Host', { ...SAME_ORIGIN, host: 'evil.example' }],
  ['a rebinding Host', { ...SAME_ORIGIN, host: '127.0.0.1.nip.io' }],
  ['a proxied request', { ...SAME_ORIGIN, 'x-forwarded-for': '203.0.113.9' }],
])('%s cannot redeem an owner link, and the link survives', async (_, headers) => {
  const { port } = await listenMacShaped();
  const code = await mint(port);
  const refused = await redeem(port, code, headers);
  expect(refused.status).toBe(403);
  expect(refused.cookie).toBeNull();
  expect((await redeem(port, code)).status).toBe(200);
});

test('only the owner token mints a link: not an owner session, not a device, not nobody', async () => {
  const { port, db, teamId } = await listenMacShaped();
  const session = await redeem(port, await mint(port));
  const device = createPairedDevice(db, { teamId, name: 'phone' });
  for (const headers of <Record<string, string>[]>[
    { cookie: session.cookie ?? '', ...SAME_ORIGIN },
    { authorization: `Bearer ${device.token}` },
  ]) {
    expect((await call(port, '/api/auth/owner-link', { method: 'POST', headers })).status).toBe(
      403,
    );
  }
  expect((await call(port, '/api/auth/owner-link', { method: 'POST' })).status).toBe(401);
});

test('`token --link` prints a link that signs the browser in', async () => {
  const { port, teamId } = await listenMacShaped();
  let out = '';
  const exit = await runTokenLinkCommand({
    env: { CAIRN_TOKEN: TOKEN, PORT: String(port) },
    writeOut: (text) => {
      out += text;
    },
  });
  expect(exit, out).toBe(0);
  const link = out.split('\n').find((line) => line.startsWith('http://'));
  expect(link).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/app#owner=`));
  const code = parseOwnerFragment(new URL(link ?? '').hash);
  const signedIn = await redeem(port, code ?? '');
  expect(signedIn.status).toBe(200);
  expect((await createApiKey(port, teamId, { cookie: signedIn.cookie ?? '' })).status).toBe(201);
});

test('`token --link` names the problem when no server is running or the token is wrong', async () => {
  const { port } = await listenMacShaped();
  let out = '';
  const wrong = await runTokenLinkCommand({
    env: { CAIRN_TOKEN: 'not-the-token', PORT: String(port) },
    writeOut: (text) => {
      out += text;
    },
  });
  expect(wrong).toBe(1);
  expect(out).toContain('refused to create a sign-in link');
  out = '';
  const idle = createHttpServer();
  await new Promise<void>((resolve) => idle.listen(0, '127.0.0.1', resolve));
  const freePort = (idle.address() as AddressInfo).port;
  await new Promise<void>((resolve) => idle.close(() => resolve()));
  const down = await runTokenLinkCommand({
    env: { CAIRN_TOKEN: TOKEN, PORT: String(freePort) },
    writeOut: (text) => {
      out += text;
    },
  });
  expect(down).toBe(1);
  expect(out).toContain('is not running');
});

test.each<[string, Parameters<typeof ownerLinkOrigin>[0], NodeJS.Platform, string | null]>([
  [
    'macOS npx',
    { authToken: TOKEN, requireToken: false, host: '127.0.0.1' },
    'darwin',
    'http://127.0.0.1:8787',
  ],
  [
    'Windows npx bound to all interfaces',
    { authToken: TOKEN, requireToken: false, host: '0.0.0.0' },
    'win32',
    'http://127.0.0.1:8787',
  ],
  [
    'IPv6 loopback bind',
    { authToken: TOKEN, requireToken: false, host: '::1' },
    'darwin',
    'http://[::1]:8787',
  ],
  [
    'Linux, where loopback bootstrap signs the browser in',
    { authToken: TOKEN, requireToken: false, host: '127.0.0.1' },
    'linux',
    null,
  ],
  ['container mode', { authToken: TOKEN, requireToken: true, host: '0.0.0.0' }, 'linux', null],
  ['auth off', { authToken: null, requireToken: false, host: '127.0.0.1' }, 'darwin', null],
  [
    'a LAN address bind',
    { authToken: TOKEN, requireToken: false, host: '192.168.1.5' },
    'darwin',
    null,
  ],
])('the startup link prints for %s: %s', (_, config, platform, expected) => {
  expect(ownerLinkOrigin(config, 8787, platform)).toBe(expected);
});
