import { statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { RemoteRoutesResponse, TunnelAccess } from '@cairn/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { WebSocketServer } from 'ws';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createTunnelRemote } from '../src/services/tunnel-remote.js';
import { bootServer } from './helpers.js';

const OWNER = 'tunnel-remote-owner-token-0123456789abcdef';
const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) releaseTestTempDir(dir);
});

function tempDir(): string {
  const dir = makeTestTempDir('tunnel-remote');
  tmpDirs.push(dir);
  return dir;
}

interface MockRelay {
  url: string;
  close: () => Promise<void>;
  sendRequest: (req: {
    id: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
    remoteAddr: string;
  }) => Promise<{ status: number; headers: [string, string][]; chunks: string[] }>;
}

async function startMockRelay(): Promise<MockRelay> {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  const wss = new WebSocketServer({ noServer: true });
  let activeWs: import('ws').WebSocket | null = null;
  const inflight = new Map<
    string,
    {
      status: number;
      headers: [string, string][];
      chunks: string[];
      resolve: (v: { status: number; headers: [string, string][]; chunks: string[] }) => void;
    }
  >();

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if ((req.url ?? '').split('?', 1)[0] !== '/_tunnel/connect') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      activeWs = ws;
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        if (msg.type === 'hello') {
          ws.send(
            JSON.stringify({
              type: 'ready',
              url: `https://${String(msg.subdomain)}.relay.example.test`,
            }),
          );
          return;
        }
        const id = String(msg.id ?? '');
        const entry = inflight.get(id);
        if (!entry) return;
        if (msg.type === 'res-head') {
          entry.status = Number(msg.status ?? 200);
          entry.headers = (msg.headers as [string, string][]) ?? [];
        } else if (msg.type === 'res-chunk' && typeof msg.data === 'string') {
          entry.chunks.push(Buffer.from(msg.data, 'base64').toString('utf8'));
        } else if (msg.type === 'res-end') {
          inflight.delete(id);
          entry.resolve({ status: entry.status, headers: entry.headers, chunks: entry.chunks });
        }
      });
      ws.on('close', () => {
        if (activeWs === ws) activeWs = null;
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      activeWs?.close();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    sendRequest: (req) =>
      new Promise((resolve, reject) => {
        if (!activeWs) {
          reject(new Error('no active tunnel'));
          return;
        }
        inflight.set(req.id, { status: 0, headers: [], chunks: [], resolve });
        activeWs.send(JSON.stringify({ type: 'req', ...req }));
      }),
  };
}

describe('tunnel-remote service', () => {
  test('refuses enabling when token auth is turned off', async () => {
    const dir = tempDir();
    const s = bootServer({
      authToken: null,
      reposDir: dir,
      attachmentsDir: dir,
      skillsDir: dir,
      skillSourcesPath: join(dir, 'skills.json'),
    });
    const tunnel = createTunnelRemote({
      environmentId: 'env-test-auth-off',
      recordPath: join(dir, 'tunnel-remote.json'),
      defaultRelayUrl: 'https://relay.example.test',
      authToken: null,
      app: () => s.app,
    });
    const status = await tunnel.setEnabled(true);
    expect(status.state).toBe('failed');
    expect(status.error).toBe('auth-off');
    await tunnel.stop();
  });

  test('connects to relay, proxies HTTP and SSE chunks, persists 0600 record, and closes cleanly', async () => {
    const dir = tempDir();
    const relay = await startMockRelay();
    try {
      const s = bootServer({
        authToken: OWNER,
        reposDir: dir,
        attachmentsDir: dir,
        skillsDir: dir,
        skillSourcesPath: join(dir, 'skills.json'),
      });
      const recordPath = join(dir, 'tunnel-remote.json');
      const tunnel = createTunnelRemote({
        environmentId: '0f9d3a52-6c1e-4b7a-9d3e-5a1c2b4d6e80',
        recordPath,
        defaultRelayUrl: relay.url,
        authToken: OWNER,
        app: () => s.app,
      });

      const started = await tunnel.setEnabled(true);
      expect(started.enabled).toBe(true);
      expect(started.state).toBe('ready');
      expect(started.url).toMatch(/^https:\/\/c-[a-f0-9]{8}\.relay\.example\.test$/);
      expect(statSync(recordPath).mode & 0o777).toBe(0o600);

      const descRes = await relay.sendRequest({
        id: 'req-1',
        method: 'GET',
        url: '/api/remote/descriptor',
        headers: { host: new URL(started.url!).host },
        body: null,
        remoteAddr: '203.0.113.10',
      });
      expect(descRes.status).toBe(200);
      expect(JSON.parse(descRes.chunks.join(''))).toHaveProperty('version', 1);

      const unauthRes = await relay.sendRequest({
        id: 'req-2',
        method: 'GET',
        url: '/api/remote/devices',
        headers: { host: new URL(started.url!).host },
        body: null,
        remoteAddr: '203.0.113.10',
      });
      expect(unauthRes.status).toBe(401);

      const grantRes = await s.app.request('/api/remote/pairing', {
        method: 'POST',
        headers: { authorization: `Bearer ${OWNER}` },
      });
      const grant = (await grantRes.json()) as { code: string; environmentId: string };
      const pairRes = await relay.sendRequest({
        id: 'req-3',
        method: 'POST',
        url: '/api/remote/pair',
        headers: {
          host: new URL(started.url!).host,
          origin: started.url!,
          'content-type': 'application/json',
          'x-cairn-browser-auth': '1',
        },
        body: Buffer.from(
          JSON.stringify({
            code: grant.code,
            environmentId: grant.environmentId,
            name: 'Tunnel Phone',
          }),
        ).toString('base64'),
        remoteAddr: '203.0.113.10',
      });
      expect(pairRes.status).toBe(201);
      expect(
        pairRes.headers.some(
          ([k, v]) =>
            k.toLowerCase() === 'set-cookie' && v.includes('cairn_auth=') && v.includes('Secure'),
        ),
      ).toBe(true);

      const stopped = await tunnel.setEnabled(false);
      expect(stopped.enabled).toBe(false);
      expect(stopped.state).toBe('off');
      expect(stopped.url).toBeNull();
      await tunnel.stop();
    } finally {
      await relay.close();
    }
  });

  test('routes response exposes tunnel route without leaking secret or paths', async () => {
    const dir = tempDir();
    const relay = await startMockRelay();
    try {
      const recordPath = join(dir, 'tunnel-remote.json');
      let appRef: ReturnType<typeof bootServer>['app'] | null = null;
      const tunnel = createTunnelRemote({
        environmentId: '0f9d3a52-6c1e-4b7a-9d3e-5a1c2b4d6e80',
        recordPath,
        defaultRelayUrl: relay.url,
        authToken: OWNER,
        app: () => appRef!,
      });
      const s = bootServer({
        authToken: OWNER,
        reposDir: dir,
        attachmentsDir: dir,
        skillsDir: dir,
        skillSourcesPath: join(dir, 'skills.json'),
        remote: {
          tunnelStatus: () => tunnel.status(),
          tunnel,
        },
      });
      appRef = s.app;

      const toggleRes = await s.app.request('/api/remote/tunnel', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${OWNER}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ enabled: true }),
      });
      expect(toggleRes.status).toBe(200);
      const toggleBody = (await toggleRes.json()) as TunnelAccess;
      expect(toggleBody.state).toBe('ready');

      const routesRes = await s.app.request('/api/remote/routes', {
        headers: { authorization: `Bearer ${OWNER}` },
      });
      expect(routesRes.status).toBe(200);
      const routesBody = (await routesRes.json()) as RemoteRoutesResponse;
      expect(routesBody.routes.some((r) => r.kind === 'tunnel' && r.url === toggleBody.url)).toBe(
        true,
      );
      expect(JSON.stringify(routesBody)).not.toContain(dir);

      await tunnel.stop();
    } finally {
      await relay.close();
    }
  });

  test('Clerk OAuth start/callback enforces one-time state nonce and hides clerkToken from routes', async () => {
    const dir = tempDir();
    const relay = await startMockRelay();
    try {
      const recordPath = join(dir, 'tunnel-remote.json');
      let appRef: ReturnType<typeof bootServer>['app'] | null = null;
      const tunnel = createTunnelRemote({
        environmentId: '0f9d3a52-6c1e-4b7a-9d3e-5a1c2b4d6e80',
        recordPath,
        defaultRelayUrl: relay.url,
        authToken: OWNER,
        app: () => appRef!,
      });
      const s = bootServer({
        authToken: OWNER,
        reposDir: dir,
        attachmentsDir: dir,
        skillsDir: dir,
        skillSourcesPath: join(dir, 'skills.json'),
        remote: {
          tunnelStatus: () => tunnel.status(),
          tunnel,
        },
      });
      appRef = s.app;

      const startRes = await s.app.request('/api/remote/account/oauth/start', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${OWNER}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      expect(startRes.status).toBe(200);
      const { loginUrl } = (await startRes.json()) as { loginUrl: string };
      const parsed = new URL(loginUrl);
      expect(parsed.origin).toBe(relay.url);
      expect(parsed.pathname).toBe('/_auth/login');
      const state = parsed.searchParams.get('state');
      expect(state).toBeTruthy();

      const badRes = await s.app.request(
        '/api/remote/account/callback?state=invalid-nonce&token=clerk-jwt-secret&email=ian@example.com',
      );
      expect(badRes.status).toBe(403);

      const okRes = await s.app.request(
        `/api/remote/account/callback?state=${encodeURIComponent(state!)}&token=clerk-jwt-secret&email=ian@example.com&name=Ian&avatar=${encodeURIComponent('https://img.clerk.com/avatar.png')}`,
      );
      expect(okRes.status).toBe(302);
      expect(okRes.headers.get('location')).toBe('/app/settings/remote-access');

      const replayRes = await s.app.request(
        `/api/remote/account/callback?state=${encodeURIComponent(state!)}&token=clerk-jwt-secret&email=ian@example.com`,
      );
      expect(replayRes.status).toBe(403);

      const routesRes = await s.app.request('/api/remote/routes', {
        headers: { authorization: `Bearer ${OWNER}` },
      });
      expect(routesRes.status).toBe(200);
      const routesBody = (await routesRes.json()) as RemoteRoutesResponse;
      expect(routesBody.tunnel?.account).toEqual({
        email: 'ian@example.com',
        displayName: 'Ian',
        avatarUrl: 'https://img.clerk.com/avatar.png',
      });
      expect(JSON.stringify(routesBody)).not.toContain('clerk-jwt-secret');

      await tunnel.stop();
    } finally {
      await relay.close();
    }
  });
});
