import { mkdirSync, writeFileSync } from 'node:fs';
import { type IncomingHttpHeaders, type IncomingMessage, request } from 'node:http';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { browserSession, pairedDevice, todo } from '../src/db/schema.js';
import {
  CONNECT_AUTH_COOKIE,
  connectOriginOf,
  openConnectListener,
} from '../src/lib/connect-listener.js';
import { registerTokenAuth } from '../src/lib/token-auth.js';
import {
  AUTH_COOKIE,
  issueBrowserSession,
  issueStreamTicket,
} from '../src/services/browser-session.js';
import {
  createPairedDevice,
  issuePairingGrant,
  revokePairedDevice,
} from '../src/services/paired-devices.js';
import { bootServer } from './helpers.js';

const HOST = 'host.connect.example';
const ORIGIN = `https://${HOST}`;
const OWNER = 'local-owner-not-public';
const DEVICE = 'paired-device';
const writeHeaders = { origin: ORIGIN, 'content-type': 'application/json' };

async function start(app: Hono, assets: ReadonlySet<string> = new Set()) {
  const listener = openConnectListener(app, HOST, assets);
  onTestFinished(() => listener.close());
  await listener.ready;
  const address = listener.server.address();
  if (address === null || typeof address === 'string') throw new Error('missing loopback port');
  expect(address.address).toBe('127.0.0.1');
  const call = (
    method: string,
    path: string,
    headers: Record<string, string | undefined> = {},
    body?: string,
  ) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            method,
            path,
            agent: false,
            headers: { host: HOST, ...headers },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                body: Buffer.concat(chunks).toString(),
              }),
            );
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.end(body);
      },
    );
  const raw = (target: string, headers = `Host: ${HOST}`, method = 'GET', body = '') =>
    new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: address.port });
      let reply = '';
      socket.setTimeout(2000, () => socket.destroy(new Error('raw request timed out')));
      socket.on('connect', () =>
        socket.write(
          `${method} ${target} HTTP/1.1\r\n${headers}\r\n${/^Connection:/im.test(headers) ? '' : 'Connection: close\r\n'}\r\n${body}`,
        ),
      );
      socket.on('data', (chunk: Buffer) => {
        reply += chunk.toString();
      });
      socket.on('end', () => resolve(reply));
      socket.on('error', reject);
    });
  const stream = (path: string, headers: Record<string, string> = {}) =>
    new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          agent: false,
          headers: { host: HOST, ...headers },
          signal: AbortSignal.timeout(3000),
        },
        resolve,
      );
      req.on('error', reject);
      onTestFinished(() => {
        req.destroy();
      });
      req.end();
    });
  return { ...listener, call, raw, stream };
}

function probe() {
  const app = new Hono();
  const hits: string[] = [];
  registerTokenAuth(app, OWNER, {
    resolveDeviceId: (value) => (value === DEVICE ? 'device-id' : null),
    resolveSession: (value) =>
      value === 'device-session'
        ? { kind: 'device', deviceId: 'device-id' }
        : { kind: 'owner', deviceId: null },
    redeemTicket: (value) => (value === 'owner-ticket' ? { kind: 'owner', deviceId: null } : null),
    isDeviceActive: (id) => id === 'device-id',
  });
  app.all('*', (c) => {
    hits.push(`${c.req.method} ${c.req.path}`);
    return c.json({
      path: c.req.path,
      origin: connectOriginOf(c),
      headers: Object.fromEntries(c.req.raw.headers),
    });
  });
  return { app, hits };
}

const GET_PATHS = [
  '/api/auth/session',
  '/api/user/me',
  '/api/teams',
  '/api/projects',
  '/api/projects/p/todos',
  '/api/todos',
  '/api/tasks',
  '/api/needs-you',
  '/api/todos/t',
  '/api/teams/t/chief',
  '/api/teams/t/chief/threads',
  '/api/conversations/c/messages',
  '/api/teams/t/model-routing',
  '/api/teams/t/machines',
  '/api/teams/t/stream',
  '/api/conversations/c/stream',
];
const POST_PATHS = [
  '/api/teams/t/chief/threads',
  '/api/conversations/c/messages',
  '/api/projects/p/todos',
  '/api/todos/t/orchestrate',
  '/api/todos/t/messages',
  '/api/teams/t/chief/threads/c/stop',
  '/api/teams/t/chief/threads/c/questions/q/answer',
  '/api/teams/t/chief/threads/c/questions/q/cancel',
  '/api/auth/stream-ticket',
];
const DENIED_PATHS = [
  '/api/auth/bootstrap',
  '/api/auth/access',
  '/api/remote/identity',
  '/api/remote/routes',
  '/api/remote/pairing',
  '/api/remote/pairing/g',
  '/api/remote/devices',
  '/api/remote/devices/d',
  '/api/teams/t/providers',
  '/api/teams/t/secrets',
  '/api/teams/t/api-keys',
  '/api/teams/t/github/connection',
  '/api/computers',
  '/api/server/status',
  '/api/backup',
  '/api/files',
  '/api/projects/p',
  '/api/teams/t/members',
  '/api/machine',
  '/api/machine/enroll',
  '/api/machine/enroll/confirm',
  '/api/machine/me',
  '/api/machines/enroll/start',
  '/api/mcp',
  '/api/oauth/callback',
  '/git/t/repo/info/refs',
  '/api/attachments/a',
  '/uploads/a',
  '/api/teams/t/push/subscriptions',
  '/_mp/api/track',
  '/api/future-route',
  '/secret.txt',
  '/assets/missing.js',
];

describe('Connect exact surface over the raw listener', () => {
  test('every allowed device template rejects owners and admits only device credentials', async () => {
    const p = probe();
    const s = await start(p.app);
    for (const [method, paths] of [
      ['GET', GET_PATHS],
      ['POST', POST_PATHS],
    ] as const) {
      for (const path of paths) {
        for (const headers of [
          {},
          { authorization: `Bearer ${OWNER}` },
          { cookie: `${AUTH_COOKIE}=owner-session` },
          { cookie: `${CONNECT_AUTH_COOKIE}=owner-session` },
          { authorization: 'Bearer machine-key' },
          { authorization: 'Bearer mcp-key' },
          { authorization: 'Bearer oauth-key' },
          { authorization: 'Basic Z2l0OmtleQ==' },
        ]) {
          const before = p.hits.length;
          expect(
            (await s.call(method, path, { ...writeHeaders, ...headers })).status,
            `${method} ${path}`,
          ).toBe(401);
          expect(p.hits).toHaveLength(before);
        }
        for (const headers of [
          { authorization: `Bearer ${DEVICE}` },
          { cookie: `${CONNECT_AUTH_COOKIE}=device-session` },
        ]) {
          const result = await s.call(method, path, { ...writeHeaders, ...headers });
          expect(result.status, `${method} ${path}`).toBe(200);
          expect(result.headers['cache-control']).toBe('no-store');
        }
        expect((await s.call('OPTIONS', path, writeHeaders)).status).toBe(404);
        expect((await s.call('HEAD', path, writeHeaders)).status).toBe(404);
      }
    }
  });

  test('denied protocols, reads, writes and future routes never reach their handlers', async () => {
    const p = probe();
    const s = await start(p.app);
    for (const path of DENIED_PATHS) {
      for (const method of ['GET', 'POST', 'DELETE', 'PATCH']) {
        for (const auth of ['', OWNER, DEVICE, 'machine-key', 'mcp-key', 'oauth-key']) {
          expect(
            (await s.call(method, path, { ...writeHeaders, authorization: `Bearer ${auth}` }))
              .status,
            `${method} ${path}`,
          ).toBe(404);
        }
      }
    }
    expect(p.hits).toEqual([]);
  });

  test('only the document and snapshotted exact asset paths are anonymous', async () => {
    const p = probe();
    const assets = new Set(['/assets/build.js', '/sw.js', '/fonts/font.woff2']);
    const s = await start(p.app, assets);
    assets.add('/secret.txt');
    for (const path of ['/', '/app', '/app/tasks/detail', '/app/secret.txt']) {
      expect(JSON.parse((await s.call('GET', path)).body).path).toBe('/');
    }
    for (const path of ['/assets/build.js', '/sw.js', '/fonts/font.woff2']) {
      expect((await s.call('GET', path)).status).toBe(200);
      expect((await s.call('HEAD', path)).status).toBe(200);
      expect((await s.call('POST', path, writeHeaders)).status).toBe(404);
    }
    for (const path of [
      '/elsewhere',
      '/assets/',
      '/assets/build.js.map',
      '/.vite/manifest.json',
      '/secret.txt',
    ]) {
      expect((await s.call('GET', path)).status).toBe(404);
    }
    expect((await s.call('GET', '/api/remote/descriptor')).headers['cache-control']).toBe(
      'no-store',
    );
  });

  test('raw aliases and ambiguous framing are refused before URL normalization or dispatch', async () => {
    const p = probe();
    const s = await start(p.app);
    for (const path of [
      'https://host.connect.example/api/teams',
      '//api/teams',
      '/api//teams',
      '/api/./teams',
      '/api/x/../teams',
      '/api/%2e/teams',
      '/api/%252e%252e/teams',
      '/api%2fteams',
      '/api%252fteams',
      '/api%5cteams',
      '/api\\teams',
      '/api/teams%00',
      '/api/teams%',
      '/api/teams#x',
      '/api/teams?bad=%xz',
    ]) {
      expect(await s.raw(path), path).toMatch(/^HTTP\/1\.1 400 /);
    }
    for (const headers of [
      `Host: ${HOST}\r\nHOST: ${HOST}`,
      `Host: ${HOST}\r\nContent-Length: 0\r\nContent-Length: 0`,
      `Host: ${HOST}\r\nContent-Length: 0\r\nTransfer-Encoding: chunked`,
      `Host: ${HOST}\r\nAuthorization: Bearer ${DEVICE}\r\nAuthorization: Bearer ${OWNER}`,
      `Host: ${HOST}\r\nCookie: ${CONNECT_AUTH_COOKIE}=one\r\nCookie: ${CONNECT_AUTH_COOKIE}=two`,
    ]) {
      expect(await s.raw('/api/teams', headers)).toMatch(/^HTTP\/1\.1 400 /);
    }
    expect(p.hits).toEqual([]);
    expect(
      (await s.call('GET', '/api/teams?filter=a%2Fb', { authorization: `Bearer ${DEVICE}` }))
        .status,
    ).toBe(200);
  });

  test('only the allocated exact authority is accepted and all upgrades are refused', async () => {
    const p = probe();
    const s = await start(p.app);
    for (const host of [
      'localhost',
      '127.0.0.1',
      'HOST.connect.example',
      `${HOST}.`,
      `${HOST}:443`,
      'other.connect.example',
    ]) {
      expect(await s.raw('/', `Host: ${host}`)).toMatch(/^HTTP\/1\.1 421 /);
    }
    expect(await s.raw('/', '')).toMatch(/^HTTP\/1\.1 (400|421) /);
    for (const path of [
      '/',
      '/api/teams/t/stream',
      '/api/computer-screen',
      '/api/machine/computer-screen',
    ]) {
      expect(
        await s.raw(
          path,
          `Host: ${HOST}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nAuthorization: Bearer ${DEVICE}`,
        ),
      ).toMatch(/^HTTP\/1\.1 400 /);
    }
    expect(await s.raw(`${HOST}:443`, `Host: ${HOST}`, 'CONNECT')).toMatch(/^HTTP\/1\.1 404 /);
    expect(await s.raw('/', `Host: ${HOST}\r\nExpect: 100-continue`)).toMatch(/^HTTP\/1\.1 400 /);
    expect(p.hits).toEqual([]);
  });

  test('all writes including bearer and pairing require exact Origin and consistent metadata', async () => {
    const p = probe();
    const s = await start(p.app);
    for (const path of [...POST_PATHS, '/api/remote/pair']) {
      for (const headers of [
        {},
        { origin: 'null' },
        { origin: 'https://other.example' },
        { origin: `${ORIGIN}:443` },
        { origin: ORIGIN, 'sec-fetch-site': 'same-site' },
        { origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
        { origin: ORIGIN, 'sec-fetch-mode': 'no-cors' },
        { origin: ORIGIN, 'sec-fetch-dest': 'document' },
      ]) {
        expect(
          (await s.call('POST', path, { authorization: `Bearer ${DEVICE}`, ...headers })).status,
        ).toBe(403);
      }
      expect(
        (
          await s.call(
            'POST',
            path,
            { ...writeHeaders, authorization: `Bearer ${DEVICE}`, 'sec-fetch-site': 'same-origin' },
            '{}',
          )
        ).status,
      ).toBe(200);
    }
    expect(p.hits).toHaveLength(POST_PATHS.length + 1);
  });

  test('trusted scheme is not supplied by proxy identity headers', async () => {
    const p = probe();
    const s = await start(p.app);
    const forged = {
      forwarded: 'proto=http;host=evil.example',
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'evil.example',
      'x-real-ip': '1.2.3.4',
      'cf-access-jwt-assertion': 'owner',
      'cf-connecting-ip': '1.2.3.4',
      'tailscale-user-login': 'owner@example.com',
      cairnListener: 'tailnet',
    };
    const response = await s.call('GET', '/api/teams', {
      authorization: `Bearer ${DEVICE}`,
      ...forged,
    });
    const body = JSON.parse(response.body);
    expect(body.origin).toBe(ORIGIN);
    for (const key of Object.keys(forged).slice(0, -1)) expect(body.headers[key]).toBeUndefined();
    expect((await s.call('GET', '/api/teams', forged)).status).toBe(401);
  });
});

describe('Connect real application authentication and streams', () => {
  test('one-use pairing issues only the public Secure cookie; private auth remains independent', async () => {
    const privateApp = bootServer({ authToken: OWNER });
    const s = await start(privateApp.app);
    const grant = issuePairingGrant(privateApp.db);
    const pairBody = JSON.stringify({ code: grant.code, name: 'phone' });
    expect((await s.call('POST', '/api/remote/pair', {}, pairBody)).status).toBe(403);
    expect(privateApp.db.select().from(pairedDevice).all()).toHaveLength(0);
    const result = await s.call(
      'POST',
      '/api/remote/pair',
      { ...writeHeaders, 'x-forwarded-proto': 'http' },
      pairBody,
    );
    expect(result.status).toBe(201);
    const cookie = result.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^__Host-cairn_connect=/);
    for (const flag of ['HttpOnly', 'Secure', 'Path=/', 'SameSite=Lax'])
      expect(cookie).toContain(flag);
    expect(cookie).not.toContain('Domain=');
    expect((await s.call('GET', '/api/auth/session', { cookie })).status).toBe(200);
    expect((await s.call('POST', '/api/remote/pair', writeHeaders, pairBody)).status).toBe(401);
    expect(privateApp.db.select().from(pairedDevice).all()).toHaveLength(1);
    const token = JSON.parse(result.body).token;
    expect(
      (await s.call('GET', '/api/projects', { authorization: `Bearer ${token}` })).status,
    ).toBe(200);
    expect((await s.call('POST', '/api/projects', { ...writeHeaders, cookie }, '{}')).status).toBe(
      404,
    );
    expect(
      (
        await privateApp.app.request('/api/teams', {
          headers: { authorization: `Bearer ${OWNER}` },
        })
      ).status,
    ).toBe(200);
    const localPair = await privateApp.app.request('/api/remote/pair', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        code: issuePairingGrant(privateApp.db).code,
        name: 'private browser',
      }),
    });
    expect(localPair.headers.get('set-cookie')).toMatch(/^cairn_auth=/);
    expect(
      (await s.call('GET', '/api/teams', { cookie: localPair.headers.get('set-cookie') ?? '' }))
        .status,
    ).toBe(401);
    expect((await privateApp.app.request('/api/teams', { headers: { cookie } })).status).toBe(401);
    revokePairedDevice(privateApp.db, privateApp.team.id, JSON.parse(result.body).deviceId);
    expect((await s.call('GET', '/api/auth/session', { cookie })).status).toBe(401);
    expect(
      (await s.call('GET', '/api/auth/session', { authorization: `Bearer ${token}` })).status,
    ).toBe(401);
  });

  test('auth-off, owner sessions, expired sessions and vanished devices fail closed', async () => {
    const off = await start(bootServer().app);
    expect((await off.call('GET', '/')).status).toBe(503);
    expect((await off.call('GET', '/api/remote/descriptor')).status).toBe(503);
    const privateApp = bootServer({ authToken: OWNER });
    const s = await start(privateApp.app);
    const { device } = createPairedDevice(privateApp.db, {
      teamId: privateApp.team.id,
      name: 'vanished',
    });
    const owner = issueBrowserSession(privateApp.db, 'owner');
    const expired = issueBrowserSession(
      privateApp.db,
      'device',
      device.id,
      Date.now() - 31 * 24 * 60 * 60_000,
    );
    for (const token of [owner.token, expired.token, '%not-valid']) {
      expect(
        (await s.call('GET', '/api/teams', { cookie: `${CONNECT_AUTH_COOKIE}=${token}` })).status,
      ).toBe(401);
    }
    const active = issueBrowserSession(privateApp.db, 'device', device.id);
    privateApp.db.delete(pairedDevice).where(eq(pairedDevice.id, device.id)).run();
    expect(privateApp.db.select().from(browserSession).all().length).toBeGreaterThan(0);
    expect(
      (await s.call('GET', '/api/teams', { cookie: `${CONNECT_AUTH_COOKIE}=${active.token}` }))
        .status,
    ).toBe(401);
  });

  test.each(['teams', 'conversations'])(
    'one-use device SSE tickets survive neither replay nor revocation: %s',
    async (kind) => {
      const privateApp = bootServer({ authToken: OWNER, pingIntervalMs: 20 });
      const s = await start(privateApp.app);
      const { device, token } = createPairedDevice(privateApp.db, {
        teamId: privateApp.team.id,
        name: 'SSE phone',
      });
      const path = `/api/${kind}/${kind === 'teams' ? privateApp.team.id : 'conversation'}/stream`;
      for (const session of [
        { kind: 'owner', deviceId: null },
        { kind: 'device', deviceId: device.id },
      ] as const) {
        const ticket = issueStreamTicket(
          session,
          session.kind === 'device' ? Date.now() - 61_000 : Date.now(),
        ).ticket;
        expect((await s.call('GET', `${path}?ticket=${ticket}`)).status).toBe(401);
      }
      expect((await s.call('GET', `${path}?token=${token}`)).status).toBe(401);
      const issued = await s.call('POST', '/api/auth/stream-ticket', {
        ...writeHeaders,
        authorization: `Bearer ${token}`,
      });
      expect(issued.status).toBe(200);
      const ticket = JSON.parse(issued.body).ticket;
      const stream = await s.stream(`${path}?ticket=${ticket}`);
      expect(stream.statusCode).toBe(200);
      expect(stream.headers['content-type']).toContain('text/event-stream');
      expect(stream.headers['cache-control']).toBe('no-store');
      const reader = stream.iterator();
      expect((await reader.next()).done).toBe(false);
      expect((await s.call('GET', `${path}?ticket=${ticket}`)).status).toBe(401);
      const beforeRevoke = issueStreamTicket({ kind: 'device', deviceId: device.id }).ticket;
      revokePairedDevice(privateApp.db, privateApp.team.id, device.id);
      while (!(await reader.next()).done) {}
      expect((await s.call('GET', `${path}?ticket=${beforeRevoke}`)).status).toBe(401);
    },
  );

  test('allowed writes persist tasks; rejected writes have no database side effect', async () => {
    const privateApp = bootServer({ authToken: OWNER });
    const projectResponse = await privateApp.app.request('/api/projects', {
      method: 'POST',
      headers: { ...writeHeaders, authorization: `Bearer ${OWNER}` },
      body: JSON.stringify({ name: 'Public task project' }),
    });
    expect(projectResponse.status).toBe(201);
    const project = (await projectResponse.json()) as { id: string };
    const s = await start(privateApp.app);
    const { token } = createPairedDevice(privateApp.db, {
      teamId: privateApp.team.id,
      name: 'task phone',
    });
    const path = `/api/projects/${project.id}/todos`;
    const body = JSON.stringify({ title: 'From paired phone', spec: 'Return a local result' });
    const before = privateApp.db.select().from(todo).all().length;
    expect(
      (await s.call('POST', path, { ...writeHeaders, authorization: `Bearer ${OWNER}` }, body))
        .status,
    ).toBe(401);
    expect(
      (
        await s.call(
          'POST',
          path,
          { ...writeHeaders, authorization: `Bearer ${token}`, origin: 'https://evil.example' },
          body,
        )
      ).status,
    ).toBe(403);
    expect(privateApp.db.select().from(todo).all()).toHaveLength(before);
    const created = await s.call(
      'POST',
      path,
      { ...writeHeaders, authorization: `Bearer ${token}` },
      body,
    );
    expect(created.status).toBe(201);
    expect(privateApp.db.select().from(todo).all()).toHaveLength(before + 1);
    expect(JSON.parse(created.body).title).toBe('From paired phone');
  });

  test('pairing has JSON, streamed-body and per-listener rate limits', async () => {
    const privateApp = bootServer({ authToken: OWNER });
    const s = await start(privateApp.app);
    expect(
      (
        await s.call(
          'POST',
          '/api/remote/pair',
          { origin: ORIGIN, 'content-type': 'text/plain' },
          '{}',
        )
      ).status,
    ).toBe(415);
    expect((await s.call('POST', '/api/remote/pair', writeHeaders, 'x'.repeat(4097))).status).toBe(
      413,
    );
    expect(
      (
        await s.call(
          'POST',
          '/api/remote/pair',
          { ...writeHeaders, 'content-length': '4097' },
          'x'.repeat(4097),
        )
      ).status,
    ).toBe(413);
    for (let i = 0; i < 27; i++)
      expect((await s.call('POST', '/api/remote/pair', writeHeaders, '{}')).status).toBe(400);
    const limited = await s.call('POST', '/api/remote/pair', writeHeaders, '{}');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(privateApp.db.select().from(pairedDevice).all()).toHaveLength(0);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 60_001);
    try {
      expect((await s.call('POST', '/api/remote/pair', writeHeaders, '{}')).status).toBe(400);
    } finally {
      clock.mockRestore();
    }
  });

  test('closing is immediate, idempotent, and drops active HTTP streams', async () => {
    const privateApp = bootServer({ authToken: OWNER, pingIntervalMs: 20 });
    const s = await start(privateApp.app);
    const { token } = createPairedDevice(privateApp.db, {
      teamId: privateApp.team.id,
      name: 'closing phone',
    });
    const stream = await s.stream(`/api/teams/${privateApp.team.id}/stream`, {
      authorization: `Bearer ${token}`,
    });
    expect(stream.statusCode).toBe(200);
    const reader = stream.iterator();
    await reader.next();
    const closed = reader.next().catch(() => ({ done: true }));
    await Promise.all([s.close(), s.close()]);
    await closed;
    expect(s.server.listening).toBe(false);
    const pending = openConnectListener(privateApp.app, HOST, new Set());
    await pending.close();
    expect(pending.server.listening).toBe(false);
  });

  test('SPA navigation never serves a file hidden under /app', async () => {
    const webDir = makeTestTempDir('connect-static-');
    onTestFinished(() => {
      releaseTestTempDir(webDir);
    });
    mkdirSync(join(webDir, 'app'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Public shell</title>');
    writeFileSync(join(webDir, 'app', 'hidden.txt'), 'must not leak');
    const s = await start(bootServer({ authToken: OWNER, webDir }).app);
    const page = await s.call('GET', '/app/hidden.txt');
    expect(page.status).toBe(200);
    expect(page.body).toContain('Public shell');
    expect(page.body).not.toContain('must not leak');
  });
});
