import { EventEmitter, once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { PassThrough } from 'node:stream';
import { type ComputerScreenRequest, chiefIdFormat, type MachineStreamEvent } from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { chief, computer, machine } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { ComputerScreenGateway } from '../src/services/computer-screen.js';
import { bootServer, type TestServer } from './helpers.js';

const MACHINE_TOKEN = 'upgrade-ownership-machine-token';
let s: TestServer;
let computerGateway: ComputerScreenGateway;
let http: Server | undefined;
let disconnect: (() => void) | undefined;
const sockets: WebSocket[] = [];

function boot() {
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
      id: 'screen-machine',
      teamId: s.team.id,
      name: 'screen',
      tokenHash: hashCredential(MACHINE_TOKEN),
      capabilities: { mcpServers: [], skills: [] },
    })
    .run();
  s.db
    .insert(computer)
    .values({
      id: 'computer-screen',
      teamId: s.team.id,
      machineId: 'screen-machine',
      scopeKey: `chief:${chiefIdFormat(s.user.id, s.team.id)}`,
      providerRef: 'test-computer',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  computerGateway = new ComputerScreenGateway({
    db: s.db,
    machineHub: s.machineHub,
    secretBox: s.secretBox,
  });
  const requests: ComputerScreenRequest[] = [];
  disconnect = s.machineHub.subscribeMachine(
    s.team.id,
    'screen-machine',
    (event: MachineStreamEvent) => {
      if (event.type === 'computer.screen') requests.push(event.channel);
    },
  );
  return requests;
}

function fakeSocket() {
  const socket = new PassThrough();
  const destroy = vi.spyOn(socket, 'destroy').mockReturnValue(socket);
  const end = vi.spyOn(socket, 'end').mockReturnValue(socket);
  return { socket, destroy, end };
}

function upgrade(server: EventEmitter, url: string, socket: PassThrough) {
  const request = { url, headers: {}, method: 'GET', socket } as unknown as IncomingMessage;
  server.emit('upgrade', request, socket, Buffer.alloc(0));
}

const ID = 'a'.repeat(64);
const SCREEN_PATHS = [`/api/computer-screen/${ID}`, `/api/machine/computer-screen/${ID}`];
const STRAY_PATHS = [
  '/api/not-a-screen',
  `/api/engine-screen/${ID}`,
  `/api/machine/engine-screen/${ID}`,
];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) socket.terminate();
  computerGateway?.close();
  if (http) await new Promise<void>((resolve) => http?.close(() => resolve()));
  http = undefined;
  disconnect?.();
  s?.dispose();
});

describe('screen upgrade ownership', () => {
  test('the gateway answers its own paths and destroys every other upgrade', () => {
    boot();
    const server = new EventEmitter();
    computerGateway.attach(server);
    for (const path of SCREEN_PATHS) {
      const probe = fakeSocket();
      upgrade(server, path, probe.socket);
      expect(probe.destroy, path).not.toHaveBeenCalled();
      expect(probe.end, path).toHaveBeenCalledWith(expect.stringContaining('401'));
    }
    for (const path of STRAY_PATHS) {
      const stray = fakeSocket();
      upgrade(server, path, stray.socket);
      expect(stray.destroy, path).toHaveBeenCalled();
    }
  });
});

async function listen() {
  http = createServer();
  computerGateway.attach(http);
  await new Promise<void>((resolve) => http?.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  return `ws://127.0.0.1:${address.port}`;
}

async function connect(url: string, token?: string, protocols: string[] = []) {
  const socket = new WebSocket(url, protocols, {
    headers: token
      ? { authorization: `Bearer ${token}` }
      : { origin: new URL(url.replace(/^ws/, 'http')).origin },
  });
  sockets.push(socket);
  await once(socket, 'open');
  return socket;
}

describe('computer screen channel', () => {
  test('pairs the machine and viewer sides on one server', async () => {
    const requests = boot();
    const base = await listen();
    const cap = computerGateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const output = once(viewer, 'message');
    daemon.send(Buffer.from('computer-bytes'));
    expect((await output)[0]).toEqual(Buffer.from('computer-bytes'));
  });
});
