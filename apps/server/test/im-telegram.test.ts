import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ImSendError } from '../src/services/im/errors.js';
import { chunkText, createTelegramAdapter } from '../src/services/im/telegram.js';
import type { ImEnv, ImInboundAction, ImInboundMessage } from '../src/services/im/types.js';

const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';
const PARK = Symbol('park');

type TelegramReply =
  | { ok: true; result: unknown }
  | { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } }
  | Uint8Array
  | typeof PARK;

interface FakeTelegram {
  env: ImEnv;
  calls: { method: string; body: Record<string, unknown> }[];
  slept: number[];
  queue(method: string, reply: TelegramReply): void;
}

function fakeTelegramEnv(): FakeTelegram {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const slept: number[] = [];
  const queues = new Map<string, TelegramReply[]>();
  const env: ImEnv = {
    now: () => Date.now(),
    sleep: async (ms) => {
      slept.push(ms);
    },
    fetch: (url, init) => {
      const method = String(url).split('/').pop() ?? '';
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ method, body });
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
        const queued = queues.get(method)?.shift();
        if (queued === undefined || queued === PARK) return;
        if (queued instanceof Uint8Array) {
          resolve(new Response(queued, { status: 200 }));
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
    connectSocket: () => {
      throw new Error('offline');
    },
  };
  return {
    env,
    calls,
    slept,
    queue(method, reply) {
      queues.set(method, [...(queues.get(method) ?? []), reply]);
    },
  };
}

const BOT_ME = { ok: true, result: { id: 987, is_bot: true, username: 'cairn_bot' } } as const;

function directMessage(updateId: number, text: string, messageId = updateId * 10) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      from: { id: 42, is_bot: false, first_name: 'Ian', last_name: 'Chen' },
      chat: { id: 777, type: 'private' },
      text,
    },
  };
}

function groupMessage(updateId: number, text: string, entities: unknown[] = []) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId * 10,
      from: { id: 55, is_bot: false, first_name: 'Bob' },
      chat: { id: -900, type: 'group', title: 'Lab' },
      text,
      entities,
    },
  };
}

describe('telegram adapter', () => {
  let tg: FakeTelegram;
  const adapter = createTelegramAdapter();

  beforeEach(() => {
    tg = fakeTelegramEnv();
  });

  test('check returns account label from getMe', async () => {
    tg.queue('getMe', BOT_ME);
    const checked = await createTelegramAdapter(tg.env).check({ botToken: TOKEN });
    expect(checked).toEqual({ ok: true, accountLabel: '@cairn_bot' });
  });

  test('check rejects malformed tokens without a request', async () => {
    const checked = await createTelegramAdapter(tg.env).check({ botToken: 'nope' });
    expect(checked.ok).toBe(false);
    expect(tg.calls).toHaveLength(0);
  });

  test('normalizes direct messages and advances the poll offset', async () => {
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', { ok: true, result: [directMessage(101, 'hello cairn')] });
    tg.queue('getUpdates', PARK);
    const inbound: ImInboundMessage[] = [];
    const session = await adapter.connect(
      { botToken: TOKEN },
      { onMessage: (m) => inbound.push(m), onStatus: () => {} },
      tg.env,
    );
    await vi.waitFor(() => expect(inbound).toHaveLength(1));
    expect(inbound[0]).toMatchObject({
      chat: { key: '777', kind: 'direct' },
      sender: { id: '42', name: 'Ian Chen' },
      text: 'hello cairn',
      messageId: '1010',
      mentioned: false,
    });
    await vi.waitFor(() => {
      const polls = tg.calls.filter((call) => call.method === 'getUpdates');
      expect(polls.length).toBeGreaterThanOrEqual(2);
      expect(polls[1]?.body.offset).toBe(102);
    });
    await session.stop();
  });

  test('routes callback_query data to onAction and acks the query', async () => {
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', {
      ok: true,
      result: [
        {
          update_id: 50,
          callback_query: {
            id: 'cbq-9',
            from: { id: 42, is_bot: false, first_name: 'Ian' },
            message: { message_id: 7, chat: { id: 777, type: 'private' } },
            data: 'imcb:q-1:0',
          },
        },
      ],
    });
    tg.queue('getUpdates', PARK);
    tg.queue('answerCallbackQuery', { ok: true, result: true });
    const actions: ImInboundAction[] = [];
    const session = await adapter.connect(
      { botToken: TOKEN },
      {
        onMessage: () => {},
        onAction: (action) => actions.push(action),
        onStatus: () => {},
      },
      tg.env,
    );
    await vi.waitFor(() => expect(actions).toHaveLength(1));
    expect(actions[0]).toEqual({
      chat: { key: '777', kind: 'direct', title: null },
      sender: { id: '42', name: 'Ian' },
      value: 'imcb:q-1:0',
      messageId: 'cq:cbq-9',
    });
    await vi.waitFor(() =>
      expect(
        tg.calls.some(
          (call) =>
            call.method === 'answerCallbackQuery' && call.body.callback_query_id === 'cbq-9',
        ),
      ).toBe(true),
    );
    await vi.waitFor(() => {
      const polls = tg.calls.filter((call) => call.method === 'getUpdates');
      expect(polls.length).toBeGreaterThanOrEqual(2);
      expect(polls[1]?.body.offset).toBe(51);
    });
    await session.stop();
  });

  test('downloads photos and documents into the inbound message', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
    const pdf = new TextEncoder().encode('%PDF-1.4 fake');
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', {
      ok: true,
      result: [
        {
          update_id: 60,
          message: {
            message_id: 600,
            from: { id: 42, is_bot: false, first_name: 'Ian' },
            chat: { id: 777, type: 'private' },
            caption: 'look',
            photo: [
              { file_id: 'small', width: 10, height: 10 },
              { file_id: 'big', width: 90, height: 90, file_size: 8 },
            ],
            document: {
              file_id: 'doc1',
              file_name: 'report.pdf',
              mime_type: 'application/pdf',
              file_size: 5,
            },
          },
        },
      ],
    });
    tg.queue('getUpdates', PARK);
    tg.queue('getFile', { ok: true, result: { file_path: 'photos/big.jpg', file_size: 8 } });
    tg.queue('getFile', { ok: true, result: { file_path: 'docs/report.pdf', file_size: 5 } });
    tg.queue('big.jpg', jpeg);
    tg.queue('report.pdf', pdf);
    const inbound: ImInboundMessage[] = [];
    const session = await adapter.connect(
      { botToken: TOKEN },
      { onMessage: (m) => inbound.push(m), onStatus: () => {} },
      tg.env,
    );
    await vi.waitFor(() => expect(inbound).toHaveLength(1));
    expect(inbound[0]?.text).toBe('look');
    expect(inbound[0]?.images).toHaveLength(1);
    expect(inbound[0]?.images[0]).toMatchObject({
      name: 'photo-600.jpg',
      mimeType: 'image/jpeg',
    });
    expect(Buffer.from(inbound[0]?.images[0]?.dataBase64 ?? '', 'base64')).toEqual(
      Buffer.from(jpeg),
    );
    expect(inbound[0]?.files).toHaveLength(1);
    expect(inbound[0]?.files[0]).toMatchObject({
      name: 'report.pdf',
      mimeType: 'application/pdf',
    });
    expect(Buffer.from(inbound[0]?.files[0]?.dataBase64 ?? '', 'base64')).toEqual(Buffer.from(pdf));
    await session.stop();
  });

  test('gates group messages on a bot mention', async () => {
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', {
      ok: true,
      result: [
        groupMessage(1, 'quiet chatter'),
        groupMessage(2, 'hey @cairn_bot status?', [{ type: 'mention', offset: 4, length: 10 }]),
      ],
    });
    tg.queue('getUpdates', PARK);
    const inbound: ImInboundMessage[] = [];
    const session = await adapter.connect(
      { botToken: TOKEN },
      { onMessage: (m) => inbound.push(m), onStatus: () => {} },
      tg.env,
    );
    await vi.waitFor(() => expect(inbound).toHaveLength(1));
    expect(inbound[0]).toMatchObject({
      chat: { key: '-900', kind: 'group', title: 'Lab' },
      mentioned: true,
    });
    await session.stop();
  });

  test('reports expired on 401 during polling', async () => {
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', { ok: false, error_code: 401, description: 'Unauthorized' });
    const statuses: string[] = [];
    const session = await adapter.connect(
      { botToken: TOKEN },
      { onMessage: () => {}, onStatus: (status) => statuses.push(status) },
      tg.env,
    );
    await vi.waitFor(() => expect(statuses).toContain('expired'));
    const polls = tg.calls.filter((call) => call.method === 'getUpdates').length;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(tg.calls.filter((call) => call.method === 'getUpdates').length).toBe(polls);
    await session.stop();
  });

  test('reports a permanent error on 409 during polling', async () => {
    tg.queue('getMe', { ok: false, error_code: 409, description: 'Conflict' });
    const details: string[] = [];
    const session = await adapter.connect(
      { botToken: TOKEN },
      {
        onMessage: () => {},
        onStatus: (status, detail) => {
          if (status === 'error') details.push(detail ?? '');
        },
      },
      tg.env,
    );
    await vi.waitFor(() => expect(details.join()).toContain('another process owns the bot'));
    await session.stop();
  });

  test('send honors retry_after through a retryable ImSendError', async () => {
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', PARK);
    tg.queue('sendMessage', {
      ok: false,
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 7 },
    });
    const session = await adapter.connect(
      { botToken: TOKEN },
      { onMessage: () => {}, onStatus: () => {} },
      tg.env,
    );
    const sending = session.send({ chatKey: '777', text: 'hi' });
    await expect(sending).rejects.toSatisfy(
      (err) => err instanceof ImSendError && err.kind === 'retry' && err.retryAfterMs === 7000,
    );
    await session.stop();
  });

  test('send renders buttons as an inline keyboard', async () => {
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', PARK);
    tg.queue('sendMessage', { ok: true, result: { message_id: 1 } });
    const session = await adapter.connect(
      { botToken: TOKEN },
      { onMessage: () => {}, onStatus: () => {} },
      tg.env,
    );
    await session.send({
      chatKey: '777',
      text: 'choose',
      buttons: [
        [
          { label: 'Approve', value: 'imcb:q:0' },
          { label: 'No', value: 'imcb:q:1' },
        ],
      ],
    });
    const send = tg.calls.find((call) => call.method === 'sendMessage');
    expect(send?.body.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: 'Approve', callback_data: 'imcb:q:0' },
          { text: 'No', callback_data: 'imcb:q:1' },
        ],
      ],
    });
    await session.stop();
  });

  test('falls back to plain text when markup is rejected', async () => {
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', PARK);
    tg.queue('sendMessage', {
      ok: false,
      error_code: 400,
      description: "Bad Request: can't parse entities",
    });
    tg.queue('sendMessage', { ok: true, result: { message_id: 9 } });
    const session = await adapter.connect(
      { botToken: TOKEN },
      { onMessage: () => {}, onStatus: () => {} },
      tg.env,
    );
    await session.send({ chatKey: '777', text: 'broken [markdown' });
    const sends = tg.calls.filter((call) => call.method === 'sendMessage');
    expect(sends).toHaveLength(2);
    expect(sends[0]?.body.parse_mode).toBe('Markdown');
    expect(sends[1]?.body.parse_mode).toBeUndefined();
    await session.stop();
  });

  test('chunks messages over the telegram limit', async () => {
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', PARK);
    tg.queue('sendMessage', { ok: true, result: { message_id: 1 } });
    tg.queue('sendMessage', { ok: true, result: { message_id: 2 } });
    const session = await adapter.connect(
      { botToken: TOKEN },
      { onMessage: () => {}, onStatus: () => {} },
      tg.env,
    );
    await session.send({ chatKey: '777', text: 'x'.repeat(5000) });
    expect(tg.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(2);
    await session.stop();
  });
});

describe('chunkText', () => {
  test('splits at newline boundaries under the limit', () => {
    const chunks = chunkText(`${'a'.repeat(3000)}\n${'b'.repeat(3000)}`, 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => [...chunk].length <= 4096)).toBe(true);
  });

  test('hard-splits text without newlines', () => {
    const chunks = chunkText('x'.repeat(5000), 4096);
    expect(chunks).toHaveLength(2);
    expect([...(chunks[0] ?? '')].length).toBe(4096);
  });
});

describe('telegram adapter reconnect and timeout hardening', () => {
  test('marks ready immediately from initial non-blocking probe without 50s wait', async () => {
    const tg = fakeTelegramEnv();
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', { ok: true, result: [] });
    tg.queue('getUpdates', PARK);
    const statuses: string[] = [];
    const session = await createTelegramAdapter().connect(
      { botToken: TOKEN },
      { onMessage: () => {}, onStatus: (status) => statuses.push(status) },
      tg.env,
    );
    await vi.waitFor(() => expect(statuses).toContain('ready'));
    const polls = tg.calls.filter((call) => call.method === 'getUpdates');
    expect(polls[0]?.body.timeout).toBe(0);
    expect(polls[1]?.body.timeout).toBe(50);
    await session.stop();
  });

  test('reports expired and stops polling on HTTP 404', async () => {
    const tg = fakeTelegramEnv();
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', { ok: false, error_code: 404, description: 'Not Found' });
    const statuses: string[] = [];
    const session = await createTelegramAdapter().connect(
      { botToken: TOKEN },
      { onMessage: () => {}, onStatus: (status) => statuses.push(status) },
      tg.env,
    );
    await vi.waitFor(() => expect(statuses).toContain('expired'));
    const polls = tg.calls.filter((call) => call.method === 'getUpdates').length;
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(tg.calls.filter((call) => call.method === 'getUpdates').length).toBe(polls);
    await session.stop();
  });

  test('stop resolves immediately even while sleeping in reconnect backoff', async () => {
    const tg = fakeTelegramEnv();
    tg.queue('getMe', { ok: false, error_code: 500, description: 'Internal error' });
    const envWithRealSleep: ImEnv = {
      ...tg.env,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
    const statuses: string[] = [];
    const session = await createTelegramAdapter().connect(
      { botToken: TOKEN },
      { onMessage: () => {}, onStatus: (status) => statuses.push(status) },
      envWithRealSleep,
    );
    await vi.waitFor(() => expect(statuses).toContain('degraded'));
    const startedStop = Date.now();
    await session.stop();
    expect(Date.now() - startedStop).toBeLessThan(500);
  });

  test('resumes from fields.pollOffset and persists onOffset only after download completes', async () => {
    const tg = fakeTelegramEnv();
    tg.queue('getMe', BOT_ME);
    tg.queue('getUpdates', { ok: true, result: [directMessage(205, 'resumed')] });
    tg.queue('getUpdates', PARK);
    const offsets: Array<string | number> = [];
    const session = await createTelegramAdapter().connect(
      { botToken: TOKEN, pollOffset: '205' },
      {
        onMessage: () => {},
        onStatus: () => {},
        onOffset: (value) => offsets.push(value),
      },
      tg.env,
    );
    await vi.waitFor(() => expect(offsets).toContain(206));
    const polls = tg.calls.filter((call) => call.method === 'getUpdates');
    expect(polls[0]?.body.offset).toBe(205);
    await session.stop();

    const bad = fakeTelegramEnv();
    bad.queue('getMe', BOT_ME);
    bad.queue('getUpdates', PARK);
    const badSession = await createTelegramAdapter().connect(
      { botToken: TOKEN, pollOffset: 'not-a-number' },
      { onMessage: () => {}, onStatus: () => {} },
      bad.env,
    );
    await vi.waitFor(() =>
      expect(bad.calls.some((call) => call.method === 'getUpdates')).toBe(true),
    );
    expect(bad.calls.find((call) => call.method === 'getUpdates')?.body.offset).toBeUndefined();
    await badSession.stop();

    const midDownload = fakeTelegramEnv();
    midDownload.queue('getMe', BOT_ME);
    midDownload.queue('getUpdates', {
      ok: true,
      result: [
        {
          update_id: 300,
          message: {
            message_id: 3001,
            from: { id: 42, is_bot: false, first_name: 'Ian' },
            chat: { id: 777, type: 'private' },
            photo: [{ file_id: 'slow', width: 10, height: 10, file_size: 8 }],
          },
        },
      ],
    });
    midDownload.queue('getFile', PARK);
    const partialOffsets: Array<string | number> = [];
    const abortSession = (await createTelegramAdapter().connect(
      { botToken: TOKEN },
      {
        onMessage: () => {},
        onStatus: () => {},
        onOffset: (value) => partialOffsets.push(value),
      },
      midDownload.env,
    )) as { stop(): Promise<void>; offset?: () => number | null };
    await vi.waitFor(() =>
      expect(midDownload.calls.some((c) => c.method === 'getFile')).toBe(true),
    );
    await abortSession.stop();
    expect(partialOffsets).toEqual([]);
    expect(abortSession.offset?.()).toBeNull();
  });
});
