import { randomBytes } from 'node:crypto';
import type {
  ImAdapter,
  ImConnectionHandlers,
  ImEnv,
  ImInboundMessage,
  ImOutboundMessage,
} from './types.js';

export type { ImConnectionHandlers, ImEnv, ImInboundMessage, ImOutboundMessage };

const QR_BASE = 'https://ilinkai.weixin.qq.com/';
const BOT_TYPE = '3';
const TEXT_LIMIT = 1800;
const POLL_TIMEOUT_MS = 35_000;
const SEND_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 10_000;
const SESSION_EXPIRED = -14;
const START_RETRY_DELAYS_MS = [250, 1_000, 3_000];
const ILINK_APP_ID = 'bot';
const ILINK_CLIENT_VERSION = (2 << 16) | (4 << 8) | 6;
const ILINK_PROTOCOL_VERSION = '2.4.6';

type IlinkObject = Record<string, unknown>;

type WireMessage = IlinkObject;

interface Failure extends Error {
  permanent?: boolean;
  expired?: boolean;
  timeout?: boolean;
  retryAfter?: number;
}

const fail = (reason: string, opts: Omit<Failure, keyof Error> = {}): Failure =>
  Object.assign(new Error(reason), opts);

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const withSlash = (value: string) => `${value.replace(/\/+$/, '')}/`;

const clientHeaders = () => ({
  'iLink-App-Id': ILINK_APP_ID,
  'iLink-App-ClientVersion': String(ILINK_CLIENT_VERSION),
});

const randomUin = () =>
  Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64');

const objectAt = (value: IlinkObject, key: string): IlinkObject | undefined => {
  const inner = value[key];
  return inner !== null && typeof inner === 'object' && !Array.isArray(inner)
    ? (inner as IlinkObject)
    : undefined;
};

const isUpdatesAnswer = (answer: IlinkObject) =>
  Array.isArray(answer.msgs) ||
  typeof answer.get_updates_buf === 'string' ||
  typeof answer.sync_buf === 'string';

const chunk = (text: string, limit: number) => {
  const chunks: string[] = [];
  let rest = String(text);
  while (rest !== '') {
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }
    let at = limit;
    const newline = rest.lastIndexOf('\n', at);
    if (newline > limit / 2) at = newline;
    else {
      const space = rest.lastIndexOf(' ', at);
      if (space > limit / 2) at = space;
    }
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\s+/, '');
  }
  return chunks;
};

function orderMessages(messages: unknown): WireMessage[] {
  if (!Array.isArray(messages)) return [];
  const list = messages.filter(
    (message): message is WireMessage => message !== null && typeof message === 'object',
  );
  if (list.length < 2) return list;
  const field = (['seq', 'create_time_ms'] as const).find((name) =>
    list.every((message) => {
      const value = message[name];
      return (
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
      );
    }),
  );
  if (field === undefined) return list;
  return list
    .map((message, index) => ({ message, index, order: Number(message[field]) }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map(({ message }) => message);
}

async function request(
  env: ImEnv,
  baseUrl: string,
  token: string,
  endpoint: string,
  body: IlinkObject,
  timeoutMs: number,
  options: { requireJson?: boolean; signal?: AbortSignal } = {},
): Promise<IlinkObject> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  timer.unref?.();
  const signal =
    options.signal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, options.signal]);
  let response: Response;
  try {
    response = await env.fetch(`${baseUrl}ilink/bot/${endpoint}`, {
      method: 'POST',
      headers: {
        ...clientHeaders(),
        'content-type': 'application/json',
        'X-WECHAT-UIN': randomUin(),
        ...(token !== ''
          ? { authorization: `Bearer ${token}`, AuthorizationType: 'ilink_bot_token' }
          : {}),
      },
      body: JSON.stringify({ ...body, base_info: { channel_version: ILINK_PROTOCOL_VERSION } }),
      signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut =
      (error instanceof Error && error.name === 'AbortError') || /timeout|aborted/i.test(message);
    const cause = (error as { cause?: { code?: string; message?: string } } | undefined)?.cause;
    throw Object.assign(
      new Error(timedOut ? 'timeout' : String(cause?.code ?? cause?.message ?? message), {
        cause: error,
      }),
      { timeout: timedOut },
    ) as Failure;
  } finally {
    clearTimeout(timer);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (signal.aborted) {
      throw Object.assign(new Error('timeout', { cause: error }), { timeout: true }) as Failure;
    }
    text = '';
  }
  let parsed: unknown;
  try {
    parsed = text === '' ? {} : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const json =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as IlinkObject)
      : undefined;
  if (response.status === 429 || json?.ret === 429) {
    throw fail('WeChat rate limited the request', {
      retryAfter: Number(response.headers.get('retry-after')),
    });
  }
  if (response.status === 401 || response.status === 403) {
    throw fail('WeChat refused the token', { permanent: true });
  }
  if (!response.ok) throw fail(`WeChat answered ${response.status}`);
  if (json === undefined) {
    if (options.requireJson === true) throw fail('WeChat answered an unreadable response');
    return {};
  }
  return json;
}

const logins = new Map<string, { qrcode: string; expiresAt: number }>();

export const wechatAdapter: ImAdapter = {
  platform: 'wechat',

  async check(fields) {
    const token = fields.token?.trim() ?? '';
    if (token === '') return { ok: false, reason: 'missing iLink bot token' };
    const baseUrl = fields.baseUrl?.trim() ?? '';
    if (baseUrl !== '') {
      try {
        const url = new URL(baseUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          return { ok: false, reason: 'baseUrl must be an http(s) URL' };
        }
      } catch {
        return { ok: false, reason: 'baseUrl is not a URL' };
      }
    }
    const botId = fields.ilinkBotId?.trim() ?? '';
    const userId = fields.ilinkUserId?.trim() ?? '';
    const label = botId !== '' ? botId : userId;
    return { ok: true, accountLabel: label === '' ? 'WeChat' : `WeChat ${label}` };
  },

  async loginStart(env) {
    const response = await env.fetch(`${QR_BASE}ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, {
      method: 'POST',
      headers: { ...clientHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ local_token_list: [] }),
    });
    const body = (await response.json().catch(() => ({}))) as IlinkObject;
    if (body.qrcode === undefined) {
      throw new Error(String(body.errmsg ?? 'WeChat did not return a code'));
    }
    const expiresAt = env.now() + 5 * 60_000;
    const loginId = `wx_${randomBytes(8).toString('hex')}`;
    logins.set(loginId, { qrcode: String(body.qrcode), expiresAt });
    for (const [id, held] of logins) if (held.expiresAt < env.now()) logins.delete(id);
    return { loginId, qr: String(body.qrcode_img_content ?? body.qrcode), expiresAt };
  },

  async loginWait(loginId, env) {
    const held = logins.get(String(loginId));
    if (held === undefined) return { status: 'expired' };
    if (held.expiresAt < env.now()) {
      logins.delete(String(loginId));
      return { status: 'expired' };
    }
    const response = await env
      .fetch(`${QR_BASE}ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(held.qrcode)}`, {
        headers: clientHeaders(),
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      })
      .catch(() => undefined);
    const body = ((await response?.json().catch(() => ({}))) ?? {}) as IlinkObject;
    const status = String(body.status ?? 'wait');
    if (status === 'expired' || status === 'invalid') {
      logins.delete(String(loginId));
      return { status: 'expired' };
    }
    if (status !== 'confirmed') return { status: 'pending' };
    logins.delete(String(loginId));
    return {
      status: 'done',
      fields: {
        token: String(body.bot_token ?? ''),
        ilinkBotId: String(body.ilink_bot_id ?? ''),
        ilinkUserId: String(body.ilink_user_id ?? ''),
        baseUrl: String(body.baseurl ?? QR_BASE),
      },
    };
  },

  async connect(fields, handlers, env) {
    const token = fields.token ?? '';
    const baseUrl = withSlash(
      fields.baseUrl !== undefined && fields.baseUrl !== '' ? fields.baseUrl : QR_BASE,
    );
    const contextTokens = new Map<string, string>();
    let cursor = '';
    let stopped = false;
    let readyOnce = false;
    const stopping = new AbortController();

    const call = (endpoint: string, body: IlinkObject, timeoutMs: number, requireJson = false) =>
      request(env, baseUrl, token, endpoint, body, timeoutMs, {
        requireJson,
        signal: stopping.signal,
      });

    const degraded = (reason: string) =>
      handlers.onStatus(readyOnce ? 'degraded' : 'connecting', reason);

    const deliver = async (message: WireMessage) => {
      const userId = String(message.from_user_id ?? '');
      if (userId === '') return;
      const contextToken = String(message.context_token ?? '');
      if (contextToken !== '') contextTokens.set(userId, contextToken);
      const texts: string[] = [];
      const images: unknown[] = [];
      for (const raw of Array.isArray(message.item_list) ? message.item_list : []) {
        const item =
          raw !== null && typeof raw === 'object' ? (raw as IlinkObject) : ({} as IlinkObject);
        const type = Number(item.type);
        if (type === 1 && objectAt(item, 'text_item')?.text !== undefined) {
          texts.push(String(objectAt(item, 'text_item')?.text));
        } else if (type === 3 && objectAt(item, 'voice_item')?.text !== undefined) {
          texts.push(String(objectAt(item, 'voice_item')?.text));
        } else if (type === 2 && objectAt(item, 'image_item') !== undefined) {
          images.push({ kind: 'image' });
        }
      }
      handlers.onMessage({
        chat: { key: userId, kind: 'direct', title: null },
        sender: { id: userId, name: null },
        text: texts.join('\n').trim(),
        images,
        messageId: String(message.client_id ?? message.message_id ?? ''),
        mentioned: false,
      });
    };

    const notifyStart = async () => {
      const answer = await call('msg/notifystart', {}, START_TIMEOUT_MS);
      const code = answer.errcode ?? answer.ret;
      if (code === undefined || Number(code) === 0) return;
      if (Number(code) === SESSION_EXPIRED) {
        throw fail('WeChat session expired; scan the QR code again', {
          permanent: true,
          expired: true,
        });
      }
      throw fail(`WeChat did not start the session (${String(code)})`, { permanent: true });
    };

    const poll = async () => {
      while (!stopped) {
        let answer: IlinkObject;
        try {
          answer = await call(
            'getupdates',
            { get_updates_buf: cursor },
            POLL_TIMEOUT_MS + 15_000,
            true,
          );
        } catch (error) {
          if (stopped) return;
          const failure = error as Failure;
          if (failure.timeout === true) continue;
          if (failure.permanent === true) {
            handlers.onStatus('error', reasonOf(error));
            return;
          }
          degraded(reasonOf(error));
          await env.sleep(3_000);
          continue;
        }
        if (stopped) return;
        const code = answer.ret ?? answer.errcode;
        if (Number(code) === SESSION_EXPIRED) {
          handlers.onStatus('expired', 'WeChat session expired; scan the QR code again');
          return;
        }
        if (answer.ret !== undefined && Number(answer.ret) !== 0) {
          if (Number(answer.ret) === 401 || Number(answer.ret) === 403) {
            handlers.onStatus('error', `WeChat answered ${String(answer.ret)}`);
            return;
          }
          degraded(`WeChat answered ${String(answer.ret)}`);
          await env.sleep(3_000);
          continue;
        }
        if (answer.ret === undefined && !isUpdatesAnswer(answer)) {
          degraded('WeChat answered an unreadable response');
          await env.sleep(3_000);
          continue;
        }
        readyOnce = true;
        handlers.onStatus('ready');
        for (const message of orderMessages(answer.msgs)) {
          if (stopped) return;
          await deliver(message).catch(() => undefined);
        }
        if (
          typeof answer.get_updates_buf === 'string' &&
          answer.get_updates_buf !== '' &&
          answer.get_updates_buf !== cursor
        ) {
          cursor = answer.get_updates_buf;
        }
      }
    };

    const run = async () => {
      try {
        let shown = false;
        for (let attempt = 0; !stopped; attempt += 1) {
          try {
            await notifyStart();
            break;
          } catch (error) {
            if (stopped) return;
            const failure = error as Failure;
            if (failure.permanent === true) {
              handlers.onStatus(failure.expired === true ? 'expired' : 'error', reasonOf(error));
              return;
            }
            const wait = START_RETRY_DELAYS_MS[attempt];
            if (wait === undefined) {
              if (!shown) {
                shown = true;
                degraded(reasonOf(error));
              }
              await env.sleep(3_000);
            } else {
              await env.sleep(wait);
            }
          }
        }
        if (!stopped) await poll();
      } catch (error) {
        if (!stopped) handlers.onStatus('error', reasonOf(error));
      }
    };

    handlers.onStatus('connecting');
    const worker = run();

    return {
      send: async (msg: ImOutboundMessage) => {
        const contextToken = contextTokens.get(msg.chatKey);
        for (const text of chunk(msg.text, TEXT_LIMIT)) {
          const answer = await call(
            'sendmessage',
            {
              msg: {
                from_user_id: '',
                to_user_id: msg.chatKey,
                client_id: `cairn-${randomBytes(8).toString('hex')}`,
                message_type: 2,
                message_state: 2,
                item_list: [{ type: 1, text_item: { text } }],
                ...(contextToken !== undefined && contextToken !== ''
                  ? { context_token: contextToken }
                  : {}),
              },
            },
            SEND_TIMEOUT_MS,
          );
          if (answer.ret !== undefined && Number(answer.ret) !== 0) {
            throw fail(`WeChat refused the reply (${String(answer.errmsg ?? answer.ret)})`, {
              permanent: true,
            });
          }
        }
      },
      stop: async () => {
        if (stopped) return;
        stopped = true;
        stopping.abort(new Error('stopped'));
        await worker.catch(() => undefined);
      },
    };
  },
};

export default wechatAdapter;
