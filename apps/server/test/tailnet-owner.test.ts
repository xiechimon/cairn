import { chmodSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { listenOnTailnetSocket } from '../src/lib/tailnet-listener.js';
import { createPairedDevice } from '../src/services/paired-devices.js';
import { bootServer } from './helpers.js';

const TOKEN = 'test-tailnet-owner-secret';
const LOGIN = 'owner@example.com';
const ORIGIN = 'https://cairn.tail.example';
const identity = { 'Tailscale-User-Login': LOGIN };
const closers: Array<() => Promise<void>> = [];
const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) await close();
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

async function setup(
  policy = {
    ownerLogin: LOGIN as string | null,
    selfTagged: false,
    allowedLogins: [] as string[],
    selfAddresses: [] as string[],
  },
) {
  const s = bootServer({ authToken: TOKEN });
  const dir = makeTestTempDir('owner-');
  dirs.push(dir);
  const socketPath = join(dir, 'tailnet.sock');
  const listener = await listenOnTailnetSocket(
    s.app,
    socketPath,
    () => 'cairn.tail.example',
    () => policy,
  );
  closers.push(() => listener.close());
  return { ...s, socketPath, listener, policy };
}

function call(
  socketPath: string,
  path: string,
  method = 'GET',
  headers: Record<string, string> = identity,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method,
        headers: { host: 'cairn.tail.example', 'content-type': 'application/json', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('A1: forged identity over TCP loopback cannot authenticate', async () => {
  const s = await setup();
  const server = createServer(getRequestListener(s.app.fetch));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/teams`, { headers: identity });
  expect(response.status).toBe(401);
});

test('A2: owner identity no longer gets teams or a signed-in login', async () => {
  const s = await setup();
  expect((await call(s.socketPath, '/api/teams')).status).toBe(401);
  expect(
    (await call(s.socketPath, '/api/remote/identity', 'GET', { authorization: `Bearer ${TOKEN}` }))
      .body,
  ).toEqual({
    login: null,
    via: null,
  });
});

test.each(['other@example.com', 'sharee@example.com', ''])(
  'A3/A4: non-owner or missing source identity %s is denied',
  async (login) => {
    const s = await setup();
    expect(
      (await call(s.socketPath, '/api/teams', 'GET', { 'Tailscale-User-Login': login })).status,
    ).toBe(401);
  },
);

test.each<Record<string, string>>([
  {},
  { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
])('A5: identity is not an owner session, so pairing is refused with %j', async (headers) => {
  const s = await setup();
  expect(
    (await call(s.socketPath, '/api/remote/pairing', 'POST', { ...identity, ...headers })).status,
  ).toBe(401);
  expect(
    (
      await call(
        s.socketPath,
        '/api/machine/enroll/confirm',
        'POST',
        { ...identity, ...headers },
        { enrollId: 'missing' },
      )
    ).status,
  ).toBe(401);
});

test.each(['cross-site', 'same-site'])(
  'a %s read with the owner identity is refused',
  async (site) => {
    const s = await setup();
    expect(
      (await call(s.socketPath, '/api/teams', 'GET', { ...identity, 'sec-fetch-site': site }))
        .status,
    ).toBe(401);
  },
);

test.each<Record<string, string>>([{ 'sec-fetch-site': 'same-origin' }, { origin: ORIGIN }])(
  'identity cannot create pairing codes even with %j',
  async (headers) => {
    const s = await setup();
    expect(
      (await call(s.socketPath, '/api/remote/pairing', 'POST', { ...identity, ...headers })).status,
    ).toBe(401);
  },
);

test('Bearer authentication is exempt from ambient CSRF', async () => {
  const s = await setup();
  expect(
    (
      await call(s.socketPath, '/api/remote/pairing', 'POST', {
        ...identity,
        authorization: `Bearer ${TOKEN}`,
        'sec-fetch-site': 'cross-site',
      })
    ).status,
  ).toBe(201);
});

test('A6: missing owner metadata fails closed, explicit allowlist is fallback, owner metadata takes priority', async () => {
  const s = await setup({
    ownerLogin: null,
    selfTagged: false,
    allowedLogins: [],
    selfAddresses: [],
  });
  expect((await call(s.socketPath, '/api/teams')).status).toBe(401);
  s.policy.allowedLogins.push(LOGIN);
  expect((await call(s.socketPath, '/api/teams')).status).toBe(401);
  s.policy.ownerLogin = 'different@example.com';
  expect((await call(s.socketPath, '/api/teams')).status).toBe(401);
  s.policy.selfTagged = true;
  expect((await call(s.socketPath, '/api/teams')).status).toBe(401);
  s.policy.allowedLogins.length = 0;
  expect((await call(s.socketPath, '/api/teams')).status).toBe(401);
});

test('A7: an existing socket with widened mode is refused, never repaired or replaced', async () => {
  const s = await setup();
  chmodSync(s.socketPath, 0o660);
  await expect(listenOnTailnetSocket(s.app, s.socketPath)).rejects.toThrow(/0600/);
});

test('an active private socket is never unlinked by a second listener', async () => {
  const s = await setup();
  await expect(listenOnTailnetSocket(s.app, s.socketPath)).rejects.toThrow(/in use/);
  expect((await call(s.socketPath, '/api/teams')).status).toBe(401);
});

test('A7: another uid cannot adopt the socket', async () => {
  const s = await setup();
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('Unix socket test requires getuid');
  vi.spyOn(process, 'getuid')
    .mockReturnValueOnce(uid)
    .mockReturnValueOnce(uid + 1);
  await expect(listenOnTailnetSocket(s.app, s.socketPath)).rejects.toThrow(/user|owner/);
});

test.each([
  '/api/machine/enroll/confirm',
  '/api/machine/enroll/%63onfirm',
  '/%61pi/machine/enroll/confirm',
  '/api/machine/%65nroll/confirm',
])('A8: only the owner can approve enrollment through %s', async (confirmPath) => {
  const s = await setup();
  const started = await call(
    s.socketPath,
    '/api/machine/enroll/start',
    'POST',
    {},
    { name: 'test-laptop' },
  );
  const device = createPairedDevice(s.db, { teamId: s.team.id, name: 'phone' });
  const headers = { authorization: `Bearer ${device.token}`, origin: ORIGIN, ...identity };
  expect((await call(s.socketPath, '/api/remote/pairing', 'POST', headers)).status).toBe(403);
  expect(
    (
      await call(s.socketPath, confirmPath, 'POST', headers, {
        enrollId: started.body.enrollId,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        s.socketPath,
        '/api/machine/enroll/confirm',
        'POST',
        { authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
        { enrollId: started.body.enrollId },
      )
    ).status,
  ).toBe(200);
});

test('A9: Funnel headers never grant ambient admission', async () => {
  const s = await setup();
  expect(
    (
      await call(s.socketPath, '/api/teams', 'GET', {
        ...identity,
        'Tailscale-Funnel-Request': '?1',
      })
    ).status,
  ).toBe(401);
  const res = await s.app.request(
    '/api/teams',
    { headers: identity },
    {
      cairnListener: {
        kind: 'funnel',
        dnsName: () => 'cairn.tail.example',
        ownerPolicy: () => s.policy,
      },
    },
  );
  expect(res.status).toBe(401);
});
