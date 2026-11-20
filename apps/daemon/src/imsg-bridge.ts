import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type {
  ImInboundActionBody,
  ImInboundFileBody,
  ImInboundMessageBody,
  MachineImEventBody,
  MachineStreamEvent,
} from '@cairn/shared';
import type { DaemonLogger } from './log.js';
import type { MachineApi } from './machine-client.js';

const IMSG_RELEASE_URL =
  'https://github.com/openclaw/imsg/releases/download/v0.21.1/imsg-macos.zip';
const IMSG_RELEASE_SHA256 = '78fcd9b7770ca9ead71228acf186759279115078895d1ee1299a09333824c77f';
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const OWN_SEND_WINDOW_MS = 60_000;
const CARD_WINDOW_MS = 3_600_000;
const RESPAWN_BASE_MS = 2_000;
const RESPAWN_MAX_MS = 60_000;

export interface ImsgBridgeDeps {
  api: Pick<MachineApi, 'imEvent'>;
  logger: Pick<DaemonLogger, 'machine' | 'wake'>;
  home: string;
  env?: NodeJS.ProcessEnv;
  spawnProc?: typeof spawn;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface ImsgMessageRow {
  id?: number;
  type?: string;
  chat_guid?: string;
  chat_name?: string;
  is_group?: boolean;
  guid?: string;
  sender?: string;
  sender_name?: string;
  is_from_me?: boolean;
  text?: string | null;
  attachments?: {
    filename?: string;
    transfer_name?: string;
    mime_type?: string;
    total_bytes?: number;
    missing?: boolean;
    original_path?: string;
  }[];
}

interface RpcError {
  code: number;
  message?: string;
  data?: { retry_safe?: boolean; disposition?: string; detail?: string };
}

interface BridgeButton {
  label: string;
  value: string;
}

class ImsgRpc {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve(v: unknown): void; reject(e: RpcError & { name?: string }): void }
  >();
  private buf = '';
  private alive = true;

  constructor(
    private readonly child: ChildProcess,
    private readonly onNotify: (method: string, params: unknown) => void,
    private readonly onExit: (code: number | null) => void,
  ) {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.feed(chunk));
    child.on('exit', (code) => this.died(code));
    child.on('error', () => this.died(null));
  }

  private feed(chunk: string): void {
    this.buf += chunk;
    for (;;) {
      const nl = this.buf.indexOf('\n');
      if (nl < 0) return;
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line === '') continue;
      let rec: {
        id?: unknown;
        method?: unknown;
        params?: unknown;
        result?: unknown;
        error?: RpcError;
      };
      try {
        rec = JSON.parse(line) as typeof rec;
      } catch {
        continue;
      }
      if (typeof rec.method === 'string') {
        this.onNotify(rec.method, rec.params);
        continue;
      }
      if (typeof rec.id === 'number') {
        const waiter = this.pending.get(rec.id);
        if (waiter === undefined) continue;
        this.pending.delete(rec.id);
        if (rec.error !== undefined && rec.error !== null) waiter.reject(rec.error);
        else waiter.resolve(rec.result);
      }
    }
  }

  private died(code: number | null): void {
    if (!this.alive) return;
    this.alive = false;
    for (const waiter of this.pending.values()) {
      waiter.reject({ code: -32004, message: 'imsg rpc exited' });
    }
    this.pending.clear();
    this.onExit(code);
  }

  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.alive) {
      return Promise.reject({ code: -32004, message: 'imsg rpc exited' });
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin?.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`,
      );
    });
  }

  kill(): void {
    this.alive = false;
    try {
      this.child.stdin?.end();
    } catch {}
    try {
      this.child.kill('SIGTERM');
    } catch {}
  }
}

interface Session {
  connId: string;
  attached: boolean;
  rpc: ImsgRpc | null;
  backoffMs: number;
  respawnTimer: ReturnType<typeof setTimeout> | null;
  recentOwn: { chatGuid: string; text: string; at: number }[];
  cards: Map<string, { buttons: BridgeButton[]; at: number }>;
}

async function sha256Of(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function downloadTo(url: string, dest: string, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(url);
  if (!res.ok || res.body === null) {
    throw new Error(`imsg download failed (HTTP ${res.status})`);
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

async function ensureImsgBin(deps: ImsgBridgeDeps): Promise<string> {
  const env = deps.env ?? process.env;
  const override = env.CAIRN_IMSG_BIN?.trim();
  if (override !== undefined && override !== '') return override;
  const managed = join(deps.home, 'imsg', 'imsg');
  const managedInfo = await lstat(managed).catch(() => null);
  if (managedInfo !== null) {
    if (managedInfo.isFile() && !managedInfo.isSymbolicLink()) return managed;
    deps.logger.machine(`imsg managed binary at ${managed} is not a regular file; reinstalling`);
    await rm(managed, { force: true });
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const dir = await mkdtemp(join(tmpdir(), 'cairn-imsg-'));
  try {
    const zipPath = join(dir, 'imsg-macos.zip');
    await downloadTo(IMSG_RELEASE_URL, zipPath, fetchImpl);
    const digest = await sha256Of(zipPath);
    if (digest !== IMSG_RELEASE_SHA256) {
      throw new Error(`imsg-macos.zip sha256 mismatch: ${digest}`);
    }
    await mkdir(join(deps.home, 'imsg'), { recursive: true });
    const unzipped = spawnSync('/usr/bin/ditto', ['-xk', zipPath, join(deps.home, 'imsg')], {
      encoding: 'utf8',
    });
    if (unzipped.status !== 0) {
      throw new Error(`imsg extract failed: ${(unzipped.stderr ?? '').trim()}`);
    }
    await chmod(managed, 0o755);
    return managed;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function rpcErrorKind(err: RpcError): 'drop' | 'permanent' | 'retry' {
  if (err.code === -32001) return 'drop';
  if (err.code === -32002 || err.code === -32004) return 'retry';
  if (err.code === -32602) return 'permanent';
  return 'retry';
}

function asInboundFile(
  row: NonNullable<ImsgMessageRow['attachments']>[number],
  data: string | null,
): ImInboundFileBody {
  return {
    name: row.transfer_name ?? row.filename ?? 'attachment',
    mimeType: row.mime_type ?? null,
    dataBase64: data,
  };
}

export function createImsgBridge(deps: ImsgBridgeDeps) {
  const log = (msg: string) => deps.logger.machine(msg);
  const now = deps.now ?? Date.now;
  const sessions = new Map<string, Session>();
  let stopped = false;

  const post = (connId: string, body: MachineImEventBody): void => {
    void deps.api.imEvent?.(connId, body).catch((err: unknown) => {
      const status = (err as { status?: number }).status;
      if (status === 403 || status === 404) {
        log(`imsg bridge post rejected conn=${connId} status=${status}; detaching`);
        detach(connId);
        return;
      }
      log(
        `imsg bridge post failed conn=${connId} kind=${body.kind}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const readAttachment = async (
    row: NonNullable<ImsgMessageRow['attachments']>[number],
  ): Promise<ImInboundFileBody | null> => {
    if (row.missing === true || row.original_path === undefined || row.original_path === '') {
      return null;
    }
    try {
      const info = await lstat(row.original_path);
      if (!info.isFile() || info.size > ATTACHMENT_MAX_BYTES) return null;
      const buf = await readFile(row.original_path);
      if (buf.length > ATTACHMENT_MAX_BYTES) return null;
      return asInboundFile(row, buf.toString('base64'));
    } catch {
      return null;
    }
  };

  const senderIdOf = (msg: ImsgMessageRow): string | null => {
    if (msg.sender !== undefined && msg.sender !== '') return msg.sender;
    return msg.is_from_me === true ? 'self' : null;
  };

  const cardAction = (session: Session, msg: ImsgMessageRow): ImInboundActionBody | null => {
    const text = (msg.text ?? '').trim();
    if (text === '') return null;
    const chatKey = msg.chat_guid ?? '';
    const card = session.cards.get(chatKey);
    if (card === undefined || now() - card.at > CARD_WINDOW_MS) return null;
    let button: BridgeButton | undefined;
    const indexMatch = /^(\d{1,2})$/.exec(text);
    if (indexMatch !== null) {
      const idx = Number(indexMatch[1]) - 1;
      button = card.buttons[idx];
    }
    if (button === undefined) {
      const lower = text.toLowerCase();
      button = card.buttons.find((b) => b.label.toLowerCase() === lower);
    }
    if (button === undefined) return null;
    const senderId = senderIdOf(msg);
    if (senderId === null) return null;
    session.cards.delete(chatKey);
    return {
      chat: {
        key: chatKey,
        kind: msg.is_group === true ? 'group' : 'direct',
        title: msg.chat_name ?? null,
      },
      sender: {
        id: senderId,
        name: msg.sender_name ?? null,
      },
      value: button.value,
      messageId: `msg-${msg.id ?? 0}`,
    };
  };

  const onMessage = async (session: Session, msg: ImsgMessageRow): Promise<void> => {
    if (msg.type !== undefined) return;
    const chatKey = msg.chat_guid ?? '';
    if (chatKey === '') return;
    const text = msg.text ?? '';
    if (msg.is_from_me === true) {
      const cutoff = now() - OWN_SEND_WINDOW_MS;
      const own = session.recentOwn.find(
        (r) => r.chatGuid === chatKey && r.text === text && r.at >= cutoff,
      );
      if (own !== undefined) {
        session.recentOwn = session.recentOwn.filter((r) => r !== own);
        return;
      }
    }
    const action = cardAction(session, msg);
    if (action !== null) {
      post(session.connId, { kind: 'action', action });
      return;
    }
    const senderId = senderIdOf(msg);
    if (senderId === null) return;
    const files: ImInboundFileBody[] = [];
    const images: ImInboundFileBody[] = [];
    for (const att of msg.attachments ?? []) {
      const file = await readAttachment(att);
      if (file === null) {
        files.push(asInboundFile(att, null));
        continue;
      }
      if ((att.mime_type ?? '').startsWith('image/')) images.push(file);
      else files.push(file);
    }
    post(session.connId, {
      kind: 'message',
      message: {
        chat: {
          key: chatKey,
          kind: msg.is_group === true ? 'group' : 'direct',
          title: msg.chat_name ?? null,
        },
        sender: {
          id: senderId,
          name: msg.sender_name ?? null,
        },
        text,
        images,
        files,
        messageId: `msg-${msg.id ?? 0}`,
        mentioned: true,
      } satisfies ImInboundMessageBody,
    });
  };

  const runSession = async (session: Session): Promise<void> => {
    const spawnProc = deps.spawnProc ?? spawn;
    let bin: string;
    try {
      bin = await ensureImsgBin(deps);
    } catch (err) {
      post(session.connId, {
        kind: 'status',
        status: 'error',
        detail: `imsg unavailable: ${err instanceof Error ? err.message : String(err)}`,
      });
      scheduleRespawn(session);
      return;
    }
    post(session.connId, { kind: 'status', status: 'connecting' });
    const child = spawnProc(bin, ['rpc'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const rpc = new ImsgRpc(
      child,
      (method, params) => {
        if (method !== 'message') return;
        const row = (params as { message?: ImsgMessageRow } | undefined)?.message;
        if (row === undefined) return;
        void onMessage(session, row).catch((err: unknown) => {
          log(
            `imsg inbound failed conn=${session.connId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      },
      (code) => {
        if (session.rpc === rpc) session.rpc = null;
        if (session.attached && !stopped) {
          post(session.connId, {
            kind: 'status',
            status: 'degraded',
            detail: `imsg rpc exited (code ${code ?? 'null'})`,
          });
          scheduleRespawn(session);
        }
      },
    );
    session.rpc = rpc;
    try {
      await rpc.call('initialize', { protocol_version: 1 });
      await rpc.call('watch.subscribe', { attachments: true });
      session.backoffMs = RESPAWN_BASE_MS;
      post(session.connId, { kind: 'status', status: 'ready' });
    } catch (err) {
      const rpcErr = err as RpcError;
      post(session.connId, {
        kind: 'status',
        status: 'degraded',
        detail: `imsg rpc init failed: ${rpcErr.message ?? 'unknown error'}`,
      });
      rpc.kill();
      scheduleRespawn(session);
    }
  };

  const scheduleRespawn = (session: Session): void => {
    if (!session.attached || stopped) return;
    if (session.respawnTimer !== null) return;
    const delay = session.backoffMs;
    session.backoffMs = Math.min(session.backoffMs * 2, RESPAWN_MAX_MS);
    session.respawnTimer = setTimeout(() => {
      session.respawnTimer = null;
      if (session.attached && !stopped) void runSession(session);
    }, delay);
  };

  const attach = (connId: string): void => {
    let session = sessions.get(connId);
    if (session !== undefined) {
      session.attached = true;
      if (session.rpc !== null || session.respawnTimer !== null) return;
      void runSession(session);
      return;
    }
    session = {
      connId,
      attached: true,
      rpc: null,
      backoffMs: RESPAWN_BASE_MS,
      respawnTimer: null,
      recentOwn: [],
      cards: new Map(),
    };
    sessions.set(connId, session);
    log(`imsg bridge attach conn=${connId}`);
    void runSession(session);
  };

  const detach = (connId: string): void => {
    const session = sessions.get(connId);
    if (session === undefined) return;
    session.attached = false;
    sessions.delete(connId);
    if (session.respawnTimer !== null) {
      clearTimeout(session.respawnTimer);
      session.respawnTimer = null;
    }
    session.rpc?.kill();
    session.rpc = null;
    log(`imsg bridge detach conn=${connId}`);
  };

  const send = async (
    connId: string,
    sendId: string,
    message: { chatKey: string; text: string; buttons?: { label: string; value: string }[][] },
  ): Promise<void> => {
    const session = sessions.get(connId);
    const rpc = session?.rpc ?? null;
    if (session === undefined || rpc === null) {
      post(connId, {
        kind: 'sent',
        sendId,
        ok: false,
        errorKind: 'retry',
        error: 'imsg bridge is not attached',
      });
      return;
    }
    try {
      await rpc.call('send', { chat_guid: message.chatKey, text: message.text });
      if (message.buttons !== undefined) {
        session.cards.set(message.chatKey, {
          buttons: message.buttons.flat(),
          at: now(),
        });
      }
      session.recentOwn.push({ chatGuid: message.chatKey, text: message.text, at: now() });
      session.recentOwn = session.recentOwn.slice(-32);
      post(connId, { kind: 'sent', sendId, ok: true });
    } catch (err) {
      const rpcErr = err as RpcError;
      const kind = rpcErrorKind(rpcErr);
      post(connId, {
        kind: 'sent',
        sendId,
        ok: false,
        errorKind: kind,
        error: rpcErr.message ?? `imsg send failed (${rpcErr.code})`,
      });
      if (rpcErr.code === -32002 || rpcErr.code === -32004) {
        rpc.kill();
      }
    }
  };

  return {
    handle(ev: MachineStreamEvent): void {
      if (ev.type === 'im.attach') attach(ev.connId);
      else if (ev.type === 'im.detach') detach(ev.connId);
      else if (ev.type === 'im.send') {
        void send(ev.connId, ev.sendId, ev.message).catch((err: unknown) => {
          log(
            `imsg send threw conn=${ev.connId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    },
    sessionCount(): number {
      return sessions.size;
    },
    stop(): void {
      stopped = true;
      for (const connId of [...sessions.keys()]) detach(connId);
    },
  };
}

export type ImsgBridge = ReturnType<typeof createImsgBridge>;
