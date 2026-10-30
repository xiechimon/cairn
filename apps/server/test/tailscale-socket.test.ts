import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { afterEach, describe, expect, test } from 'vitest';
import { listenTailscaleSocket } from '../src/lib/tailscale-socket.js';
import { bootServer } from './helpers.js';

const TOKEN = 'socket-test-owner-token';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function socketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'c2057-'));
  chmodSync(dir, 0o700);
  dirs.push(dir);
  return join(dir, 's');
}

function httpStatus(
  socket: string | number,
  headers: Record<string, string>,
  path = '/api/teams',
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        ...(typeof socket === 'string'
          ? { socketPath: socket }
          : { host: '127.0.0.1', port: socket }),
        path,
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        agent: false,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe('#2057 real HTTP transport boundary', () => {
  test('owner socket identity works, TCP requires bearer, socket is owner-only, enrollment uses the same boundary', async () => {
    const app = bootServer({ authToken: TOKEN, tailscaleUsers: ['owner@example.com'] }).app;
    const path = socketPath();
    const unix = await listenTailscaleSocket(app, path);
    const tcp = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await once(tcp, 'listening');
    try {
      const address = tcp.address();
      if (address === null || typeof address === 'string') throw new Error('missing TCP port');
      const identity = {
        'tailscale-user-login': 'owner@example.com',
        'x-forwarded-for': '127.0.0.1',
      };
      expect((await httpStatus(address.port, identity)).status).toBe(401);
      expect(
        (await httpStatus(address.port, { ...identity, authorization: `Bearer ${TOKEN}` })).status,
      ).toBe(200);
      expect((await httpStatus(path, identity)).status).toBe(200);
      expect((await httpStatus(path, { ...identity, authorization: 'Bearer stale' })).status).toBe(
        200,
      );
      expect((await httpStatus(path, { 'tailscale-user-login': 'other@example.com' })).status).toBe(
        401,
      );
      expect((await httpStatus(path, {})).status).toBe(401);
      expect((await httpStatus(path, { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
      expect(lstatSync(path).mode & 0o777).toBe(0o600);
      expect(lstatSync(path).uid).toBe(process.getuid?.());
      const start = await httpStatus(address.port, {}, '/api/machine/enroll/start', {
        name: 'socket-machine',
      });
      const enrollment = JSON.parse(start.body) as { enrollId: string };
      expect(
        (await httpStatus(address.port, identity, '/api/machine/enroll/confirm', enrollment))
          .status,
      ).toBe(401);
      expect(
        (await httpStatus(path, identity, '/api/machine/enroll/confirm', enrollment)).status,
      ).toBe(200);
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => unix.close(() => resolve())),
        new Promise<void>((resolve) => tcp.close(() => resolve())),
      ]);
    }
  });

  test.each([
    'file',
    'directory',
    'symlink',
    'writable-group',
    'writable-other',
    'missing-parent',
    'relative',
  ])('refuses unsafe path: %s', async (kind) => {
    let path = socketPath();
    const parent = join(path, '..');
    if (kind === 'file') writeFileSync(path, 'keep');
    if (kind === 'directory') mkdirSync(path);
    if (kind === 'symlink') symlinkSync('absent', path);
    if (kind === 'writable-group') chmodSync(parent, 0o720);
    if (kind === 'writable-other') chmodSync(parent, 0o702);
    if (kind === 'missing-parent') path = join(path, 'absent');
    if (kind === 'relative') path = 'relative.sock';
    await expect(listenTailscaleSocket(bootServer().app, path)).rejects.toThrow();
    if (kind === 'file') expect(readFileSync(path, 'utf8')).toBe('keep');
    if (kind === 'symlink') expect(lstatSync(path).isSymbolicLink()).toBe(true);
  });

  test('does not replace an active socket', async () => {
    const path = socketPath();
    const active = createServer((connection) => connection.end());
    active.listen(path);
    await once(active, 'listening');
    const inode = lstatSync(path).ino;
    try {
      await expect(listenTailscaleSocket(bootServer().app, path)).rejects.toThrow();
      expect(lstatSync(path).ino).toBe(inode);
    } finally {
      await new Promise<void>((resolve) => active.close(() => resolve()));
    }
  });

  test('replaces a stale socket left by a killed owner process', async () => {
    const path = socketPath();
    const child = spawn(
      process.execPath,
      [
        '-e',
        'require("node:net").createServer().listen(process.argv[1], () => process.stdout.write("ready"))',
        path,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      await Promise.race([
        once(child.stdout, 'data'),
        once(child, 'exit').then(([code]) => {
          throw new Error(`socket fixture exited before readiness: ${code}`);
        }),
      ]);
      child.kill('SIGKILL');
      await once(child, 'exit');
      expect(lstatSync(path).isSocket()).toBe(true);
      const server = await listenTailscaleSocket(bootServer().app, path);
      expect(lstatSync(path).mode & 0o777).toBe(0o600);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
      child.kill('SIGKILL');
    }
  });
});
