import { describe, expect, test } from 'vitest';
import type {
  ImConnectionHandlers,
  ImEnv,
  ImInboundMessage,
  ImOutboundMessage,
} from '../src/services/im/wechat.js';
import { wechatAdapter } from '../src/services/im/wechat.js';

const HANG = Symbol('hang');

interface RecordedCall {
  url: string;
  init: RequestInit;
  body: unknown;
}

type ScriptEntry = Record<string, unknown> | Response | Error | typeof HANG;

function sequence(map: Record<string, ScriptEntry[]>) {
  const queues = new Map(Object.entries(map).map(([key, list]) => [key, [...list]]));
  return ({ url }: RecordedCall): ScriptEntry | Promise<ScriptEntry> => {
    for (const [key, queue] of queues) {
      if (url.includes(key)) {
        const next = queue.shift();
        return next === undefined ? HANG : next;
      }
    }
    throw new Error(`unscripted fetch: ${url}`);
  };
}

function makeEnv(handle: (call: RecordedCall) => ScriptEntry | Promise<ScriptEntry>) {
  const calls: RecordedCall[] = [];
  const sleeps: number[] = [];
  const state = { now: 1_700_000_000_000 };
  const env: ImEnv = {
    fetch: (async (url: unknown, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      const call: RecordedCall = { url: String(url), init, body };
      calls.push(call);
      const result = await handle(call);
      if (result === HANG) {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          const onAbort = () => {
            const reason = signal?.reason;
            reject(
              reason instanceof Error
                ? reason
                : new DOMException('The operation was aborted', 'AbortError'),
            );
          };
          if (signal?.aborted === true) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
      if (result instanceof Response) return result;
      if (result instanceof Error) throw result;
      return new Response(JSON.stringify(result ?? {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
    now: () => state.now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    connectSocket: () => {
      throw new Error('offline');
    },
  };
  return { env, calls, sleeps, state };
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function makeHandlers() {
  const messages: ImInboundMessage[] = [];
  const statuses: { status: string; detail?: string }[] = [];
  const handlers: ImConnectionHandlers = {
    onMessage: (msg) => messages.push(msg),
    onStatus: (status, detail) => statuses.push({ status, ...(detail ? { detail } : {}) }),
  };
  return { handlers, messages, statuses };
}

const callsTo = (calls: RecordedCall[], key: string) =>
  calls.filter((call) => call.url.includes(key));

const callBody = (call: RecordedCall) => call.body as Record<string, unknown>;

const callHeaders = (call: RecordedCall) => call.init.headers as Record<string, string>;

const FIELDS = {
  token: 'BOT-TOKEN',
  ilinkBotId: 'bot@im.bot',
  ilinkUserId: 'owner@im.wechat',
  baseUrl: 'https://ilinkai.weixin.qq.com/',
};

describe('wechat adapter check', () => {
  test('accepts ilink fields and labels the account', async () => {
    await expect(wechatAdapter.check(FIELDS)).resolves.toEqual({
      ok: true,
      accountLabel: 'WeChat bot@im.bot',
    });
  });

  test('rejects fields without a token', async () => {
    await expect(wechatAdapter.check({})).resolves.toEqual({
      ok: false,
      reason: 'missing iLink bot token',
    });
    await expect(wechatAdapter.check({ token: '  ' })).resolves.toEqual({
      ok: false,
      reason: 'missing iLink bot token',
    });
  });

  test('rejects a malformed baseUrl', async () => {
    const result = await wechatAdapter.check({ token: 't', baseUrl: 'not a url' });
    expect(result.ok).toBe(false);
  });
});

describe('wechat adapter QR login', () => {
  test('loginStart returns a QR and loginWait finishes with connect fields', async () => {
    const { env, calls, state } = makeEnv(
      sequence({
        get_bot_qrcode: [
          { qrcode: 'QR-TOKEN', qrcode_img_content: 'https://ilinkai.weixin.qq.com/q/ABC' },
        ],
        get_qrcode_status: [
          { status: 'wait' },
          { status: 'scaned' },
          {
            status: 'confirmed',
            bot_token: 'BOT-TOKEN',
            ilink_bot_id: 'bot@im.bot',
            ilink_user_id: 'owner@im.wechat',
            baseurl: 'https://ilinkai.weixin.qq.com/',
          },
        ],
      }),
    );

    const start = await wechatAdapter.loginStart?.(env);
    expect(start?.loginId).toMatch(/^wx_[0-9a-f]{16}$/);
    expect(start?.qr).toBe('https://ilinkai.weixin.qq.com/q/ABC');
    expect(start?.expiresAt).toBe(state.now + 300_000);

    const qrCall = calls[0];
    expect(qrCall?.url).toBe('https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3');
    expect(qrCall?.init.method).toBe('POST');
    expect(callHeaders(qrCall as RecordedCall)).toMatchObject({
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': '132102',
    });
    expect(callBody(qrCall as RecordedCall)).toEqual({ local_token_list: [] });

    const loginId = start?.loginId ?? '';
    await expect(wechatAdapter.loginWait?.(loginId, env)).resolves.toEqual({ status: 'pending' });
    await expect(wechatAdapter.loginWait?.(loginId, env)).resolves.toEqual({ status: 'pending' });
    await expect(wechatAdapter.loginWait?.(loginId, env)).resolves.toEqual({
      status: 'done',
      fields: {
        token: 'BOT-TOKEN',
        ilinkBotId: 'bot@im.bot',
        ilinkUserId: 'owner@im.wechat',
        baseUrl: 'https://ilinkai.weixin.qq.com/',
      },
    });

    const statusCall = callsTo(calls, 'get_qrcode_status')[0];
    expect(statusCall?.init.method).toBeUndefined();
    expect(statusCall?.url).toContain('qrcode=QR-TOKEN');
    expect(callHeaders(statusCall as RecordedCall)).toMatchObject({ 'iLink-App-Id': 'bot' });
  });

  test('loginWait reports expired for unknown or stale logins', async () => {
    const { env, state } = makeEnv(sequence({ get_bot_qrcode: [{ qrcode: 'QR-TOKEN' }] }));
    await expect(wechatAdapter.loginWait?.('wx_missing', env)).resolves.toEqual({
      status: 'expired',
    });
    const start = await wechatAdapter.loginStart?.(env);
    state.now += 6 * 60_000;
    await expect(wechatAdapter.loginWait?.(start?.loginId ?? '', env)).resolves.toEqual({
      status: 'expired',
    });
  });

  test('loginStart rejects when iLink returns no code', async () => {
    const { env } = makeEnv(sequence({ get_bot_qrcode: [{ errmsg: 'rate limited' }] }));
    await expect(wechatAdapter.loginStart?.(env)).rejects.toThrow('rate limited');
  });
});

describe('wechat adapter connect', () => {
  async function connectWith(script: Record<string, ScriptEntry[]>) {
    const { env, calls, sleeps } = makeEnv(sequence(script));
    const { handlers, messages, statuses } = makeHandlers();
    const connection = await wechatAdapter.connect(FIELDS, handlers, env);
    return { env, calls, sleeps, messages, statuses, ...connection };
  }

  test('opens the session, polls getupdates and normalizes messages', async () => {
    const { calls, messages, statuses, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            {
              seq: 2,
              from_user_id: 'u2@im.wechat',
              context_token: 'CTX2',
              message_id: 'm9',
              item_list: [{ type: 1, text_item: { text: 'second' } }],
            },
            {
              seq: 1,
              from_user_id: 'u1@im.wechat',
              context_token: 'CTX1',
              client_id: 'c1',
              message_id: 'm1',
              item_list: [
                { type: 1, text_item: { text: 'hello' } },
                { type: 3, voice_item: { text: 'spoken words' } },
                { type: 2, image_item: { media: { aes_key: 'k' } } },
              ],
            },
          ],
          get_updates_buf: 'BUF1',
        },
      ],
    });

    await waitFor(() => messages.length === 2);
    expect(messages[0]).toEqual({
      chat: { key: 'u1@im.wechat', kind: 'direct', title: null },
      sender: { id: 'u1@im.wechat', name: null },
      text: 'hello\nspoken words',
      images: [{ name: 'image', mimeType: null, dataBase64: null }],
      files: [],
      messageId: 'c1',
      mentioned: false,
    });
    expect(messages[1]?.text).toBe('second');
    expect(messages[1]?.messageId).toBe('m9');

    const updates = callsTo(calls, 'getupdates');
    expect(callHeaders(updates[0] as RecordedCall)).toMatchObject({
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': '132102',
      authorization: 'Bearer BOT-TOKEN',
      AuthorizationType: 'ilink_bot_token',
    });
    expect(callHeaders(updates[0] as RecordedCall)['X-WECHAT-UIN']).toBeTruthy();
    expect(callBody(updates[0] as RecordedCall)).toEqual({
      get_updates_buf: '',
      base_info: { channel_version: '2.4.6' },
    });
    await waitFor(() => callsTo(calls, 'getupdates').length >= 2);
    expect(callBody(callsTo(calls, 'getupdates')[1] as RecordedCall).get_updates_buf).toBe('BUF1');

    expect(statuses.map((s) => s.status)).toEqual(['connecting', 'ready']);
    await stop();
  });

  test('sends replies chunked at 1800 chars with the latest context token', async () => {
    const { calls, messages, send, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            {
              from_user_id: 'u1@im.wechat',
              context_token: 'CTX1',
              item_list: [{ type: 1, text_item: { text: 'hi' } }],
            },
            {
              from_user_id: 'u2@im.wechat',
              context_token: 'CTX2',
              item_list: [{ type: 1, text_item: { text: 'hey' } }],
            },
          ],
        },
      ],
      sendmessage: [{ ret: 0 }, { ret: 0 }, { ret: 0 }, { ret: 0 }, { ret: 0 }],
    });
    await waitFor(() => messages.length === 2);

    const outbound: ImOutboundMessage = {
      chatKey: 'u1@im.wechat',
      text: 'a'.repeat(1_900),
      buttons: [[{ label: 'yes', value: '1' }]],
      replyToMessageId: 'ignored',
    };
    await send(outbound);
    await send({ chatKey: 'u2@im.wechat', text: `${'x'.repeat(1_000)}\n${'y'.repeat(1_500)}` });
    await send({ chatKey: 'nobody@im.wechat', text: 'ping' });

    const sends = callsTo(calls, 'sendmessage');
    expect(sends).toHaveLength(5);
    const texts = sends.map((call) => {
      const msg = callBody(call).msg as Record<string, unknown>;
      const item = (msg.item_list as Record<string, unknown>[])[0];
      return String((item?.text_item as Record<string, unknown> | undefined)?.text);
    });
    expect(texts[0]).toHaveLength(1_800);
    expect(texts[1]).toHaveLength(100);
    expect(texts[2]).toBe('x'.repeat(1_000));
    expect(texts[3]).toBe('y'.repeat(1_500));

    const first = callBody(sends[0] as RecordedCall).msg as Record<string, unknown>;
    expect(first.to_user_id).toBe('u1@im.wechat');
    expect(first.context_token).toBe('CTX1');
    expect(first.message_type).toBe(2);
    expect(first.message_state).toBe(2);
    expect(String(first.client_id)).toMatch(/^cairn-[0-9a-f]{16}$/);

    const second = callBody(sends[2] as RecordedCall).msg as Record<string, unknown>;
    expect(second.to_user_id).toBe('u2@im.wechat');
    expect(second.context_token).toBe('CTX2');

    const nobody = callBody(sends[4] as RecordedCall).msg as Record<string, unknown>;
    expect('context_token' in nobody).toBe(false);
    await stop();
  });

  test('a refused sendmessage rejects the send', async () => {
    const { send, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [{ msgs: [] }],
      sendmessage: [{ ret: 5, errmsg: 'context token invalid' }],
    });
    await expect(send({ chatKey: 'u1', text: 'hi' })).rejects.toThrow(
      'WeChat refused the reply (context token invalid)',
    );
    await stop();
  });

  test('SESSION_EXPIRED on getupdates ends polling with the expired status', async () => {
    const { calls, statuses, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [{ ret: -14, errmsg: 'session timeout' }],
    });
    await waitFor(() => statuses.some((s) => s.status === 'expired'));
    await stop();
    expect(statuses.map((s) => s.status)).toEqual(['connecting', 'expired']);
    expect(callsTo(calls, 'getupdates')).toHaveLength(1);
  });

  test('a blank 200 is not counted as a successful poll', async () => {
    const { calls, sleeps, statuses, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [{}, { msgs: [], get_updates_buf: 'b0' }],
    });
    await waitFor(() => statuses.some((s) => s.status === 'ready'));
    await stop();
    expect(statuses.map((s) => s.status)).toEqual(['connecting', 'connecting', 'ready']);
    expect(sleeps[0]).toBe(3_000);
    expect(callsTo(calls, 'getupdates').length).toBeGreaterThanOrEqual(2);
  });

  test('session open retries at 250ms, 1s then a steady 3s', async () => {
    const failure = () => new Response('upstream broke', { status: 500 });
    const { calls, sleeps, statuses, stop } = await connectWith({
      notifystart: [failure(), failure(), failure(), failure(), {}],
      getupdates: [{ msgs: [] }],
    });
    await waitFor(() => callsTo(calls, 'getupdates').length > 0);
    await stop();
    expect(sleeps.slice(0, 4)).toEqual([250, 1_000, 3_000, 3_000]);
    expect(statuses.map((s) => s.status)).toContain('ready');
  });

  test('an expired session on open reports expired and never polls', async () => {
    const { calls, statuses, stop } = await connectWith({
      notifystart: [{ errcode: -14, errmsg: 'session timeout' }],
    });
    await waitFor(() => statuses.some((s) => s.status === 'expired'));
    await stop();
    expect(statuses.map((s) => s.status)).toEqual(['connecting', 'expired']);
    expect(callsTo(calls, 'getupdates')).toHaveLength(0);
  });
});
