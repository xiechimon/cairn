import { liveImEnv } from './env.js';
import { asSendError, ImSendError } from './errors.js';
import { chunkText } from './telegram.js';
import type {
  ImAdapter,
  ImConnectionHandlers,
  ImEnv,
  ImOutboundMessage,
  ImSocket,
} from './types.js';

const SLACK_API = 'https://slack.com/api';
const MESSAGE_MAX_CHARS = 3000;
const SECTION_TEXT_MAX_CHARS = 3000;
const MESSAGE_MAX_BLOCKS = 50;
const MESSAGE_MAX_BLOCK_CHARS = 12000;
const MESSAGE_MAX_FALLBACK_CHARS = 40_000;
export const CARD_TOO_LONG_NOTICE =
  '内容太长或无法完整显示，这里不提供按钮：请在 Cairn 里查看全文后作答。';
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const APP_TOKEN_PREFIX = 'xapp-';
const BOT_TOKEN_PREFIX = 'xoxb-';
const BUTTON_TEXT_MAX_CHARS = 75;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const AUTH_ERRORS = new Set(['invalid_auth', 'not_authed', 'token_revoked', 'account_inactive']);
const PERMANENT_ERRORS = new Set(['channel_not_found', 'is_archived', 'msg_too_long', 'no_text']);

interface SlackAuthTest {
  ok: boolean;
  url?: string;
  team?: string;
  user?: string;
  team_id?: string;
  user_id?: string;
  bot_id?: string;
}

interface SlackUserInfo {
  user?: {
    name?: string;
    real_name?: string;
    profile?: { display_name?: string; real_name?: string };
  };
}

interface SlackFile {
  id?: string;
  name?: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
}

interface SlackEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  files?: SlackFile[];
}

interface SlackAction {
  action_id?: string;
  type?: string;
  value?: string;
}

interface SlackFrame {
  envelope_id?: string;
  type?: string;
  reason?: string;
  payload?: {
    event?: SlackEvent;
    type?: string;
    user?: { id?: string };
    channel?: { id?: string };
    container?: { channel_id?: string };
    actions?: SlackAction[];
  };
}

type SocketEnd =
  | { kind: 'closed'; reason: string; ready: boolean }
  | { kind: 'disconnect'; reason: string; ready: boolean }
  | { kind: 'fatal'; reason: string; ready: boolean };

class SlackApiError extends Error {
  readonly status: number;
  readonly error: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(status: number, message: string, error?: string, retryAfterMs?: number) {
    super(message);
    this.name = 'SlackApiError';
    this.status = status;
    this.error = error;
    this.retryAfterMs = retryAfterMs;
  }
}

async function slackApi<T>(
  env: ImEnv,
  token: string,
  method: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  const query = method === 'users.info';
  const params = new URLSearchParams(
    Object.entries(body).map(([key, value]) => [key, String(value)]),
  );
  const url = query ? `${SLACK_API}/${method}?${params.toString()}` : `${SLACK_API}/${method}`;
  try {
    res = await env.fetch(url, {
      method: query ? 'GET' : 'POST',
      headers: {
        ...(query ? {} : { 'content-type': 'application/json' }),
        authorization: `Bearer ${token}`,
      },
      body: query ? undefined : JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new SlackApiError(
      0,
      `slack ${method}: network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new SlackApiError(
      429,
      `slack ${method}: ratelimited`,
      'ratelimited',
      Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
    );
  }
  let data: { ok?: boolean; error?: string } & Record<string, unknown>;
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new SlackApiError(res.status, `slack ${method}: HTTP ${res.status}`);
  }
  if (data.ok === true) return data as T;
  throw new SlackApiError(
    res.status,
    `slack ${method}: ${data.error ?? `HTTP ${res.status}`}`,
    data.error,
  );
}

function scrub(message: string, ...secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret !== '') out = out.split(secret).join('<redacted>');
  }
  return out;
}

function isAuthFailure(err: unknown): boolean {
  return (
    err instanceof SlackApiError &&
    ((err.error !== undefined && AUTH_ERRORS.has(err.error)) ||
      err.status === 401 ||
      err.status === 403)
  );
}

function toSendError(err: unknown, ...secrets: string[]): ImSendError {
  if (err instanceof SlackApiError) {
    const detail = scrub(err.message, ...secrets);
    if (isAuthFailure(err)) {
      return new ImSendError('permanent', detail, {
        retryAfterMs: err.retryAfterMs,
        authExpired: true,
      });
    }
    if (err.status === 429 || err.error === 'ratelimited') {
      return new ImSendError('retry', detail, { retryAfterMs: err.retryAfterMs });
    }
    if (err.error !== undefined && PERMANENT_ERRORS.has(err.error)) {
      return new ImSendError('permanent', detail);
    }
    if (err.status === 0 || err.status >= 500) return new ImSendError('retry', detail);
    return new ImSendError('drop', detail);
  }
  return asSendError(err);
}

function workspaceLabel(auth: SlackAuthTest): string {
  if (typeof auth.team === 'string' && auth.team !== '') return auth.team;
  if (typeof auth.url === 'string') {
    try {
      return new URL(auth.url).hostname.split('.')[0] ?? 'Slack workspace';
    } catch {
      return 'Slack workspace';
    }
  }
  return 'Slack workspace';
}

function displayName(info: SlackUserInfo): string | null {
  const profile = info.user?.profile;
  const name = profile?.display_name ?? info.user?.real_name ?? profile?.real_name;
  if (typeof name === 'string' && name !== '') return name;
  return typeof info.user?.name === 'string' && info.user.name !== '' ? info.user.name : null;
}

function buttonText(label: string): string {
  let text = '';
  let count = 0;
  for (const point of label) {
    text += point;
    if (++count === BUTTON_TEXT_MAX_CHARS) break;
  }
  return text;
}

function actionBlocks(buttons: ImOutboundMessage['buttons']): Record<string, unknown>[] {
  if (buttons === undefined || buttons.length === 0) return [];
  return buttons.map((row, rowIndex) => ({
    type: 'actions',
    elements: row.map((button, colIndex) => ({
      type: 'button',
      text: {
        type: 'plain_text',
        text: buttonText(button.label),
      },
      value: button.value,
      action_id: `cairn-${rowIndex}-${colIndex}`,
    })),
  }));
}

function escapeText(part: string): string {
  return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sectionBlocks(part: string): Record<string, unknown>[] {
  const sections: Record<string, unknown>[] = [];
  let text = '';
  const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(part);
  for (const { segment } of graphemes) {
    for (const piece of segment.length > SECTION_TEXT_MAX_CHARS ? [...segment] : [segment]) {
      if (text.length + piece.length > SECTION_TEXT_MAX_CHARS) {
        sections.push({ type: 'section', text: { type: 'plain_text', text } });
        text = '';
      }
      text += piece;
    }
  }
  sections.push({ type: 'section', text: { type: 'plain_text', text } });
  return sections;
}

export function slackCardBlocks({ text, buttons }: Pick<ImOutboundMessage, 'text' | 'buttons'>) {
  if (text.length > MESSAGE_MAX_BLOCK_CHARS || text.trim() === '') return null;
  if (escapeText(text).length > MESSAGE_MAX_FALLBACK_CHARS) return null;
  const blocks = [...sectionBlocks(text), ...actionBlocks(buttons)];
  return blocks.length <= MESSAGE_MAX_BLOCKS &&
    JSON.stringify(blocks).length <= MESSAGE_MAX_BLOCK_CHARS
    ? blocks
    : null;
}

export function createSlackAdapter(checkEnv: ImEnv = liveImEnv): ImAdapter {
  return {
    platform: 'slack',

    async check(fields) {
      const appToken = (fields.appToken ?? '').trim();
      if (!appToken.startsWith(APP_TOKEN_PREFIX)) {
        return { ok: false, reason: 'appToken does not look like a Slack app-level token' };
      }
      const botToken = (fields.botToken ?? '').trim();
      if (!botToken.startsWith(BOT_TOKEN_PREFIX)) {
        return { ok: false, reason: 'botToken does not look like a Slack bot token' };
      }
      try {
        const auth = await slackApi<SlackAuthTest>(checkEnv, botToken, 'auth.test', {});
        return { ok: true, accountLabel: workspaceLabel(auth) };
      } catch (err) {
        return {
          ok: false,
          reason: scrub(err instanceof Error ? err.message : String(err), appToken, botToken),
        };
      }
    },

    async connect(fields, handlers: ImConnectionHandlers, env: ImEnv) {
      const appToken = (fields.appToken ?? '').trim();
      const botToken = (fields.botToken ?? '').trim();
      if (appToken === '') throw new Error('slack connection missing appToken');
      if (botToken === '') throw new Error('slack connection missing botToken');
      let stopped = false;
      let readyOnce = false;
      let botUserId = '';
      let socket: ImSocket | null = null;
      const stopping = new AbortController();
      const nameLookups = new Map<string, Promise<string | null>>();

      const senderName = (user: string): Promise<string | null> => {
        const pending = nameLookups.get(user);
        if (pending !== undefined) return pending;
        const lookup = slackApi<SlackUserInfo>(
          env,
          botToken,
          'users.info',
          { user },
          stopping.signal,
        )
          .then((info) => displayName(info))
          .catch(() => null);
        nameLookups.set(user, lookup);
        return lookup;
      };

      const slackFile = async (file: SlackFile): Promise<string | null> => {
        const url = file.url_private_download;
        if (typeof url !== 'string' || url === '') return null;
        if (file.size !== undefined && file.size > FILE_MAX_BYTES) return null;
        let res: Response;
        try {
          res = await env.fetch(url, {
            headers: { authorization: `Bearer ${botToken}` },
            signal: stopping.signal,
          });
        } catch {
          return null;
        }
        if (!res.ok) return null;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > FILE_MAX_BYTES) return null;
        return bytes.toString('base64');
      };

      const deliver = async (event: SlackEvent): Promise<void> => {
        if (event.type !== 'message' || event.channel_type !== 'im') return;
        if (event.user === undefined || event.bot_id !== undefined) return;
        if (event.subtype !== undefined && event.subtype !== 'file_share') return;
        const channel = event.channel ?? '';
        const ts = event.ts ?? '';
        const text = (event.text ?? '').trim();
        if (channel === '' || ts === '') return;
        if (event.user === botUserId) return;
        const rawFiles = event.files ?? [];
        const files =
          event.subtype === 'file_share' && rawFiles.length > 0
            ? await Promise.all(
                rawFiles.map(async (file, index) => ({
                  name: file.name ?? `slack-file-${index}`,
                  mimeType: file.mimetype ?? null,
                  dataBase64: await slackFile(file),
                })),
              )
            : [];
        if (text === '' && files.length === 0) return;
        const name = await senderName(event.user);
        if (stopped) return;
        handlers.onMessage({
          chat: { key: channel, kind: 'direct', title: null },
          sender: { id: event.user, name },
          text,
          images: [],
          files,
          messageId: ts,
          mentioned: false,
        });
      };

      const openSocket = (url: string) => {
        let helloSeen = false;
        let settle: (end: Omit<SocketEnd, 'ready'>) => void = () => {};
        const done = new Promise<SocketEnd>((resolve) => {
          settle = (end) => resolve({ ...end, ready: helloSeen });
        });
        let sock: ImSocket | undefined;
        sock = env.connectSocket(url, {
          onMessage: (text) => {
            let frame: SlackFrame;
            try {
              frame = JSON.parse(text) as SlackFrame;
            } catch {
              return;
            }
            if (typeof frame.envelope_id === 'string' && frame.envelope_id !== '') {
              sock?.send(JSON.stringify({ envelope_id: frame.envelope_id }));
            }
            switch (frame.type) {
              case 'hello':
                helloSeen = true;
                readyOnce = true;
                handlers.onStatus('ready');
                break;
              case 'events_api': {
                const event = frame.payload?.event;
                if (event !== undefined) void deliver(event).catch(() => undefined);
                break;
              }
              case 'interactive': {
                const payload = frame.payload;
                if (payload?.type !== 'block_actions') break;
                const userId = payload.user?.id;
                const channelId = payload.channel?.id ?? payload.container?.channel_id;
                const envelope = frame.envelope_id ?? 'none';
                if (userId === undefined || channelId === undefined) break;
                if (userId === botUserId) break;
                for (const [index, action] of (payload.actions ?? []).entries()) {
                  if (typeof action.value !== 'string' || action.value === '') continue;
                  const chatKey = channelId;
                  handlers.onAction?.({
                    chat: { key: chatKey, kind: 'direct', title: null },
                    sender: { id: userId, name: null },
                    value: action.value,
                    messageId: `slack-ia:${envelope}:${action.action_id ?? index}`,
                  });
                }
                break;
              }
              case 'disconnect':
                settle(
                  frame.reason === 'link_disabled'
                    ? { kind: 'fatal', reason: 'slack disabled socket mode for this app' }
                    : { kind: 'disconnect', reason: frame.reason ?? 'disconnect' },
                );
                break;
              default:
                break;
            }
          },
          onClose: (code, reason) => {
            settle({ kind: 'closed', reason: reason === '' ? `code ${code}` : reason });
          },
          onError: () => {
            settle({ kind: 'closed', reason: 'socket error' });
          },
        });
        return { sock, done };
      };

      const degraded = (reason: string) =>
        handlers.onStatus(readyOnce ? 'degraded' : 'connecting', reason);

      const run = async () => {
        let failures = 0;
        while (!stopped) {
          let url: string;
          try {
            if (botUserId === '') {
              const auth = await slackApi<SlackAuthTest>(
                env,
                botToken,
                'auth.test',
                {},
                stopping.signal,
              );
              botUserId = auth.user_id ?? '';
            }
            const opened = await slackApi<{ url: string }>(
              env,
              appToken,
              'apps.connections.open',
              {},
              stopping.signal,
            );
            url = opened.url;
          } catch (err) {
            if (stopped || (err instanceof Error && err.name === 'AbortError')) return;
            if (isAuthFailure(err)) {
              handlers.onStatus(
                'expired',
                scrub(err instanceof Error ? err.message : String(err), appToken, botToken),
              );
              return;
            }
            failures += 1;
            degraded(scrub(err instanceof Error ? err.message : String(err), appToken, botToken));
            await env.sleep(Math.min(RECONNECT_BASE_MS * 2 ** (failures - 1), RECONNECT_MAX_MS));
            continue;
          }
          if (stopped) return;
          let session: ReturnType<typeof openSocket>;
          try {
            session = openSocket(url);
          } catch (err) {
            if (stopped) return;
            failures += 1;
            degraded(scrub(err instanceof Error ? err.message : String(err), appToken, botToken));
            await env.sleep(Math.min(RECONNECT_BASE_MS * 2 ** (failures - 1), RECONNECT_MAX_MS));
            continue;
          }
          socket = session.sock;
          const end = await session.done;
          socket = null;
          session.sock.close();
          if (stopped) return;
          if (end.kind === 'fatal') {
            handlers.onStatus('error', end.reason);
            return;
          }
          failures = end.ready ? 1 : failures + 1;
          degraded(`slack socket ${end.kind}: ${end.reason}`);
          await env.sleep(Math.min(RECONNECT_BASE_MS * 2 ** (failures - 1), RECONNECT_MAX_MS));
        }
      };

      handlers.onStatus('connecting');
      const worker = run();

      return {
        send: async (msg: ImOutboundMessage): Promise<void> => {
          if (stopped) throw new ImSendError('permanent', 'slack connection is stopped');
          const post = async (body: Record<string, unknown>): Promise<void> => {
            try {
              await slackApi(env, botToken, 'chat.postMessage', body, stopping.signal);
            } catch (err) {
              throw toSendError(err, appToken, botToken);
            }
          };
          const carded = msg.buttons !== undefined && msg.buttons.length > 0;
          if (carded) {
            const blocks = slackCardBlocks(msg);
            await post(
              blocks !== null
                ? {
                    channel: msg.chatKey,
                    text: escapeText(msg.text),
                    unfurl_links: false,
                    unfurl_media: false,
                    mrkdwn: false,
                    parse: 'none',
                    blocks,
                  }
                : { channel: msg.chatKey, text: CARD_TOO_LONG_NOTICE },
            );
            return;
          }
          for (const chunk of chunkText(msg.text, MESSAGE_MAX_CHARS)) {
            await post({ channel: msg.chatKey, text: chunk });
          }
        },
        stop: async (): Promise<void> => {
          if (stopped) return;
          stopped = true;
          stopping.abort();
          socket?.close();
          socket = null;
          await worker.catch(() => undefined);
        },
      };
    },
  };
}
