import { asSendError, ImSendError } from './errors.js';
import type {
  ImAdapter,
  ImConnectionHandlers,
  ImEnv,
  ImInboundMessage,
  ImOutboundMessage,
} from './types.js';

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT_SECONDS = 50;
const MESSAGE_MAX_CHARS = 4096;
const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{20,}$/;
const TOKEN_MASK = /^(\d+:)[A-Za-z0-9_-]+$/;

export const liveImEnv: ImEnv = {
  fetch: globalThis.fetch.bind(globalThis),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

interface TgUser {
  id: number;
  is_bot: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TgChat {
  id: number;
  type: string;
  title?: string;
}

interface TgEntity {
  type: string;
  offset: number;
  length: number;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  photo?: unknown[];
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

class TelegramApiError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(status: number, description: string, retryAfterMs?: number) {
    super(description);
    this.name = 'TelegramApiError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

interface TelegramEnvelope {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

async function telegramApi<T>(
  env: ImEnv,
  token: string,
  method: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await env.fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new TelegramApiError(
      0,
      `network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let data: TelegramEnvelope;
  try {
    data = (await res.json()) as TelegramEnvelope;
  } catch {
    throw new TelegramApiError(res.status, `telegram ${method}: HTTP ${res.status}`);
  }
  if (data.ok === true) return data.result as T;
  const description =
    typeof data.description === 'string' ? data.description : `HTTP ${res.status}`;
  const retryAfterMs =
    typeof data.parameters?.retry_after === 'number'
      ? data.parameters.retry_after * 1000
      : undefined;
  throw new TelegramApiError(data.error_code ?? res.status, description, retryAfterMs);
}

function scrubToken(message: string, token: string): string {
  const masked = token.replace(TOKEN_MASK, '$1<redacted>');
  return message.split(token).join(masked).split(masked).join('<bot-token>');
}

function senderName(from: TgUser): string | null {
  const parts = [from.first_name, from.last_name].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  if (parts.length > 0) return parts.join(' ');
  return from.username !== undefined ? `@${from.username}` : null;
}

function mentionsBot(text: string, entities: TgEntity[] | undefined, botUsername: string): boolean {
  if (botUsername === '' || entities === undefined) return false;
  const target = `@${botUsername}`;
  return entities.some((entity) => {
    if (entity.type !== 'mention' && entity.type !== 'bot_command') return false;
    const span = [...text].slice(entity.offset, entity.offset + entity.length).join('');
    if (entity.type === 'mention') return span.toLowerCase() === target;
    const at = span.indexOf('@');
    return at >= 0 && span.slice(at).toLowerCase() === target;
  });
}

function normalizeMessage(message: TgMessage, botUsername: string): ImInboundMessage | null {
  if (message.from === undefined || message.from.is_bot) return null;
  const text = (message.text ?? message.caption ?? '').trim();
  if (text === '') return null;
  const entities = message.entities ?? message.caption_entities;
  const group = message.chat.type === 'group' || message.chat.type === 'supergroup';
  if (message.chat.type !== 'private' && !group) return null;
  const mentioned = group ? mentionsBot(text, entities, botUsername) : false;
  if (group && !mentioned) return null;
  return {
    chat: {
      key: String(message.chat.id),
      kind: group ? 'group' : 'direct',
      title: group ? (message.chat.title ?? null) : null,
    },
    sender: { id: String(message.from.id), name: senderName(message.from) },
    text,
    images: [],
    messageId: String(message.message_id),
    mentioned,
  };
}

export function chunkText(text: string, limit: number): string[] {
  const points = [...text];
  if (points.length <= limit) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (points.length - start > limit) {
    let cut = limit;
    for (let i = limit - 1; i > 0; i -= 1) {
      if (points[start + i] === '\n') {
        cut = i;
        break;
      }
    }
    chunks.push(points.slice(start, start + cut).join(''));
    start += cut;
    while (start < points.length && points[start] === '\n') start += 1;
  }
  chunks.push(points.slice(start).join(''));
  return chunks;
}

function isMarkupRejection(err: TelegramApiError): boolean {
  return err.status === 400 && /can'?t parse|parse entities|find end of/i.test(err.message);
}

function toSendError(err: unknown, token: string): ImSendError {
  if (err instanceof TelegramApiError) {
    const detail = scrubToken(err.message, token);
    if (err.status === 401) {
      return new ImSendError('permanent', detail, {
        retryAfterMs: err.retryAfterMs,
        authExpired: true,
      });
    }
    if (err.status === 403 || err.status === 404) {
      return new ImSendError('permanent', detail);
    }
    if (err.status === 400 && /chat not found/i.test(err.message)) {
      return new ImSendError('permanent', detail);
    }
    if (err.status === 429) {
      return new ImSendError('retry', detail, { retryAfterMs: err.retryAfterMs });
    }
    if (err.status === 0 || err.status >= 500) return new ImSendError('retry', detail);
    return new ImSendError('drop', detail);
  }
  return asSendError(err);
}

export function createTelegramAdapter(checkEnv: ImEnv = liveImEnv): ImAdapter {
  return {
    platform: 'telegram',

    async check(fields) {
      const token = (fields.botToken ?? '').trim();
      if (!TOKEN_PATTERN.test(token)) {
        return { ok: false, reason: 'botToken does not look like a Telegram bot token' };
      }
      try {
        const me = await telegramApi<TgUser>(checkEnv, token, 'getMe', {});
        if (me.is_bot !== true) return { ok: false, reason: 'token does not belong to a bot' };
        return {
          ok: true,
          accountLabel: me.username !== undefined ? `@${me.username}` : `bot ${me.id}`,
        };
      } catch (err) {
        return {
          ok: false,
          reason:
            err instanceof TelegramApiError
              ? scrubToken(err.message, token)
              : `unreachable: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    async connect(fields, handlers: ImConnectionHandlers, env: ImEnv) {
      const token = (fields.botToken ?? '').trim();
      if (token === '') throw new Error('telegram connection missing botToken');
      let stopped = false;
      let offset: number | null = null;
      let botUsername = '';
      const abort = new AbortController();

      handlers.onStatus('connecting');
      const loop = (async () => {
        let failures = 0;
        while (!stopped) {
          try {
            if (botUsername === '') {
              const me = await telegramApi<TgUser>(env, token, 'getMe', {}, abort.signal);
              botUsername = (me.username ?? '').toLowerCase();
            }
            const updates: TgUpdate[] = await telegramApi<TgUpdate[]>(
              env,
              token,
              'getUpdates',
              {
                timeout: POLL_TIMEOUT_SECONDS,
                ...(offset !== null ? { offset } : {}),
                allowed_updates: ['message'],
              },
              abort.signal,
            );
            failures = 0;
            handlers.onStatus('ready');
            for (const update of updates) {
              if (update.message !== undefined) {
                const inbound = normalizeMessage(update.message, botUsername);
                if (inbound !== null) handlers.onMessage(inbound);
              }
              offset = update.update_id + 1;
            }
          } catch (err) {
            if (stopped || (err instanceof Error && err.name === 'AbortError')) break;
            if (err instanceof TelegramApiError && (err.status === 401 || err.status === 403)) {
              handlers.onStatus('expired', scrubToken(err.message, token));
              break;
            }
            if (err instanceof TelegramApiError && err.status === 409) {
              handlers.onStatus(
                'error',
                `another process owns the bot (${scrubToken(err.message, token)})`,
              );
              break;
            }
            failures += 1;
            handlers.onStatus(
              'degraded',
              scrubToken(err instanceof Error ? err.message : String(err), token),
            );
            const waitMs =
              err instanceof TelegramApiError && err.retryAfterMs !== undefined
                ? err.retryAfterMs
                : Math.min(5000 * 2 ** (failures - 1), 30000);
            await env.sleep(waitMs);
          }
        }
      })();

      const session = {
        offset: () => offset,
        send: async (msg: ImOutboundMessage): Promise<void> => {
          if (stopped) throw new ImSendError('permanent', 'telegram connection is stopped');
          const chatId = Number(msg.chatKey);
          if (!Number.isFinite(chatId)) {
            throw new ImSendError('permanent', `bad telegram chat key ${msg.chatKey}`);
          }
          const chunks = chunkText(msg.text, MESSAGE_MAX_CHARS);
          for (const [index, chunk] of chunks.entries()) {
            const body: Record<string, unknown> = {
              chat_id: chatId,
              text: chunk,
              parse_mode: 'Markdown',
            };
            if (index === 0 && msg.replyToMessageId !== undefined) {
              const replyTo = Number(msg.replyToMessageId);
              if (Number.isFinite(replyTo)) {
                body.reply_parameters = { message_id: replyTo };
              }
            }
            if (
              index === chunks.length - 1 &&
              msg.buttons !== undefined &&
              msg.buttons.length > 0
            ) {
              body.reply_markup = {
                inline_keyboard: msg.buttons.map((row) =>
                  row.map((button) => ({ text: button.label, callback_data: button.value })),
                ),
              };
            }
            try {
              await telegramApi(env, token, 'sendMessage', body);
            } catch (err) {
              if (err instanceof TelegramApiError && isMarkupRejection(err)) {
                delete body.parse_mode;
                try {
                  await telegramApi(env, token, 'sendMessage', body);
                } catch (retryErr) {
                  throw toSendError(retryErr, token);
                }
              } else {
                throw toSendError(err, token);
              }
            }
          }
        },
        stop: async (): Promise<void> => {
          stopped = true;
          abort.abort();
          await loop.catch(() => {});
        },
      };
      return session;
    },
  };
}
