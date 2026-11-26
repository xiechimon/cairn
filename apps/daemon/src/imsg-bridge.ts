import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
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
const STALE_BACKLOG_MAX_AGE_MS = 15 * 60_000;
const RESPAWN_BASE_MS = 2_000;
const RESPAWN_MAX_MS = 60_000;
const STDERR_TAIL_LINES = 8;
const STDERR_TAIL_CHARS = 512;

export interface ImsgBridgeDeps {
  api: Pick<MachineApi, 'imEvent'>;
  logger: Pick<DaemonLogger, 'machine' | 'wake'>;
  home: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
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
  created_at?: string;
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
  private stderrBuf = '';
  private readonly stderrLines: string[] = [];
  private alive = true;

  constructor(
    private readonly child: ChildProcess,
    private readonly onNotify: (method: string, params: unknown) => void,
    private readonly onExit: (
      code: number | null,
      spawnError: NodeJS.ErrnoException | null,
      stderrTail: string,
    ) => void,
    private readonly onStderrLine?: (line: string) => void,
  ) {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.feed(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => this.feedStderr(chunk));
    child.on('exit', (code) => this.died(code, null));
    child.on('error', (err) => this.died(null, err as NodeJS.ErrnoException));
  }

  private feedStderr(chunk: string): void {
    this.stderrBuf += chunk;
    for (;;) {
      const nl = this.stderrBuf.indexOf('\n');
      if (nl < 0) break;
      const line = this.stderrBuf.slice(0, nl).trim();
      this.stderrBuf = this.stderrBuf.slice(nl + 1);
      if (line === '') continue;
      this.stderrLines.push(line);
      if (this.stderrLines.length > STDERR_TAIL_LINES) {
        this.stderrLines.shift();
      }
      this.onStderrLine?.(line);
    }
  }

  stderrTail(): string {
    const extra = this.stderrBuf.trim();
    const lines = extra === '' ? this.stderrLines : [...this.stderrLines, extra];
    const joined = lines.join(' | ');
    return joined.length > STDERR_TAIL_CHARS ? joined.slice(-STDERR_TAIL_CHARS) : joined;
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

  private died(code: number | null, spawnError: NodeJS.ErrnoException | null): void {
    if (!this.alive) return;
    this.alive = false;
    for (const waiter of this.pending.values()) {
      waiter.reject({ code: -32004, message: 'imsg rpc exited' });
    }
    this.pending.clear();
    this.onExit(code, spawnError, this.stderrTail());
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
  lastRowId: number | null;
  outboundDegraded: boolean;
  recentOwn: { chatGuid: string; text: string; at: number }[];
  recentOwnGuids: { guid: string; at: number }[];
  cards: Map<string, { buttons: BridgeButton[]; at: number }>;
}

class PermanentImsgError extends Error {}

async function findImsgOnPath(env: NodeJS.ProcessEnv): Promise<string | null> {
  const raw = env.PATH ?? '';
  for (const dir of raw.split(delimiter)) {
    const trimmed = dir.trim();
    if (trimmed === '') continue;
    const candidate = join(trimmed, 'imsg');
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
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
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') {
    throw new PermanentImsgError('imessage bridge requires macOS (darwin)');
  }
  const managed = join(deps.home, 'imsg', 'imsg');
  const managedInfo = await lstat(managed).catch(() => null);
  if (managedInfo !== null) {
    if (managedInfo.isFile() && !managedInfo.isSymbolicLink()) return managed;
    deps.logger.machine(`imsg managed binary at ${managed} is not a regular file; reinstalling`);
    await rm(managed, { force: true });
  }
  const onPath = await findImsgOnPath(env);
  if (onPath !== null) return onPath;
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

function classifyOutboundFailure(
  err: RpcError,
  stderrTail: string,
): {
  kind: 'drop' | 'permanent' | 'retry';
  error: string;
  degradedDetail: string | null;
} {
  const rawMessage = err.message ?? `imsg send failed (${err.code})`;
  const detailText = [rawMessage, err.data?.detail ?? '', stderrTail].filter(Boolean).join(' | ');
  if (/-1743\b|not authorized to send apple events/i.test(detailText)) {
    const error =
      stderrTail !== '' && !rawMessage.includes(stderrTail)
        ? `${rawMessage} (${stderrTail})`
        : rawMessage;
    return {
      kind: 'permanent',
      error,
      degradedDetail: `imsg send denied (-1743; grant Automation -> Messages in System Settings): ${error}`,
    };
  }
  if (/-1712\b|appleevent timed out/i.test(detailText)) {
    const error =
      stderrTail !== '' && !rawMessage.includes(stderrTail)
        ? `${rawMessage} (${stderrTail})`
        : rawMessage;
    return {
      kind: 'retry',
      error,
      degradedDetail: `imsg send timed out (-1712; check Messages.app or Automation permission): ${error}`,
    };
  }
  if (err.code === -32001) return { kind: 'drop', error: rawMessage, degradedDetail: null };
  if (err.code === -32002 || err.code === -32004) {
    return { kind: 'retry', error: rawMessage, degradedDetail: null };
  }
  if (err.code === -32602) return { kind: 'permanent', error: rawMessage, degradedDetail: null };
  return { kind: 'retry', error: rawMessage, degradedDetail: null };
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

  const isOwnEcho = (session: Session, chatKey: string, msg: ImsgMessageRow): boolean => {
    if (msg.is_from_me !== true) return false;
    const cutoff = now() - OWN_SEND_WINDOW_MS;
    if (typeof msg.guid === 'string' && msg.guid !== '') {
      const ownGuid = session.recentOwnGuids.find((r) => r.guid === msg.guid && r.at >= cutoff);
      if (ownGuid !== undefined) {
        session.recentOwnGuids = session.recentOwnGuids.filter((r) => r !== ownGuid);
        return true;
      }
    }
    const text = msg.text ?? '';
    const own = session.recentOwn.find(
      (r) => r.chatGuid === chatKey && r.text === text && r.at >= cutoff,
    );
    if (own === undefined) return false;
    session.recentOwn = session.recentOwn.filter((r) => r !== own);
    return true;
  };

  const recordRowId = (session: Session, rawId: unknown): void => {
    if (typeof rawId === 'number' && Number.isInteger(rawId) && rawId > 0) {
      session.lastRowId = Math.max(session.lastRowId ?? 0, rawId);
    }
  };

  const isStaleBacklog = (msg: ImsgMessageRow): boolean => {
    if (typeof msg.created_at !== 'string' || msg.created_at === '') return false;
    const createdAt = Date.parse(msg.created_at);
    return Number.isFinite(createdAt) && now() - createdAt > STALE_BACKLOG_MAX_AGE_MS;
  };

  const onMessage = async (session: Session, msg: ImsgMessageRow): Promise<void> => {
    recordRowId(session, msg.id);
    if (msg.type !== undefined) return;
    if (isStaleBacklog(msg)) return;
    const chatKey = msg.chat_guid ?? '';
    if (chatKey === '') return;
    if (isOwnEcho(session, chatKey, msg)) return;
    const text = msg.text ?? '';
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
      if (!(err instanceof PermanentImsgError)) scheduleRespawn(session);
      return;
    }
    post(session.connId, { kind: 'status', status: 'connecting' });
    const child = spawnProc(bin, ['rpc'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const rpc = new ImsgRpc(
      child,
      (method, params) => {
        if (method === 'watch.overflow' || method === 'error') {
          if (method === 'watch.overflow') {
            recordRowId(
              session,
              (params as { resume_after_rowid?: unknown } | undefined)?.resume_after_rowid,
            );
          }
          const detail =
            method === 'watch.overflow'
              ? `imsg watch overflow (${String((params as { reason?: unknown } | undefined)?.reason ?? 'buffer_limit_exceeded')})`
              : `imsg watch error: ${String((params as { error?: { message?: unknown } } | undefined)?.error?.message ?? 'unknown error')}`;
          log(`imsg bridge ${detail} conn=${session.connId}`);
          if (session.rpc === rpc) session.rpc = null;
          rpc.kill();
          if (session.attached && !stopped) {
            post(session.connId, { kind: 'status', status: 'degraded', detail });
            scheduleRespawn(session);
          }
          return;
        }
        if (method !== 'message') return;
        const row = (params as { message?: ImsgMessageRow } | undefined)?.message;
        if (row === undefined) return;
        void onMessage(session, row).catch((err: unknown) => {
          log(
            `imsg inbound failed conn=${session.connId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      },
      (code, spawnError, stderrTail) => {
        if (session.rpc === rpc) session.rpc = null;
        if (session.attached && !stopped) {
          const suffix = stderrTail !== '' ? `: ${stderrTail}` : '';
          if (spawnError?.code === 'ENOENT' || spawnError?.code === 'EACCES') {
            post(session.connId, {
              kind: 'status',
              status: 'error',
              detail: `imsg unavailable (${spawnError.code}: ${spawnError.message})${suffix}`,
            });
            return;
          }
          post(session.connId, {
            kind: 'status',
            status: 'degraded',
            detail: `imsg rpc exited (code ${code ?? 'null'})${suffix}`,
          });
          scheduleRespawn(session);
        }
      },
      (line) => log(`imsg stderr conn=${session.connId}: ${line}`),
    );
    session.rpc = rpc;
    try {
      await rpc.call('initialize', { protocol_version: 1 });
      await rpc.call(
        'watch.subscribe',
        session.lastRowId !== null
          ? { attachments: true, since_rowid: session.lastRowId }
          : { attachments: true },
      );
      session.backoffMs = RESPAWN_BASE_MS;
      session.outboundDegraded = false;
      post(session.connId, { kind: 'status', status: 'ready' });
    } catch (err) {
      const rpcErr = err as RpcError;
      const tail = rpc.stderrTail();
      const suffix = tail !== '' ? ` (${tail})` : '';
      const detail =
        rpcErr.code === -32002
          ? `imsg rpc init failed (grant Full Disk Access to Cairn/Terminal): ${rpcErr.message ?? 'database unavailable'}${suffix}`
          : `imsg rpc init failed: ${rpcErr.message ?? 'unknown error'}${suffix}`;
      post(session.connId, {
        kind: 'status',
        status: 'degraded',
        detail,
      });
      if (session.rpc === rpc) session.rpc = null;
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
      if (session.rpc !== null) return;
      if (session.respawnTimer !== null) {
        clearTimeout(session.respawnTimer);
        session.respawnTimer = null;
        session.backoffMs = RESPAWN_BASE_MS;
      }
      void runSession(session);
      return;
    }
    session = {
      connId,
      attached: true,
      rpc: null,
      backoffMs: RESPAWN_BASE_MS,
      respawnTimer: null,
      lastRowId: null,
      outboundDegraded: false,
      recentOwn: [],
      recentOwnGuids: [],
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
    const ownEntry = { chatGuid: message.chatKey, text: message.text, at: now() };
    session.recentOwn.push(ownEntry);
    session.recentOwn = session.recentOwn.slice(-32);
    try {
      const res = (await rpc.call('send', {
        chat_guid: message.chatKey,
        text: message.text,
      })) as { guid?: unknown } | undefined;
      if (typeof res?.guid === 'string' && res.guid !== '') {
        session.recentOwnGuids.push({ guid: res.guid, at: now() });
        session.recentOwnGuids = session.recentOwnGuids.slice(-32);
      }
      if (message.buttons !== undefined) {
        session.cards.set(message.chatKey, {
          buttons: message.buttons.flat(),
          at: now(),
        });
      }
      if (session.outboundDegraded && session.rpc === rpc) {
        session.outboundDegraded = false;
        post(connId, { kind: 'status', status: 'ready' });
      }
      post(connId, { kind: 'sent', sendId, ok: true });
    } catch (err) {
      const rpcErr = err as RpcError;
      if (rpcErr.code !== -32001 && rpcErr.code !== -32004) {
        session.recentOwn = session.recentOwn.filter((r) => r !== ownEntry);
      }
      const classified = classifyOutboundFailure(rpcErr, rpc.stderrTail());
      if (classified.degradedDetail !== null && session.rpc === rpc) {
        session.outboundDegraded = true;
        post(connId, {
          kind: 'status',
          status: 'degraded',
          detail: classified.degradedDetail,
        });
      }
      post(connId, {
        kind: 'sent',
        sendId,
        ok: false,
        errorKind: classified.kind,
        error: classified.error,
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
