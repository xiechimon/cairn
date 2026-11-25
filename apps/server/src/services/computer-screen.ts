import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { TLSSocket } from 'node:tls';
import {
  COMPUTER_SCREEN_CAP_TTL_MS,
  COMPUTER_SCREEN_MAX_FRAME_BYTES,
  type ComputerScreenRequest,
  computerScreenRequestSchema,
  type OpenComputerScreen,
  openComputerScreenSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { createWebSocketStream, type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { computer, machine as machineTable, step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { forwardedOrigin } from '../lib/forwarded-origin.js';
import { forwardedHostFor, isTrustedProxyAddress } from '../lib/request-origin.js';
import { ownedPrivateComputer } from './computer-access.js';
import {
  acquireComputerControl,
  hasComputerControl,
  ownedComputer,
  releaseComputerControl,
  renewComputerControl,
} from './computer-control.js';
import { browserScopeFor, computerThreadOf } from './computer-thread.js';
import { findMachineByToken } from './machines.js';
import { deviceStreamsOf } from './paired-devices.js';
import { screenUpgradePath } from './screen-upgrade-paths.js';

const MAX_CHANNELS = 128;
const MAX_COMPUTER_CHANNELS = 8;
const PAIR_TIMEOUT_MS = 15_000;
const CAP_PROTOCOL_PREFIX = 'cairn-screen.';
const CAP_PURPOSE = 'cairn-computer-screen-v1';
const viewerCapabilitySchema = z
  .object({ purpose: z.literal(CAP_PURPOSE), channel: computerScreenRequestSchema })
  .strict();
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

type ScreenDependencies = Pick<AppContext, 'db' | 'machineHub' | 'secretBox' | 'trustedProxies'>;
interface Channel {
  request: ComputerScreenRequest;
  machineId: string;
  teamId: string;
  userId: string;
  viewerUsed: boolean;
  machineUsed: boolean;
  machineTokenHash?: string;
  viewer?: WebSocket;
  machine?: WebSocket;
  viewerStream?: Duplex;
  machineStream?: Duplex;
  openedAt: number;
  streams: Duplex[];
  unbindDevice: () => void;
}

const gateways = new WeakMap<ScreenDependencies['machineHub'], ComputerScreenGateway>();

export function computerScreensOf(deps: ScreenDependencies): ComputerScreenGateway {
  let gateway = gateways.get(deps.machineHub);
  if (!gateway) {
    gateway = new ComputerScreenGateway(deps);
    gateways.set(deps.machineHub, gateway);
  }
  return gateway;
}

export class ComputerScreenGateway {
  private readonly channels = new Map<string, Channel>();
  private readonly servers = new Map<
    UpgradeServer,
    (request: IncomingMessage, socket: Duplex, head: Buffer) => void
  >();
  private readonly sockets = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: COMPUTER_SCREEN_MAX_FRAME_BYTES,
    handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
  });
  private readonly timer: NodeJS.Timeout;
  private readonly offDisconnect: () => void;
  private closed = false;

  constructor(private readonly deps: ScreenDependencies) {
    this.timer = setInterval(() => this.sweep(), 250);
    this.timer.unref();
    this.offDisconnect = deps.machineHub.onDisconnect((machineId) => {
      const rows = deps.db
        .select({ id: computer.id })
        .from(computer)
        .where(eq(computer.machineId, machineId))
        .all();
      for (const row of rows) this.invalidateComputer(row.id);
    });
  }

  recover(): void {
    for (const row of this.deps.db.select({ id: computer.id }).from(computer).all()) {
      this.invalidateComputer(row.id);
    }
  }

  acquireControl(teamId: string, userId: string, computerId: string) {
    return acquireComputerControl(this.deps.db, this.deps.machineHub, teamId, userId, computerId);
  }

  renewControl(teamId: string, userId: string, computerId: string, leaseId: string) {
    const row = ownedComputer(this.deps.db, teamId, userId, computerId);
    if (!this.deps.machineHub.isConnected(row.machineId))
      throw new HttpError(409, 'the computer is not connected');
    return renewComputerControl(this.deps.db, teamId, userId, computerId, leaseId);
  }

  releaseControl(teamId: string, userId: string, computerId: string, leaseId: string): void {
    releaseComputerControl(this.deps.db, teamId, userId, computerId, leaseId);
    for (const channel of [...this.channels.values()]) {
      if (channel.request.computerId === computerId && channel.request.kind !== 'view')
        this.revoke(channel, 'control released');
    }
  }

  open(
    teamId: string,
    userId: string,
    computerId: string,
    input: OpenComputerScreen,
    deviceId: string | null = null,
  ) {
    if (this.closed) throw new HttpError(503, 'computer screen gateway is closed');
    if (deviceStreamsOf(this.deps.db).isRevoked(deviceId)) {
      throw new HttpError(401, 'this device was revoked');
    }
    const parsed = openComputerScreenSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'invalid screen request');
    const { kind, leaseId } = parsed.data;
    const row = ownedComputer(this.deps.db, teamId, userId, computerId);
    this.sweep();
    if (!this.deps.machineHub.isConnected(row.machineId))
      throw new HttpError(409, 'the computer is not connected');
    if (kind !== 'view' && !hasComputerControl(row, leaseId))
      throw new HttpError(409, 'a live control lease is required');
    if (
      this.channels.size >= MAX_CHANNELS ||
      [...this.channels.values()].filter((channel) => channel.request.computerId === computerId)
        .length >= MAX_COMPUTER_CHANNELS
    )
      throw new HttpError(429, 'too many computer screen channels');
    const now = Date.now();
    const handoff =
      kind === 'control' &&
      row.handoffReason !== null &&
      this.deps.db
        .select({ capabilities: machineTable.capabilities })
        .from(machineTable)
        .where(eq(machineTable.id, row.machineId))
        .get()?.capabilities?.screenHandoff === true;
    const handoffBrowserScope = (() => {
      if (!handoff || row.handoffStepId === null) return undefined;
      const stepRow = this.deps.db
        .select({ kind: step.kind, buildId: step.buildId })
        .from(step)
        .where(eq(step.id, row.handoffStepId))
        .get();
      if (stepRow === undefined) return undefined;
      const thread = computerThreadOf(this.deps.db, stepRow);
      return thread === null ? undefined : browserScopeFor(thread);
    })();
    const request: ComputerScreenRequest = computerScreenRequestSchema.parse({
      id: randomBytes(32).toString('hex'),
      computerId,
      scopeKey: row.scopeKey,
      kind,
      generation: row.screenGeneration,
      controlLeaseId: kind === 'view' ? null : (leaseId ?? null),
      controlFence: row.controlFence,
      ...(handoff ? { handoff: true } : {}),
      ...(handoffBrowserScope !== undefined ? { browserScope: handoffBrowserScope } : {}),
      expiresAt: Math.min(
        now + COMPUTER_SCREEN_CAP_TTL_MS,
        kind === 'view' ? Number.POSITIVE_INFINITY : (row.controlLeaseExpiresAt ?? now),
      ),
    });
    const channel: Channel = {
      request,
      machineId: row.machineId,
      teamId,
      userId,
      viewerUsed: false,
      machineUsed: false,
      openedAt: now,
      streams: [],
      unbindDevice: () => {},
    };
    this.channels.set(request.id, channel);
    channel.unbindDevice = deviceStreamsOf(this.deps.db).bind(deviceId, () =>
      this.revoke(channel, 'device revoked'),
    );
    if (!this.deps.machineHub.pushComputerScreen(row.machineId, request)) {
      this.revoke(channel, 'machine not connected');
      throw new HttpError(409, 'the computer is not connected');
    }
    const token = Buffer.from(
      this.deps.secretBox.seal(JSON.stringify({ purpose: CAP_PURPOSE, channel: request })),
    ).toString('base64url');
    return {
      path: `/api/computer-screen/${request.id}`,
      wsProtocols: ['binary', `${CAP_PROTOCOL_PREFIX}${token}`],
      kind,
      expiresAt: request.expiresAt,
      generation: request.generation,
    };
  }

  invalidateComputer(computerId: string): void {
    const row = this.deps.db.select().from(computer).where(eq(computer.id, computerId)).get();
    if (!row) return;
    this.deps.db
      .update(computer)
      .set({
        screenGeneration: row.screenGeneration + 1,
        controlHolder: 'none',
        controlLeaseId: null,
        controlLeaseExpiresAt: null,
        controlFence: row.controlFence + 1,
        updatedAt: Date.now(),
      })
      .where(eq(computer.id, computerId))
      .run();
    for (const channel of [...this.channels.values()])
      if (channel.request.computerId === computerId) this.revoke(channel, 'computer screen reset');
  }

  sweep(): void {
    for (const channel of [...this.channels.values()]) {
      const invalid = this.invalidReason(channel);
      if (invalid) this.revoke(channel, invalid);
      else if (
        (!channel.machine || !channel.viewer) &&
        Date.now() - channel.openedAt >= PAIR_TIMEOUT_MS
      )
        this.revoke(channel, `${channel.machine ? 'viewer' : 'machine'} never connected`);
    }
    const expired = this.deps.db
      .select()
      .from(computer)
      .all()
      .filter(
        (row) =>
          row.controlHolder === 'user' &&
          row.controlLeaseExpiresAt !== null &&
          row.controlLeaseExpiresAt <= Date.now(),
      );
    for (const row of expired) {
      this.deps.db
        .update(computer)
        .set({
          controlHolder: 'none',
          controlLeaseId: null,
          controlLeaseExpiresAt: null,
          controlFence: row.controlFence + 1,
          updatedAt: Date.now(),
        })
        .where(eq(computer.id, row.id))
        .run();
    }
  }

  attach(server: UpgradeServer): void {
    if (this.servers.has(server)) return;
    const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
      let url: URL;
      try {
        url = new URL(request.url ?? '/', 'http://screen.invalid');
      } catch {
        socket.destroy();
        return;
      }
      const path = screenUpgradePath(url.pathname);
      if (path === null || path.gateway !== 'computer') {
        if (path === null) socket.destroy();
        return;
      }
      const viewer = path.side === 'viewer';
      const channel = this.channels.get(path.channelId);
      let authorized =
        url.search === '' && channel !== undefined && this.invalidReason(channel) === undefined;
      if (authorized && channel) {
        if (viewer) {
          const protocols = (request.headers['sec-websocket-protocol'] ?? '')
            .split(',')
            .map((value) => value.trim());
          const caps = protocols.filter((value) => value.startsWith(CAP_PROTOCOL_PREFIX));
          authorized =
            !channel.viewerUsed &&
            this.sameOrigin(request) &&
            caps.length === 1 &&
            this.viewerToken(caps[0]?.slice(CAP_PROTOCOL_PREFIX.length) ?? null, channel);
        } else {
          const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
          const owner = token ? findMachineByToken(this.deps.db, token) : undefined;
          authorized =
            !channel.machineUsed &&
            owner?.id === channel.machineId &&
            owner.teamId === channel.teamId;
          if (authorized && owner?.tokenHash) channel.machineTokenHash = owner.tokenHash;
        }
      }
      if (!authorized || !channel) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      if (viewer) channel.viewerUsed = true;
      else channel.machineUsed = true;
      try {
        this.sockets.handleUpgrade(request, socket, head, (websocket) => {
          const invalid = this.invalidReason(channel);
          if (invalid) {
            websocket.terminate();
            this.revoke(channel, invalid);
            return;
          }
          const side = viewer ? 'viewer' : 'machine';
          const stream = createWebSocketStream(websocket);
          channel.streams.push(stream);
          stream.once('error', (error) =>
            this.revoke(channel, `${side} stream failed (${error.message})`),
          );
          if (viewer) {
            channel.viewer = websocket;
            channel.viewerStream = stream;
          } else {
            channel.machine = websocket;
            channel.machineStream = stream;
          }
          websocket.once('close', (code, reason) =>
            this.revoke(
              channel,
              `${side} closed (code ${code}${reason.length > 0 ? `, ${reason.toString()}` : ''})`,
            ),
          );
          websocket.once('error', (error) =>
            this.revoke(channel, `${side} websocket failed (${error.message})`),
          );
          this.pair(channel);
        });
      } catch {
        this.revoke(channel, 'upgrade failed');
        socket.destroy();
      }
    };
    server.on('upgrade', upgrade);
    this.servers.set(server, upgrade);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.offDisconnect();
    for (const channel of [...this.channels.values()]) this.revoke(channel, 'server shutting down');
    for (const row of this.deps.db.select().from(computer).all()) {
      if (row.controlHolder === 'user') this.invalidateComputer(row.id);
    }
    for (const [server, listener] of this.servers) server.off('upgrade', listener);
    this.servers.clear();
    this.sockets.close();
  }

  private invalidReason(channel: Channel): string | undefined {
    if (this.closed) return 'server shutting down';
    if (!this.channels.has(channel.request.id)) return 'channel closed';
    if (channel.request.expiresAt <= Date.now()) return 'channel expired';
    if (!this.deps.machineHub.isConnected(channel.machineId)) return 'machine disconnected';
    if (channel.machineTokenHash !== undefined) {
      const owner = this.deps.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, channel.machineId))
        .get();
      if (!owner || owner.teamId !== channel.teamId || owner.tokenHash !== channel.machineTokenHash)
        return 'machine credentials changed';
    }
    const row = ownedPrivateComputer(
      this.deps.db,
      channel.teamId,
      channel.userId,
      channel.request.computerId,
    );
    if (
      row === undefined ||
      row.teamId !== channel.teamId ||
      row.machineId !== channel.machineId ||
      row.scopeKey !== channel.request.scopeKey
    )
      return 'computer moved or removed';
    if (row.screenGeneration !== channel.request.generation) return 'computer screen reset';
    if (
      channel.request.kind !== 'view' &&
      (row.controlFence !== channel.request.controlFence ||
        !hasComputerControl(row, channel.request.controlLeaseId ?? undefined))
    )
      return 'control lease lost';
    return undefined;
  }

  private sameOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (!origin || !host) return false;
    try {
      const scheme =
        request.socket instanceof TLSSocket && request.socket.encrypted ? 'https' : 'http';
      const remoteAddress = request.socket.remoteAddress ?? '';
      const expected = forwardedOrigin({
        url: `${scheme}://${host}/`,
        trustedProxy:
          remoteAddress !== '' && isTrustedProxyAddress(remoteAddress, this.deps.trustedProxies),
        proto:
          typeof request.headers['x-forwarded-proto'] === 'string'
            ? request.headers['x-forwarded-proto']
            : undefined,
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

  private viewerToken(token: string | null, channel: Channel): boolean {
    if (!token || token.length > 8192 || !/^[a-zA-Z0-9_-]+$/.test(token)) return false;
    try {
      const encoded = Buffer.from(token, 'base64url');
      if (encoded.toString('base64url') !== token) return false;
      const envelope = encoded.toString();
      const body = envelope.slice(envelope.indexOf(':') + 1);
      if (
        !/^[A-Za-z0-9+/]+={0,2}$/.test(body) ||
        Buffer.from(body, 'base64').toString('base64') !== body
      )
        return false;
      const plaintext = this.deps.secretBox.open(envelope);
      const parsed = viewerCapabilitySchema.safeParse(JSON.parse(plaintext));
      return (
        parsed.success && JSON.stringify(parsed.data.channel) === JSON.stringify(channel.request)
      );
    } catch {
      return false;
    }
  }

  private pair(channel: Channel): void {
    if (!channel.viewerStream || !channel.machineStream) return;
    channel.viewerStream.pipe(channel.machineStream).pipe(channel.viewerStream);
  }

  private revoke(channel: Channel, reason: string): void {
    if (!this.channels.delete(channel.request.id)) return;
    console.info('computer screen closed', {
      channel: channel.request.id.slice(0, 8),
      computerId: channel.request.computerId,
      kind: channel.request.kind,
      reason,
      openMs: Date.now() - channel.openedAt,
      viewerBufferedBytes:
        (channel.viewer?.bufferedAmount ?? 0) + (channel.viewerStream?.writableLength ?? 0),
      machineBufferedBytes:
        (channel.machine?.bufferedAmount ?? 0) + (channel.machineStream?.writableLength ?? 0),
    });
    channel.unbindDevice();
    for (const stream of channel.streams) stream.destroy();
    channel.viewer?.terminate();
    channel.machine?.terminate();
  }
}
