import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import {
  COMPUTER_SCREEN_MAX_FRAME_BYTES,
  type ComputerScreenRequest,
  chiefIdFormat,
  type MachineStreamEvent,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { chief, computer, computerCall, machine, step } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { ComputerScreenGateway } from '../src/services/computer-screen.js';
import { deviceStreams } from '../src/services/paired-devices.js';
import { bootServer, type TestServer } from './helpers.js';

const MACHINE_TOKEN = 'screen-test-machine-token';
let s: TestServer;
let gateway: ComputerScreenGateway;
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
  gateway = new ComputerScreenGateway({
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

async function listen() {
  http = createServer();
  gateway.attach(http);
  await new Promise<void>((resolve) => http?.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  return `ws://127.0.0.1:${address.port}`;
}

async function connect(
  url: string,
  token?: string,
  protocols: string[] = [],
  origin = new URL(url.replace(/^ws/, 'http')).origin,
) {
  const socket = new WebSocket(url, protocols, {
    headers: token ? { authorization: `Bearer ${token}` } : { origin },
  });
  sockets.push(socket);
  await once(socket, 'open');
  return socket;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) socket.terminate();
  gateway?.close();
  if (http) await new Promise<void>((resolve) => http?.close(() => resolve()));
  http = undefined;
  disconnect?.();
  s?.dispose();
});

describe('screen capabilities and control leases', () => {
  test('offline computers fail before a channel is dispatched', () => {
    const requests = boot();
    disconnect?.();
    expect(() => gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' })).toThrow(
      /not connected/,
    );
    expect(requests).toHaveLength(0);
  });

  test('another team cannot open or take over the computer', () => {
    boot();
    expect(() =>
      gateway.open('another-team', s.user.id, 'computer-screen', { kind: 'view' }),
    ).toThrow(/not found/);
    expect(() => gateway.acquireControl('another-team', s.user.id, 'computer-screen')).toThrow(
      /not found/,
    );
  });

  test('control and PTY require the exact live user lease', () => {
    boot();
    for (const kind of ['control', 'terminal'] as const) {
      expect(() => gateway.open(s.team.id, s.user.id, 'computer-screen', { kind })).toThrow(
        /control lease/,
      );
    }
    const lease = gateway.acquireControl(s.team.id, s.user.id, 'computer-screen');
    const reclaimed = gateway.acquireControl(s.team.id, s.user.id, 'computer-screen');
    expect(reclaimed.leaseId).not.toBe(lease.leaseId);
    expect(reclaimed.controlFence).toBeGreaterThan(lease.controlFence);
    expect(() =>
      gateway.open(s.team.id, s.user.id, 'computer-screen', {
        kind: 'terminal',
        leaseId: lease.leaseId,
      }),
    ).toThrow(/control lease/);
    expect(() =>
      gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'terminal', leaseId: 'wrong' }),
    ).toThrow(/control lease/);
    const opened = gateway.open(s.team.id, s.user.id, 'computer-screen', {
      kind: 'terminal',
      leaseId: reclaimed.leaseId,
    });
    expect(opened.kind).toBe('terminal');
  });

  test('takeover is refused while a Coordinator holds its execution lease', () => {
    boot();
    s.db
      .update(computer)
      .set({ executionStepId: 'active-bot', executionLeaseExpiresAt: Date.now() + 60000 })
      .where(eq(computer.id, 'computer-screen'))
      .run();
    expect(() => gateway.acquireControl(s.team.id, s.user.id, 'computer-screen')).toThrow(
      /Stop the Coordinator first/,
    );
  });

  test('a live bot control lease cannot be replaced by user control', () => {
    boot();
    s.db
      .update(computer)
      .set({
        controlHolder: 'bot',
        controlLeaseId: 'bot-control',
        controlLeaseExpiresAt: Date.now() + 60000,
      })
      .run();
    expect(() => gateway.acquireControl(s.team.id, s.user.id, 'computer-screen')).toThrow(
      /Stop the Coordinator first/,
    );
  });

  test('a current takeover request allows user control but an expired request does not', () => {
    boot();
    const now = Date.now();
    s.db
      .insert(step)
      .values({
        id: 'takeover-step',
        buildId: 'takeover-thread',
        kind: 'chief',
        status: 'claimed',
        machineId: 'screen-machine',
        createdAt: now,
      })
      .run();
    s.db
      .update(computer)
      .set({ executionStepId: 'takeover-step', executionLeaseExpiresAt: now + 60000 })
      .run();
    s.db
      .insert(computerCall)
      .values({
        id: 'a'.repeat(64),
        teamId: s.team.id,
        computerId: 'computer-screen',
        machineId: 'screen-machine',
        stepId: 'takeover-step',
        toolCallId: 'takeover',
        tool: 'request_takeover',
        params: {},
        replaySafe: false,
        state: 'running',
        deadlineAt: now - 1,
        createdAt: now,
      })
      .run();
    expect(() => gateway.acquireControl(s.team.id, s.user.id, 'computer-screen')).toThrow(
      /Stop the Coordinator first/,
    );
    s.db
      .update(computerCall)
      .set({ deadlineAt: now + 60000 })
      .run();
    s.db
      .insert(computerCall)
      .values({
        id: 'b'.repeat(64),
        teamId: s.team.id,
        computerId: 'computer-screen',
        machineId: 'screen-machine',
        stepId: 'takeover-step',
        toolCallId: 'still-running',
        tool: 'computer_act',
        params: {},
        replaySafe: false,
        state: 'running',
        deadlineAt: now + 60000,
        createdAt: now,
      })
      .run();
    expect(() => gateway.acquireControl(s.team.id, s.user.id, 'computer-screen')).toThrow(
      /Stop the Coordinator first/,
    );
    s.db
      .update(computerCall)
      .set({ state: 'done', finishedAt: now })
      .where(eq(computerCall.id, 'b'.repeat(64)))
      .run();
    const lease = gateway.acquireControl(s.team.id, s.user.id, 'computer-screen');
    expect(lease.leaseId).toBeTruthy();
    gateway.releaseControl(s.team.id, s.user.id, 'computer-screen', lease.leaseId);
    s.db.update(computer).set({ executionStepId: null, executionLeaseExpiresAt: null }).run();
    s.db
      .update(computerCall)
      .set({ state: 'cancelled', finishedAt: null })
      .where(eq(computerCall.id, 'b'.repeat(64)))
      .run();
    expect(() => gateway.acquireControl(s.team.id, s.user.id, 'computer-screen')).toThrow(
      /Stop the Coordinator first/,
    );
    s.db
      .update(computerCall)
      .set({ finishedAt: now })
      .where(eq(computerCall.id, 'b'.repeat(64)))
      .run();
    expect(gateway.acquireControl(s.team.id, s.user.id, 'computer-screen').leaseId).toBeTruthy();
  });

  test('renewal keeps its fence and release rejects a different lease', () => {
    boot();
    const lease = gateway.acquireControl(s.team.id, s.user.id, 'computer-screen');
    const renewed = gateway.renewControl(s.team.id, s.user.id, 'computer-screen', lease.leaseId);
    expect(renewed.controlFence).toBe(lease.controlFence);
    expect(renewed.expiresAt).toBeGreaterThanOrEqual(lease.expiresAt);
    expect(() => gateway.releaseControl(s.team.id, s.user.id, 'computer-screen', 'other')).toThrow(
      /control lease/,
    );
    gateway.releaseControl(s.team.id, s.user.id, 'computer-screen', lease.leaseId);
    expect(s.db.select().from(computer).get()?.controlHolder).toBe('none');
  });

  test('expired leases cannot renew and a new owner gets a new fence', () => {
    boot();
    const old = gateway.acquireControl(s.team.id, s.user.id, 'computer-screen');
    s.db
      .update(computer)
      .set({ controlLeaseExpiresAt: Date.now() - 1 })
      .run();
    expect(() =>
      gateway.renewControl(s.team.id, s.user.id, 'computer-screen', old.leaseId),
    ).toThrow(/control lease/);
    const next = gateway.acquireControl(s.team.id, s.user.id, 'computer-screen');
    expect(next.controlFence).toBeGreaterThan(old.controlFence);
    expect(next.leaseId).not.toBe(old.leaseId);
  });

  test('daemon disconnect invalidates the generation and control lease', () => {
    boot();
    const generation = s.db.select().from(computer).get()?.screenGeneration ?? 0;
    gateway.acquireControl(s.team.id, s.user.id, 'computer-screen');
    disconnect?.();
    const row = s.db.select().from(computer).get();
    expect(row?.screenGeneration).toBe(generation + 1);
    expect(row?.controlHolder).toBe('none');
  });

  test('a new gateway revokes persisted user control after server restart', () => {
    boot();
    gateway.acquireControl(s.team.id, s.user.id, 'computer-screen');
    const prior = s.db.select().from(computer).get()?.screenGeneration ?? 0;
    gateway.close();
    gateway = new ComputerScreenGateway({
      db: s.db,
      machineHub: s.machineHub,
      secretBox: s.secretBox,
    });
    gateway.recover();
    const row = s.db.select().from(computer).get();
    expect(row?.controlHolder).toBe('none');
    expect(row?.screenGeneration).toBeGreaterThan(prior);
  });
});

describe('real websocket screen bridge', () => {
  test('binary bytes pass both ways and each capability connects once', async () => {
    const requests = boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const channel = requests[0];
    if (!channel) throw new Error('screen request missing');
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${channel.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const received = once(viewer, 'message');
    daemon.send(Buffer.from([0, 1, 128, 255]));
    expect((await received)[0]).toEqual(Buffer.from([0, 1, 128, 255]));
    const response = once(daemon, 'message');
    viewer.send(Buffer.from('RFB 003.008\n'));
    expect((await response)[0]).toEqual(Buffer.from('RFB 003.008\n'));
    await expect(connect(base + cap.path, undefined, cap.wsProtocols)).rejects.toThrow(/401/);
  });

  test('an open screen of a revoked device is cut, and another device keeps its own', async () => {
    const requests = boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' }, 'device-a');
    const other = gateway.open(
      s.team.id,
      s.user.id,
      'computer-screen',
      { kind: 'view' },
      'device-b',
    );
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const closed = once(viewer, 'close');
    deviceStreams.closeAll('device-a');
    await closed;
    expect(daemon.readyState).not.toBe(WebSocket.OPEN);
    await expect(connect(base + other.path, undefined, other.wsProtocols)).resolves.toBeDefined();
  });

  test('a revoked device cannot open a screen, and a closed channel leaves no binding behind', () => {
    boot();
    deviceStreams.closeAll('device-gone');
    expect(() =>
      gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' }, 'device-gone'),
    ).toThrow(/revoked/);
    const before = deviceStreams.size();
    gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' }, 'device-live');
    expect(deviceStreams.size()).toBe(before + 1);
    gateway.invalidateComputer('computer-screen');
    expect(deviceStreams.size()).toBe(before);
  });

  test('the daemon greeting is buffered until the viewer attaches', async () => {
    const requests = boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    daemon.send(Buffer.from('RFB 003.008\n'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const viewer = new WebSocket(base + cap.path, cap.wsProtocols, {
      headers: { origin: base.replace(/^ws/, 'http') },
    });
    sockets.push(viewer);
    const received = once(viewer, 'message');
    await once(viewer, 'open');
    expect((await received)[0]).toEqual(Buffer.from('RFB 003.008\n'));
  });

  test('a machine connection requires the assigned machine bearer', async () => {
    const requests = boot();
    const base = await listen();
    gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    await expect(
      connect(`${base}/api/machine/computer-screen/${requests[0]?.id}`, 'bad-token'),
    ).rejects.toThrow(/401/);
  });

  test('tampered viewer tokens fail before websocket upgrade', async () => {
    boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    await expect(
      connect(
        base + cap.path,
        undefined,
        cap.wsProtocols.map((protocol) => (protocol === 'binary' ? protocol : `${protocol}x`)),
      ),
    ).rejects.toThrow(/401/);
  });

  test('viewer caps stay out of URLs and reject a foreign or absent Origin', async () => {
    boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    expect(cap.path).not.toContain('?');
    await expect(
      connect(base + cap.path, undefined, cap.wsProtocols, 'https://outside.example.test'),
    ).rejects.toThrow(/401/);
    await expect(connect(base + cap.path, undefined, cap.wsProtocols, '')).rejects.toThrow(/401/);
  });

  test('mode and generation remain bound even if another sealed payload is supplied', async () => {
    boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const protocol = cap.wsProtocols.find((value) => value.startsWith('cairn-screen.')) ?? '';
    const original = JSON.parse(
      s.secretBox.open(Buffer.from(protocol.slice('cairn-screen.'.length), 'base64url').toString()),
    );
    for (const patch of [{ kind: 'terminal' }, { generation: original.channel.generation + 1 }]) {
      const payload = { ...original, channel: { ...original.channel, ...patch } };
      const forged = Buffer.from(s.secretBox.seal(JSON.stringify(payload))).toString('base64url');
      await expect(
        connect(base + cap.path, undefined, ['binary', `cairn-screen.${forged}`]),
      ).rejects.toThrow(/401/);
    }
  });

  test('a different enrolled machine and query bearer cannot attach', async () => {
    const requests = boot();
    s.db
      .insert(machine)
      .values({
        id: 'other-machine',
        teamId: s.team.id,
        name: 'other',
        tokenHash: hashCredential('other-token'),
      })
      .run();
    const base = await listen();
    gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const path = `${base}/api/machine/computer-screen/${requests[0]?.id}`;
    await expect(connect(path, 'other-token')).rejects.toThrow(/401/);
    await expect(connect(`${path}?token=${MACHINE_TOKEN}`)).rejects.toThrow(/401/);
  });

  test('expired screen capabilities close both live sockets', async () => {
    const requests = boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const closed = Promise.all([once(daemon, 'close'), once(viewer, 'close')]);
    vi.spyOn(Date, 'now').mockReturnValue(cap.expiresAt + 1);
    gateway.sweep();
    vi.restoreAllMocks();
    await closed;
    await expect(connect(base + cap.path, undefined, cap.wsProtocols)).rejects.toThrow(/401/);
  });

  test('an oversized websocket frame closes both ends of the bridge', async () => {
    const requests = boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const closed = Promise.all([once(daemon, 'close'), once(viewer, 'close')]);
    viewer.send(Buffer.alloc(COMPUTER_SCREEN_MAX_FRAME_BYTES + 1));
    await closed;
  });

  test('daemon loss closes both live sockets immediately', async () => {
    const requests = boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const closed = Promise.all([once(daemon, 'close'), once(viewer, 'close')]);
    disconnect?.();
    await closed;
  });

  test('revoking the machine bearer closes an already authenticated screen', async () => {
    const requests = boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const closed = Promise.all([once(daemon, 'close'), once(viewer, 'close')]);
    s.db.update(machine).set({ tokenHash: null }).where(eq(machine.id, 'screen-machine')).run();
    gateway.sweep();
    await closed;
  });

  test('generation changes revoke live sockets and block reconnect', async () => {
    const requests = boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', { kind: 'view' });
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const daemonClosed = once(daemon, 'close');
    const viewerClosed = once(viewer, 'close');
    gateway.invalidateComputer('computer-screen');
    await Promise.all([daemonClosed, viewerClosed]);
    await expect(connect(base + cap.path, undefined, cap.wsProtocols)).rejects.toThrow(/401/);
  });

  test('releasing control closes the user PTY channel immediately', async () => {
    const requests = boot();
    const base = await listen();
    const lease = gateway.acquireControl(s.team.id, s.user.id, 'computer-screen');
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', {
      kind: 'terminal',
      leaseId: lease.leaseId,
    });
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const closed = once(daemon, 'close');
    const viewerClosed = once(viewer, 'close');
    gateway.releaseControl(s.team.id, s.user.id, 'computer-screen', lease.leaseId);
    await Promise.all([closed, viewerClosed]);
  });

  test('lease expiration and daemon loss close live channels', async () => {
    const requests = boot();
    const base = await listen();
    const lease = gateway.acquireControl(s.team.id, s.user.id, 'computer-screen');
    const cap = gateway.open(s.team.id, s.user.id, 'computer-screen', {
      kind: 'control',
      leaseId: lease.leaseId,
    });
    const daemon = await connect(
      `${base}/api/machine/computer-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const closed = once(daemon, 'close');
    const viewerClosed = once(viewer, 'close');
    s.db
      .update(computer)
      .set({ controlLeaseExpiresAt: Date.now() - 1 })
      .run();
    gateway.sweep();
    await Promise.all([closed, viewerClosed]);
  });
});
