import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  FeedbackSubmitResponse,
  RelayAccount,
  RelayDirectoryDevice,
  RelayDirectoryResponse,
  RelayOAuthStartResponse,
  TunnelAccess,
  TunnelErrorKind,
} from '@cairn/shared';
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
  account: RelayAccount | null;
  clerkToken?: string | null;
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
  startOAuthLogin(input: { callbackUrl: string; relayUrl?: string }): RelayOAuthStartResponse;
  completeOAuthLogin(input: {
    state: string;
    token: string;
    email: string;
    displayName?: string;
    avatarUrl?: string;
  }): Promise<boolean>;
  signOut(): Promise<TunnelAccess>;
  directory(): Promise<RelayDirectoryResponse>;
  shareDevice(targetEmail: string, role?: 'owner' | 'collaborator'): Promise<void>;
  revokeShare(targetEmail: string): Promise<void>;
  submitFeedback(input: {
    message: string;
    route?: string;
    errorSummary?: string;
  }): Promise<FeedbackSubmitResponse>;
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
    const rawAccount = raw.account;
    const account =
      rawAccount !== null &&
      rawAccount !== undefined &&
      typeof rawAccount.email === 'string' &&
      typeof rawAccount.displayName === 'string'
        ? {
            email: rawAccount.email,
            displayName: rawAccount.displayName,
            ...(typeof rawAccount.avatarUrl === 'string'
              ? { avatarUrl: rawAccount.avatarUrl }
              : {}),
          }
        : null;
    return {
      enabled: raw.enabled,
      relayUrl: normalizeRelayUrl(raw.relayUrl),
      secret:
        typeof raw.secret === 'string' && raw.secret.length >= 16
          ? raw.secret
          : randomBytes(24).toString('hex'),
      account,
      clerkToken: typeof raw.clerkToken === 'string' ? raw.clerkToken : null,
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
  let account: RelayAccount | null = saved?.account ?? null;
  let clerkToken: string | null = saved?.clerkToken ?? null;
  const pendingOAuthStates = new Map<string, number>();
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
    account,
  });

  const persist = (): void => {
    writeRecord(input.recordPath, { enabled, relayUrl, secret, account, clerkToken });
  };

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
        socket.send(
          JSON.stringify({
            type: 'hello',
            subdomain,
            secret,
            clerkToken,
            accountEmail: account?.email ?? null,
            deviceName: hostname(),
            os: process.platform,
          }),
        );
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
        persist();
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
    startOAuthLogin: ({ callbackUrl, relayUrl: nextRelayUrl }) => {
      if (nextRelayUrl !== undefined) {
        const parsed = normalizeRelayUrl(nextRelayUrl);
        if (parsed !== null) {
          relayUrl = parsed;
          persist();
        }
      }
      if (relayUrl === null) throw new Error('relay url is required for sign-in');
      const nonce = randomBytes(16).toString('hex');
      pendingOAuthStates.set(nonce, Date.now() + 600_000);
      const url = new URL('/_auth/login', relayUrl);
      url.searchParams.set('callback', callbackUrl);
      url.searchParams.set('state', nonce);
      return { loginUrl: url.toString() };
    },
    completeOAuthLogin: (payload) =>
      enqueue(async () => {
        const expires = pendingOAuthStates.get(payload.state);
        pendingOAuthStates.delete(payload.state);
        if (expires === undefined || expires < Date.now()) return false;
        if (!payload.token || !payload.email.includes('@')) return false;
        const email = payload.email.trim().toLowerCase();
        const displayName = payload.displayName?.trim() || email.split('@', 1)[0] || email;
        const avatarUrl = payload.avatarUrl?.startsWith('https://') ? payload.avatarUrl : null;
        account = { email, displayName, avatarUrl };
        clerkToken = payload.token;
        enabled = relayUrl !== null && input.authToken !== null;
        persist();
        if (enabled) {
          reconnectAttempt = 0;
          await connectOnce();
        }
        return true;
      }),
    signOut: () =>
      enqueue(async () => {
        account = null;
        clerkToken = null;
        enabled = false;
        reconnectAttempt = 0;
        closeSocket();
        state = 'off';
        publicUrl = null;
        error = null;
        persist();
        return snapshot();
      }),
    directory: async (): Promise<RelayDirectoryResponse> => {
      if (account === null || relayUrl === null || clerkToken === null) {
        return { account, selfSubdomain: subdomain, ownDevices: [], sharedDevices: [] };
      }
      try {
        const res = await fetch(
          `${relayUrl}/_directory/devices?email=${encodeURIComponent(account.email)}`,
          { headers: { authorization: `Bearer ${clerkToken}` } },
        );
        if (!res.ok) {
          return { account, selfSubdomain: subdomain, ownDevices: [], sharedDevices: [] };
        }
        const body = (await res.json()) as {
          ownDevices?: RelayDirectoryDevice[];
          sharedDevices?: RelayDirectoryDevice[];
        };
        return {
          account,
          selfSubdomain: subdomain,
          ownDevices: Array.isArray(body.ownDevices) ? body.ownDevices : [],
          sharedDevices: Array.isArray(body.sharedDevices) ? body.sharedDevices : [],
        };
      } catch {
        return { account, selfSubdomain: subdomain, ownDevices: [], sharedDevices: [] };
      }
    },
    shareDevice: async (targetEmail: string, role: 'owner' | 'collaborator' = 'collaborator') => {
      if (relayUrl === null || clerkToken === null) throw new Error('clerk session required');
      const res = await fetch(`${relayUrl}/_directory/shares`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${clerkToken}`,
        },
        body: JSON.stringify({ subdomain, targetEmail, role }),
      });
      if (!res.ok) throw new Error('failed to share device');
    },
    revokeShare: async (targetEmail: string) => {
      if (relayUrl === null || clerkToken === null) throw new Error('clerk session required');
      const res = await fetch(`${relayUrl}/_directory/shares`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${clerkToken}`,
        },
        body: JSON.stringify({ subdomain, targetEmail }),
      });
      if (!res.ok) throw new Error('failed to revoke share');
    },
    submitFeedback: async (fb): Promise<FeedbackSubmitResponse> => {
      const localId = `fb_${randomBytes(6).toString('hex')}`;
      const payload = {
        id: localId,
        createdAt: new Date().toISOString(),
        email: account?.email ?? null,
        message: fb.message,
        context: {
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          route: fb.route ?? null,
          errorSummary: fb.errorSummary ?? null,
          tunnelState: state,
        },
      };
      const localPath = join(dirname(input.recordPath), 'feedback.jsonl');
      mkdirSync(dirname(localPath), { recursive: true, mode: 0o700 });
      appendFileSync(localPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
      if (relayUrl !== null) {
        try {
          const res = await fetch(`${relayUrl}/_feedback`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            const remote = (await res.json()) as { id?: string };
            if (typeof remote.id === 'string') return { ok: true, id: remote.id };
          }
        } catch {}
      }
      return { ok: true, id: localId };
    },
    stop: () =>
      enqueue(async () => {
        stopped = true;
        closeSocket();
        state = 'stopped';
        publicUrl = null;
      }),
  };
}
