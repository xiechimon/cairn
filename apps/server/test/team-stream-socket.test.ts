import { randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect as netConnect } from 'node:net';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { sql } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { closeUnclaimedUpgrades } from '../src/lib/upgrade-claims.js';
import { computerScreensOf } from '../src/services/computer-screen.js';
import { deviceStreamsOf } from '../src/services/paired-devices.js';
import { drainThenReleaseStreams } from '../src/services/stream-drain.js';
import { attachTeamStreamSockets } from '../src/services/team-stream-socket.js';
import { createHttpDrain } from '../src/shutdown-http.js';
import { bootServer, req, type TestServer } from './helpers.js';

const open: { close: () => void }[] = [];
const upgradeNonce = () => randomBytes(16).toString('base64');

afterEach(() => {
  for (const entry of open.splice(0)) entry.close();
});

async function boot(
  authToken: string | null,
  opts: { pingIntervalMs?: number; screens?: boolean; webOrigin?: string; proxyHop?: boolean } = {},
) {
  const s = bootServer(authToken === null ? opts : { ...opts, authToken }) as TestServer;
  const server = serve({ fetch: s.app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  if (opts.screens === true) {
    computerScreensOf({
      db: s.db,
      machineHub: s.machineHub,
      secretBox: s.secretBox,
      trustedProxies: new Set(),
    }).attach(server);
  }
  if (opts.proxyHop === true) {
    server.on('upgrade', (request) => {
      Object.defineProperty(request.socket, 'remoteAddress', { value: '192.0.2.1' });
    });
  }
  const stop = attachTeamStreamSockets(server, s.ctx);
  const closeUnclaimed = closeUnclaimedUpgrades(server);
  const port = (server.address() as AddressInfo).port;
  const sockets: WebSocket[] = [];
  open.push({
    close: () => {
      stop();
      closeUnclaimed();
      for (const socket of sockets) {
        try {
          socket.terminate();
        } catch {
          void 0;
        }
      }
      server.close();
    },
  });
  return { s, port, sockets };
}

function client(url: string, headers: Record<string, string>): WebSocket {
  const socket = new WebSocket(url, { headers });
  socket.on('error', () => {});
  return socket;
}

async function ticketOf(
  s: TestServer,
  token: string,
): Promise<{ ticket: string; transport?: string }> {
  const res = await s.app.request('/api/auth/stream-ticket', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { ticket: string; transport?: string };
}

function streamUrl(port: number, teamId: string, ticket: string | null): string {
  const base = `ws://127.0.0.1:${port}/api/teams/${teamId}/stream`;
  return ticket === null ? base : `${base}?ticket=${encodeURIComponent(ticket)}`;
}

function collect(socket: WebSocket): {
  next: (match?: (ev: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>;
  remaining: (match: (ev: Record<string, unknown>) => boolean) => number;
} {
  const frames: Record<string, unknown>[] = [];
  socket.on('message', (raw) => {
    const envelope = JSON.parse(String(raw)) as { id: number; data: string };
    frames.push(JSON.parse(envelope.data) as Record<string, unknown>);
  });
  return {
    remaining: (match) => frames.filter(match).length,
    next(match = () => true) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const attempt = () => {
          const hit = frames.findIndex(match);
          if (hit >= 0) {
            resolve(frames.splice(hit, 1)[0]!);
            return;
          }
          if (Date.now() > deadline) {
            reject(new Error(`websocket frame timeout (buffered ${frames.length})`));
            return;
          }
          setTimeout(attempt, 25);
        };
        attempt();
      });
    },
  };
}

async function connect(
  port: number,
  teamId: string,
  ticket: string | null,
  headers?: Record<string, string>,
): Promise<{ socket: WebSocket; inbox: ReturnType<typeof collect> }> {
  const socket = client(
    streamUrl(port, teamId, ticket),
    headers ?? {
      origin: `http://127.0.0.1:${port}`,
    },
  );
  const inbox = collect(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('unexpected-response', (_req, res) =>
      reject(new Error(`upgrade refused with ${res.statusCode}`)),
    );
    socket.once('error', reject);
  });
  return { socket, inbox };
}

async function upgradeStatus(
  port: number,
  options: { path: string; method: string; headers: Record<string, string> },
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const call = request(
      {
        port,
        host: '127.0.0.1',
        path: options.path,
        method: options.method,
        headers: options.headers,
      },
      (res) => resolve(res.statusCode ?? 0),
    );
    call.on('error', reject);
    call.end();
  });
}

async function refusedWith(socket: WebSocket): Promise<number> {
  return new Promise<number>((resolve) => {
    socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
    socket.once('open', () => resolve(101));
  });
}

async function followOn(
  s: TestServer,
  connectionId: string,
  conversationId: string,
): Promise<number> {
  const res = await s.app.request(`/api/streams/${connectionId}/conversations`, {
    method: 'PUT',
    headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' },
    body: JSON.stringify({ conversationIds: [conversationId], revision: 1 }),
  });
  return res.status;
}

test('the tab stream runs over one websocket per tab and carries follow frames', async () => {
  const { s, port, sockets } = await boot('secret-token');
  const { ticket, transport } = await ticketOf(s, 'secret-token');
  expect(transport).toBe('websocket');

  const { socket, inbox } = await connect(port, s.team.id, ticket);
  sockets.push(socket);

  const hello = await inbox.next((ev) => ev.type === 'hello');
  expect(hello.type).toBe('hello');
  expect(await followOn(s, hello.connectionId as string, 'conv-a')).toBe(200);
  expect(s.convHub.subscriberCount('conv-a')).toBe(1);

  s.convHub.publishTextDelta('conv-a', 'hello over ws');
  const frame = await inbox.next(
    (ev) => ev.type === 'conversation' && (ev.event as { type: string }).type === 'text_delta',
  );
  expect(frame.type).toBe('conversation');
  expect(frame.conversationId).toBe('conv-a');
  expect((frame.event as { text: string }).text).toBe('hello over ws');

  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(s.convHub.subscriberCount('conv-a')).toBe(0);
});

test('two tabs on the same conversation each get one copy, and one closing leaves the other live', async () => {
  const { s, port, sockets } = await boot('secret-token');
  const first = await connect(port, s.team.id, (await ticketOf(s, 'secret-token')).ticket);
  const second = await connect(port, s.team.id, (await ticketOf(s, 'secret-token')).ticket);
  sockets.push(first.socket, second.socket);

  for (const tab of [first, second]) {
    const hello = await tab.inbox.next((ev) => ev.type === 'hello');
    expect(await followOn(s, hello.connectionId as string, 'conv-b')).toBe(200);
  }
  expect(s.convHub.subscriberCount('conv-b')).toBe(2);

  s.convHub.publishTextDelta('conv-b', 'one copy');
  for (const tab of [first, second]) {
    const frame = await tab.inbox.next(
      (ev) => ev.type === 'conversation' && (ev.event as { type: string }).type === 'text_delta',
    );
    expect((frame.event as { text: string }).text).toBe('one copy');
  }

  const textDelta = (ev: Record<string, unknown>) =>
    ev.type === 'conversation' && (ev.event as { type: string }).type === 'text_delta';
  expect(first.inbox.remaining(textDelta)).toBe(0);
  expect(second.inbox.remaining(textDelta)).toBe(0);
  first.socket.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(s.convHub.subscriberCount('conv-b')).toBe(1);
  s.convHub.publishTextDelta('conv-b', 'still live');
  const survivor = await second.inbox.next(
    (ev) => ev.type === 'conversation' && (ev.event as { type: string }).type === 'text_delta',
  );
  expect((survivor.event as { text: string }).text).toBe('still live');
  expect(second.inbox.remaining(textDelta)).toBe(0);
});

test('an unpaired device is dropped from an open socket', async () => {
  const { s, port, sockets } = await boot('secret-token', { pingIntervalMs: 100 });
  s.db.run(
    sql`INSERT INTO paired_device (id, teamId, name, tokenHash, masked, createdAt) VALUES ('dev-1', ${s.team.id}, 'tab', 'hash-1', '...', 1)`,
  );
  const { ticket } = s.ctx.streamTickets.issue({ kind: 'device', deviceId: 'dev-1' });
  const { socket, inbox } = await connect(port, s.team.id, ticket);
  sockets.push(socket);
  await inbox.next((ev) => ev.type === 'hello');

  s.db.run(sql`DELETE FROM paired_device WHERE id = 'dev-1'`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket stayed open')), 3000);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
});

test('an upgrade without a ticket is refused, and a ticket cannot be reused', async () => {
  const { s, port, sockets } = await boot('secret-token');
  const missing = client(streamUrl(port, s.team.id, null), {
    origin: `http://127.0.0.1:${port}`,
  });
  sockets.push(missing);
  expect(await refusedWith(missing)).toBe(401);

  const { ticket } = await ticketOf(s, 'secret-token');
  const first = await connect(port, s.team.id, ticket);
  sockets.push(first.socket);
  await first.inbox.next((ev) => ev.type === 'hello');
  const reused = client(streamUrl(port, s.team.id, ticket), {
    origin: `http://127.0.0.1:${port}`,
  });
  sockets.push(reused);
  expect(await refusedWith(reused)).toBe(401);
});

test('an upgrade from another origin is refused, and a LAN host is accepted when it matches', async () => {
  const { s, port, sockets } = await boot('secret-token');
  const foreign = client(streamUrl(port, s.team.id, (await ticketOf(s, 'secret-token')).ticket), {
    origin: 'http://evil.example',
  });
  sockets.push(foreign);
  expect(await refusedWith(foreign)).toBe(403);

  const lanHost = `cairn.local:${port}`;
  const { socket } = await connect(port, s.team.id, (await ticketOf(s, 'secret-token')).ticket, {
    origin: `http://${lanHost}`,
    host: lanHost,
  });
  sockets.push(socket);
  expect(socket.readyState).toBe(WebSocket.OPEN);
});

test('the configured public HTTPS origin survives the proxy HTTP hop', async () => {
  const webOrigin = 'https://cairn.example';
  const { s, port, sockets } = await boot('secret-token', { webOrigin, proxyHop: true });
  const ticket = (await ticketOf(s, 'secret-token')).ticket;
  const refused = client(streamUrl(port, s.team.id, ticket), {
    origin: webOrigin,
    host: 'other.example',
    'x-forwarded-proto': 'https',
  });
  sockets.push(refused);
  expect(await refusedWith(refused)).toBe(403);
  const { socket, inbox } = await connect(port, s.team.id, ticket, {
    origin: webOrigin,
    host: 'cairn.example',
    'x-forwarded-proto': 'https',
  });
  sockets.push(socket);
  expect(await inbox.next((frame) => frame.type === 'hello')).toMatchObject({ type: 'hello' });
});

test('malformed, foreign-team, origin-less and non-GET upgrades are refused without crashing', async () => {
  const { s, port, sockets } = await boot('secret-token');
  const base = { connection: 'Upgrade', upgrade: 'websocket' };
  const origin = { origin: `http://127.0.0.1:${port}` };
  const key = { 'sec-websocket-key': upgradeNonce(), 'sec-websocket-version': '13' };

  expect(
    await upgradeStatus(port, {
      path: '/api/teams/%E0%A4%A/stream',
      method: 'GET',
      headers: { ...base, ...origin, ...key },
    }),
  ).toBe(403);
  expect(
    await upgradeStatus(port, {
      path: '/api/teams/other-team/stream',
      method: 'GET',
      headers: { ...base, ...origin, ...key },
    }),
  ).toBe(403);
  expect(
    await upgradeStatus(port, {
      path: `/api/teams/${s.team.id}/stream`,
      method: 'POST',
      headers: { ...base, ...origin, ...key },
    }),
  ).toBe(403);
  expect(
    await upgradeStatus(port, {
      path: `/api/teams/${s.team.id}/stream`,
      method: 'GET',
      headers: { ...base, ...key },
    }),
  ).toBe(403);

  const { socket } = await connect(port, s.team.id, (await ticketOf(s, 'secret-token')).ticket);
  sockets.push(socket);
  expect(socket.readyState).toBe(WebSocket.OPEN);
});

test('seven tabs stream at once while short requests keep flowing', async () => {
  const { s, port, sockets } = await boot('secret-token');
  const tabs = await Promise.all(
    Array.from({ length: 7 }, async () =>
      connect(port, s.team.id, (await ticketOf(s, 'secret-token')).ticket),
    ),
  );
  sockets.push(...tabs.map((tab) => tab.socket));
  for (const tab of tabs) {
    const hello = await tab.inbox.next((ev) => ev.type === 'hello');
    expect(await followOn(s, hello.connectionId as string, 'conv-7')).toBe(200);
  }
  expect(s.convHub.subscriberCount('conv-7')).toBe(7);

  const shortRequests = await Promise.all(
    Array.from({ length: 7 }, () =>
      s.app.request('/api/user/me', {
        method: 'GET',
        headers: { authorization: 'Bearer secret-token' },
      }),
    ),
  );
  expect(shortRequests.every((res) => res.status === 200)).toBe(true);

  s.convHub.publishTextDelta('conv-7', 'seven tabs');
  for (const tab of tabs) {
    const frame = await tab.inbox.next(
      (ev) => ev.type === 'conversation' && (ev.event as { type: string }).type === 'text_delta',
    );
    expect((frame.event as { text: string }).text).toBe('seven tabs');
  }
});

test('shutdown stops upgrades and closes open sockets', async () => {
  const s = bootServer({ authToken: 'secret-token' }) as TestServer;
  const server = serve({ fetch: s.app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const stop = attachTeamStreamSockets(server, s.ctx);
  const port = (server.address() as AddressInfo).port;
  const { ticket } = await ticketOf(s, 'secret-token');
  const { socket, inbox } = await connect(port, s.team.id, ticket);
  await inbox.next((ev) => ev.type === 'hello');

  stop();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket stayed open after shutdown')), 3000);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  server.close();
});

test('the production upgrade assembly still routes the tab stream to the gateway', async () => {
  const { s, port, sockets } = await boot('secret-token', { screens: true });
  const { socket, inbox } = await connect(
    port,
    s.team.id,
    (await ticketOf(s, 'secret-token')).ticket,
  );
  sockets.push(socket);
  await inbox.next((ev) => ev.type === 'hello');
  expect(socket.readyState).toBe(WebSocket.OPEN);
});

test('an unknown upgrade path is closed instead of hanging the socket', async () => {
  const { port } = await boot('secret-token');
  const closed = await new Promise<boolean>((resolve) => {
    const call = request(
      {
        port,
        host: '127.0.0.1',
        path: '/api/nothing/stream',
        method: 'GET',
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          origin: `http://127.0.0.1:${port}`,
          'sec-websocket-key': upgradeNonce(),
          'sec-websocket-version': '13',
        },
      },
      () => resolve(false),
    );
    call.on('error', () => resolve(true));
    call.end();
    setTimeout(() => resolve(false), 2000);
  });
  expect(closed).toBe(true);
});

test('a client that resets its connection during the handshake does not take the server down', async () => {
  const { s, port, sockets } = await boot('secret-token');
  const reset = netConnect(port, '127.0.0.1');
  await new Promise<void>((resolve) => reset.once('connect', () => resolve()));
  reset.write(
    `GET /api/teams/${s.team.id}/stream?ticket=not-a-ticket HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\n` +
      'Connection: Upgrade\r\nUpgrade: websocket\r\n' +
      `Sec-WebSocket-Key: ${upgradeNonce()}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  reset.resetAndDestroy();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const next = await connect(port, s.team.id, (await ticketOf(s, 'secret-token')).ticket);
  sockets.push(next.socket);
  await next.inbox.next((ev) => ev.type === 'hello');
  expect(next.socket.readyState).toBe(WebSocket.OPEN);
});

test('the gateway accepts upgrades on a tailnet unix socket with an https origin', async () => {
  const { s } = await boot('secret-token');
  const dir = makeTestTempDir('cairn-tailnet-');
  const socketPath = join(dir, 'tailnet.sock');
  const server = createServer((_req, res) => res.end());
  await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
  const stop = attachTeamStreamSockets(server, s.ctx);
  const closeUnclaimed = closeUnclaimedUpgrades(server);
  try {
    const { ticket } = await ticketOf(s, 'secret-token');
    const dnsName = 'box.example.ts.net';
    const socket = client(
      `ws+unix:${socketPath}:/api/teams/${s.team.id}/stream?ticket=${encodeURIComponent(ticket)}`,
      { origin: `https://${dnsName}`, host: dnsName },
    );
    const inbox = collect(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('unexpected-response', (_req, res) =>
        reject(new Error(`upgrade refused with ${res.statusCode}`)),
      );
      socket.once('error', reject);
    });
    const hello = await inbox.next((ev) => ev.type === 'hello');
    expect(hello.connectionId).toBeTruthy();
    socket.close();

    const closed = await new Promise<boolean>((resolve) => {
      const call = request(
        {
          socketPath,
          path: '/api/nothing/stream',
          method: 'GET',
          headers: {
            connection: 'Upgrade',
            upgrade: 'websocket',
            origin: `https://${dnsName}`,
            host: dnsName,
            'sec-websocket-key': upgradeNonce(),
            'sec-websocket-version': '13',
          },
        },
        () => resolve(false),
      );
      call.on('error', () => resolve(true));
      call.end();
      setTimeout(() => resolve(false), 2000);
    });
    expect(closed).toBe(true);
  } finally {
    stop();
    closeUnclaimed();
    server.close();
    releaseTestTempDir(dir);
  }
});

test('revoking a device closes its socket at once and refuses further upgrades', async () => {
  const { s, port, sockets } = await boot('secret-token');
  s.db.run(
    sql`INSERT INTO paired_device (id, teamId, name, tokenHash, masked, createdAt) VALUES ('dev-2', ${s.team.id}, 'tab', 'hash-2', '...', 1)`,
  );
  const { ticket } = s.ctx.streamTickets.issue({ kind: 'device', deviceId: 'dev-2' });
  const { socket, inbox } = await connect(port, s.team.id, ticket);
  sockets.push(socket);
  await inbox.next((ev) => ev.type === 'hello');

  deviceStreamsOf(s.db).closeAll('dev-2');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket stayed open after revoke')), 2000);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  const { ticket: nextTicket } = s.ctx.streamTickets.issue({ kind: 'device', deviceId: 'dev-2' });
  const refused = client(streamUrl(port, s.team.id, nextTicket), {
    origin: `http://127.0.0.1:${port}`,
  });
  sockets.push(refused);
  expect(await refusedWith(refused)).toBe(401);
});

function upgradeAttempt(port: number, teamId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const call = request(
      {
        port,
        host: '127.0.0.1',
        path: `/api/teams/${teamId}/stream`,
        method: 'GET',
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          origin: `http://127.0.0.1:${port}`,
          'sec-websocket-key': upgradeNonce(),
          'sec-websocket-version': '13',
        },
      },
      () => resolve(false),
    );
    call.on('error', () => resolve(true));
    call.end();
    setTimeout(() => resolve(false), 2000);
  });
}

test('shutdown releases the follow set and refuses later upgrades', async () => {
  const s = bootServer({ authToken: 'secret-token' }) as TestServer;
  const server = serve({ fetch: s.app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const stop = attachTeamStreamSockets(server, s.ctx);
  const closeUnclaimed = closeUnclaimedUpgrades(server);
  const port = (server.address() as AddressInfo).port;
  const { ticket } = await ticketOf(s, 'secret-token');
  const { socket, inbox } = await connect(port, s.team.id, ticket);
  const hello = await inbox.next((ev) => ev.type === 'hello');
  expect(await followOn(s, hello.connectionId as string, 'conv-9')).toBe(200);
  expect(s.convHub.subscriberCount('conv-9')).toBe(1);

  let midShutdown: Promise<boolean> | null = null;
  const drained = drainThenReleaseStreams({
    drain: createHttpDrain(server),
    release: () => {
      expect(server.listening).toBe(false);
      stop();
      closeUnclaimed();
      midShutdown = upgradeAttempt(port, s.team.id);
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(s.convHub.subscriberCount('conv-9')).toBe(0);
  socket.terminate();

  expect(await midShutdown).toBe(true);
  await drained;
});

test('the ticket endpoint advertises the websocket transport and still keeps SSE for old clients', async () => {
  const s = bootServer({});
  const legacy = await req(s.app, 'GET', `/api/teams/${s.team.id}/stream`);
  expect(legacy.status).toBe(200);
  const ticket = await req(s.app, 'POST', '/api/auth/stream-ticket');
  expect(((await ticket.json()) as { transport?: string }).transport).toBe('websocket');
});
