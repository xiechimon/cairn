import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MachineStreamEvent } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openMemoryDb } from '../src/db/client.js';
import { imConnection, imPairingRequest } from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { ConversationStreamHub, TeamStreamHub } from '../src/services/events.js';
import { createImService, type ImService } from '../src/services/im/core.js';
import {
  createImBridge,
  createImessageAdapter,
  type ImBridge,
} from '../src/services/im/imessage.js';
import { setImRuntime } from '../src/services/im/runtime.js';
import { MachineWakeHub } from '../src/services/machine-wake-hub.js';
import { bootServer, enrollConnectorRunner, req, type TestServer } from './helpers.js';

const env = {
  fetch: (() => Promise.reject(new Error('offline'))) as typeof fetch,
  now: () => Date.now(),
  sleep: async () => {},
  connectSocket: () => {
    throw new Error('offline');
  },
};

let s: TestServer;
let service: ImService;
let bridge: ImBridge;
let machineHub: MachineWakeHub;
let teamId: string;

beforeEach(() => {
  const db = openMemoryDb();
  const seeded = seed(db);
  teamId = seeded.team.id;
  machineHub = new MachineWakeHub();
  bridge = createImBridge(machineHub);
  service = createImService({
    db,
    hub: new TeamStreamHub(),
    machineHub,
    convHub: new ConversationStreamHub(),
    box: createEphemeralSecretBox(),
    user: seeded.user,
    env,
    attachmentsDir: mkdtempSync(join(tmpdir(), 'im-att-')),
    reposDir: mkdtempSync(join(tmpdir(), 'im-repos-')),
    adapters: { imessage: createImessageAdapter({ db, bridge }) },
  });
  setImRuntime(service.runtime);
  s = bootServer({ db, im: service, imBridge: bridge, machineHub, vapidKeys: null });
});

afterEach(() => {
  setImRuntime(null);
  void service.shutdown();
});

function collectStream(machineId: string): {
  events: MachineStreamEvent[];
  release: () => void;
} {
  const events: MachineStreamEvent[] = [];
  const release = s.machineHub.subscribeMachine(
    teamId,
    machineId,
    (ev) => events.push(ev),
    () => {},
  );
  return { events, release };
}

async function connectImsg(machineId: string): Promise<string> {
  const res = await req(s.app, 'POST', `/api/teams/${teamId}/im/imessage`, { machineId });
  expect(res.status).toBe(200);
  const { connection } = (await res.json()) as { connection: { id: string } };
  return connection.id;
}

async function postImEvent(connId: string, token: string, body: unknown) {
  return s.app.request(`/api/machine/im/${encodeURIComponent(connId)}/event`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('imessage bridge', () => {
  test('connecting binds the conn to the machine stream and attach re-emits on reconnect', async () => {
    const runner = await enrollConnectorRunner(s, 'mini', false);
    const stream = collectStream(runner.machineId);

    const connId = await connectImsg(runner.machineId);
    expect(stream.events).toContainEqual({ type: 'im.attach', connId });

    const conn = s.db.select().from(imConnection).where(eq(imConnection.id, connId)).get();
    expect(conn?.platform).toBe('imessage');
    expect(conn?.accountLabel).toBe('mini');

    stream.release();
    const second = collectStream(runner.machineId);
    expect(second.events).toContainEqual({ type: 'im.attach', connId });
    second.release();
  });

  test('a machine from outside the conn cannot create the connection', async () => {
    const res = await req(s.app, 'POST', `/api/teams/${teamId}/im/imessage`, {
      machineId: 'machine-not-here',
    });
    expect(res.status).toBe(400);
  });

  test('inbound message, status and sent events flow through the machine-authed route', async () => {
    const runner = await enrollConnectorRunner(s, 'mini', false);
    const stream = collectStream(runner.machineId);
    const connId = await connectImsg(runner.machineId);

    const inbound = await postImEvent(connId, runner.token, {
      kind: 'message',
      message: {
        chat: { key: 'iMessage;-;+15551234', kind: 'direct', title: null },
        sender: { id: '+15551234', name: 'Ian' },
        text: 'hello from phone',
        images: [],
        files: [],
        messageId: 'msg-41',
        mentioned: true,
      },
    });
    expect(inbound.status).toBe(200);
    const pairings = s.db
      .select()
      .from(imPairingRequest)
      .where(eq(imPairingRequest.connId, connId))
      .all();
    expect(pairings).toHaveLength(1);
    expect(pairings[0]?.senderId).toBe('+15551234');

    const statusRes = await postImEvent(connId, runner.token, {
      kind: 'status',
      status: 'degraded',
      detail: 'imsg rpc exited',
    });
    expect(statusRes.status).toBe(200);
    const conn = s.db.select().from(imConnection).where(eq(imConnection.id, connId)).get();
    expect(conn?.status).toBe('degraded');
    expect(conn?.statusDetail).toBe('imsg rpc exited');

    const sending = bridge.send(connId, {
      chatKey: 'iMessage;-;+15551234',
      text: 'reply text',
    });
    const sendEvs = stream.events.filter(
      (ev): ev is Extract<MachineStreamEvent, { type: 'im.send' }> => ev.type === 'im.send',
    );
    const sendEv = sendEvs.find((ev) => ev.message.text === 'reply text');
    expect(sendEv?.connId).toBe(connId);
    const sentRes = await postImEvent(connId, runner.token, {
      kind: 'sent',
      sendId: sendEv?.sendId ?? '',
      ok: true,
    });
    expect(sentRes.status).toBe(200);
    await sending;
    for (const ev of sendEvs) {
      if (ev.sendId === sendEv?.sendId) continue;
      await postImEvent(connId, runner.token, { kind: 'sent', sendId: ev.sendId, ok: true });
    }
    stream.release();
  });

  test('events from a different machine are rejected', async () => {
    const runner = await enrollConnectorRunner(s, 'mini', false);
    const other = await enrollConnectorRunner(s, 'impostor', false);
    const stream = collectStream(runner.machineId);
    const connId = await connectImsg(runner.machineId);

    const res = await postImEvent(connId, other.token, {
      kind: 'status',
      status: 'ready',
    });
    expect(res.status).toBe(403);
    stream.release();
  });

  test('events for an unattached conn return 404', async () => {
    const runner = await enrollConnectorRunner(s, 'mini', false);
    const res = await postImEvent('conn-missing', runner.token, {
      kind: 'status',
      status: 'ready',
    });
    expect(res.status).toBe(404);
  });

  test('send fails retry-class while the machine is offline and permanent reports map kinds', async () => {
    const runner = await enrollConnectorRunner(s, 'mini', false);
    const connId = await connectImsg(runner.machineId);

    await expect(
      bridge.send(connId, { chatKey: 'iMessage;-;+1', text: 'x' }),
    ).rejects.toMatchObject({ kind: 'retry' });

    const stream = collectStream(runner.machineId);
    const sending = bridge.send(connId, { chatKey: 'iMessage;-;+1', text: 'x' });
    const sendEv = stream.events.find(
      (ev): ev is Extract<MachineStreamEvent, { type: 'im.send' }> => ev.type === 'im.send',
    );
    await postImEvent(connId, runner.token, {
      kind: 'sent',
      sendId: sendEv?.sendId ?? '',
      ok: false,
      errorKind: 'permanent',
      error: 'bad chat guid',
    });
    await expect(sending).rejects.toMatchObject({
      kind: 'permanent',
      message: 'bad chat guid',
    });
    stream.release();
  });

  test('detach on stop fails pending sends and posts im.detach', async () => {
    const runner = await enrollConnectorRunner(s, 'mini', false);
    const stream = collectStream(runner.machineId);
    const connId = await connectImsg(runner.machineId);

    const sending = bridge.send(connId, { chatKey: 'iMessage;-;+1', text: 'x' });
    bridge.unregister(connId);
    await expect(sending).rejects.toMatchObject({
      kind: 'drop',
    });
    expect(stream.events).toContainEqual({ type: 'im.detach', connId });
    stream.release();
  });
});
