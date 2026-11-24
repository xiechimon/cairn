import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TunnelAccess, TunnelErrorKind } from '@cairn/shared';
import type { Hono } from 'hono';
import WebSocket from 'ws';
import { TUNNEL_ORIGIN_ENV_KEY } from '../lib/request-origin.js';

const CONNECT_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface TunnelRecord {
  enabled: boolean;
  relayUrl: string | null;
  secret: string;
}

interface RelayRequestFrame {
  type: 'req';
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  remoteAddr: string;
}

export interface TunnelRemote {
  status(): TunnelAccess;
  resume(): Promise<TunnelAccess>;
  setEnabled(enabled: boolean, relayUrl?: string): Promise<TunnelAccess>;
  stop(): Promise<void>;
}

export interface CreateTunnelRemoteInput {
  environmentId: string;
  recordPath: string;
  defaultRelayUrl: string | null;
  authToken: string | null;
  app: () => Hono;
}

function deriveSubdomain(environmentId: string): string {
  const hash = createHash('sha256').update(environmentId).digest('hex').slice(0, 8);
  return `c-${hash}`;
}

function normalizeRelayUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function relayWsUrl(relayOrigin: string): string {
  const parsed = new URL(relayOrigin);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/_tunnel/connect';
  return parsed.toString();
}

function readRecord(path: string): TunnelRecord | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<TunnelRecord>;
    if (typeof raw.enabled !== 'boolean') return null;
    return {
      enabled: raw.enabled,
      relayUrl: normalizeRelayUrl(raw.relayUrl),
      secret:
        typeof raw.secret === 'string' && raw.secret.length >= 16
          ? raw.secret
          : randomBytes(24).toString('hex'),
    };
  } catch {
    return null;
  }
}

function writeRecord(path: string, record: TunnelRecord): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
  renameSync(tmp, path);
}

export function createTunnelRemote(input: CreateTunnelRemoteInput): TunnelRemote {
  const saved = readRecord(input.recordPath);
  const subdomain = deriveSubdomain(input.environmentId);
  let enabled = saved?.enabled ?? false;
  let relayUrl = saved?.relayUrl ?? normalizeRelayUrl(input.defaultRelayUrl);
  const secret = saved?.secret ?? randomBytes(24).toString('hex');
  let state: TunnelAccess['state'] = 'off';
  let publicUrl: string | null = null;
  let error: TunnelErrorKind | null = null;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let stopped = false;
  const inflight = new Map<string, AbortController>();
  let queue: Promise<void> = Promise.resolve();

  const snapshot = (): TunnelAccess => ({
    enabled,
    state: enabled ? state : 'off',
    url: enabled && state === 'ready' ? publicUrl : null,
    relayUrl,
    error: enabled && state === 'failed' ? error : null,
  });

  const clearReconnect = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const abortAllInflight = (): void => {
    for (const ctrl of inflight.values()) ctrl.abort();
    inflight.clear();
  };

  const closeSocket = (): void => {
    clearReconnect();
    abortAllInflight();
    if (ws !== null) {
      const current = ws;
      ws = null;
      current.removeAllListeners();
      try {
        current.close(1000, 'disabled');
      } catch {}
    }
  };

  const handleRelayRequest = async (socket: WebSocket, frame: RelayRequestFrame): Promise<void> => {
    const controller = new AbortController();
    inflight.set(frame.id, controller);
    try {
      const host = frame.headers.host ?? (publicUrl ? new URL(publicUrl).host : 'localhost');
      const targetUrl = `https://${host}${frame.url.startsWith('/') ? frame.url : `/${frame.url}`}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(frame.headers)) headers.set(k, v);
      headers.set('x-forwarded-proto', 'https');
      const body =
        frame.method !== 'GET' && frame.method !== 'HEAD' && frame.body !== null
          ? Buffer.from(frame.body, 'base64')
          : undefined;
      const request = new Request(targetUrl, {
        method: frame.method,
        headers,
        body,
        signal: controller.signal,
      });
      const response = await input.app().fetch(request, {
        incoming: { socket: { remoteAddress: frame.remoteAddr || '0.0.0.0' } },
        [TUNNEL_ORIGIN_ENV_KEY]: `https://${host}`,
      });
      if (socket.readyState !== WebSocket.OPEN) return;
      const outHeaders: [string, string][] = [];
      response.headers.forEach((value, key) => {
        outHeaders.push([key, value]);
      });
      socket.send(
        JSON.stringify({
          type: 'res-head',
          id: frame.id,
          status: response.status,
          headers: outHeaders,
        }),
      );
      if (response.body !== null) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done || socket.readyState !== WebSocket.OPEN) break;
          if (value !== undefined && value.byteLength > 0) {
            socket.send(
              JSON.stringify({
                type: 'res-chunk',
                id: frame.id,
                data: Buffer.from(value).toString('base64'),
              }),
            );
          }
        }
      }
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'res-end', id: frame.id }));
      }
    } catch {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'res-end', id: frame.id }));
      }
    } finally {
      inflight.delete(frame.id);
    }
  };

  const scheduleReconnect = (): void => {
    if (!enabled || stopped || relayUrl === null) return;
    clearReconnect();
    state = 'reconnecting';
    publicUrl = null;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!enabled || stopped) return;
      void connectOnce().catch(() => {});
    }, delay);
  };

  const connectOnce = (): Promise<TunnelAccess> => {
    closeSocket();
    if (input.authToken === null) {
      state = 'failed';
      error = 'auth-off';
      publicUrl = null;
      return Promise.resolve(snapshot());
    }
    if (relayUrl === null) {
      state = 'failed';
      error = 'invalid-relay';
      publicUrl = null;
      return Promise.resolve(snapshot());
    }
    const targetWs = relayWsUrl(relayUrl);
    state = reconnectAttempt > 0 ? 'reconnecting' : 'connecting';
    error = null;
    publicUrl = null;

    return new Promise<TunnelAccess>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(snapshot());
        }
      };

      const socket = new WebSocket(targetWs);
      ws = socket;

      const timer = setTimeout(() => {
        if (!settled) {
          state = 'failed';
          error = 'unreachable';
          try {
            socket.terminate();
          } catch {}
          finish();
          scheduleReconnect();
        }
      }, CONNECT_TIMEOUT_MS);

      socket.on('open', () => {
        if (ws !== socket) return;
        socket.send(JSON.stringify({ type: 'hello', subdomain, secret }));
      });

      socket.on('message', (raw) => {
        if (ws !== socket) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          return;
        }
        if (msg.type === 'ready' && typeof msg.url === 'string') {
          reconnectAttempt = 0;
          state = 'ready';
          publicUrl = msg.url;
          error = null;
          finish();
          return;
        }
        if (msg.type === 'error') {
          state = 'failed';
          error = 'rejected';
          publicUrl = null;
          finish();
          return;
        }
        if (msg.type === 'req' && typeof msg.id === 'string') {
          void handleRelayRequest(socket, msg as unknown as RelayRequestFrame);
          return;
        }
        if (msg.type === 'req-abort' && typeof msg.id === 'string') {
          inflight.get(msg.id)?.abort();
          inflight.delete(msg.id);
        }
      });

      socket.on('error', () => {
        if (ws !== socket) return;
        if (!settled) {
          state = 'failed';
          error = 'unreachable';
          publicUrl = null;
          finish();
        }
      });

      socket.on('close', () => {
        if (ws !== socket) return;
        ws = null;
        abortAllInflight();
        if (!settled) {
          if (state !== 'failed') {
            state = 'failed';
            error = 'unreachable';
          }
          finish();
        }
        if (enabled && !stopped && error !== 'rejected' && error !== 'auth-off') {
          scheduleReconnect();
        }
      });
    });
  };

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    status: snapshot,
    resume: () =>
      enqueue(async () => {
        if (!enabled || stopped) return snapshot();
        return connectOnce();
      }),
    setEnabled: (nextEnabled: boolean, nextRelayUrl?: string) =>
      enqueue(async () => {
        if (nextRelayUrl !== undefined) {
          const parsed = normalizeRelayUrl(nextRelayUrl);
          if (parsed === null) {
            enabled = nextEnabled;
            state = 'failed';
            error = 'invalid-relay';
            publicUrl = null;
            return snapshot();
          }
          relayUrl = parsed;
        }
        enabled = nextEnabled;
        writeRecord(input.recordPath, { enabled, relayUrl, secret });
        if (!enabled) {
          reconnectAttempt = 0;
          closeSocket();
          state = 'off';
          publicUrl = null;
          error = null;
          return snapshot();
        }
        reconnectAttempt = 0;
        return connectOnce();
      }),
    stop: () =>
      enqueue(async () => {
        stopped = true;
        closeSocket();
        state = 'stopped';
        publicUrl = null;
      }),
  };
}
