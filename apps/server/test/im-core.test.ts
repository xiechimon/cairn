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
  memoryCorrection,
  step,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { CARD_ENDINGS, proposeAction } from '../src/services/action-proposals.js';
import { askQuestionContentOf } from '../src/services/chief-question-store.js';
import { announceQuestion, createOrGetQuestion } from '../src/services/chief-questions.js';
import { coordinatorInputs, releaseCoordinatorInput } from '../src/services/coordinator-inputs.js';
import { createImService, type ImService } from '../src/services/im/core.js';
import { ImSendError } from '../src/services/im/errors.js';
import { setImRuntime } from '../src/services/im/runtime.js';
import type {
  ImAdapter,
  ImCardMessageRef,
  ImConnectionHandlers,
  ImEnv,
  ImInboundMessage,
  ImOutboundMessage,
} from '../src/services/im/types.js';
import { upsertChiefRow } from '../src/services/machine-deps.js';
import { executeMemoryToolForStep } from '../src/services/memory-corrections.js';
import { notifyChiefMessage } from '../src/services/notifications.js';
import { bootServer, seedRoute, type TestServer } from './helpers.js';

let s: TestServer;
let service: ImService;
let slept: number[];

interface FakeSession {
  fields: Record<string, string>;
  handlers: ImConnectionHandlers;
  sent: ImOutboundMessage[];
  settledCards: { ref: ImCardMessageRef; summary: string }[];
  sendCount: number;
  stopped: boolean;
  failWith: ImSendError | null;
  onSend?: (msg: ImOutboundMessage) => Promise<void>;
}

const sessions: FakeSession[] = [];

const adapter: ImAdapter = {
  platform: 'telegram',
  check: async (fields) =>
    fields.botToken === 'bad-token'
      ? { ok: false, reason: 'telegram refused the token' }
      : { ok: true, accountLabel: '@cairn_test_bot' },
  connect: async (fields, handlers, _env) => {
    const session: FakeSession = {
      fields,
      handlers,
      sent: [],
      settledCards: [],
      sendCount: 0,
      stopped: false,
      failWith: null,
    };
    sessions.push(session);
    return {
      send: async (msg) => {
        session.sendCount += 1;
        if (session.onSend !== undefined) {
          await session.onSend(msg);
          return;
        }
        if (session.failWith !== null) throw session.failWith;
        session.sent.push(msg);
      },
      settleCard: async (ref, summary) => {
        session.settledCards.push({ ref, summary });
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
  connect: async (fields, handlers, _env) => {
    const session: FakeSession = {
      fields,
      handlers,
      sent: [],
      settledCards: [],
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

  const claimLatest = () => {
    const { id } = latestChiefStep();
    s.db.update(step).set({ status: 'claimed', claimedAt: nowMs() }).where(eq(step.id, id)).run();
    return stepById(id);
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

  test('a pending question card lists each option description after its label', async () => {
    await connectAndPair('55');
    const stepRow = await claimImStep('pick something');
    createOrGetQuestion(
      { db: s.db, hub: s.hub, convHub: s.convHub, user: s.user },
      {
        threadId: stepRow.buildId,
        requestId: 'q-desc',
        questions: [
          {
            header: '选择',
            question: 'Pick one?',
            options: [
              { label: 'A', description: 'the safe choice' },
              { label: 'B' },
              { label: 'C', description: '   ' },
            ],
          },
        ],
        askedFor: [],
      },
    );
    await vi.waitFor(() => expect(sessions[0]?.sent).toHaveLength(1));
    expect(sessions[0]?.sent[0]?.text).toBe('Pick one?\n\n1. A — the safe choice\n2. B\n3. C');
    expect(sessions[0]?.sent[0]?.buttons).toEqual([
      [
        { label: 'A', value: 'imcb:q-desc:0' },
        { label: 'B', value: 'imcb:q-desc:1' },
        { label: 'C', value: 'imcb:q-desc:2' },
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

  test('an option tapped in the chat app is kept as what the user chose', async () => {
    seedRoute(s, 'coordinator');
    await connectAndPair('55');
    const stepRow = await claimImStep('pick something');
    await questionCard(stepRow.buildId, 'q-evidence');
    const card = s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'q-evidence')).get();
    const parked = { ...(JSON.parse(card?.content as string) as object), parkedAt: nowMs() };
    s.db
      .update(chiefMessage)
      .set({ content: JSON.stringify(parked) })
      .where(eq(chiefMessage.id, 'q-evidence'))
      .run();
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();

    tap('imcb:q-evidence:1');
    correct(claimLatest().id);

    expect(s.db.select().from(memoryCorrection).all()).toMatchObject([{ ownerWords: 'B' }]);
  });

  test('approving a card in the chat app leaves no words to quote', async () => {
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
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();

    tap(`imcb:approval-${proposalId}:0`);

    const wakeId = `wake:${proposalId}:${stepRow.buildId}`;
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, wakeId))
      .run();
    expect(correct(wakeId)).toMatchObject({
      correction: expect.stringContaining('not recorded'),
    });
    expect(s.db.select().from(memoryCorrection).all()).toEqual([]);
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

  test('reconnect clears any prior lastSendError on the connection record', async () => {
    await service.createConnection(s.team.id, 'telegram', { botToken: 'good-token' });
    const session = sessions[0]!;
    session.failWith = new ImSendError('permanent', 'chat gone');
    session.handlers.onMessage(inbound('99', 'ping'));
    await vi.waitFor(() =>
      expect(service.listConnections(s.team.id)[0]?.lastSendError).toBe('chat gone'),
    );
    const reconnected = await service.reconnectConnection(s.team.id, connRow()!.id);
    expect(reconnected.lastSendError).toBeNull();
  });
});

function correct(stepId: string) {
  return executeMemoryToolForStep(
    s.db,
    { agentId: 'agent-im', teamId: s.team.id, projectId: null },
    stepId,
    'save_memory',
    { scope: 'team', file: 'units.md', content: 'Use metric units.', correction: true },
  );
}

test('the words of a paired chat app message are kept as evidence of a correction', async () => {
  await connectAndPair();
  sessions[0]?.handlers.onMessage(inbound('55', 'IM CORRECTION: use metric units.'));
  const turnRow = latestChiefStep();
  s.db
    .update(step)
    .set({ status: 'claimed', claimedAt: Date.now() })
    .where(eq(step.id, turnRow.id))
    .run();
  correct(turnRow.id);
  expect(s.db.select().from(memoryCorrection).all()).toMatchObject([
    { ownerWords: 'IM CORRECTION: use metric units.', stepId: turnRow.id },
  ]);
});

describe('text reply cards, cursor recovery, and stale session guards', () => {
  const sendQuestionAndPark = async (requestId: string) => {
    sessions[0]?.handlers.onMessage(inbound('55', 'pick something'));
    const stepRow = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, stepRow.id))
      .run();
    createOrGetQuestion(
      { db: s.db, hub: s.hub, convHub: s.convHub, user: s.user },
      {
        threadId: stepRow.buildId,
        requestId,
        questions: [
          {
            header: '选择',
            question: 'Pick one?',
            options: [{ label: 'Alpha' }, { label: 'Beta' }],
          },
        ],
        askedFor: [],
      },
    );
    await vi.waitFor(() => expect(sessions[0]?.sent).toHaveLength(1));
    const card = s.db.select().from(chiefMessage).where(eq(chiefMessage.id, requestId)).get();
    const parked = { ...(JSON.parse(card?.content as string) as object), parkedAt: nowMs() };
    s.db
      .update(chiefMessage)
      .set({ content: JSON.stringify(parked) })
      .where(eq(chiefMessage.id, requestId))
      .run();
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    return stepRow;
  };

  test('text reply resolves pending question card and resumes reply to IM', async () => {
    seedRoute(s, 'coordinator');
    await connectAndPair('55');
    const stepRow = await sendQuestionAndPark('q-text-1');
    const stepsBefore = s.db.select().from(step).where(eq(step.kind, 'chief')).all().length;
    sessions[0]?.sent.splice(0);

    sessions[0]?.handlers.onMessage(inbound('55', '2.'));

    const answered = askQuestionContentOf(
      s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'q-text-1')).get()?.content,
    );
    expect(answered?.status).toBe('answered');
    expect(answered?.answers).toEqual([{ header: '选择', choices: ['Beta'] }]);
    const pending = s.db
      .select()
      .from(step)
      .where(
        and(eq(step.buildId, stepRow.buildId), eq(step.kind, 'chief'), eq(step.status, 'pending')),
      )
      .all();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.ownerSaid).toBeNull();
    expect(s.db.select().from(step).where(eq(step.kind, 'chief')).all()).toHaveLength(
      stepsBefore + 1,
    );
    expect(
      s.db
        .select()
        .from(imTurnOrigin)
        .where(eq(imTurnOrigin.stepId, pending[0]?.id ?? ''))
        .get()?.chatKey,
    ).toBe('777');
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, pending[0]?.id ?? ''))
      .run();
    upsertChiefRow(
      { db: s.db, convHub: s.convHub },
      {
        id: 'asst-beta',
        threadId: stepRow.buildId,
        role: 'assistant',
        content: 'picked Beta',
        createdAt: nowMs() + 1,
      },
    );
    s.db
      .update(step)
      .set({ status: 'done' })
      .where(eq(step.id, pending[0]?.id ?? ''))
      .run();
    service.runtime.turnFinished(stepById(pending[0]?.id ?? ''));
    await vi.waitFor(() =>
      expect(sessions[0]?.sent.some((msg) => msg.text === 'picked Beta')).toBe(true),
    );
  });

  test('text reply resolves approval card after restart without creating a user turn', async () => {
    await connectAndPair('55');
    sessions[0]?.handlers.onMessage(inbound('55', 'send it'));
    const stepRow = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, stepRow.id))
      .run();
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
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();

    await service.shutdown();
    await service.resume();
    sessions[1]?.handlers.onMessage(inbound('55', '１'));

    expect(
      s.db.select().from(actionProposal).where(eq(actionProposal.id, proposalId)).get()?.status,
    ).toBe('executed');
    await vi.waitFor(() =>
      expect(sessions[1]?.sent.some((msg) => msg.text === CARD_ENDINGS.executed)).toBe(true),
    );

    const { proposalId: secondProposal } = proposeAction(s.db, {
      teamId: s.team.id,
      actionId: 'connector.gmail.send_message',
      targetId: 'mailto:ian@example.com',
      input: { to: 'mailto:ian@example.com', body: 'hi 2' },
      threadId: stepRow.buildId,
      scopeProjectId: null,
      card: [
        {
          header: '发送',
          question: 'Send second mail?',
          options: [{ label: '发送' }, { label: '不发' }],
        },
      ],
    });
    const wakeStep = stepById(`wake:${proposalId}:${stepRow.buildId}`);
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, wakeStep.id))
      .run();
    announceQuestion(
      { db: s.db, hub: s.hub, convHub: s.convHub, user: s.user },
      stepRow.buildId,
      `approval-${secondProposal}`,
    );
    await vi.waitFor(() =>
      expect(sessions[1]?.sent.some((msg) => msg.text.includes('Send second mail?'))).toBe(true),
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, wakeStep.id)).run();

    sessions[1]?.handlers.onMessage(inbound('55', '发送'));
    expect(
      s.db.select().from(actionProposal).where(eq(actionProposal.id, secondProposal)).get()?.status,
    ).toBe('executed');
  });

  test('non-matching text, zero, out-of-range digits, attachments, and unpaired replies do not answer pending cards', async () => {
    await connectAndPair('55');
    await sendQuestionAndPark('q-guard');
    const note = Buffer.from('note\n').toString('base64');

    sessions[0]?.handlers.onMessage(inbound('55', '0'));
    sessions[0]?.handlers.onMessage(inbound('55', '9'));
    sessions[0]?.handlers.onMessage(inbound('55', 'maybe'));
    sessions[0]?.handlers.onMessage({
      ...inbound('55', '1'),
      files: [{ name: 'note.txt', mimeType: 'text/plain', dataBase64: note }],
    });
    sessions[0]?.handlers.onMessage(inbound('stranger', '1', 'chat-stranger'));

    const content = askQuestionContentOf(
      s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'q-guard')).get()?.content,
    );
    expect(content?.status).toBe('pending');
  });

  test('restores telegram pollOffset and wechat encrypted contextTokens across shutdown and resume', async () => {
    adapters.wechat = wechatAdapterFake;
    await service.createConnection(s.team.id, 'telegram', { botToken: 'good-token' });
    sessions[0]?.handlers.onOffset?.(102);
    expect(connRow()?.pollOffset).toBe('102');

    const login = await service.startWechatLogin();
    wechatWaits.set(login.loginId, {
      status: 'done',
      fields: {
        token: 'wx-tok',
        ilinkBotId: 'wx@im.bot',
        ilinkUserId: 'u1@im.wechat',
        baseUrl: 'https://ilink.example/',
      },
    });
    await service.pollWechatLogin(s.team.id, login.loginId);
    const wxHandlers = wechatSessions[0]?.handlers as {
      onOffset?: (offset: string | number) => void;
      onSecretField?: (key: string, value: string) => void;
    };
    wxHandlers.onOffset?.('BUF-2');
    wxHandlers.onSecretField?.('contextTokensJson', JSON.stringify({ 'u1@im.wechat': 'CTX-9' }));

    await service.shutdown();
    await service.resume();

    expect(sessions[1]?.fields.pollOffset).toBe('102');
    expect(wechatSessions[1]?.fields.pollOffset).toBe('BUF-2');
    expect(wechatSessions[1]?.fields.contextTokensJson).toBe(
      JSON.stringify({ 'u1@im.wechat': 'CTX-9' }),
    );
  });

  test('handles corrupt secretCipher, deleted rows, and stale session errors safely', async () => {
    await service.createConnection(s.team.id, 'telegram', { botToken: 'good-token' });
    const first = sessions[0]!;
    const id = connRow()!.id;
    let rejectFirst: ((err: Error) => void) | undefined;
    first.onSend = () =>
      new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      });
    first.handlers.onMessage(inbound('99', 'ping'));
    await vi.waitFor(() => expect(rejectFirst).toBeTypeOf('function'));

    await service.reconnectConnection(s.team.id, id);
    rejectFirst?.(new ImSendError('permanent', 'old session broke'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.listConnections(s.team.id)[0]?.lastSendError).toBeNull();

    const firstHandlers = first.handlers as {
      onOffset?: (offset: string | number) => void;
      onSecretField?: (key: string, value: string) => void;
    };
    s.db
      .update(imConnection)
      .set({ secretCipher: 'not-valid-cipher' })
      .where(eq(imConnection.id, id))
      .run();
    expect(() => firstHandlers.onSecretField?.('contextTokensJson', '{}')).not.toThrow();

    await service.reconnectConnection(s.team.id, id);
    expect(connRow()?.status).toBe('error');

    await service.deleteConnection(s.team.id, id);
    expect(() => firstHandlers.onOffset?.(999)).not.toThrow();
    expect(() => firstHandlers.onSecretField?.('contextTokensJson', '{}')).not.toThrow();
  });

  test('next successful send clears lastSendError and ready reconnect preserves pairedSenders', async () => {
    await connectAndPair('55');
    const id = connRow()!.id;
    const session = sessions[0]!;
    session.handlers.onStatus('ready');
    session.failWith = new ImSendError('permanent', 'upstream failed');
    session.handlers.onMessage(inbound('55', 'first ask'));
    const failedStep = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, failedStep.id))
      .run();
    upsertChiefRow(
      { db: s.db, convHub: s.convHub },
      {
        id: 'asst-fail-1',
        threadId: failedStep.buildId,
        role: 'assistant',
        content: 'blocked reply',
        createdAt: nowMs() + 1,
      },
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, failedStep.id)).run();
    service.runtime.turnFinished(stepById(failedStep.id));
    await vi.waitFor(() =>
      expect(service.listConnections(s.team.id)[0]?.lastSendError).toBe('upstream failed'),
    );

    session.failWith = null;
    session.handlers.onMessage(inbound('55', 'second ask'));
    const okStep = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, okStep.id))
      .run();
    upsertChiefRow(
      { db: s.db, convHub: s.convHub },
      {
        id: 'asst-ok-2',
        threadId: okStep.buildId,
        role: 'assistant',
        content: 'recovered reply',
        createdAt: nowMs() + 1,
      },
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, okStep.id)).run();
    service.runtime.turnFinished(stepById(okStep.id));
    await vi.waitFor(() => {
      expect(session.sent.some((msg) => msg.text === 'recovered reply')).toBe(true);
      expect(service.listConnections(s.team.id)[0]?.lastSendError).toBeNull();
    });
    expect(connRow()?.status).toBe('ready');

    const reconnected = await service.reconnectConnection(s.team.id, id);
    expect(reconnected.pairedSenders.map((sender) => sender.id)).toEqual(['55']);
  });
});

describe('Wave 4B UX fixes', () => {
  test('suppresses lastAssistantText in turnFinished after notify_user or ask_user while preserving direct replies', async () => {
    await connectAndPair('55');
    const session = sessions[0]!;

    session.handlers.onMessage(inbound('55', 'send notice only'));
    const notifyStep = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, notifyStep.id))
      .run();
    notifyChiefMessage(
      { db: s.db, hub: s.hub, user: s.user },
      {
        threadId: notifyStep.buildId,
        message: 'actual reply for user',
        agent: { name: 'Coordinator', avatarUrl: null },
      },
    );
    upsertChiefRow(
      { db: s.db },
      {
        id: 'asst-wake-summary-1',
        threadId: notifyStep.buildId,
        role: 'assistant',
        content: '已通过 notify_user (provenance: im:telegram:c1:777) 回复。本轮结束。',
        createdAt: nowMs() + 5,
      },
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, notifyStep.id)).run();
    service.runtime.turnFinished(stepById(notifyStep.id));
    await vi.waitFor(() => expect(session.sent).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.sent).toHaveLength(1);
    expect(session.sent[0]?.text).toBe('actual reply for user');

    session.sent.splice(0);
    session.handlers.onMessage(inbound('55', 'ask me options'));
    const askStep = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() + 10 })
      .where(eq(step.id, askStep.id))
      .run();
    createOrGetQuestion(
      { db: s.db, convHub: s.convHub, hub: s.hub, user: s.user },
      {
        threadId: askStep.buildId,
        requestId: 'ask-suppressed-1',
        questions: [
          {
            header: 'Pick',
            question: '选择哪一项',
            options: [{ label: '选项 A' }, { label: '选项 B' }],
          },
        ],
        askedFor: [],
      },
    );
    await vi.waitFor(() => expect(session.sent).toHaveLength(1));
    upsertChiefRow(
      { db: s.db },
      {
        id: 'asst-wake-summary-2',
        threadId: askStep.buildId,
        role: 'assistant',
        content: '已发送确认卡，正在等待用户回答，本轮结束。',
        createdAt: nowMs() + 15,
      },
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, askStep.id)).run();
    service.runtime.turnFinished(stepById(askStep.id));
    await vi.waitFor(() => expect(session.sent).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.sent).toHaveLength(1);
    expect(session.sent[0]?.buttons?.[0]?.map((b) => b.label)).toEqual(['选项 A', '选项 B']);

    session.sent.splice(0);
    session.handlers.onMessage(inbound('55', 'direct ping'));
    const directStep = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() + 20 })
      .where(eq(step.id, directStep.id))
      .run();
    upsertChiefRow(
      { db: s.db },
      {
        id: 'asst-direct-3',
        threadId: directStep.buildId,
        role: 'assistant',
        content: 'direct pong',
        createdAt: nowMs() + 25,
      },
    );
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, directStep.id)).run();
    service.runtime.turnFinished(stepById(directStep.id));
    await vi.waitFor(() => expect(session.sent).toHaveLength(1));
    expect(session.sent[0]?.text).toBe('direct pong');
  });

  test('settleCard clears platform buttons on fresh and stale card clicks', async () => {
    await connectAndPair('55');
    const session = sessions[0]!;
    session.handlers.onMessage(inbound('55', 'send card'));
    const turn = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, turn.id))
      .run();
    createOrGetQuestion(
      { db: s.db, convHub: s.convHub, hub: s.hub, user: s.user },
      {
        threadId: turn.buildId,
        requestId: 'ask-settle-1',
        questions: [
          {
            header: 'Confirm',
            question: '继续吗',
            options: [{ label: '同意' }, { label: '取消' }],
          },
        ],
        askedFor: [],
      },
    );
    await vi.waitFor(() => expect(session.sent).toHaveLength(1));
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, turn.id)).run();
    service.runtime.turnFinished(stepById(turn.id));

    const ref: ImCardMessageRef = { chatKey: '777', messageRef: 'm-1', text: '继续吗' };
    session.handlers.onAction?.({
      chat: { key: '777', kind: 'direct', title: null },
      sender: { id: '55', name: 'Ian' },
      value: 'imcb:ask-settle-1:1',
      messageId: 'act-1',
      cardMessage: ref,
    });
    session.handlers.onAction?.({
      chat: { key: '777', kind: 'direct', title: null },
      sender: { id: '55', name: 'Ian' },
      value: 'imcb:ask-settle-1:0',
      messageId: 'act-2',
      cardMessage: ref,
    });
    await vi.waitFor(() => expect(session.settledCards).toHaveLength(2));
    expect(session.settledCards).toEqual([
      { ref, summary: '已选择：取消' },
      { ref, summary: '已处理' },
    ]);
  });

  test('coalesces unstarted same-origin turns, steers claimed native turns, preserves origin on unconsumed release, and isolates cross-origin turns', async () => {
    await connectAndPair('55');
    const conn = connRow()!;
    const secondSender = { id: '66', name: 'Other', chatKey: '888', addedAt: nowMs() };
    s.db
      .update(imConnection)
      .set({ pairedSenders: [...conn.pairedSenders, secondSender] })
      .where(eq(imConnection.id, conn.id))
      .run();

    const session = sessions[0]!;
    session.handlers.onMessage(inbound('55', 'first photo message', '777'));
    session.handlers.onMessage(inbound('55', 'follow-up instruction', '777'));
    const allPending = s.db.select().from(step).where(eq(step.kind, 'chief')).all();
    expect(allPending).toHaveLength(1);
    const mergedStep = allPending[0]!;
    expect(mergedStep.prompt).toContain('first photo message');
    expect(mergedStep.prompt).toContain('follow-up instruction');

    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs(), holdReason: null })
      .where(eq(step.id, mergedStep.id))
      .run();
    session.handlers.onMessage(inbound('55', 'steered while running', '777'));
    const inputs = coordinatorInputs(s.db, mergedStep.buildId);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      stepId: mergedStep.id,
      kind: 'steer',
      state: 'pending',
    });
    expect(inputs[0]?.content).toContain('steered while running');
    const steeredStep = stepById(inputs[0]!.id);
    expect(steeredStep.holdReason).toBe('steer');
    expect(
      s.db.select().from(imTurnOrigin).where(eq(imTurnOrigin.stepId, steeredStep.id)).get(),
    ).toMatchObject({
      connId: conn.id,
      chatKey: '777',
    });

    releaseCoordinatorInput(s.db, inputs[0]!.id, null);
    const released = coordinatorInputs(s.db, mergedStep.buildId)[0]!;
    expect(released.state).toBe('released');
    expect(released.successorStepId).not.toBeNull();
    const successor = stepById(released.successorStepId!);
    expect(successor.status).toBe('pending');
    expect(successor.freshSession).toBe(true);
    expect(successor.prompt).toContain('steered while running');
    expect(
      s.db.select().from(imTurnOrigin).where(eq(imTurnOrigin.stepId, successor.id)).get(),
    ).toMatchObject({ connId: conn.id, chatKey: '777' });
    expect(
      s.db.select().from(imTurnOrigin).where(eq(imTurnOrigin.stepId, steeredStep.id)).get(),
    ).toBeUndefined();

    session.handlers.onMessage(inbound('66', 'different chat turn', '888'));
    expect(coordinatorInputs(s.db, mergedStep.buildId)).toHaveLength(1);
    const otherStep = latestChiefStep();
    expect(otherStep.holdReason).toBeNull();
    expect(otherStep.prompt).toContain('different chat turn');
  });
});

describe('one message per chat turn', () => {
  test('the closing narration after a message already sent in the same turn is dropped', async () => {
    await connectAndPair('55');
    const session = sessions[0]!;
    session.handlers.onMessage(inbound('55', 'handle this attachment'));
    const turn = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, turn.id))
      .run();
    notifyChiefMessage(
      { db: s.db, hub: s.hub, user: s.user },
      {
        threadId: turn.buildId,
        message: '收到，我看一下这个附件。',
        agent: { name: 'Coordinator', avatarUrl: null },
      },
    );
    await vi.waitFor(() => expect(session.sent).toHaveLength(1));
    notifyChiefMessage(
      { db: s.db, hub: s.hub, user: s.user },
      {
        threadId: turn.buildId,
        message: '已通过 notify_user 回复，本轮结束。',
        agent: { name: 'Coordinator', avatarUrl: null },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.sent).toHaveLength(1);
    expect(session.sent[0]?.text).toBe('收到，我看一下这个附件。');
  });

  test('a question card already in the chat is not repeated by the thread notification that follows it', async () => {
    await connectAndPair('55');
    const session = sessions[0]!;
    session.handlers.onMessage(inbound('55', 'ask me something'));
    const turn = latestChiefStep();
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, turn.id))
      .run();
    createOrGetQuestion(
      { db: s.db, convHub: s.convHub, hub: s.hub, user: s.user },
      {
        threadId: turn.buildId,
        requestId: 'ask-dup-1',
        questions: [
          { header: 'Pick', question: '选哪一项', options: [{ label: '选项 A' }, { label: '选项 B' }] },
        ],
        askedFor: [],
      },
    );
    await vi.waitFor(() => expect(session.sent).toHaveLength(1));
    expect(session.sent[0]?.buttons?.[0]?.map((b) => b.label)).toEqual(['选项 A', '选项 B']);
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, turn.id)).run();
    announceQuestion(
      { db: s.db, convHub: s.convHub, hub: s.hub, user: s.user },
      turn.buildId,
      'ask-dup-1',
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.sent).toHaveLength(1);
  });
});
