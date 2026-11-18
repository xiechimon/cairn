import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { EngineScreenRequest, MachineStreamEvent } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { build, machine, project, step, todo } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { EngineScreenGateway } from '../src/services/engine-screen.js';
import { bootServer, type TestServer } from './helpers.js';

const MACHINE_TOKEN = 'engine-screen-test-machine-token';
let s: TestServer;
let gateway: EngineScreenGateway;
let http: Server | undefined;
let disconnect: (() => void) | undefined;
const sockets: WebSocket[] = [];

function boot(opts: { pty?: boolean; status?: 'pending' | 'claimed' | 'done' } = {}) {
  s = bootServer();
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
    .insert(machine)
    .values({
      id: 'engine-machine',
      teamId: s.team.id,
      name: 'engine',
      tokenHash: hashCredential(MACHINE_TOKEN),
      capabilities: {
        mcpServers: [],
        skills: [],
        ...(opts.pty === false ? {} : { enginePty: true as const }),
      },
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'engine-step',
      buildId: 'engine-build',
      kind: 'session',
      machineId: 'engine-machine',
      status: opts.status ?? 'claimed',
      createdAt: 1,
    })
    .run();
  gateway = new EngineScreenGateway({
    db: s.db,
    machineHub: s.machineHub,
    secretBox: s.secretBox,
    hub: s.hub,
    attachmentsDir: s.attachmentsDir,
  });
  const requests: EngineScreenRequest[] = [];
  disconnect = s.machineHub.subscribeMachine(
    s.team.id,
    'engine-machine',
    (event: MachineStreamEvent) => {
      if (event.type === 'engine.screen') requests.push(event.channel);
    },
  );
  return requests;
}

function leaseEvents() {
  const events: { type: string; stepId?: string; held?: boolean }[] = [];
  let seq = 0;
  const unsubscribe = s.hub.subscribe(
    s.team.id,
    {
      nextSeq: () => ++seq,
      send: (payload) => {
        events.push(payload as { type: string; stepId?: string; held?: boolean });
        return Promise.resolve();
      },
    },
    s.user.id,
  );
  return { events, unsubscribe };
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

describe('engine takeover leases', () => {
  test('a second acquire steals the lease, raises the fence and revokes the stolen channel', async () => {
    const requests = boot();
    const { events } = leaseEvents();
    const first = gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step');
    const opened = gateway.open(s.team.id, s.user.id, 'engine-step', {
      kind: 'takeover',
      leaseId: first.leaseId,
    });
    const base = await listen();
    const daemon = await connect(
      `${base}/api/machine/engine-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + opened.path, undefined, opened.wsProtocols);
    const cut = Promise.all([once(daemon, 'close'), once(viewer, 'close')]);
    const stolen = gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step');
    expect(stolen.leaseId).not.toBe(first.leaseId);
    expect(stolen.fence).toBeGreaterThan(first.fence);
    await cut;
    expect(() =>
      gateway.open(s.team.id, s.user.id, 'engine-step', {
        kind: 'takeover',
        leaseId: first.leaseId,
      }),
    ).toThrow(/takeover lease/);
    expect(events.filter((e) => e.type === 'engine.lease' && e.held).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  test('an unknown or foreign step is not found', () => {
    boot();
    expect(() => gateway.acquireTakeover(s.team.id, s.user.id, 'missing-step')).toThrow(
      /not found/,
    );
    expect(() => gateway.acquireTakeover('another-team', s.user.id, 'engine-step')).toThrow(
      /not found/,
    );
    expect(() => gateway.open(s.team.id, s.user.id, 'missing-step', { kind: 'view' })).toThrow(
      /not found/,
    );
  });

  test('non-running steps and non-PTY machines reject takeover, and a takeover without the live lease conflicts', () => {
    boot();
    expect(() => gateway.open(s.team.id, s.user.id, 'engine-step', { kind: 'takeover' })).toThrow(
      /takeover lease/,
    );
    const lease = gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step');
    expect(() =>
      gateway.open(s.team.id, s.user.id, 'engine-step', {
        kind: 'takeover',
        leaseId: 'stale-lease',
      }),
    ).toThrow(/takeover lease/);
    expect(() => gateway.renewTakeover(s.team.id, s.user.id, 'engine-step', 'stale-lease')).toThrow(
      /takeover lease/,
    );
    expect(() =>
      gateway.releaseTakeover(s.team.id, s.user.id, 'engine-step', 'stale-lease'),
    ).toThrow(/takeover lease/);
    expect(lease.leaseId).toBeTruthy();

    s.db.update(step).set({ status: 'pending' }).where(eq(step.id, 'engine-step')).run();
    gateway.releaseTakeover(s.team.id, s.user.id, 'engine-step', lease.leaseId);
    expect(() => gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step')).toThrow(/not live/);
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, 'engine-step')).run();
    expect(() => gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step')).toThrow(/not live/);
  });

  test('a machine without engine PTY rejects takeover and view channels', () => {
    boot({ pty: false });
    expect(() => gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step')).toThrow(
      /cannot be taken over/,
    );
    expect(() => gateway.open(s.team.id, s.user.id, 'engine-step', { kind: 'view' })).toThrow(
      /cannot be taken over/,
    );
  });

  test('an offline machine fails before a channel is dispatched', () => {
    const requests = boot();
    disconnect?.();
    expect(() => gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step')).toThrow(
      /not connected/,
    );
    expect(() => gateway.open(s.team.id, s.user.id, 'engine-step', { kind: 'view' })).toThrow(
      /not connected/,
    );
    expect(requests).toHaveLength(0);
  });
});

describe('paired engine screen channel', () => {
  test('an unpaired channel expires after the pair timeout', async () => {
    boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'engine-step', { kind: 'view' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16_000);
    gateway.sweep();
    vi.restoreAllMocks();
    await expect(connect(base + cap.path, undefined, cap.wsProtocols)).rejects.toThrow(/401/);
  });

  test('bytes pass both ways once the viewer and machine pair', async () => {
    const requests = boot();
    const base = await listen();
    const cap = gateway.open(s.team.id, s.user.id, 'engine-step', { kind: 'view' });
    const daemon = await connect(
      `${base}/api/machine/engine-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + cap.path, undefined, cap.wsProtocols);
    const output = once(viewer, 'message');
    daemon.send(Buffer.from('\x1b[31mred\x1b[0m'));
    expect((await output)[0]).toEqual(Buffer.from('\x1b[31mred\x1b[0m'));
    const input = once(daemon, 'message');
    viewer.send(Buffer.from('q'));
    expect((await input)[0]).toEqual(Buffer.from('q'));
    await expect(connect(base + cap.path, undefined, cap.wsProtocols)).rejects.toThrow(/401/);
  });

  test('releasing the takeover drops the lease, closes the channel and publishes unheld', async () => {
    const requests = boot();
    const { events } = leaseEvents();
    const lease = gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step');
    const opened = gateway.open(s.team.id, s.user.id, 'engine-step', {
      kind: 'takeover',
      leaseId: lease.leaseId,
    });
    const base = await listen();
    const daemon = await connect(
      `${base}/api/machine/engine-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + opened.path, undefined, opened.wsProtocols);
    const closed = Promise.all([once(daemon, 'close'), once(viewer, 'close')]);
    gateway.releaseTakeover(s.team.id, s.user.id, 'engine-step', lease.leaseId);
    await closed;
    expect(events.at(-1)).toMatchObject({
      type: 'engine.lease',
      stepId: 'engine-step',
      held: false,
    });
    expect(() => gateway.renewTakeover(s.team.id, s.user.id, 'engine-step', lease.leaseId)).toThrow(
      /takeover lease/,
    );
  });

  test('a holder disconnect releases the lease and cuts the machine side', async () => {
    const requests = boot();
    const { events } = leaseEvents();
    const lease = gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step');
    const opened = gateway.open(s.team.id, s.user.id, 'engine-step', {
      kind: 'takeover',
      leaseId: lease.leaseId,
    });
    const base = await listen();
    const daemon = await connect(
      `${base}/api/machine/engine-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + opened.path, undefined, opened.wsProtocols);
    const cut = once(daemon, 'close');
    viewer.terminate();
    await cut;
    expect(() => gateway.renewTakeover(s.team.id, s.user.id, 'engine-step', lease.leaseId)).toThrow(
      /takeover lease/,
    );
    expect(events.at(-1)).toMatchObject({ type: 'engine.lease', held: false });
  });

  test('a machine disconnect releases the lease and announces unheld', async () => {
    const requests = boot();
    const { events } = leaseEvents();
    const lease = gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step');
    const opened = gateway.open(s.team.id, s.user.id, 'engine-step', {
      kind: 'takeover',
      leaseId: lease.leaseId,
    });
    const base = await listen();
    const daemon = await connect(
      `${base}/api/machine/engine-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + opened.path, undefined, opened.wsProtocols);
    const cut = Promise.all([once(daemon, 'close'), once(viewer, 'close')]);
    disconnect?.();
    await cut;
    expect(() => gateway.renewTakeover(s.team.id, s.user.id, 'engine-step', lease.leaseId)).toThrow(
      /takeover lease/,
    );
    expect(events.at(-1)).toMatchObject({ type: 'engine.lease', held: false });
  });

  test('a takeover lease that outlives its TTL is swept and both sockets close', async () => {
    const requests = boot();
    const { events } = leaseEvents();
    const lease = gateway.acquireTakeover(s.team.id, s.user.id, 'engine-step');
    const opened = gateway.open(s.team.id, s.user.id, 'engine-step', {
      kind: 'takeover',
      leaseId: lease.leaseId,
    });
    const base = await listen();
    const daemon = await connect(
      `${base}/api/machine/engine-screen/${requests[0]?.id}`,
      MACHINE_TOKEN,
    );
    const viewer = await connect(base + opened.path, undefined, opened.wsProtocols);
    const closed = Promise.all([once(daemon, 'close'), once(viewer, 'close')]);
    vi.spyOn(Date, 'now').mockReturnValue(lease.expiresAt + 1);
    gateway.sweep();
    vi.restoreAllMocks();
    await closed;
    expect(events.at(-1)).toMatchObject({ type: 'engine.lease', held: false });
    expect(() => gateway.renewTakeover(s.team.id, s.user.id, 'engine-step', lease.leaseId)).toThrow(
      /takeover lease/,
    );
  });
});

describe('engine pty log upload and fetch', () => {
  async function uploadPtyLog(content: Uint8Array): Promise<Response> {
    const urlsRes = await s.app.request('/api/machine/upload-urls/engine-step', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${MACHINE_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ files: [{ name: 'engine-pty.log' }] }),
    });
    expect(urlsRes.status).toBe(200);
    const { uploads } = (await urlsRes.json()) as { uploads: { url: string }[] };
    const uploadId = uploads[0]?.url.split('/').pop();
    return s.app.request(`/api/machine/upload/${uploadId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${MACHINE_TOKEN}` },
      body: content,
    });
  }

  test('the machine uploads engine-pty.log and the owner fetches the bytes', async () => {
    boot();
    const bytes = new TextEncoder().encode('\x1b[31mred scrollback\x1b[0m\n');
    const put = await uploadPtyLog(bytes);
    expect(put.status).toBe(200);
    const res = await s.app.request(`/api/teams/${s.team.id}/engine-runs/engine-step/pty-log`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  test('pty-log is 404 before any upload and the upload is 413 past the cap', async () => {
    boot();
    const missing = await s.app.request(`/api/teams/${s.team.id}/engine-runs/engine-step/pty-log`);
    expect(missing.status).toBe(404);
    const oversized = await uploadPtyLog(new Uint8Array(4 * 1024 * 1024 + 1));
    expect(oversized.status).toBe(413);
  });

  test('a foreign step has no pty log and upload-urls for it is rejected', async () => {
    boot();
    const res = await s.app.request(`/api/teams/${s.team.id}/engine-runs/missing-step/pty-log`);
    expect(res.status).toBe(404);
    const urlsRes = await s.app.request('/api/machine/upload-urls/missing-step', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${MACHINE_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ files: [{ name: 'engine-pty.log' }] }),
    });
    expect(urlsRes.status).toBe(404);
  });
});
