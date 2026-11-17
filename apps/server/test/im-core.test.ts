import { desc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { imConnection, imPairingRequest, step } from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { createImService, type ImService } from '../src/services/im/core.js';
import { ImSendError } from '../src/services/im/errors.js';
import { setImRuntime } from '../src/services/im/runtime.js';
import type {
  ImAdapter,
  ImConnectionHandlers,
  ImEnv,
  ImInboundMessage,
  ImOutboundMessage,
} from '../src/services/im/types.js';
import { upsertChiefRow } from '../src/services/machine-deps.js';
import { notifyChiefMessage } from '../src/services/notifications.js';
import { bootServer, type TestServer } from './helpers.js';

let s: TestServer;
let service: ImService;
let slept: number[];

interface FakeSession {
  handlers: ImConnectionHandlers;
  sent: ImOutboundMessage[];
  sendCount: number;
  stopped: boolean;
  failWith: ImSendError | null;
}

const sessions: FakeSession[] = [];

const adapter: ImAdapter = {
  platform: 'telegram',
  check: async (fields) =>
    fields.botToken === 'bad-token'
      ? { ok: false, reason: 'telegram refused the token' }
      : { ok: true, accountLabel: '@cairn_test_bot' },
  connect: async (_fields, handlers, _env) => {
    const session: FakeSession = {
      handlers,
      sent: [],
      sendCount: 0,
      stopped: false,
      failWith: null,
    };
    sessions.push(session);
    return {
      send: async (msg) => {
        session.sendCount += 1;
        if (session.failWith !== null) throw session.failWith;
        session.sent.push(msg);
      },
      stop: async () => {
        session.stopped = true;
      },
    };
  },
};

const env = (): ImEnv => ({
  fetch: (() => Promise.reject(new Error('offline'))) as typeof fetch,
  now: () => Date.now(),
  sleep: async (ms) => {
    slept.push(ms);
  },
});

let messageSeq = 0;
const inbound = (senderId: string, text = 'hi', chatKey = '777'): ImInboundMessage => {
  messageSeq += 1;
  return {
    chat: { key: chatKey, kind: 'direct', title: null },
    sender: { id: senderId, name: 'Ian' },
    text,
    images: [],
    messageId: `tg-msg-${messageSeq}`,
    mentioned: false,
  };
};

const pairingRequests = () => s.db.select().from(imPairingRequest).all();
const connRow = () => s.db.select().from(imConnection).all()[0];
const latestChiefStep = () => {
  const row = s.db
    .select()
    .from(step)
    .where(eq(step.kind, 'chief'))
    .orderBy(desc(step.createdAt))
    .all()[0];
  if (row === undefined) throw new Error('expected a chief step');
  return row;
};
const stepById = (id: string) => {
  const row = s.db.select().from(step).where(eq(step.id, id)).get();
  if (row === undefined) throw new Error(`expected step ${id}`);
  return row;
};
const firstPairingRequest = () => {
  const row = pairingRequests()[0];
  if (row === undefined) throw new Error('expected a pairing request');
  return row;
};

beforeEach(() => {
  s = bootServer({ vapidKeys: null });
  slept = [];
  sessions.length = 0;
  service = createImService({
    db: s.db,
    hub: s.hub,
    machineHub: s.machineHub,
    convHub: s.convHub,
    box: s.secretBox,
    user: s.user,
    env: env(),
    adapters: { telegram: adapter },
  });
  setImRuntime(service.runtime);
});

afterEach(() => {
  setImRuntime(null);
  void service.shutdown();
});

async function connectAndPair(senderId = '55'): Promise<void> {
  await service.createConnection(s.team.id, 'telegram', { botToken: 'good-token' });
  const session = sessions[0];
  session?.handlers.onMessage(inbound(senderId));
  const request = firstPairingRequest();
  await service.decidePairingRequest(s.team.id, request.id, 'approved');
  await vi.waitFor(() => expect(session?.sent).toHaveLength(2));
  if (session !== undefined) {
    session.sent.splice(0);
    session.sendCount = 0;
  }
}

describe('connection lifecycle', () => {
  test('create checks credentials then starts a session', async () => {
    const record = await service.createConnection(s.team.id, 'telegram', {
      botToken: 'good-token',
    });
    expect(record.accountLabel).toBe('@cairn_test_bot');
    expect(record.status).toBe('connecting');
    expect(sessions).toHaveLength(1);
  });

  test('create surfaces a refused credential and stores nothing', async () => {
    await expect(
      service.createConnection(s.team.id, 'telegram', { botToken: 'bad-token' }),
    ).rejects.toThrow('telegram refused the token');
    expect(s.db.select().from(imConnection).all()).toHaveLength(0);
  });

  test('delete stops the session and removes the row', async () => {
    const record = await service.createConnection(s.team.id, 'telegram', {
      botToken: 'good-token',
    });
    await service.deleteConnection(s.team.id, record.id);
    expect(sessions[0]?.stopped).toBe(true);
    expect(s.db.select().from(imConnection).all()).toHaveLength(0);
  });
});

describe('pairing', () => {
  test('an unpaired sender gets one pending request and one reply', async () => {
    await service.createConnection(s.team.id, 'telegram', { botToken: 'good-token' });
    const session = sessions[0];
    session?.handlers.onMessage(inbound('55', 'hello?'));
    session?.handlers.onMessage(inbound('55', 'are you there?'));
    await vi.waitFor(() => expect(session?.sent).toHaveLength(1));
    const requests = pairingRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ senderId: '55', status: 'pending', chatKey: '777' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(session?.sent).toHaveLength(1);
  });

  test('approve allow-lists the sender and confirms in chat', async () => {
    await connectAndPair('55');
    const conn = connRow();
    expect(conn?.pairedSenders).toHaveLength(1);
    expect(conn?.pairedSenders[0]?.id).toBe('55');
  });

  test('reject keeps the sender unpaired', async () => {
    await service.createConnection(s.team.id, 'telegram', { botToken: 'good-token' });
    sessions[0]?.handlers.onMessage(inbound('55'));
    const request = firstPairingRequest();
    await service.decidePairingRequest(s.team.id, request.id, 'rejected');
    sessions[0]?.handlers.onMessage(inbound('55', 'please?'));
    const steps = s.db.select().from(step).where(eq(step.kind, 'chief')).all();
    expect(steps).toHaveLength(0);
  });
});

describe('inbound turns and origin scoping', () => {
  test('a paired message opens a coordinator turn with im provenance', async () => {
    await connectAndPair('55');
    sessions[0]?.handlers.onMessage(inbound('55', 'what is on my plate?'));
    const stepRow = latestChiefStep();
    expect(stepRow?.prompt).toContain('provenance=im:telegram:');
    expect(stepRow?.prompt).toContain('what is on my plate?');
    expect(stepRow?.freshSession).toBe(true);
  });

  test('the finished turn replies to the origin chat only', async () => {
    await connectAndPair('55');
    sessions[0]?.handlers.onMessage(inbound('55', 'ping'));
    const stepRow = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, stepRow.id))
      .run();
    upsertChiefRow(
      { db: s.db, convHub: s.convHub },
      {
        id: 'asst-1',
        threadId: stepRow.buildId,
        role: 'assistant',
        content: 'pong',
        createdAt: nowMs() + 1,
      },
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    service.runtime.turnFinished(stepById(stepRow.id));
    await vi.waitFor(() => expect(sessions[0]?.sent).toHaveLength(1));
    expect(sessions[0]?.sent[0]).toMatchObject({ chatKey: '777', text: 'pong' });
  });

  test('a turn touched by another source goes to mixed and never sends', async () => {
    await connectAndPair('55');
    sessions[0]?.handlers.onMessage(inbound('55', 'ping'));
    const stepRow = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs(), ownerMessageIds: ['web-msg-1'] })
      .where(eq(step.id, stepRow.id))
      .run();
    upsertChiefRow(
      { db: s.db },
      {
        id: 'asst-2',
        threadId: stepRow.buildId,
        role: 'assistant',
        content: 'web and im mixed reply',
        createdAt: nowMs() + 1,
      },
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    service.runtime.turnFinished(stepById(stepRow.id));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessions[0]?.sent).toHaveLength(0);
  });

  test('a mid-turn notify_user reaches only the origin chat', async () => {
    await connectAndPair('55');
    sessions[0]?.handlers.onMessage(inbound('55', 'long task'));
    const stepRow = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, stepRow.id))
      .run();
    notifyChiefMessage(
      { db: s.db, hub: s.hub, user: s.user },
      {
        threadId: stepRow.buildId,
        message: 'working on it',
        agent: { name: 'Coordinator', avatarUrl: null },
      },
    );
    await vi.waitFor(() => expect(sessions[0]?.sent).toHaveLength(1));
    expect(sessions[0]?.sent[0]?.text).toBe('working on it');
  });

  test('a notice while the origin turn is still queued sends nothing', async () => {
    await connectAndPair('55');
    sessions[0]?.handlers.onMessage(inbound('55', 'pending task'));
    const stepRow = latestChiefStep();
    notifyChiefMessage(
      { db: s.db, hub: s.hub, user: s.user },
      {
        threadId: stepRow.buildId,
        message: 'too early',
        agent: { name: 'Coordinator', avatarUrl: null },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessions[0]?.sent).toHaveLength(0);
  });
});

describe('restart and send queue', () => {
  test('origins are memory-only: a restarted service sends nothing', async () => {
    await connectAndPair('55');
    sessions[0]?.handlers.onMessage(inbound('55', 'ping'));
    const stepRow = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, stepRow.id))
      .run();
    upsertChiefRow(
      { db: s.db },
      {
        id: 'asst-3',
        threadId: stepRow.buildId,
        role: 'assistant',
        content: 'lost reply',
        createdAt: nowMs() + 1,
      },
    );
    await service.shutdown();
    const restarted = createImService({
      db: s.db,
      hub: s.hub,
      machineHub: s.machineHub,
      convHub: s.convHub,
      box: s.secretBox,
      user: s.user,
      env: env(),
      adapters: { telegram: adapter },
    });
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    restarted.runtime.turnFinished(stepById(stepRow.id));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessions[0]?.sent.filter((msg) => msg.text === 'lost reply')).toHaveLength(0);
  });

  test('retry-class sends back off and then surface as failed', async () => {
    await connectAndPair('55');
    const session = sessions[0];
    session!.failWith = new ImSendError('retry', 'boom');
    sessions[0]?.handlers.onMessage(inbound('55', 'ping'));
    const stepRow = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, stepRow.id))
      .run();
    upsertChiefRow(
      { db: s.db },
      {
        id: 'asst-4',
        threadId: stepRow.buildId,
        role: 'assistant',
        content: 'will fail',
        createdAt: nowMs() + 1,
      },
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    service.runtime.turnFinished(stepById(stepRow.id));
    await vi.waitFor(() =>
      expect(service.listConnections(s.team.id)[0]?.lastSendError).toBe('boom'),
    );
    expect(session?.sendCount).toBe(4);
    expect(slept).toEqual([5000, 10000, 20000]);
  });

  test('permanent-class sends fail once and surface on the record', async () => {
    await service.createConnection(s.team.id, 'telegram', { botToken: 'good-token' });
    const session = sessions[0];
    session!.failWith = new ImSendError('permanent', 'gone');
    session!.handlers.onMessage(inbound('99', 'ping'));
    await vi.waitFor(() =>
      expect(service.listConnections(s.team.id)[0]?.lastSendError).toBe('gone'),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session?.sendCount).toBe(1);
  });

  test('drop-class sends vanish quietly without a recorded error', async () => {
    await service.createConnection(s.team.id, 'telegram', { botToken: 'good-token' });
    const session = sessions[0];
    session!.failWith = new ImSendError('drop', 'nothing to do');
    session!.handlers.onMessage(inbound('99', 'ping'));
    await vi.waitFor(() => expect(session?.sendCount).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session?.sendCount).toBe(1);
    expect(service.listConnections(s.team.id)[0]?.lastSendError).toBeNull();
  });

  test('an auth-expired send marks the connection expired', async () => {
    await connectAndPair('55');
    const session = sessions[0];
    session!.failWith = new ImSendError('permanent', 'Unauthorized', { authExpired: true });
    sessions[0]?.handlers.onMessage(inbound('55', 'ping'));
    const stepRow = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, stepRow.id))
      .run();
    upsertChiefRow(
      { db: s.db },
      {
        id: 'asst-5',
        threadId: stepRow.buildId,
        role: 'assistant',
        content: 'undeliverable',
        createdAt: nowMs() + 1,
      },
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    service.runtime.turnFinished(stepById(stepRow.id));
    await vi.waitFor(() => {
      expect(connRow()?.status).toBe('expired');
    });
  });
});
