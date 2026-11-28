import { createCipheriv } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { ImSendError } from '../src/services/im/errors.js';
import type {
  ImConnectionHandlers,
  ImEnv,
  ImInboundMessage,
  ImOutboundMessage,
} from '../src/services/im/wechat.js';
import { createWechatAdapter } from '../src/services/im/wechat.js';

const wechatAdapter = createWechatAdapter();

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
      images: [{ name: 'wechat-image-1', mimeType: null, dataBase64: null }],
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

  test('HTTP 401/403 on poll or send surfaces expired and throws ImSendError', async () => {
    const { statuses, send, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [new Response('unauthorized', { status: 401 })],
      sendmessage: [
        new Response('unauthorized', { status: 401 }),
        { ret: 5, errmsg: 'context token invalid' },
      ],
    });
    await waitFor(() => statuses.some((s) => s.status === 'expired'));
    await expect(send({ chatKey: 'u1', text: 'hi' })).rejects.toSatisfy(
      (err) => err instanceof ImSendError && err.kind === 'permanent' && err.authExpired === true,
    );
    await expect(send({ chatKey: 'u1', text: 'hi' })).rejects.toSatisfy(
      (err) => err instanceof ImSendError && err.kind === 'permanent' && err.authExpired === false,
    );
    await stop();
  });

  test('stop resolves immediately while sleeping between failed polls', async () => {
    const { env, calls } = makeEnv(
      sequence({
        notifystart: [{}],
        getupdates: [{ ret: 500 }],
      }),
    );
    env.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const { handlers, statuses } = makeHandlers();
    const connection = await wechatAdapter.connect(FIELDS, handlers, env);
    await waitFor(() => callsTo(calls, 'getupdates').length >= 1);
    const startedStop = Date.now();
    await connection.stop();
    expect(Date.now() - startedStop).toBeLessThan(500);
    expect(statuses.map((s) => s.status)).toContain('connecting');
  });

  test('resumes cursor and contextTokensJson with 50-entry cap and corrupt-json fallback', async () => {
    const initialTokens: Record<string, string> = {};
    for (let i = 1; i <= 50; i += 1) initialTokens[`u${i}@im.wechat`] = `CTX-${i}`;

    const secretUpdates: Array<{ key: string; value: string }> = [];
    const offsetUpdates: Array<string | number> = [];
    const { env, calls } = makeEnv(
      sequence({
        notifystart: [{}],
        getupdates: [
          {
            msgs: [
              {
                from_user_id: 'u51@im.wechat',
                context_token: 'CTX-51',
                item_list: [{ type: 1, text_item: { text: 'hello new' } }],
              },
            ],
            get_updates_buf: 'BUF-NEXT',
          },
        ],
        sendmessage: [{ ret: 0 }, { ret: 0 }],
      }),
    );
    const { handlers, messages } = makeHandlers();
    (handlers as { onOffset?: (v: string | number) => void }).onOffset = (v) =>
      offsetUpdates.push(v);
    (handlers as { onSecretField?: (k: string, v: string) => void }).onSecretField = (k, v) =>
      secretUpdates.push({ key: k, value: v });

    const connection = (await wechatAdapter.connect(
      {
        ...FIELDS,
        pollOffset: 'BUF-SAVED',
        contextTokensJson: JSON.stringify(initialTokens),
      },
      handlers,
      env,
    )) as {
      send(msg: ImOutboundMessage): Promise<void>;
      stop(): Promise<void>;
      offset?: () => string | number | null;
    };

    await waitFor(() => offsetUpdates.includes('BUF-NEXT'));
    expect(messages).toHaveLength(1);
    expect(callBody(callsTo(calls, 'getupdates')[0] as RecordedCall).get_updates_buf).toBe(
      'BUF-SAVED',
    );
    expect(connection.offset?.()).toBe('BUF-NEXT');

    const latestTokens = JSON.parse(secretUpdates.at(-1)?.value ?? '{}') as Record<string, string>;
    expect(Object.keys(latestTokens)).toHaveLength(50);
    expect(latestTokens['u1@im.wechat']).toBeUndefined();
    expect(latestTokens['u51@im.wechat']).toBe('CTX-51');

    await connection.send({ chatKey: 'u50@im.wechat', text: 'immediate reply' });
    const sent = callBody(callsTo(calls, 'sendmessage')[0] as RecordedCall).msg as Record<
      string,
      unknown
    >;
    expect(sent.context_token).toBe('CTX-50');
    await connection.stop();

    const corrupt = await connectWith({
      notifystart: [{}],
      getupdates: [{ msgs: [] }],
      sendmessage: [{ ret: 0 }],
    });
    const corruptConn = await wechatAdapter.connect(
      { ...FIELDS, contextTokensJson: '{broken-json' },
      makeHandlers().handlers,
      corrupt.env,
    );
    await corruptConn.send({ chatKey: 'u50@im.wechat', text: 'fallback' });
    await corruptConn.stop();
    await corrupt.stop();
  });
});

describe('wechat inbound images', () => {
  const keyBytes = Buffer.from([
    0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
  ]);
  const keyHex = keyBytes.toString('hex');
  const fullUrl = 'https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=ABC';
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xd9,
  ]);

  const encryptEcb = (key: Buffer, plaintext: Buffer): Buffer => {
    const cipher = createCipheriv('aes-128-ecb', key, null);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
  };

  const encrypted = encryptEcb(keyBytes, jpeg);
  const hexKeyBase64 = Buffer.from(keyHex, 'utf8').toString('base64');
  const rawKeyBase64 = keyBytes.toString('base64');

  const imageResponse = () => new Response(new Uint8Array(encrypted), { status: 200 });

  const connectWith = async (script: Record<string, ScriptEntry[]>) => {
    const { env, calls } = makeEnv(sequence(script));
    const { handlers, messages } = makeHandlers();
    const connection = await wechatAdapter.connect(FIELDS, handlers, env);
    return { calls, messages, ...connection };
  };

  const imageMessage = (
    clientId: string,
    itemList: Record<string, unknown>[],
  ): Record<string, unknown> => ({
    from_user_id: 'u1@im.wechat',
    context_token: 'CTX-IMG',
    client_id: clientId,
    message_id: `mid-${clientId}`,
    item_list: itemList,
  });

  test('downloads and decrypts an image with a full_url and base64(hex) media key', async () => {
    const { calls, messages, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            imageMessage('c-img-1', [
              {
                type: 2,
                image_item: {
                  aeskey: keyHex,
                  media: {
                    full_url: fullUrl,
                    aes_key: hexKeyBase64,
                    encrypt_query_param: 'ABC',
                  },
                  mid_size: encrypted.length,
                },
              },
            ]),
          ],
          get_updates_buf: 'BUF-IMG',
        },
      ],
      'novac2c.cdn.weixin.qq.com': [imageResponse()],
    });

    await waitFor(() => messages.length === 1);
    expect(messages[0]?.images).toEqual([
      {
        name: 'wechat-image-1.jpg',
        mimeType: 'image/jpeg',
        dataBase64: jpeg.toString('base64'),
      },
    ]);
    expect(callsTo(calls, 'novac2c.cdn.weixin.qq.com')).toHaveLength(1);
    await stop();
  });

  test('builds the CDN download URL from encrypt_query_param and accepts a top-level hex aeskey', async () => {
    const { calls, messages, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            imageMessage('c-img-2', [
              {
                type: 2,
                image_item: {
                  aeskey: keyHex,
                  media: { encrypt_query_param: 'QP+/=' },
                  mid_size: encrypted.length,
                },
              },
            ]),
          ],
        },
      ],
      'novac2c.cdn.weixin.qq.com': [imageResponse()],
    });

    await waitFor(() => messages.length === 1);
    const download = callsTo(calls, 'novac2c.cdn.weixin.qq.com')[0];
    expect(download?.url).toContain('encrypted_query_param=QP%2B%2F%3D');
    expect(messages[0]?.images?.[0]?.dataBase64).toBe(jpeg.toString('base64'));
    await stop();
  });

  test('accepts media.aes_key that is base64 of 16 raw key bytes', async () => {
    const { messages, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            imageMessage('c-img-3', [
              {
                type: 2,
                image_item: {
                  media: {
                    full_url: fullUrl,
                    aes_key: rawKeyBase64,
                    encrypt_query_param: 'ABC',
                  },
                  mid_size: encrypted.length,
                },
              },
            ]),
          ],
        },
      ],
      'novac2c.cdn.weixin.qq.com': [imageResponse()],
    });

    await waitFor(() => messages.length === 1);
    expect(messages[0]?.images?.[0]?.dataBase64).toBe(jpeg.toString('base64'));
    await stop();
  });

  test('keeps the text and reports a failed image as missing', async () => {
    const { calls, messages, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            imageMessage('c-img-4', [
              { type: 1, text_item: { text: 'see this' } },
              {
                type: 2,
                image_item: {
                  media: {
                    full_url: fullUrl,
                    aes_key: hexKeyBase64,
                    encrypt_query_param: 'ABC',
                  },
                },
              },
              { type: 2, image_item: { aeskey: keyHex } },
            ]),
          ],
        },
      ],
      'novac2c.cdn.weixin.qq.com': [new Response('nope', { status: 500 })],
    });

    await waitFor(() => messages.length === 1);
    expect(messages[0]?.text).toBe('see this');
    expect(messages[0]?.images).toHaveLength(2);
    expect(messages[0]?.images?.[0]?.dataBase64).toBeNull();
    expect(messages[0]?.images?.[1]?.dataBase64).toBeNull();
    expect(callsTo(calls, 'novac2c.cdn.weixin.qq.com').length).toBeGreaterThan(0);
    await stop();
  });

  test('does not block a later image when one download fails', async () => {
    const { messages, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            imageMessage('c-img-5', [
              {
                type: 2,
                image_item: {
                  media: {
                    full_url: fullUrl,
                    aes_key: hexKeyBase64,
                    encrypt_query_param: 'ABC',
                  },
                },
              },
              {
                type: 2,
                image_item: {
                  media: {
                    full_url:
                      'https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=DEF',
                    aes_key: hexKeyBase64,
                    encrypt_query_param: 'DEF',
                  },
                },
              },
            ]),
          ],
        },
      ],
      'novac2c.cdn.weixin.qq.com': [new Response('nope', { status: 500 }), imageResponse()],
    });

    await waitFor(() => messages.length === 1);
    expect(messages[0]?.images).toHaveLength(2);
    expect(messages[0]?.images?.[0]?.dataBase64).toBeNull();
    expect(messages[0]?.images?.[1]?.dataBase64).toBe(jpeg.toString('base64'));
    await stop();
  });

  test('never fetches a full_url on another host', async () => {
    const { calls, messages, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            imageMessage('c-img-6', [
              {
                type: 2,
                image_item: {
                  media: {
                    full_url: 'https://evil.example/steal',
                    encrypt_query_param: 'QP',
                    aes_key: rawKeyBase64,
                  },
                },
              },
            ]),
          ],
        },
      ],
      'novac2c.cdn.weixin.qq.com': [imageResponse()],
    });

    await waitFor(() => messages.length === 1);
    expect(calls.some((call) => call.url.includes('evil.example'))).toBe(false);
    expect(callsTo(calls, 'novac2c.cdn.weixin.qq.com')[0]?.url).toContain(
      'encrypted_query_param=QP',
    );
    expect(messages[0]?.images?.[0]?.dataBase64).toBe(jpeg.toString('base64'));
    await stop();
  });

  test('drops an oversize image without reading the body', async () => {
    const { messages, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            imageMessage('c-img-7', [
              { type: 1, text_item: { text: 'still here' } },
              {
                type: 2,
                image_item: {
                  media: { encrypt_query_param: 'BIG', aes_key: rawKeyBase64 },
                },
              },
            ]),
          ],
        },
      ],
      'novac2c.cdn.weixin.qq.com': [
        new Response('x', {
          status: 200,
          headers: { 'content-length': String(10 * 1024 * 1024 + 1) },
        }),
      ],
    });

    await waitFor(() => messages.length === 1);
    expect(messages[0]?.text).toBe('still here');
    expect(messages[0]?.images?.[0]?.dataBase64).toBeNull();
    await stop();
  });

  test('drops an image with bad padding', async () => {
    const { messages, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            imageMessage('c-img-8', [
              {
                type: 2,
                image_item: {
                  media: { encrypt_query_param: 'PAD', aes_key: rawKeyBase64 },
                },
              },
            ]),
          ],
        },
      ],
      'novac2c.cdn.weixin.qq.com': [
        new Response(new Uint8Array(Buffer.alloc(32, 7)), { status: 200 }),
      ],
    });

    await waitFor(() => messages.length === 1);
    expect(messages[0]?.images?.[0]?.dataBase64).toBeNull();
    await stop();
  });

  test('drops an image whose bytes are not a known image', async () => {
    const notAnImage = encryptEcb(keyBytes, Buffer.from('plain text, not an image'));
    const { messages, stop } = await connectWith({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            imageMessage('c-img-9', [
              {
                type: 2,
                image_item: {
                  media: { encrypt_query_param: 'TXT', aes_key: rawKeyBase64 },
                },
              },
            ]),
          ],
        },
      ],
      'novac2c.cdn.weixin.qq.com': [new Response(new Uint8Array(notAnImage), { status: 200 })],
    });

    await waitFor(() => messages.length === 1);
    expect(messages[0]?.images?.[0]?.dataBase64).toBeNull();
    await stop();
  });

  test('treats an aborted download as a missing image', async () => {
    const scripted = sequence({
      notifystart: [{}],
      getupdates: [
        {
          msgs: [
            imageMessage('c-img-10', [
              { type: 1, text_item: { text: 'text survives' } },
              {
                type: 2,
                image_item: {
                  media: { encrypt_query_param: 'ABORT', aes_key: rawKeyBase64 },
                },
              },
            ]),
          ],
        },
      ],
    });
    const { env } = makeEnv((call) =>
      call.url.includes('novac2c.cdn.weixin.qq.com')
        ? Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
        : scripted(call),
    );
    const { handlers, messages } = makeHandlers();
    const connection = await wechatAdapter.connect(FIELDS, handlers, env);

    await waitFor(() => messages.length === 1);
    expect(messages[0]?.text).toBe('text survives');
    expect(messages[0]?.images?.[0]?.dataBase64).toBeNull();
    await connection.stop();
  });

  test('delivers every message before the cursor advances', async () => {
    const events: string[] = [];
    const { env } = makeEnv(
      sequence({
        notifystart: [{}],
        getupdates: [
          {
            msgs: [
              imageMessage('c-img-11', [
                {
                  type: 2,
                  image_item: {
                    media: {
                      full_url: fullUrl,
                      aes_key: hexKeyBase64,
                      encrypt_query_param: 'ABC',
                    },
                  },
                },
              ]),
              {
                from_user_id: 'u1@im.wechat',
                client_id: 'c-text-12',
                item_list: [{ type: 1, text_item: { text: 'after the photo' } }],
              },
            ],
            get_updates_buf: 'BUF-ORDER',
          },
        ],
        'novac2c.cdn.weixin.qq.com': [imageResponse()],
      }),
    );
    const messages: ImInboundMessage[] = [];
    const { handlers } = makeHandlers();
    handlers.onMessage = (msg) => {
      messages.push(msg);
      events.push(`message:${msg.messageId}`);
    };
    handlers.onOffset = () => events.push('offset');
    const connection = await wechatAdapter.connect(FIELDS, handlers, env);

    await waitFor(() => events.includes('offset'));
    expect(events).toEqual(['message:c-img-11', 'message:c-text-12', 'offset']);
    expect(messages[0]?.images?.[0]?.dataBase64).toBe(jpeg.toString('base64'));
    expect(messages[1]?.text).toBe('after the photo');
    await connection.stop();
  });

  test('downloads a message images in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let polls = 0;
    const { env } = makeEnv((call) => {
      if (call.url.includes('novac2c.cdn.weixin.qq.com')) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<ScriptEntry>((resolve) => {
          setTimeout(() => {
            inFlight -= 1;
            resolve(imageResponse());
          }, 30);
        });
      }
      if (call.url.includes('notifystart')) return {};
      if (call.url.includes('getupdates')) {
        polls += 1;
        return polls === 1
          ? {
              msgs: [
                imageMessage('c-par-1', [
                  {
                    type: 2,
                    image_item: {
                      media: {
                        full_url: fullUrl,
                        aes_key: hexKeyBase64,
                        encrypt_query_param: 'ABC',
                      },
                    },
                  },
                  {
                    type: 2,
                    image_item: {
                      media: {
                        full_url:
                          'https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=DEF',
                        aes_key: hexKeyBase64,
                        encrypt_query_param: 'DEF',
                      },
                    },
                  },
                ]),
              ],
              get_updates_buf: 'BUF-PAR',
            }
          : HANG;
      }
      throw new Error(`unscripted fetch: ${call.url}`);
    });
    const { handlers, messages } = makeHandlers();
    const connection = await wechatAdapter.connect(FIELDS, handlers, env);

    await waitFor(() => messages.length === 1);
    expect(maxInFlight).toBe(2);
    expect(messages[0]?.images).toHaveLength(2);
    expect(
      messages[0]?.images?.every((image) => image.dataBase64 === jpeg.toString('base64')),
    ).toBe(true);
    await connection.stop();
  });
});
