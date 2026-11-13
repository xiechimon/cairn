import { createServer as createHttpServer, request } from 'node:http';
import { type AddressInfo, connect, createServer as createTcpServer, type Socket } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { afterEach, expect, test } from 'vitest';
import {
  type LoopbackOwner,
  loopbackOwnerFor,
  peerUidFromTables,
  procNetPeerUid,
} from '../src/lib/loopback-owner.js';
import { createPairedDevice } from '../src/services/paired-devices.js';
import { bootServer } from './helpers.js';

const TOKEN = 'test-loopback-owner-secret';
const OWNER_UID = 4242;
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function listen(
  owner: LoopbackOwner | null,
): Promise<{ port: number; db: ReturnType<typeof bootServer>['db']; teamId: string }> {
  const s = bootServer({ authToken: TOKEN, loopbackOwner: owner });
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

function ownerWithPeer(uid: number | null): LoopbackOwner {
  return { uid: OWNER_UID, peerUid: () => uid };
}

function call(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
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
          resolve({
            status: res.statusCode ?? 0,
            body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
          });
        });
      },
    );
    req.on('error', reject);
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}

test('the owner browser on loopback exchanges a bootstrap for a session', async () => {
  const { port } = await listen(ownerWithPeer(OWNER_UID));
  expect((await call(port, '/api/teams')).status).toBe(401);
  const bootstrapped = await fetch(`http://127.0.0.1:${port}/api/auth/bootstrap`, {
    method: 'POST',
  });
  expect(bootstrapped.status).toBe(200);
  const cookie = (bootstrapped.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0] ?? '')
    .find((value) => value.startsWith('cairn_auth='));
  expect(cookie).toBeTruthy();
  expect((await call(port, '/api/teams', { headers: { cookie: cookie ?? '' } })).status).toBe(200);
  expect((await call(port, '/api/remote/identity')).body).toEqual({ error: 'Unauthorized' });
});

test('a peer owned by another local user still needs the token', async () => {
  const { port } = await listen(ownerWithPeer(OWNER_UID + 1));
  expect((await call(port, '/api/teams')).status).toBe(401);
  expect(
    (await call(port, '/api/teams', { headers: { authorization: `Bearer ${TOKEN}` } })).status,
  ).toBe(200);
});

test('an unresolvable peer uid fails closed', async () => {
  const { port } = await listen(ownerWithPeer(null));
  expect((await call(port, '/api/teams')).status).toBe(401);
});

test('without a loopback owner, loopback requests still need the token', async () => {
  const { port } = await listen(null);
  expect((await call(port, '/api/teams')).status).toBe(401);
});

test.each([
  'evil.example',
  'evil.example:PORT',
  '127.0.0.1',
  '127.0.0.1:1',
  'localhost.evil.example:PORT',
  '127.0.0.1.nip.io:PORT',
])('a rebinding or foreign Host %s is refused', async (host) => {
  const { port } = await listen(ownerWithPeer(OWNER_UID));
  const res = await call(port, '/api/teams', {
    headers: { host: host.replace('PORT', String(port)) },
  });
  expect(res.status).toBe(401);
});

test.each<Record<string, string>>([
  { 'x-forwarded-for': '203.0.113.9' },
  { 'x-forwarded-host': 'cairn.example.com' },
  { forwarded: 'for=203.0.113.9' },
  { via: '1.1 proxy' },
  { 'x-real-ip': '203.0.113.9' },
  { 'cf-connecting-ip': '203.0.113.9' },
  { 'tailscale-user-login': 'owner@example.com' },
])('a request relayed by a proxy %j is refused', async (headers) => {
  const { port } = await listen(ownerWithPeer(OWNER_UID));
  expect((await call(port, '/api/teams', { headers })).status).toBe(401);
});

test.each<Record<string, string>>([
  { 'sec-fetch-site': 'cross-site' },
  { 'sec-fetch-site': 'same-site' },
])('a cross-site read %j is refused', async (headers) => {
  const { port } = await listen(ownerWithPeer(OWNER_UID));
  expect((await call(port, '/api/teams', { headers })).status).toBe(401);
});

test.each<Record<string, string>>([
  {},
  { origin: 'https://evil.example' },
  { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
  { origin: 'null' },
])('a cross-site write %j is refused', async (headers) => {
  const { port } = await listen(ownerWithPeer(OWNER_UID));
  expect((await call(port, '/api/remote/pairing', { method: 'POST', headers })).status).toBe(401);
  expect(
    (
      await call(port, '/api/auth/bootstrap', {
        method: 'POST',
        headers: { ...headers, host: `127.0.0.1:${port}` },
      })
    ).status,
  ).toBe(headers['sec-fetch-site'] === undefined ? 200 : 403);
});

test('a same-origin write from the owner browser can do owner-only work after bootstrap', async () => {
  const { port } = await listen(ownerWithPeer(OWNER_UID));
  const bootstrapped = await fetch(`http://127.0.0.1:${port}/api/auth/bootstrap`, {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  expect(bootstrapped.status).toBe(200);
  const cookie = (bootstrapped.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0] ?? '')
    .find((value) => value.startsWith('cairn_auth='));
  expect(
    (
      await call(port, '/api/remote/pairing', {
        method: 'POST',
        headers: { cookie: cookie ?? '', 'sec-fetch-site': 'same-origin' },
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call(port, '/api/remote/pairing', {
        method: 'POST',
        headers: { cookie: cookie ?? '', 'sec-fetch-site': 'same-site' },
      })
    ).status,
  ).toBe(403);
});

test('a paired-device token on loopback keeps its narrower authority', async () => {
  const { port, db, teamId } = await listen(ownerWithPeer(OWNER_UID));
  const device = createPairedDevice(db, { teamId, name: 'phone' });
  expect(
    (
      await call(port, '/api/remote/pairing', {
        method: 'POST',
        headers: { authorization: `Bearer ${device.token}`, 'sec-fetch-site': 'same-origin' },
      })
    ).status,
  ).toBe(403);
});

test('container mode and platforms without /proc never trust loopback', () => {
  expect(loopbackOwnerFor({ requireToken: true }, 'linux')).toBeNull();
  expect(loopbackOwnerFor({ requireToken: false }, 'darwin')).toBeNull();
  expect(loopbackOwnerFor({ requireToken: false }, 'win32')).toBeNull();
  expect(loopbackOwnerFor({ requireToken: false }, 'linux')?.uid).toBe(process.getuid?.());
});

const TCP_HEADER =
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';

test('the socket tables map a loopback client 4-tuple to its uid', () => {
  const tcp = [
    TCP_HEADER,
    '   0: 0100007F:2253 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 11 1 0 100 0 0 10 0',
    '   1: 0100007F:2253 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 12 1 0 20 4 30 10 -1',
    '   2: 0100007F:D431 0100007F:2253 01 00000000:00000000 00:00000000 00000000 10001        0 13 1 0 20 4 30 10 -1',
  ].join('\n');
  const tcp6 = [
    TCP_HEADER,
    '   0: 0000000000000000FFFF00000100007F:D432 0000000000000000FFFF00000100007F:2253 01 00000000:00000000 00:00000000 00000000  1001        0 14 1 0 20 4 30 10 -1',
    '   1: 00000000000000000000000001000000:D433 00000000000000000000000001000000:2253 01 00000000:00000000 00:00000000 00000000  1002        0 15 1 0 20 4 30 10 -1',
  ].join('\n');
  const peer = (remoteAddress: string, remotePort: number, localAddress = '127.0.0.1') =>
    peerUidFromTables([tcp, tcp6], { remoteAddress, remotePort, localAddress, localPort: 0x2253 });
  expect(peer('127.0.0.1', 0xd431)).toBe(10001);
  expect(peer('::ffff:127.0.0.1', 0xd432, '::ffff:127.0.0.1')).toBe(1001);
  expect(peer('::1', 0xd433, '::1')).toBe(1002);
  expect(peer('127.0.0.1', 0xd439)).toBeNull();
  expect(peer('10.0.0.5', 0xd431)).toBeNull();
});

test.each([
  ['FIN_WAIT2 orphan', '05', '0'],
  ['TIME_WAIT orphan', '06', '0'],
  ['FIN_WAIT1 orphan', '04', '0'],
  ['half-closed live socket', '05', '16'],
  ['inode-less established', '01', '0'],
])('a %s row never vouches for a uid', (_name, state, inode) => {
  const tcp = [
    TCP_HEADER,
    `   0: 0100007F:D431 0100007F:2253 ${state} 00000000:00000000 00:00000000 00000000     0        0 ${inode} 1 0 20 4 30 10 -1`,
  ].join('\n');
  expect(
    peerUidFromTables([tcp], {
      remoteAddress: '127.0.0.1',
      remotePort: 0xd431,
      localAddress: '127.0.0.1',
      localPort: 0x2253,
    }),
  ).toBeNull();
});

test.runIf(process.platform === 'linux')(
  'the live socket table names this process as the owner of its own loopback client',
  async () => {
    const accepted = new Promise<Socket>((resolve) => {
      const server = createTcpServer(resolve);
      server.listen(0, '127.0.0.1', () => {
        const client = connect((server.address() as AddressInfo).port, '127.0.0.1');
        closers.push(
          () =>
            new Promise<void>((done) => {
              client.destroy();
              server.close(() => done());
            }),
        );
      });
    });
    const socket = await accepted;
    expect(
      procNetPeerUid({
        remoteAddress: socket.remoteAddress ?? '',
        remotePort: socket.remotePort ?? 0,
        localAddress: socket.localAddress ?? '',
        localPort: socket.localPort ?? 0,
      }),
    ).toBe(process.getuid?.());
    socket.destroy();
  },
);
