import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ImSendError } from '../src/services/im/errors.js';
import { chunkText, createTelegramAdapter } from '../src/services/im/telegram.js';
import type { ImEnv, ImInboundMessage } from '../src/services/im/types.js';

const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';
const PARK = Symbol('park');

type TelegramReply =
  | { ok: true; result: unknown }
  | { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } }
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
