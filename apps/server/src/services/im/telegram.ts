import { liveImEnv } from './env.js';
import { asSendError, ImSendError } from './errors.js';
import type {
  ImAdapter,
  ImConnectionHandlers,
  ImEnv,
  ImInboundFile,
  ImInboundMessage,
  ImOutboundMessage,
} from './types.js';

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT_SECONDS = 50;
const MESSAGE_MAX_CHARS = 4096;
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{20,}$/;
const TOKEN_MASK = /^(\d+:)[A-Za-z0-9_-]+$/;

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

interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TgDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  photo?: TgPhotoSize[];
  document?: TgDocument;
}

interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
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

async function telegramFile(
  env: ImEnv,
  token: string,
  fileId: string,
  declaredSize: number | undefined,
): Promise<string | null> {
  if (declaredSize !== undefined && declaredSize > FILE_MAX_BYTES) return null;
  let info: { file_path?: string; file_size?: number };
  try {
    info = await telegramApi(env, token, 'getFile', { file_id: fileId });
  } catch {
    return null;
  }
  if (typeof info.file_path !== 'string' || info.file_path === '') return null;
  if (info.file_size !== undefined && info.file_size > FILE_MAX_BYTES) return null;
  let res: Response;
  try {
    res = await env.fetch(`${TELEGRAM_API}/file/bot${token}/${info.file_path}`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > FILE_MAX_BYTES) return null;
  return bytes.toString('base64');
}

async function normalizeMessage(
  message: TgMessage,
  botUsername: string,
  env: ImEnv,
  token: string,
): Promise<ImInboundMessage | null> {
  if (message.from === undefined || message.from.is_bot) return null;
  const text = (message.text ?? message.caption ?? '').trim();
  const entities = message.entities ?? message.caption_entities;
  const group = message.chat.type === 'group' || message.chat.type === 'supergroup';
  if (message.chat.type !== 'private' && !group) return null;
  const mentioned = group ? mentionsBot(text, entities, botUsername) : false;
  if (group && !mentioned) return null;
  const images: ImInboundFile[] = [];
  const files: ImInboundFile[] = [];
  const photo = message.photo?.at(-1);
  if (photo !== undefined) {
    images.push({
      name: `photo-${message.message_id}.jpg`,
      mimeType: 'image/jpeg',
      dataBase64: await telegramFile(env, token, photo.file_id, photo.file_size),
    });
  }
  if (message.document !== undefined) {
    files.push({
      name: message.document.file_name ?? `file-${message.message_id}`,
      mimeType: message.document.mime_type ?? null,
      dataBase64: await telegramFile(
        env,
        token,
        message.document.file_id,
        message.document.file_size,
      ),
    });
  }
  if (text === '' && images.length === 0 && files.length === 0) return null;
  return {
    chat: {
      key: String(message.chat.id),
      kind: group ? 'group' : 'direct',
      title: group ? (message.chat.title ?? null) : null,
    },
    sender: { id: String(message.from.id), name: senderName(message.from) },
    text,
    images,
    files,
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
                allowed_updates: ['message', 'callback_query'],
              },
              abort.signal,
            );
            failures = 0;
            handlers.onStatus('ready');
            for (const update of updates) {
              if (update.message !== undefined) {
                const inbound = await normalizeMessage(
                  update.message,
                  botUsername,
                  env,
                  token,
                ).catch(() => null);
                if (inbound !== null) handlers.onMessage(inbound);
              }
              const query = update.callback_query;
              if (query !== undefined && query.message !== undefined && query.data !== undefined) {
                const group =
                  query.message.chat.type === 'group' || query.message.chat.type === 'supergroup';
                handlers.onAction?.({
                  chat: {
                    key: String(query.message.chat.id),
                    kind: group ? 'group' : 'direct',
                    title: group ? (query.message.chat.title ?? null) : null,
                  },
                  sender: { id: String(query.from.id), name: senderName(query.from) },
                  value: query.data,
                  messageId: `cq:${query.id}`,
                });
              }
              if (query !== undefined) {
                void telegramApi(env, token, 'answerCallbackQuery', {
                  callback_query_id: query.id,
                }).catch(() => {});
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
