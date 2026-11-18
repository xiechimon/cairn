import type { ImPlatform } from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openMemoryDb } from '../src/db/client.js';
import { seed } from '../src/db/seed.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { ConversationStreamHub, TeamStreamHub } from '../src/services/events.js';
import { createImService, type ImService } from '../src/services/im/core.js';
import { setImRuntime } from '../src/services/im/runtime.js';
import type {
  ImAdapter,
  ImConnectionHandlers,
  ImEnv,
  ImInboundMessage,
  ImOutboundMessage,
} from '../src/services/im/types.js';
import { MachineWakeHub } from '../src/services/machine-wake-hub.js';
import { bootServer, req, type TestServer } from './helpers.js';

const sessions: { handlers: ImConnectionHandlers; sent: ImOutboundMessage[] }[] = [];

const adapter: ImAdapter = {
  platform: 'telegram',
  check: async (fields) =>
    fields.botToken === 'bad-token'
      ? { ok: false, reason: 'telegram refused the token' }
      : { ok: true, accountLabel: '@cairn_test_bot' },
  connect: async (_fields, handlers, _env) => {
    const session = { handlers, sent: [] as ImOutboundMessage[] };
    sessions.push(session);
    return {
      send: async (msg) => {
        session.sent.push(msg);
      },
      stop: async () => {},
    };
  },
};

const slackAdapterFake: ImAdapter = {
  platform: 'slack',
  check: async (fields) =>
    fields.appToken === 'bad-app' || fields.botToken === 'bad-bot'
      ? { ok: false, reason: 'slack refused the tokens' }
      : { ok: true, accountLabel: 'Cairn HQ' },
  connect: async (_fields, handlers, _env) => {
    const session = { handlers, sent: [] as ImOutboundMessage[] };
    sessions.push(session);
    return {
      send: async (msg) => {
        session.sent.push(msg);
      },
      stop: async () => {},
    };
  },
};

const wechatWaits = new Map<
  string,
  { status: 'pending' | 'expired' } | { status: 'done'; fields: Record<string, string> }
>();
let wechatLoginSeq = 0;

const wechatAdapterFake: ImAdapter = {
  platform: 'wechat',
  check: async (fields) => ({
    ok: true,
    accountLabel: `WeChat ${fields.ilinkBotId ?? 'bot'}`,
  }),
  connect: async (_fields, handlers, _env) => {
    const session = { handlers, sent: [] as ImOutboundMessage[] };
    sessions.push(session);
    return {
      send: async (msg) => {
        session.sent.push(msg);
      },
      stop: async () => {},
    };
  },
  loginStart: async (env) => {
    wechatLoginSeq += 1;
    return {
      loginId: `wx_route_${wechatLoginSeq}`,
      qr: 'https://ilink.example/q/ABC',
      expiresAt: env.now() + 300_000,
    };
  },
  loginWait: async (loginId) => wechatWaits.get(loginId) ?? { status: 'pending' },
};

const env: ImEnv = {
  fetch: (() => Promise.reject(new Error('offline'))) as typeof fetch,
  now: () => Date.now(),
  sleep: async () => {},
  connectSocket: () => {
    throw new Error('offline');
  },
};

let seq = 0;
const inbound = (senderId: string): ImInboundMessage => {
  seq += 1;
  return {
    chat: { key: '777', kind: 'direct', title: null },
    sender: { id: senderId, name: 'Ian' },
    text: 'hello',
    images: [],
    messageId: `r-${seq}`,
    mentioned: false,
  };
};

let s: TestServer;
let service: ImService;
let teamId: string;

let adapters: Partial<Record<ImPlatform, ImAdapter>>;

beforeEach(() => {
  sessions.length = 0;
  wechatWaits.clear();
  const db = openMemoryDb();
  const seeded = seed(db);
  teamId = seeded.team.id;
  adapters = { telegram: adapter };
  service = createImService({
    db,
    hub: new TeamStreamHub(),
    machineHub: new MachineWakeHub(),
    convHub: new ConversationStreamHub(),
    box: createEphemeralSecretBox(),
    user: seeded.user,
    env,
    adapters,
  });
  setImRuntime(service.runtime);
  s = bootServer({ db, im: service, vapidKeys: null });
});

afterEach(() => {
  setImRuntime(null);
  void service.shutdown();
});

describe('im routes', () => {
  test('create, list and delete a telegram connection', async () => {
    const created = await req(s.app, 'POST', `/api/teams/${teamId}/im/telegram`, {
      botToken: 'good-token',
    });
    expect(created.status).toBe(200);
    const { connection } = (await created.json()) as {
      connection: { id: string; accountLabel: string; status: string };
    };
    expect(connection.accountLabel).toBe('@cairn_test_bot');

    const listed = await req(s.app, 'GET', `/api/teams/${teamId}/im/connections`);
    const { connections } = (await listed.json()) as { connections: { id: string }[] };
    expect(connections.map((row) => row.id)).toContain(connection.id);

    const deleted = await req(
      s.app,
      'DELETE',
      `/api/teams/${teamId}/im/connections/${connection.id}`,
    );
    expect(deleted.status).toBe(200);
    const listedAfter = await req(s.app, 'GET', `/api/teams/${teamId}/im/connections`);
    const body = (await listedAfter.json()) as { connections: unknown[] };
    expect(body.connections).toHaveLength(0);
  });

  test('a refused credential returns 400 and stores nothing', async () => {
    const res = await req(s.app, 'POST', `/api/teams/${teamId}/im/telegram`, {
      botToken: 'bad-token',
    });
    expect(res.status).toBe(400);
    const listed = await req(s.app, 'GET', `/api/teams/${teamId}/im/connections`);
    const { connections } = (await listed.json()) as { connections: unknown[] };
    expect(connections).toHaveLength(0);
  });

  test('pairing requests list, approve and reject', async () => {
    await req(s.app, 'POST', `/api/teams/${teamId}/im/telegram`, { botToken: 'good-token' });
    sessions[0]?.handlers.onMessage(inbound('55'));
    sessions[0]?.handlers.onMessage(inbound('66'));

    const listed = await req(s.app, 'GET', `/api/teams/${teamId}/im/pairing-requests`);
    const { requests } = (await listed.json()) as {
      requests: { id: string; senderId: string; status: string }[];
    };
    expect(requests).toHaveLength(2);

    const approveId = requests.find((row) => row.senderId === '66')!.id;
    const approved = await req(
      s.app,
      'POST',
      `/api/teams/${teamId}/im/pairing-requests/${approveId}/approve`,
    );
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as { request: { status: string } }).request.status).toBe(
      'approved',
    );

    const rejectId = requests.find((row) => row.senderId === '55')!.id;
    const rejected = await req(
      s.app,
      'POST',
      `/api/teams/${teamId}/im/pairing-requests/${rejectId}/reject`,
    );
    expect(rejected.status).toBe(200);
    expect(((await rejected.json()) as { request: { status: string } }).request.status).toBe(
      'rejected',
    );

    const again = await req(
      s.app,
      'POST',
      `/api/teams/${teamId}/im/pairing-requests/${rejectId}/approve`,
    );
    expect(again.status).toBe(409);
  });

  test('create a slack connection with app and bot tokens', async () => {
    adapters.slack = slackAdapterFake;
    const created = await req(s.app, 'POST', `/api/teams/${teamId}/im/slack`, {
      appToken: 'xapp-good',
      botToken: 'xoxb-good',
    });
    expect(created.status).toBe(200);
    const { connection } = (await created.json()) as {
      connection: { platform: string; accountLabel: string };
    };
    expect(connection.platform).toBe('slack');
    expect(connection.accountLabel).toBe('Cairn HQ');

    const refused = await req(s.app, 'POST', `/api/teams/${teamId}/im/slack`, {
      appToken: 'bad-app',
      botToken: 'xoxb-good',
    });
    expect(refused.status).toBe(400);

    const malformed = await req(s.app, 'POST', `/api/teams/${teamId}/im/slack`, {
      appToken: 'xapp-good',
    });
    expect(malformed.status).toBe(400);
  });

  test('another team sees nothing', async () => {
    const res = await req(s.app, 'GET', `/api/teams/other-team/im/connections`);
    expect(res.status).toBe(404);
  });

  test('deciding a missing request returns 404', async () => {
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${teamId}/im/pairing-requests/missing/approve`,
    );
    expect(res.status).toBe(404);
  });

  test('wechat qr login starts, waits and creates the connection on confirm', async () => {
    adapters.wechat = wechatAdapterFake;
    const start = await req(s.app, 'POST', `/api/teams/${teamId}/im/wechat/login`);
    expect(start.status).toBe(200);
    const login = (await start.json()) as {
      loginId: string;
      qr?: string;
      expiresAt: number;
    };
    expect(login.qr).toBe('https://ilink.example/q/ABC');
    expect(login.expiresAt).toBeGreaterThan(Date.now());

    const pending = await req(
      s.app,
      'GET',
      `/api/teams/${teamId}/im/wechat/login/${login.loginId}`,
    );
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({ status: 'pending' });

    wechatWaits.set(login.loginId, {
      status: 'done',
      fields: {
        token: 'BOT-TOKEN',
        ilinkBotId: 'bot@im.bot',
        ilinkUserId: 'scanner@im.wechat',
        baseUrl: 'https://ilink.example/',
      },
    });
    const done = await req(s.app, 'GET', `/api/teams/${teamId}/im/wechat/login/${login.loginId}`);
    expect(done.status).toBe(200);
    const body = (await done.json()) as {
      status: string;
      connection: { platform: string; pairedSenders: { id: string }[] };
    };
    expect(body.status).toBe('done');
    expect(body.connection.platform).toBe('wechat');
    expect(body.connection.pairedSenders.map((sender) => sender.id)).toEqual(['scanner@im.wechat']);

    const listed = await req(s.app, 'GET', `/api/teams/${teamId}/im/connections`);
    const { connections } = (await listed.json()) as {
      connections: { platform: string }[];
    };
    expect(connections.map((row) => row.platform)).toEqual(['wechat']);
  });

  test('wechat login reports expired and is a 400 without the adapter', async () => {
    const missing = await req(s.app, 'POST', `/api/teams/${teamId}/im/wechat/login`);
    expect(missing.status).toBe(400);
    const missingPoll = await req(s.app, 'GET', `/api/teams/${teamId}/im/wechat/login/wx_route_0`);
    expect(missingPoll.status).toBe(400);

    adapters.wechat = wechatAdapterFake;
    const start = await req(s.app, 'POST', `/api/teams/${teamId}/im/wechat/login`);
    const login = (await start.json()) as { loginId: string };
    wechatWaits.set(login.loginId, { status: 'expired' });
    const expired = await req(
      s.app,
      'GET',
      `/api/teams/${teamId}/im/wechat/login/${login.loginId}`,
    );
    expect(await expired.json()).toEqual({ status: 'expired' });
  });
});
