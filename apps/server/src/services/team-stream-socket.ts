import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { TLSSocket } from 'node:tls';
import { WebSocket, WebSocketServer } from 'ws';
import type { AppContext } from '../context.js';
import { forwardedOrigin } from '../lib/forwarded-origin.js';
import { forwardedHostFor, isTrustedProxyAddress } from '../lib/request-origin.js';
import { claimUpgrade } from '../lib/upgrade-claims.js';
import { createSerialConnection } from './events.js';
import { deviceStreamsOf, pairedDeviceExists } from './paired-devices.js';
import { startTeamStreamSession } from './team-stream-session.js';

interface UpgradeServer {
  on(
    event: 'upgrade',
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
  off(
    event: 'upgrade',
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
}

const TEAM_STREAM_PATH = /^\/api\/teams\/([^/]+)\/stream$/;

function sameOrigin(request: IncomingMessage, ctx: AppContext): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  if (request.socket.remoteAddress === undefined) {
    try {
      const parsed = new URL(origin);
      return parsed.host === host && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
    } catch {
      return false;
    }
  }
  try {
    const scheme =
      request.socket instanceof TLSSocket && request.socket.encrypted ? 'https' : 'http';
    const direct = new URL(`${scheme}://${host}/`);
    const forwardedProto = request.headers['x-forwarded-proto'];
    const configured = ctx.webOrigin === undefined ? null : URL.parse(ctx.webOrigin);
    if (
      configured?.protocol === 'https:' &&
      configured.host === direct.host &&
      typeof forwardedProto === 'string' &&
      forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https' &&
      origin === configured.origin
    ) {
      return true;
    }
    const expected = forwardedOrigin({
      url: direct.href,
      trustedProxy: isTrustedProxyAddress(request.socket.remoteAddress, ctx.trustedProxies),
      proto: typeof forwardedProto === 'string' ? forwardedProto : undefined,
      host: forwardedHostFor(
        host,
        typeof request.headers['x-forwarded-host'] === 'string'
          ? request.headers['x-forwarded-host']
          : undefined,
      ),
    });
    return origin === expected;
  } catch {
    return false;
  }
}

function deviceOf(
  ctx: AppContext,
  ticket: string | null,
): { ok: true; deviceId: string | null } | { ok: false } {
  if (ctx.authToken === null) return { ok: true, deviceId: null };
  if (ticket === null || ticket === '') return { ok: false };
  const session = ctx.streamTickets.redeem(ticket);
  if (session === null) return { ok: false };
  if (session.kind !== 'device') return { ok: true, deviceId: null };
  if (
    session.deviceId === null ||
    deviceStreamsOf(ctx.db).isRevoked(session.deviceId) ||
    !pairedDeviceExists(ctx.db, session.deviceId)
  ) {
    return { ok: false };
  }
  return { ok: true, deviceId: session.deviceId };
}

function refuse(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function attachTeamStreamSockets(server: UpgradeServer, ctx: AppContext): () => void {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const live = new Set<WebSocket>();

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    socket.on('error', () => socket.destroy());
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://stream.invalid');
    } catch {
      refuse(socket, '400 Bad Request');
      return;
    }
    const matched = TEAM_STREAM_PATH.exec(url.pathname);
    if (matched === null) return;
    claimUpgrade(request);
    if (request.method !== 'GET') {
      refuse(socket, '403 Forbidden');
      return;
    }
    let teamId: string;
    try {
      teamId = decodeURIComponent(matched[1] ?? '');
    } catch {
      refuse(socket, '403 Forbidden');
      return;
    }
    if (teamId !== ctx.team.id || !sameOrigin(request, ctx)) {
      refuse(socket, '403 Forbidden');
      return;
    }
    const device = deviceOf(ctx, url.searchParams.get('ticket'));
    if (!device.ok) {
      refuse(socket, '401 Unauthorized');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      live.add(ws);
      ws.on('close', () => live.delete(ws));
      openStream(ws, teamId, device.deviceId);
    });
  };

  function openStream(ws: WebSocket, teamId: string, deviceId: string | null): void {
    let stopped = false;
    let cleanup: (() => void) | null = null;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      const release = cleanup;
      cleanup = null;
      if (release === null) {
        ws.terminate();
        return;
      }
      release();
      ws.close();
    };
    const conn = createSerialConnection<string>(
      (data, seq) => {
        if (ws.readyState !== WebSocket.OPEN) return Promise.resolve();
        return new Promise<void>((resolve) => {
          ws.send(JSON.stringify({ id: seq, data }), () => resolve());
        });
      },
      { onOverflow: stop },
    );
    const started = startTeamStreamSession(ctx, {
      teamId,
      deviceId,
      conn,
      abort: stop,
    });
    if (stopped) started();
    else cleanup = started;
    ws.on('close', stop);
    ws.on('error', stop);
  }

  server.on('upgrade', upgrade);
  return () => {
    server.off('upgrade', upgrade);
    for (const ws of live) ws.terminate();
    live.clear();
    sockets.close();
  };
}
