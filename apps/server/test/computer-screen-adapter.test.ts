import { once } from 'node:events';
import { createServer, type Server as HttpServer } from 'node:http';
import { connect, createServer as createNetServer, type Server as NetServer } from 'node:net';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { type ComputerScreenRequest, chiefIdFormat, type MachineStreamEvent } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { OutboundComputerScreens } from '../../daemon/src/computer/screen-channel.js';
import { chief, computer, machine } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { ComputerScreenGateway } from '../src/services/computer-screen.js';
import { bootServer, type TestServer } from './helpers.js';

vi.setConfig({ testTimeout: 10000 });
const TOKEN = 'outbound-computer-token';
let s: TestServer;
let gateway: ComputerScreenGateway;
let adapter: OutboundComputerScreens;
let http: HttpServer;
let net: NetServer;
let viewer: WebSocket | undefined;
let dir: string | undefined;
const cleanup: (() => void)[] = [];

afterEach(async () => {
  viewer?.terminate();
  viewer = undefined;
  await adapter?.close();
  gateway?.close();
  for (const close of cleanup.splice(0)) close();
  if (net) await new Promise<void>((resolve) => net.close(() => resolve()));
  if (http) await new Promise<void>((resolve) => http.close(() => resolve()));
  s?.dispose();
  if (dir) releaseTestTempDir(dir);
  dir = undefined;
});

async function boot(kind: 'view' | 'terminal' = 'view') {
  s = bootServer();
  s.db
    .insert(chief)
    .values({
      id: chiefIdFormat(s.user.id, s.team.id),
      userId: s.user.id,
      teamId: s.team.id,
      createdAt: 1,
    })
    .run();
  s.db
    .insert(machine)
    .values({
      id: 'outbound-machine',
      teamId: s.team.id,
      name: 'screen',
      tokenHash: hashCredential(TOKEN),
    })
    .run();
  s.db
    .insert(computer)
    .values({
      id: 'outbound-screen',
      teamId: s.team.id,
      machineId: 'outbound-machine',
      scopeKey: `chief:${chiefIdFormat(s.user.id, s.team.id)}`,
      providerRef: 'test-computer',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  let request: ComputerScreenRequest | undefined;
  s.machineHub.subscribeMachine(s.team.id, 'outbound-machine', (event: MachineStreamEvent) => {
    if (event.type === 'computer.screen') request = event.channel;
  });
  gateway = new ComputerScreenGateway({
    db: s.db,
    machineHub: s.machineHub,
    secretBox: s.secretBox,
  });
  http = createServer();
  gateway.attach(http);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  const origin = `http://127.0.0.1:${address.port}`;
  const lease =
    kind === 'terminal'
      ? gateway.acquireControl(s.team.id, s.user.id, 'outbound-screen')
      : undefined;
  const cap = gateway.open(s.team.id, s.user.id, 'outbound-screen', {
    kind,
    ...(lease ? { leaseId: lease.leaseId } : {}),
  });
  if (!request) throw new Error('no outbound request');
  return { request, cap, lease, origin };
}

test('the adapter authenticates outbound and bridges a Unix screen stream without inbound daemon ports', async () => {
  const { request, cap, origin } = await boot();
  dir = makeTestTempDir('screen-socket-');
  const path = join(dir, 'view.sock');
  let input = '';
  net = createNetServer((socket) => {
    cleanup.push(() => socket.destroy());
    socket.write('RFB 003.008\n');
    socket.on('data', (data) => {
      input += data.toString();
      socket.write(data);
    });
  });
  await new Promise<void>((resolve) => net.listen(path, resolve));
  let closed = 0;
  adapter = new OutboundComputerScreens({
    serverUrl: origin,
    getToken: () => TOKEN,
    provider: {
      async connectScreen(target) {
        expect(target.kind).toBe('view');
        expect(target).not.toHaveProperty('token');
        expect(JSON.stringify(target)).not.toContain(TOKEN);
        const stream = connect(path);
        return {
          stream,
          close: () => {
            closed++;
            stream.destroy();
          },
        };
      },
    },
  });
  const running = adapter.dispatch(request);
  viewer = new WebSocket(origin.replace('http:', 'ws:') + cap.path, cap.wsProtocols, {
    headers: { origin },
  });
  const greeting = once(viewer, 'message');
  await once(viewer, 'open');
  expect((await greeting)[0].toString()).toBe('RFB 003.008\n');
  const echoed = once(viewer, 'message');
  viewer.send(Buffer.from([0, 128, 255]));
  expect((await echoed)[0]).toEqual(Buffer.from([0, 128, 255]));
  expect(input.length).toBe(3);
  viewer.close();
  await running;
  expect(closed).toBe(1);
});

test('failed machine authentication cannot start a desktop or PTY resource', async () => {
  const { request, origin } = await boot();
  const connectScreen = vi.fn();
  adapter = new OutboundComputerScreens({
    serverUrl: origin,
    getToken: () => 'invalid-token',
    provider: { connectScreen },
  });
  await adapter.dispatch(request);
  expect(connectScreen).not.toHaveBeenCalled();
});

test('local user control remains fenced until resource teardown completes', async () => {
  const { request, cap, origin, lease } = await boot('terminal');
  let finishRelease = (): void => {};
  let releasing = false;
  const released = new Promise<void>((resolve) => {
    finishRelease = resolve;
  });
  adapter = new OutboundComputerScreens({
    serverUrl: origin,
    getToken: () => TOKEN,
    provider: {
      async connectScreen() {
        return {
          stream: new PassThrough(),
          close: () => {
            releasing = true;
            return released;
          },
        };
      },
    },
  });
  const running = adapter.dispatch(request);
  viewer = new WebSocket(origin.replace('http:', 'ws:') + cap.path, cap.wsProtocols, {
    headers: { origin },
  });
  await once(viewer, 'open');
  try {
    expect(adapter.hasUserControl(request.scopeKey)).toBe(true);
    gateway.releaseControl(s.team.id, s.user.id, 'outbound-screen', lease?.leaseId ?? 'missing');
    await vi.waitFor(() => expect(releasing).toBe(true));
    expect(adapter.hasUserControl(request.scopeKey)).toBe(true);
  } finally {
    viewer?.terminate();
    finishRelease();
    await running;
  }
  expect(adapter.hasUserControl(request.scopeKey)).toBe(false);
});

test('releasing user control closes the adapter and kills its PTY resource', async () => {
  const { request, cap, origin, lease } = await boot('terminal');
  let released = 0;
  adapter = new OutboundComputerScreens({
    serverUrl: origin,
    getToken: () => TOKEN,
    provider: {
      async connectScreen(target) {
        expect(target.kind).toBe('terminal');
        expect(target.controlLeaseId).toBe(lease?.leaseId);
        const stream = new PassThrough();
        return {
          stream,
          close: () => {
            released++;
            stream.destroy();
          },
        };
      },
    },
  });
  const running = adapter.dispatch(request);
  viewer = new WebSocket(origin.replace('http:', 'ws:') + cap.path, cap.wsProtocols, {
    headers: { origin },
  });
  await once(viewer, 'open');
  await vi.waitFor(() => expect(released).toBe(0));
  gateway.releaseControl(s.team.id, s.user.id, 'outbound-screen', lease?.leaseId ?? 'missing');
  await running;
  expect(released).toBe(1);
});

test('a provider resolving after shutdown is still released and never receives input', async () => {
  const { request, origin } = await boot('terminal');
  let release: ((value: { stream: PassThrough; close: () => void }) => void) | undefined;
  let released = 0;
  adapter = new OutboundComputerScreens({
    serverUrl: origin,
    getToken: () => TOKEN,
    provider: {
      connectScreen: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  });
  const running = adapter.dispatch(request);
  await vi.waitFor(() => expect(release).toBeDefined());
  expect(adapter.hasUserControl(request.scopeKey)).toBe(true);
  await adapter.close();
  expect(adapter.hasUserControl(request.scopeKey)).toBe(true);
  const stream = new PassThrough();
  release?.({
    stream,
    close: () => {
      released++;
      stream.destroy();
    },
  });
  await running;
  await vi.waitFor(() => expect(released).toBe(1));
  expect(adapter.hasUserControl(request.scopeKey)).toBe(false);
});
