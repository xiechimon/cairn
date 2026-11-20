import { and, desc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  actionProposal,
  attachment,
  chiefMessage,
  externalEffect,
  imConnection,
  imPairingRequest,
  imTurnOrigin,
  step,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { CARD_ENDINGS, proposeAction } from '../src/services/action-proposals.js';
import {
  announceQuestion,
  askQuestionContentOf,
  createOrGetQuestion,
} from '../src/services/chief-questions.js';
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
import { bootServer, seedRoute, type TestServer } from './helpers.js';

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

const wechatSessions: FakeSession[] = [];
const wechatWaits = new Map<
  string,
  { status: 'pending' | 'expired' } | { status: 'done'; fields: Record<string, string> }
>();
let wechatLoginSeq = 0;

const wechatAdapterFake: ImAdapter = {
  platform: 'wechat',
  check: async (fields) =>
    fields.token === 'bad-token'
      ? { ok: false, reason: 'missing iLink bot token' }
      : { ok: true, accountLabel: `WeChat ${fields.ilinkBotId ?? 'bot'}` },
  connect: async (_fields, handlers, _env) => {
    const session: FakeSession = {
      handlers,
      sent: [],
      sendCount: 0,
      stopped: false,
      failWith: null,
    };
    wechatSessions.push(session);
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
  loginStart: async (env) => {
    wechatLoginSeq += 1;
    return {
      loginId: `wx_test_${wechatLoginSeq}`,
      qr: 'https://ilink.example/q/ABC',
      expiresAt: env.now() + 300_000,
    };
  },
  loginWait: async (loginId) => wechatWaits.get(loginId) ?? { status: 'pending' },
};

const env = (): ImEnv => ({
  fetch: (() => Promise.reject(new Error('offline'))) as typeof fetch,
  now: () => Date.now(),
  sleep: async (ms) => {
    slept.push(ms);
  },
  connectSocket: () => {
    throw new Error('offline');
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
    files: [],
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

let adapters: Partial<Record<'telegram' | 'wechat', ImAdapter>>;

beforeEach(() => {
  s = bootServer({ vapidKeys: null });
  slept = [];
  sessions.length = 0;
  wechatSessions.length = 0;
  wechatWaits.clear();
  adapters = { telegram: adapter };
  service = createImService({
    db: s.db,
    hub: s.hub,
    machineHub: s.machineHub,
    convHub: s.convHub,
    box: s.secretBox,
    user: s.user,
    env: env(),
    attachmentsDir: s.attachmentsDir,
    reposDir: s.reposDir,
    adapters,
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
  test('a restarted service still answers the origin chat', async () => {
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
        content: 'durable reply',
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
      attachmentsDir: s.attachmentsDir,
      reposDir: s.reposDir,
      adapters: { telegram: adapter },
    });
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    restarted.runtime.turnFinished(stepById(stepRow.id));
    await restarted.resume();
    await vi.waitFor(() => {
      expect(
        sessions.flatMap((session) => session.sent).some((m) => m.text === 'durable reply'),
      ).toBe(true);
    });
  });

  test('a replayed inbound message is deduped durably across restarts', async () => {
    await connectAndPair('55');
    const msg = inbound('55', 'ping');
    sessions[0]?.handlers.onMessage(msg);
    sessions[0]?.handlers.onMessage(msg);
    await service.shutdown();
    const restarted = createImService({
      db: s.db,
      hub: s.hub,
      machineHub: s.machineHub,
      convHub: s.convHub,
      box: s.secretBox,
      user: s.user,
      env: env(),
      attachmentsDir: s.attachmentsDir,
      reposDir: s.reposDir,
      adapters: { telegram: adapter },
    });
    await restarted.resume();
    sessions[sessions.length - 1]?.handlers.onMessage(msg);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.db.select().from(step).where(eq(step.kind, 'chief')).all()).toHaveLength(1);
  });

  test('a send queued while the session is offline drains on reconnect once', async () => {
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
        id: 'asst-3b',
        threadId: stepRow.buildId,
        role: 'assistant',
        content: 'offline reply',
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
      attachmentsDir: s.attachmentsDir,
      reposDir: s.reposDir,
      adapters: { telegram: adapter },
    });
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    restarted.runtime.turnFinished(stepById(stepRow.id));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessions[sessions.length - 1]?.sent ?? []).toHaveLength(0);
    await restarted.resume();
    await vi.waitFor(() => {
      const sent = sessions.flatMap((session) => session.sent);
      expect(sent.filter((msg) => msg.text === 'offline reply')).toHaveLength(1);
    });
    const delivered = s.db
      .select()
      .from(externalEffect)
      .where(and(eq(externalEffect.kind, 'im-send'), eq(externalEffect.state, 'delivered')))
      .all();
    expect(delivered.length).toBeGreaterThan(0);
  });

  test('an outward-acted im send is never re-run when the turn finishes twice', async () => {
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
        id: 'asst-3c',
        threadId: stepRow.buildId,
        role: 'assistant',
        content: 'exactly once',
        createdAt: nowMs() + 1,
      },
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    service.runtime.turnFinished(stepById(stepRow.id));
    await vi.waitFor(() => expect(sessions[0]?.sent).toHaveLength(1));
    service.runtime.turnFinished(stepById(stepRow.id));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessions[0]?.sent.filter((msg) => msg.text === 'exactly once')).toHaveLength(1);
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

describe('cards, actions and attachments', () => {
  const claimImStep = async (text: string) => {
    sessions[0]?.handlers.onMessage(inbound('55', text));
    const stepRow = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, stepRow.id))
      .run();
    return stepRow;
  };

  const tap = (value: string, senderId = '55', messageId = 'cq:1') => {
    sessions[0]?.handlers.onAction?.({
      chat: { key: '777', kind: 'direct', title: null },
      sender: { id: senderId, name: 'Ian' },
      value,
      messageId,
    });
  };

  const questionCard = async (threadId: string, requestId: string) => {
    createOrGetQuestion(
      { db: s.db, hub: s.hub, convHub: s.convHub, user: s.user },
      {
        threadId,
        requestId,
        questions: [
          {
            header: '选择',
            question: 'Pick one?',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
        askedFor: [],
      },
    );
    await vi.waitFor(() => expect(sessions[0]?.sent).toHaveLength(1));
  };

  test('a pending question card reaches the chat with tap buttons', async () => {
    await connectAndPair('55');
    const stepRow = await claimImStep('pick something');
    await questionCard(stepRow.buildId, 'q-1');
    const sent = sessions[0]?.sent[0];
    expect(sent?.text).toContain('Pick one?');
    expect(sent?.buttons).toEqual([
      [
        { label: 'A', value: 'imcb:q-1:0' },
        { label: 'B', value: 'imcb:q-1:1' },
      ],
    ]);
  });

  test('tapping a button answers a parked question and the resumed turn replies in chat', async () => {
    seedRoute(s, 'coordinator');
    await connectAndPair('55');
    const stepRow = await claimImStep('pick something');
    await questionCard(stepRow.buildId, 'q-2');
    const card = s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'q-2')).get();
    const parked = { ...(JSON.parse(card?.content as string) as object), parkedAt: nowMs() };
    s.db
      .update(chiefMessage)
      .set({ content: JSON.stringify(parked) })
      .where(eq(chiefMessage.id, 'q-2'))
      .run();
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    sessions[0]?.sent.splice(0);

    tap('imcb:q-2:0');

    const answered = askQuestionContentOf(
      s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'q-2')).get()?.content,
    );
    expect(answered?.status).toBe('answered');
    expect(answered?.answers).toEqual([{ header: '选择', choices: ['A'] }]);
    const resumed = s.db
      .select()
      .from(step)
      .where(
        and(eq(step.buildId, stepRow.buildId), eq(step.kind, 'chief'), eq(step.status, 'pending')),
      )
      .all();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.ownerMessageIds).toContain('q-2');
    expect(
      s.db
        .select()
        .from(imTurnOrigin)
        .where(eq(imTurnOrigin.stepId, resumed[0]?.id ?? ''))
        .get()?.chatKey,
    ).toBe('777');

    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, resumed[0]?.id ?? ''))
      .run();
    upsertChiefRow(
      { db: s.db, convHub: s.convHub },
      {
        id: 'asst-a',
        threadId: stepRow.buildId,
        role: 'assistant',
        content: 'went with A',
        createdAt: nowMs() + 1,
      },
    );
    s.db
      .update(step)
      .set({ status: 'done' })
      .where(eq(step.id, resumed[0]?.id ?? ''))
      .run();
    service.runtime.turnFinished(stepById(resumed[0]?.id ?? ''));
    await vi.waitFor(() =>
      expect(sessions[0]?.sent.some((msg) => msg.text === 'went with A')).toBe(true),
    );
  });

  test('tapping approve on an approval card executes the proposal and unblocks the chat', async () => {
    await connectAndPair('55');
    const stepRow = await claimImStep('send the mail');
    const { proposalId } = proposeAction(s.db, {
      teamId: s.team.id,
      actionId: 'connector.gmail.send_message',
      targetId: 'mailto:ian@example.com',
      input: { to: 'mailto:ian@example.com', body: 'hi' },
      threadId: stepRow.buildId,
      scopeProjectId: null,
      card: [
        {
          header: '发送',
          question: 'Send this mail?',
          options: [{ label: '发送' }, { label: '不发' }],
        },
      ],
    });
    announceQuestion(
      { db: s.db, hub: s.hub, convHub: s.convHub, user: s.user },
      stepRow.buildId,
      `approval-${proposalId}`,
    );
    await vi.waitFor(() => expect(sessions[0]?.sent).toHaveLength(1));
    expect(sessions[0]?.sent[0]?.buttons?.[0]?.[0]?.label).toBe('发送');
    sessions[0]?.sent.splice(0);

    tap(`imcb:approval-${proposalId}:0`);

    expect(
      s.db.select().from(actionProposal).where(eq(actionProposal.id, proposalId)).get()?.status,
    ).toBe('executed');
    await vi.waitFor(() =>
      expect(sessions[0]?.sent.some((msg) => msg.text === CARD_ENDINGS.executed)).toBe(true),
    );
    const wake = s.db
      .select()
      .from(step)
      .where(eq(step.id, `wake:${proposalId}:${stepRow.buildId}`))
      .get();
    expect(wake?.status).toBe('pending');
    expect(
      s.db
        .select()
        .from(imTurnOrigin)
        .where(eq(imTurnOrigin.stepId, wake?.id ?? ''))
        .get()?.senderId,
    ).toBe('55');
    const settled = askQuestionContentOf(
      s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.id, `approval-${proposalId}`))
        .get()?.content,
    );
    expect(settled?.status).toBe('answered');
  });

  test('a tap from an unpaired sender is ignored', async () => {
    await connectAndPair('55');
    const stepRow = await claimImStep('pick something');
    await questionCard(stepRow.buildId, 'q-3');
    sessions[0]?.sent.splice(0);
    tap('imcb:q-3:0', 'stranger');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const content = askQuestionContentOf(
      s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'q-3')).get()?.content,
    );
    expect(content?.status).toBe('pending');
    expect(sessions[0]?.sent).toHaveLength(0);
  });

  test('inbound photos and files are stored and listed for the coordinator', async () => {
    await connectAndPair('55');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).toString('base64');
    const notes = Buffer.from('ship it\n').toString('base64');
    sessions[0]?.handlers.onMessage({
      ...inbound('55', 'see these'),
      images: [{ name: 'photo.jpg', mimeType: 'image/jpeg', dataBase64: jpeg }],
      files: [{ name: 'notes.txt', mimeType: 'text/plain', dataBase64: notes }],
    });
    const rows = s.db.select().from(attachment).all();
    expect(rows).toHaveLength(2);
    const names = rows.map((row) => row.fileName).sort();
    expect(names).toEqual(['notes.txt', 'photo.jpg']);
    const stepRow = latestChiefStep();
    for (const row of rows) {
      expect(stepRow.prompt).toContain(`attachment=${row.id}`);
      expect(stepRow.prompt).toContain(row.fileName);
    }
    expect(stepRow.prompt).toContain('see these');
  });

  test('attachments that fail to download are counted, not fatal', async () => {
    await connectAndPair('55');
    sessions[0]?.handlers.onMessage({
      ...inbound('55', ''),
      images: [
        { name: 'gone.jpg', mimeType: 'image/jpeg', dataBase64: null },
        {
          name: 'bad.jpg',
          mimeType: 'image/jpeg',
          dataBase64: Buffer.from('not jpeg').toString('base64'),
        },
      ],
    });
    expect(s.db.select().from(attachment).all()).toHaveLength(0);
    const stepRow = latestChiefStep();
    expect(stepRow.prompt).toContain('2 个附件没有取到');
  });
});

describe('wechat qr login', () => {
  const doneFields = {
    token: 'BOT-TOKEN',
    ilinkBotId: 'bot@im.bot',
    ilinkUserId: 'scanner@im.wechat',
    baseUrl: 'https://ilink.example/',
  };

  const startLogin = () => {
    adapters.wechat = wechatAdapterFake;
    return service.startWechatLogin();
  };

  test('start returns the adapter QR code', async () => {
    const login = await startLogin();
    expect(login.loginId).toMatch(/^wx_test_/);
    expect(login.qr).toBe('https://ilink.example/q/ABC');
    expect(login.expiresAt).toBeGreaterThan(Date.now());
  });

  test('start and poll are a 400 without a login-capable wechat adapter', async () => {
    await expect(service.startWechatLogin()).rejects.toMatchObject({ status: 400 });
    await expect(service.pollWechatLogin(s.team.id, 'wx_test_1')).rejects.toMatchObject({
      status: 400,
    });
  });

  test('poll passes pending and expired through without creating a connection', async () => {
    const login = await startLogin();
    await expect(service.pollWechatLogin(s.team.id, login.loginId)).resolves.toEqual({
      status: 'pending',
    });
    wechatWaits.set(login.loginId, { status: 'expired' });
    await expect(service.pollWechatLogin(s.team.id, login.loginId)).resolves.toEqual({
      status: 'expired',
    });
    expect(s.db.select().from(imConnection).all()).toHaveLength(0);
  });

  test('a confirmed scan creates a connection paired to the scanning account', async () => {
    const login = await startLogin();
    wechatWaits.set(login.loginId, { status: 'done', fields: doneFields });
    const result = await service.pollWechatLogin(s.team.id, login.loginId);
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.connection.platform).toBe('wechat');
    expect(result.connection.accountLabel).toBe('WeChat bot@im.bot');
    expect(result.connection.pairedSenders).toEqual([
      {
        id: 'scanner@im.wechat',
        name: null,
        chatKey: 'scanner@im.wechat',
        addedAt: expect.any(Number),
      },
    ]);
    expect(wechatSessions).toHaveLength(1);

    wechatSessions[0]?.handlers.onMessage(inbound('scanner@im.wechat', 'hi', 'scanner@im.wechat'));
    expect(pairingRequests()).toHaveLength(0);
    expect(latestChiefStep().prompt).toContain('provenance=im:wechat:');
  });

  test('a wechat connection reconnects through the generic path', async () => {
    const login = await startLogin();
    wechatWaits.set(login.loginId, { status: 'done', fields: doneFields });
    const result = await service.pollWechatLogin(s.team.id, login.loginId);
    if (result.status !== 'done') throw new Error('expected a confirmed login');
    const reconnected = await service.reconnectConnection(s.team.id, result.connection.id);
    expect(reconnected.status).toBe('connecting');
    expect(wechatSessions).toHaveLength(2);
    expect(wechatSessions[0]?.stopped).toBe(true);
  });
});
