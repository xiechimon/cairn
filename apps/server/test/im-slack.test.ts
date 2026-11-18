import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ImSendError } from '../src/services/im/errors.js';
import { createSlackAdapter } from '../src/services/im/slack.js';
import type { ImConnectionHandlers, ImEnv, ImInboundMessage } from '../src/services/im/types.js';

const APP_TOKEN = 'xapp-1-A0123BCDE-456789-abcdef';
const BOT_TOKEN = 'xoxb-123456789012-abcdefghijkl';
const PARK = Symbol('park');

type SlackReply = Record<string, unknown> | typeof PARK | { __http: number; retryAfter?: number };

interface RecordedCall {
  method: string;
  body: Record<string, unknown>;
  authorization: string | null;
}

interface FakeSocket {
  url: string;
  sent: string[];
  closed: boolean;
  receive(frame: unknown): void;
  drop(code: number, reason: string): void;
  close(): void;
}

interface FakeSlack {
  env: ImEnv;
  calls: RecordedCall[];
  sockets: FakeSocket[];
  slept: number[];
  queue(method: string, reply: SlackReply): void;
}

function fakeSlackEnv(): FakeSlack {
  const calls: RecordedCall[] = [];
  const sockets: FakeSocket[] = [];
  const slept: number[] = [];
  const queues = new Map<string, SlackReply[]>();
  const env: ImEnv = {
    now: () => Date.now(),
    sleep: async (ms) => {
      slept.push(ms);
    },
    fetch: (url, init) => {
      const method = String(url).split('/').pop() ?? '';
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ method, body, authorization: headers.authorization ?? null });
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
        const queued = queues.get(method)?.shift();
        if (queued === undefined || queued === PARK) return;
        if (typeof queued === 'object' && '__http' in queued) {
          const http = queued as { __http: number; retryAfter?: number };
          resolve(
            new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
              status: http.__http,
              headers: {
                'content-type': 'application/json',
                ...(http.retryAfter !== undefined
                  ? { 'retry-after': String(http.retryAfter) }
                  : {}),
              },
            }),
          );
          return;
        }
        resolve(
          new Response(JSON.stringify(queued), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      });
    },
    connectSocket: (url, handlers) => {
      const socket: FakeSocket = {
        url,
        sent: [],
        closed: false,
        receive: (frame) => handlers.onMessage(JSON.stringify(frame)),
        drop: (code, reason) => handlers.onClose(code, reason),
        close: () => {
          if (socket.closed) return;
          socket.closed = true;
          handlers.onClose(1000, 'normal');
        },
      };
      sockets.push(socket);
      return {
        send: (text) => socket.sent.push(text),
        close: () => socket.close(),
      };
    },
  };
  return {
    env,
    calls,
    sockets,
    slept,
    queue(method, reply) {
      queues.set(method, [...(queues.get(method) ?? []), reply]);
    },
  };
}

const AUTH_OK = {
  ok: true,
  url: 'https://cairn-hq.slack.com/',
  team: 'Cairn HQ',
  user: 'cairn_bot',
  team_id: 'T0TEAM',
  user_id: 'U0BOT',
  bot_id: 'B0BOT',
} as const;

const OPEN_OK = {
  ok: true,
  url: 'wss://wss-primary.slack.com/link/?ticket=t-1',
} as const;

function imEnvelope(envelopeId: string, event: Record<string, unknown>): Record<string, unknown> {
  return { envelope_id: envelopeId, type: 'events_api', payload: { event } };
}

function messageEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'message',
    channel: 'D0DM',
    channel_type: 'im',
    user: 'U42',
    text: 'hello cairn',
    ts: '1700000001.000001',
    ...overrides,
  };
}

describe('slack adapter', () => {
  let slack: FakeSlack;
  const adapter = createSlackAdapter();

  beforeEach(() => {
    slack = fakeSlackEnv();
  });

  async function readySession(handlers: ImConnectionHandlers) {
    slack.queue('auth.test', AUTH_OK);
    slack.queue('apps.connections.open', OPEN_OK);
    const session = await adapter.connect(
      { appToken: APP_TOKEN, botToken: BOT_TOKEN },
      handlers,
      slack.env,
    );
    await vi.waitFor(() => expect(slack.sockets).toHaveLength(1));
    return session;
  }

  test('check returns the workspace name from auth.test', async () => {
    slack.queue('auth.test', AUTH_OK);
    const checked = await createSlackAdapter(slack.env).check({
      appToken: APP_TOKEN,
      botToken: BOT_TOKEN,
    });
    expect(checked).toEqual({ ok: true, accountLabel: 'Cairn HQ' });
    expect(slack.calls[0]?.authorization).toBe(`Bearer ${BOT_TOKEN}`);
  });

  test('check rejects malformed tokens without a request', async () => {
    const badApp = await createSlackAdapter(slack.env).check({
      appToken: 'nope',
      botToken: BOT_TOKEN,
    });
    const badBot = await createSlackAdapter(slack.env).check({
      appToken: APP_TOKEN,
      botToken: 'nope',
    });
    expect(badApp.ok).toBe(false);
    expect(badBot.ok).toBe(false);
    expect(slack.calls).toHaveLength(0);
  });

  test('check reports a refused bot token', async () => {
    slack.queue('auth.test', { ok: false, error: 'invalid_auth' });
    const checked = await createSlackAdapter(slack.env).check({
      appToken: APP_TOKEN,
      botToken: BOT_TOKEN,
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.reason).toContain('invalid_auth');
  });

  test('opens a socket from apps.connections.open and is ready on hello', async () => {
    const statuses: string[] = [];
    const session = await readySession({
      onMessage: () => {},
      onStatus: (status) => statuses.push(status),
    });
    expect(slack.calls.map((call) => call.method)).toEqual(['auth.test', 'apps.connections.open']);
    expect(slack.calls[1]?.authorization).toBe(`Bearer ${APP_TOKEN}`);
    expect(slack.sockets[0]?.url).toBe(OPEN_OK.url);
    slack.sockets[0]?.receive({ type: 'hello' });
    await vi.waitFor(() => expect(statuses).toContain('ready'));
    await session.stop();
  });

  test('delivers im messages with the inbound shape and acks the envelope', async () => {
    const inbound: ImInboundMessage[] = [];
    const session = await readySession({
      onMessage: (msg) => inbound.push(msg),
      onStatus: () => {},
    });
    slack.queue('users.info', {
      ok: true,
      user: { name: 'ian', profile: { display_name: 'Ian Chen' } },
    });
    slack.sockets[0]?.receive(imEnvelope('env-1', messageEvent()));
    await vi.waitFor(() => expect(inbound).toHaveLength(1));
    expect(inbound[0]).toMatchObject({
      chat: { key: 'D0DM', kind: 'direct', title: null },
      sender: { id: 'U42', name: 'Ian Chen' },
      text: 'hello cairn',
      images: [],
      messageId: '1700000001.000001',
      mentioned: false,
    });
    expect(slack.sockets[0]?.sent).toContain(JSON.stringify({ envelope_id: 'env-1' }));
    await session.stop();
  });

  test('acks but ignores group messages, subtypes, non-message events and the bot itself', async () => {
    const inbound: ImInboundMessage[] = [];
    const session = await readySession({
      onMessage: (msg) => inbound.push(msg),
      onStatus: () => {},
    });
    const socket = slack.sockets[0];
    socket?.receive(imEnvelope('e-chan', messageEvent({ channel_type: 'channel' })));
    socket?.receive(imEnvelope('e-botmsg', messageEvent({ subtype: 'bot_message' })));
    socket?.receive(imEnvelope('e-self', messageEvent({ user: 'U0BOT' })));
    socket?.receive(
      imEnvelope('e-react', { type: 'reaction_added', user: 'U42', reaction: 'eyes' }),
    );
    await vi.waitFor(() => expect(socket?.sent).toHaveLength(4));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(inbound).toHaveLength(0);
    await session.stop();
  });

  test('acks interactive envelopes without routing them', async () => {
    const inbound: ImInboundMessage[] = [];
    const session = await readySession({
      onMessage: (msg) => inbound.push(msg),
      onStatus: () => {},
    });
    const socket = slack.sockets[0];
    socket?.receive({
      envelope_id: 'e-int',
      type: 'interactive',
      payload: { type: 'block_actions', actions: [{ value: 'approve' }] },
    });
    await vi.waitFor(() =>
      expect(socket?.sent).toContain(JSON.stringify({ envelope_id: 'e-int' })),
    );
    expect(inbound).toHaveLength(0);
    await session.stop();
  });

  test('send posts chat.postMessage with the bot token', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1700000002.000002' });
    await session.send({ chatKey: 'D0DM', text: 'hi there' });
    const posts = slack.calls.filter((call) => call.method === 'chat.postMessage');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ channel: 'D0DM', text: 'hi there' });
    expect(posts[0]?.authorization).toBe(`Bearer ${BOT_TOKEN}`);
    await session.stop();
  });

  test('send renders buttons as block kit actions', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    await session.send({
      chatKey: 'D0DM',
      text: 'choose',
      buttons: [[{ label: 'Approve', value: 'approve-1' }], [{ label: 'No', value: 'no' }]],
    });
    const post = slack.calls.find((call) => call.method === 'chat.postMessage');
    expect(post?.body.blocks).toEqual([
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            value: 'approve-1',
            action_id: 'cairn-0-0',
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'No' },
            value: 'no',
            action_id: 'cairn-1-0',
          },
        ],
      },
    ]);
    await session.stop();
  });

  test('send chunks long messages and threads only the first', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    slack.queue('chat.postMessage', { ok: true, ts: '2' });
    slack.queue('chat.postMessage', { ok: true, ts: '3' });
    await session.send({
      chatKey: 'D0DM',
      text: 'x'.repeat(6500),
      replyToMessageId: '1700000000.000000',
    });
    const posts = slack.calls.filter((call) => call.method === 'chat.postMessage');
    expect(posts).toHaveLength(3);
    expect(posts[0]?.body.thread_ts).toBe('1700000000.000000');
    expect(posts[1]?.body.thread_ts).toBeUndefined();
    await session.stop();
  });

  test('send honors retry-after through a retryable ImSendError', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { __http: 429, retryAfter: 7 });
    await expect(session.send({ chatKey: 'D0DM', text: 'hi' })).rejects.toSatisfy(
      (err) => err instanceof ImSendError && err.kind === 'retry' && err.retryAfterMs === 7000,
    );
    await session.stop();
  });

  test('send marks auth failures permanent and expired', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: false, error: 'invalid_auth' });
    await expect(session.send({ chatKey: 'D0DM', text: 'hi' })).rejects.toSatisfy(
      (err) => err instanceof ImSendError && err.kind === 'permanent' && err.authExpired === true,
    );
    await session.stop();
  });

  test('a disconnect envelope triggers a fresh apps.connections.open', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('apps.connections.open', {
      ok: true,
      url: 'wss://wss-primary.slack.com/link/?ticket=t-2',
    });
    slack.sockets[0]?.receive({ type: 'disconnect', reason: 'warning' });
    await vi.waitFor(() => expect(slack.sockets).toHaveLength(2));
    expect(slack.calls.filter((call) => call.method === 'apps.connections.open')).toHaveLength(2);
    expect(slack.sockets[0]?.closed).toBe(true);
    expect(slack.sockets[1]?.url).toContain('ticket=t-2');
    await session.stop();
  });

  test('a dropped socket reconnects with backoff', async () => {
    const statuses: { status: string; detail?: string }[] = [];
    const session = await readySession({
      onMessage: () => {},
      onStatus: (status, detail) => statuses.push({ status, detail }),
    });
    slack.sockets[0]?.receive({ type: 'hello' });
    slack.queue('apps.connections.open', PARK);
    slack.sockets[0]?.drop(1006, 'abnormal closure');
    await vi.waitFor(() =>
      expect(
        slack.calls.filter((call) => call.method === 'apps.connections.open').length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(statuses.map((row) => row.status)).toContain('degraded');
    await session.stop();
  });

  test('invalid_auth on apps.connections.open reports expired and stops', async () => {
    slack.queue('auth.test', AUTH_OK);
    slack.queue('apps.connections.open', { ok: false, error: 'invalid_auth' });
    const statuses: string[] = [];
    const session = await adapter.connect(
      { appToken: APP_TOKEN, botToken: BOT_TOKEN },
      { onMessage: () => {}, onStatus: (status) => statuses.push(status) },
      slack.env,
    );
    await vi.waitFor(() => expect(statuses).toContain('expired'));
    const opens = slack.calls.filter((call) => call.method === 'apps.connections.open').length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(slack.calls.filter((call) => call.method === 'apps.connections.open')).toHaveLength(
      opens,
    );
    expect(slack.sockets).toHaveLength(0);
    await session.stop();
  });

  test('link_disabled disconnect reports an error and stops', async () => {
    const statuses: { status: string; detail?: string }[] = [];
    const session = await readySession({
      onMessage: () => {},
      onStatus: (status, detail) => statuses.push({ status, detail }),
    });
    slack.sockets[0]?.receive({ type: 'disconnect', reason: 'link_disabled' });
    await vi.waitFor(() => expect(statuses.map((row) => row.status)).toContain('error'));
    const opens = slack.calls.filter((call) => call.method === 'apps.connections.open').length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(slack.calls.filter((call) => call.method === 'apps.connections.open')).toHaveLength(
      opens,
    );
    await session.stop();
  });

  test('stop closes the socket and halts reconnects', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('apps.connections.open', PARK);
    await session.stop();
    expect(slack.sockets[0]?.closed).toBe(true);
    const opens = slack.calls.filter((call) => call.method === 'apps.connections.open').length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(slack.calls.filter((call) => call.method === 'apps.connections.open')).toHaveLength(
      opens,
    );
  });
});
