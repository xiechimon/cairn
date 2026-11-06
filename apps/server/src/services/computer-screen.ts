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
import { computer, machine as machineTable } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { forwardedOrigin } from '../lib/forwarded-origin.js';
import { ownedPrivateComputer } from './computer-access.js';
import {
  acquireComputerControl,
  hasComputerControl,
  ownedComputer,
  releaseComputerControl,
  renewComputerControl,
} from './computer-control.js';
import { findMachineByToken } from './machines.js';
import { deviceStreams } from './paired-devices.js';

const MAX_CHANNELS = 128;
const MAX_COMPUTER_CHANNELS = 8;
const PAIR_TIMEOUT_MS = 15_000;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
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

type ScreenDependencies = Pick<AppContext, 'db' | 'machineHub' | 'secretBox'>;
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
        this.revoke(channel);
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
    const request: ComputerScreenRequest = computerScreenRequestSchema.parse({
      id: randomBytes(32).toString('hex'),
      computerId,
      scopeKey: row.scopeKey,
      kind,
      generation: row.screenGeneration,
      controlLeaseId: kind === 'view' ? null : (leaseId ?? null),
      controlFence: row.controlFence,
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
    };
    this.channels.set(request.id, channel);
    deviceStreams.bind(deviceId, () => this.revoke(channel));
    if (!this.deps.machineHub.pushComputerScreen(row.machineId, request)) {
      this.revoke(channel);
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
      if (channel.request.computerId === computerId) this.revoke(channel);
  }

  sweep(): void {
    for (const channel of [...this.channels.values()]) {
      if (
        !this.valid(channel) ||
        ((!channel.machine || !channel.viewer) && Date.now() - channel.openedAt >= PAIR_TIMEOUT_MS)
      )
        this.revoke(channel);
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
      const viewer = /^\/api\/computer-screen\/([a-f0-9]{64})$/.exec(url.pathname);
      const machine = /^\/api\/machine\/computer-screen\/([a-f0-9]{64})$/.exec(url.pathname);
      if (!viewer && !machine) {
        socket.destroy();
        return;
      }
      const channel = this.channels.get((viewer ?? machine)?.[1] ?? '');
      let authorized = url.search === '' && channel !== undefined && this.valid(channel);
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
          if (!this.valid(channel)) {
            websocket.terminate();
            this.revoke(channel);
            return;
          }
          const stream = createWebSocketStream(websocket);
          channel.streams.push(stream);
          stream.once('error', () => this.revoke(channel));
          if (viewer) {
            channel.viewer = websocket;
            channel.viewerStream = stream;
          } else {
            channel.machine = websocket;
            channel.machineStream = stream;
          }
          websocket.once('close', () => this.revoke(channel));
          websocket.once('error', () => this.revoke(channel));
          this.pair(channel);
        });
      } catch {
        this.revoke(channel);
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
    for (const channel of [...this.channels.values()]) this.revoke(channel);
    for (const row of this.deps.db.select().from(computer).all()) {
      if (row.controlHolder === 'user') this.invalidateComputer(row.id);
    }
    for (const [server, listener] of this.servers) server.off('upgrade', listener);
    this.servers.clear();
    this.sockets.close();
  }

  private valid(channel: Channel): boolean {
    if (
      this.closed ||
      !this.channels.has(channel.request.id) ||
      channel.request.expiresAt <= Date.now() ||
      !this.deps.machineHub.isConnected(channel.machineId)
    )
      return false;
    if (channel.machineTokenHash !== undefined) {
      const owner = this.deps.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, channel.machineId))
        .get();
      if (!owner || owner.teamId !== channel.teamId || owner.tokenHash !== channel.machineTokenHash)
        return false;
    }
    const row = ownedPrivateComputer(
      this.deps.db,
      channel.teamId,
      channel.userId,
      channel.request.computerId,
    );
    return (
      row !== undefined &&
      row.teamId === channel.teamId &&
      row.machineId === channel.machineId &&
      row.scopeKey === channel.request.scopeKey &&
      row.screenGeneration === channel.request.generation &&
      (channel.request.kind === 'view' ||
        (row.controlFence === channel.request.controlFence &&
          hasComputerControl(row, channel.request.controlLeaseId ?? undefined)))
    );
  }

  private sameOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (!origin || !host) return false;
    try {
      const scheme =
        request.socket instanceof TLSSocket && request.socket.encrypted ? 'https' : 'http';
      const expected = forwardedOrigin({
        url: `${scheme}://${host}/`,
        loopbackPeer: LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? ''),
        proto:
          typeof request.headers['x-forwarded-proto'] === 'string'
            ? request.headers['x-forwarded-proto']
            : undefined,
        host:
          typeof request.headers['x-forwarded-host'] === 'string'
            ? request.headers['x-forwarded-host']
            : undefined,
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

  private revoke(channel: Channel): void {
    if (!this.channels.delete(channel.request.id)) return;
    for (const stream of channel.streams) stream.destroy();
    channel.viewer?.terminate();
    channel.machine?.terminate();
  }
}
