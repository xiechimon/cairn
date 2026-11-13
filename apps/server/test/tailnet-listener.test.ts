import { spawn } from 'node:child_process';
import { chmodSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { listenOnTailnetSocket, tailnetIdentityOf } from '../src/lib/tailnet-listener.js';
import { requestOrigin } from '../src/routes-helpers.js';
import { bootServer } from './helpers.js';

const TOKEN = 'tailnet-listener-token-0123456789abcdef';
const SIDECAR_IDENTITY = {
  'Tailscale-User-Login': 'owner@example.com',
  'Tailscale-User-Name': 'Owner Example',
};

const tmpDirs: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) releaseTestTempDir(dir);
});

function tempDir(): string {
  const dir = makeTestTempDir('tn-');
  tmpDirs.push(dir);
  return dir;
}

interface Reply {
  status: number;
  body: string;
}

function viaSocket(
  socketPath: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, headers: { host: 'cairn.tail.ts.net', ...headers } });
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

async function viaTcp(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  return { status: res.status, body: await res.text() };
}

async function bothListeners(dnsName: string | null = null): Promise<{
  socketPath: string;
  port: number;
}> {
  const s = bootServer({ authToken: TOKEN });
  s.app.get('/api/test/who', (c) => c.json({ identity: tailnetIdentityOf(c) }));
  s.app.get('/api/test/origin', (c) => c.json({ origin: requestOrigin(c) }));
  const socketPath = join(tempDir(), 'tailnet.sock');
  const tailnet = await listenOnTailnetSocket(s.app, socketPath, () => dnsName);
  closers.push(() => tailnet.close());
  const port = await new Promise<number>((resolve) => {
    const server = createServer(getRequestListener(s.app.fetch));
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    closers.push(
      () =>
        new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
    );
  });
  return { socketPath, port };
}

const bearer = { authorization: `Bearer ${TOKEN}` };

describe('identity comes from the tailnet listener, never from a header on its own', () => {
  test('a request over the tailnet socket carries the sidecar WhoIs identity', async () => {
    const { socketPath } = await bothListeners();
    const reply = await viaSocket(socketPath, '/api/test/who', { ...bearer, ...SIDECAR_IDENTITY });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({
      identity: { login: 'owner@example.com', name: 'Owner Example' },
    });
  });

  test('the same headers on the normal listener give no identity', async () => {
    const { port } = await bothListeners();
    const reply = await viaTcp(port, '/api/test/who', { ...bearer, ...SIDECAR_IDENTITY });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ identity: null });
  });

  test('WhoIs failure (the sidecar sends no identity) gives no identity', async () => {
    const { socketPath } = await bothListeners();
    const reply = await viaSocket(socketPath, '/api/test/who', bearer);
    expect(JSON.parse(reply.body)).toEqual({ identity: null });
  });

  test('a name without a login is not an identity', async () => {
    const { socketPath } = await bothListeners();
    const reply = await viaSocket(socketPath, '/api/test/who', {
      ...bearer,
      'Tailscale-User-Name': 'Owner Example',
    });
    expect(JSON.parse(reply.body)).toEqual({ identity: null });
  });

  test('a login without a name keeps the login and a null name', async () => {
    const { socketPath } = await bothListeners();
    const reply = await viaSocket(socketPath, '/api/test/who', {
      ...bearer,
      'Tailscale-User-Login': 'owner@example.com',
    });
    expect(JSON.parse(reply.body)).toEqual({
      identity: { login: 'owner@example.com', name: null },
    });
  });

  test.each([
    ['blank', ' '],
    ['an oversized value', 'a'.repeat(400)],
  ])('%s login is rejected', async (_label, login) => {
    const { socketPath } = await bothListeners();
    const reply = await viaSocket(socketPath, '/api/test/who', {
      ...bearer,
      'Tailscale-User-Login': login,
    });
    expect(JSON.parse(reply.body)).toEqual({ identity: null });
  });
});

describe('the tailnet listener restores the external https origin (P2)', () => {
  const DNS_NAME = 'cairn.tail.ts.net';

  test('request origin is https on the node DNS name, even for a spoofed Host or forwarded headers', async () => {
    const { socketPath } = await bothListeners(DNS_NAME);
    const reply = await viaSocket(socketPath, '/api/test/origin', {
      ...bearer,
      host: 'evil.example',
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'evil.example',
    });
    expect(JSON.parse(reply.body)).toEqual({ origin: `https://${DNS_NAME}` });
  });

  test('before the node name is known it falls back to https on the request host', async () => {
    const { socketPath } = await bothListeners(null);
    const reply = await viaSocket(socketPath, '/api/test/origin', bearer);
    expect(JSON.parse(reply.body)).toEqual({ origin: 'https://cairn.tail.ts.net' });
  });

  test('the normal listener keeps its own http origin and ignores forwarded headers', async () => {
    const { port } = await bothListeners(DNS_NAME);
    const reply = await viaTcp(port, '/api/test/origin', {
      ...bearer,
      'x-forwarded-proto': 'https',
      'x-forwarded-host': DNS_NAME,
    });
    expect(JSON.parse(reply.body)).toEqual({ origin: `http://127.0.0.1:${port}` });
  });

  test('the machine enrollment approval link is https on the tailnet and http locally', async () => {
    const { socketPath, port } = await bothListeners(DNS_NAME);
    const startPath = '/api/machine/enroll/start';
    const viaTailnet = await new Promise<Reply>((resolve, reject) => {
      const req = request({
        socketPath,
        path: startPath,
        method: 'POST',
        headers: { host: DNS_NAME, 'content-type': 'application/json' },
      });
      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      });
      req.on('error', reject);
      req.end(JSON.stringify({ name: 'laptop' }));
    });
    expect(JSON.parse(viaTailnet.body).url).toMatch(
      new RegExp(`^https://${DNS_NAME}/app/machines/authorize\\?enroll=`),
    );
    const local = await fetch(`http://127.0.0.1:${port}${startPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'laptop' }),
    });
    expect(((await local.json()) as { url: string }).url).toMatch(
      new RegExp(`^http://127.0.0.1:${port}/app/machines/authorize`),
    );
  });
});

describe('identity grants no access: the token is still required on both listeners', () => {
  test.each([
    ['tailnet socket', 'socket'],
    ['normal listener', 'tcp'],
  ])(
    'spoofed or genuine identity headers without a token get 401 on the %s',
    async (_name, via) => {
      const { socketPath, port } = await bothListeners();
      const reply =
        via === 'socket'
          ? await viaSocket(socketPath, '/api/teams', SIDECAR_IDENTITY)
          : await viaTcp(port, '/api/teams', SIDECAR_IDENTITY);
      expect(reply.status).toBe(401);
    },
  );

  test('the bearer token still works over the tailnet socket', async () => {
    const { socketPath } = await bothListeners();
    expect((await viaSocket(socketPath, '/api/teams', bearer)).status).toBe(200);
  });
});

describe('tailnet socket lifecycle', () => {
  test('the socket is owner-only and is removed on close', async () => {
    const s = bootServer({ authToken: TOKEN });
    const dir = tempDir();
    const socketPath = join(dir, 'tailnet.sock');
    const tailnet = await listenOnTailnetSocket(s.app, socketPath);
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
    await tailnet.close();
    expect(readdirSync(dir)).toEqual([]);
  });

  test('a stale socket left by a killed server is replaced', async () => {
    const s = bootServer({ authToken: TOKEN });
    const dir = tempDir();
    const socketPath = join(dir, 'tailnet.sock');
    const crashed = spawn(
      process.execPath,
      [
        '-e',
        `require('node:net').createServer().listen(${JSON.stringify(socketPath)}, () => console.log('up'))`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    await new Promise<void>((resolve) => crashed.stdout.once('data', () => resolve()));
    const exited = new Promise<void>((resolve) => crashed.once('exit', () => resolve()));
    crashed.kill('SIGKILL');
    await exited;
    expect(statSync(socketPath).isSocket()).toBe(true);
    chmodSync(socketPath, 0o600);
    const tailnet = await listenOnTailnetSocket(s.app, socketPath);
    closers.push(() => tailnet.close());
    expect((await viaSocket(socketPath, '/api/teams', bearer)).status).toBe(200);
  });

  test('a regular file at the socket path is never deleted', async () => {
    const s = bootServer({ authToken: TOKEN });
    const dir = tempDir();
    const socketPath = join(dir, 'tailnet.sock');
    writeFileSync(socketPath, 'precious');
    await expect(listenOnTailnetSocket(s.app, socketPath)).rejects.toThrow(/not a socket/);
    expect(readFileSync(socketPath, 'utf8')).toBe('precious');
  });

  test('a missing directory is an error, not a silent mkdir', async () => {
    const s = bootServer({ authToken: TOKEN });
    const socketPath = join(tempDir(), 'absent', 'tailnet.sock');
    await expect(listenOnTailnetSocket(s.app, socketPath)).rejects.toThrow();
  });
});

describe('the identity header is read in exactly one module', () => {
  test('no other server source touches Tailscale-User-* request headers', () => {
    const root = join(import.meta.dirname, '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts') && /tailscale-user/i.test(readFileSync(path, 'utf8'))) {
          offenders.push(path.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(offenders.sort()).toEqual(['lib/tailnet-listener.ts']);
  });
});

describe('request origins are derived in one place', () => {
  test('only requestOrigin reads the origin of the request URL, so the tailnet scheme cannot be missed', () => {
    const root = join(import.meta.dirname, '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          entry.name.endsWith('.ts') &&
          /new URL\(c\.req\.url\)\.origin/.test(readFileSync(path, 'utf8'))
        ) {
          offenders.push(path.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual(['routes-helpers.ts']);
  });
});

test('a session cookie set through the tailnet socket is Secure', async () => {
  const { socketPath, port } = await bothListeners();
  const issued = await fetch(`http://127.0.0.1:${port}/api/remote/pairing`, {
    method: 'POST',
    headers: bearer,
  });
  expect(issued.status).toBe(201);
  const code = ((await issued.json()) as { code: string }).code;
  const setCookie = await new Promise<string>((resolve, reject) => {
    const req = request({
      socketPath,
      path: '/api/remote/pair',
      method: 'POST',
      headers: { host: 'cairn.tail.ts.net', 'content-type': 'application/json' },
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.headers['set-cookie']?.join('; ') ?? '');
    });
    req.on('error', reject);
    req.end(JSON.stringify({ code, name: 'phone' }));
  });
  expect(setCookie).toContain('cairn_auth=');
  expect(setCookie.toLowerCase()).toContain('secure');
});
