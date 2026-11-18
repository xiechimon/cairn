import { EventEmitter, once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { PassThrough } from 'node:stream';
import {
  type ComputerScreenRequest,
  chiefIdFormat,
  type EngineScreenRequest,
  type MachineStreamEvent,
} from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { build, chief, computer, machine, project, step, todo } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { ComputerScreenGateway } from '../src/services/computer-screen.js';
import { EngineScreenGateway } from '../src/services/engine-screen.js';
import { bootServer, type TestServer } from './helpers.js';

const MACHINE_TOKEN = 'upgrade-ownership-machine-token';
let s: TestServer;
let computerGateway: ComputerScreenGateway;
let engineGateway: EngineScreenGateway;
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
      capabilities: { mcpServers: [], skills: [], enginePty: true as const },
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
  s.db.insert(project).values({ id: 'engine-project', teamId: s.team.id, name: 'engine' }).run();
  s.db
    .insert(todo)
    .values({
      id: 'engine-todo',
      teamId: s.team.id,
      projectId: 'engine-project',
      title: 'engine run',
      phaseAt: 1,
      seqNum: 1,
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'engine-build',
      todoId: 'engine-todo',
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'engine-step',
      buildId: 'engine-build',
      kind: 'session',
      machineId: 'screen-machine',
      status: 'claimed',
      createdAt: 1,
    })
    .run();
  computerGateway = new ComputerScreenGateway({
    db: s.db,
    machineHub: s.machineHub,
    secretBox: s.secretBox,
  });
  engineGateway = new EngineScreenGateway({
    db: s.db,
    machineHub: s.machineHub,
    secretBox: s.secretBox,
    hub: s.hub,
    attachmentsDir: s.attachmentsDir,
  });
  const requests: { computer: ComputerScreenRequest[]; engine: EngineScreenRequest[] } = {
    computer: [],
    engine: [],
  };
  disconnect = s.machineHub.subscribeMachine(
    s.team.id,
    'screen-machine',
    (event: MachineStreamEvent) => {
      if (event.type === 'computer.screen') requests.computer.push(event.channel);
      if (event.type === 'engine.screen') requests.engine.push(event.channel);
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
const SCREEN_PATHS = [
  `/api/engine-screen/${ID}`,
  `/api/machine/engine-screen/${ID}`,
  `/api/computer-screen/${ID}`,
  `/api/machine/computer-screen/${ID}`,
];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) socket.terminate();
  computerGateway?.close();
  engineGateway?.close();
  if (http) await new Promise<void>((resolve) => http?.close(() => resolve()));
  http = undefined;
  disconnect?.();
  s?.dispose();
});

describe.each([true, false])(
  'screen upgrade ownership (computer gateway attached first: %s)',
  (computerFirst) => {
    test("each gateway answers its own paths and never destroys the other gateway's sockets", () => {
      boot();
      const server = new EventEmitter();
      if (computerFirst) {
        computerGateway.attach(server);
        engineGateway.attach(server);
      } else {
        engineGateway.attach(server);
        computerGateway.attach(server);
      }
      for (const path of SCREEN_PATHS) {
        const probe = fakeSocket();
        upgrade(server, path, probe.socket);
        expect(probe.destroy, path).not.toHaveBeenCalled();
        expect(probe.end, path).toHaveBeenCalledWith(expect.stringContaining('401'));
      }
      const stray = fakeSocket();
      upgrade(server, '/api/not-a-screen', stray.socket);
      expect(stray.destroy).toHaveBeenCalled();
    });
  },
);

async function listen() {
  http = createServer();
  computerGateway.attach(http);
  engineGateway.attach(http);
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

describe('both gateways attached to one server', () => {
  test('an engine screen channel pairs while the computer gateway shares the server', async () => {
    const requests = boot();
    const base = await listen();
    const cap = engineGateway.open(s.team.id, s.user.id, 'engine-step', { kind: 'view' });
    const daemon = await connect(
      `${base}/api/machine/engine-screen/${requests.engine[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const output = once(viewer, 'message');
    daemon.send(Buffer.from('engine-bytes'));
    expect((await output)[0]).toEqual(Buffer.from('engine-bytes'));
  });

  test('a computer screen channel pairs while the engine gateway shares the server', async () => {
    const requests = boot();
    const base = await listen();
    const cap = computerGateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests.computer[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const output = once(viewer, 'message');
    daemon.send(Buffer.from('computer-bytes'));
    expect((await output)[0]).toEqual(Buffer.from('computer-bytes'));
  });
});
