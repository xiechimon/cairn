import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { TLSSocket } from 'node:tls';
import {
  ENGINE_SCREEN_CAP_TTL_MS,
  ENGINE_SCREEN_MAX_FRAME_BYTES,
  ENGINE_TAKEOVER_LEASE_MS,
  type EngineScreenRequest,
  type EngineTakeoverLease,
  engineScreenRequestSchema,
  type OpenEngineScreen,
  openEngineScreenSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { createWebSocketStream, type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { build, chiefThread, machine as machineTable, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { forwardedOrigin } from '../lib/forwarded-origin.js';
import { newRecordId } from '../lib/ids.js';
import { findMachineByToken } from './machines.js';
import { assertDeviceActive, deviceStreams } from './paired-devices.js';

const MAX_CHANNELS = 128;
const MAX_STEP_CHANNELS = 8;
const PAIR_TIMEOUT_MS = 15_000;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const CAP_PROTOCOL_PREFIX = 'cairn-escreen.';
const CAP_PURPOSE = 'cairn-engine-screen-v1';
const viewerCapabilitySchema = z
  .object({ purpose: z.literal(CAP_PURPOSE), channel: engineScreenRequestSchema })
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

type ScreenDependencies = Pick<AppContext, 'db' | 'machineHub' | 'secretBox' | 'hub'>;

interface EngineStepRow {
  id: string;
  buildId: string;
  status: string;
  machineId: string | null;
}

interface EngineLease {
  leaseId: string;
  fence: number;
  expiresAt: number;
  teamId: string;
  userId: string;
  machineId: string;
}

interface Channel {
  request: EngineScreenRequest;
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

const gateways = new WeakMap<ScreenDependencies['machineHub'], EngineScreenGateway>();

export function engineScreensOf(deps: ScreenDependencies): EngineScreenGateway {
  let gateway = gateways.get(deps.machineHub);
  if (!gateway) {
    gateway = new EngineScreenGateway(deps);
    gateways.set(deps.machineHub, gateway);
  }
  return gateway;
}

export class EngineScreenGateway {
  private readonly channels = new Map<string, Channel>();
  private readonly leases = new Map<string, EngineLease>();
  private readonly generations = new Map<string, number>();
  private readonly servers = new Map<
    UpgradeServer,
    (request: IncomingMessage, socket: Duplex, head: Buffer) => void
  >();
  private readonly sockets = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: ENGINE_SCREEN_MAX_FRAME_BYTES,
    handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
  });
  private readonly timer: NodeJS.Timeout;
  private readonly offDisconnect: () => void;
  private closed = false;

  constructor(private readonly deps: ScreenDependencies) {
    this.timer = setInterval(() => this.sweep(), 250);
    this.timer.unref();
    this.offDisconnect = deps.machineHub.onDisconnect((machineId) => {
      for (const channel of [...this.channels.values()]) {
        if (channel.machineId === machineId) this.revoke(channel, 'machine disconnected');
      }
      for (const [stepId, lease] of [...this.leases.entries()]) {
        if (lease.machineId === machineId) this.dropLease(stepId, lease.leaseId);
      }
    });
  }

  acquireTakeover(teamId: string, userId: string, stepId: string): EngineTakeoverLease {
    const row = this.ownedStep(teamId, userId, stepId);
    if (row.status !== 'claimed' || row.machineId === null)
      throw new HttpError(409, 'the engine run is not live');
    if (!this.deps.machineHub.isConnected(row.machineId))
      throw new HttpError(409, 'the machine is not connected');
    const capabilities = this.deps.db
      .select({ capabilities: machineTable.capabilities })
      .from(machineTable)
      .where(eq(machineTable.id, row.machineId))
      .get()?.capabilities?.enginePty;
    if (capabilities !== true) throw new HttpError(409, 'the engine run cannot be taken over');
    const now = Date.now();
    const lease: EngineLease = {
      leaseId: newRecordId(),
      fence: (this.leases.get(stepId)?.fence ?? 0) + 1,
      expiresAt: now + ENGINE_TAKEOVER_LEASE_MS,
      teamId,
      userId,
      machineId: row.machineId,
    };
    this.leases.set(stepId, lease);
    this.publishLease(stepId, lease, true);
    for (const channel of [...this.channels.values()]) {
      if (
        channel.request.stepId === stepId &&
        channel.request.kind === 'takeover' &&
        channel.request.takeoverLeaseId !== lease.leaseId
      )
        this.revoke(channel, 'takeover lease lost');
    }
    return { leaseId: lease.leaseId, fence: lease.fence, expiresAt: lease.expiresAt };
  }

  renewTakeover(
    teamId: string,
    userId: string,
    stepId: string,
    leaseId: string,
  ): EngineTakeoverLease {
    this.ownedStep(teamId, userId, stepId);
    const lease = this.leases.get(stepId);
    if (lease === undefined || lease.leaseId !== leaseId || lease.expiresAt <= Date.now())
      throw new HttpError(409, 'a live takeover lease is required');
    lease.expiresAt = Math.max(lease.expiresAt, Date.now() + ENGINE_TAKEOVER_LEASE_MS);
    return { leaseId: lease.leaseId, fence: lease.fence, expiresAt: lease.expiresAt };
  }

  releaseTakeover(teamId: string, userId: string, stepId: string, leaseId: string): void {
    this.ownedStep(teamId, userId, stepId);
    const lease = this.leases.get(stepId);
    if (lease === undefined) return;
    if (lease.leaseId !== leaseId)
      throw new HttpError(409, 'a matching takeover lease is required');
    this.dropLease(stepId, lease.leaseId);
  }

  open(
    teamId: string,
    userId: string,
    stepId: string,
    input: OpenEngineScreen,
    deviceId: string | null = null,
  ) {
    if (this.closed) throw new HttpError(503, 'engine screen gateway is closed');
    assertDeviceActive(deviceId);
    const parsed = openEngineScreenSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'invalid engine screen request');
    const { kind, leaseId, fromSeq } = parsed.data;
    const row = this.ownedStep(teamId, userId, stepId);
    this.sweep();
    if (row.status !== 'claimed' || row.machineId === null)
      throw new HttpError(409, 'the engine run is not live');
    if (!this.deps.machineHub.isConnected(row.machineId))
      throw new HttpError(409, 'the machine is not connected');
    const lease = this.leases.get(stepId);
    if (
      kind === 'takeover' &&
      (lease === undefined ||
        lease.leaseId !== leaseId ||
        lease.userId !== userId ||
        lease.expiresAt <= Date.now())
    )
      throw new HttpError(409, 'a live takeover lease is required');
    if (
      this.channels.size >= MAX_CHANNELS ||
      [...this.channels.values()].filter((channel) => channel.request.stepId === stepId).length >=
        MAX_STEP_CHANNELS
    )
      throw new HttpError(429, 'too many engine screen channels');
    const now = Date.now();
    const request: EngineScreenRequest = engineScreenRequestSchema.parse({
      id: randomBytes(32).toString('hex'),
      stepId,
      buildId: row.buildId,
      generation: this.generations.get(stepId) ?? 0,
      kind,
      takeoverLeaseId: kind === 'view' ? null : (leaseId ?? null),
      takeoverFence: lease?.fence ?? 0,
      fromSeq: fromSeq ?? 0,
      expiresAt: Math.min(
        now + ENGINE_SCREEN_CAP_TTL_MS,
        kind === 'view' ? Number.POSITIVE_INFINITY : (lease?.expiresAt ?? now),
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
    channel.unbindDevice = deviceStreams.bind(deviceId, () =>
      this.revoke(channel, 'device revoked'),
    );
    if (!this.deps.machineHub.pushEngineScreen(row.machineId, request)) {
      this.revoke(channel, 'machine not connected');
      throw new HttpError(409, 'the machine is not connected');
    }
    const token = Buffer.from(
      this.deps.secretBox.seal(JSON.stringify({ purpose: CAP_PURPOSE, channel: request })),
    ).toString('base64url');
    return {
      path: `/api/engine-screen/${request.id}`,
      wsProtocols: ['binary', `${CAP_PROTOCOL_PREFIX}${token}`],
      kind,
      expiresAt: request.expiresAt,
      generation: request.generation,
    };
  }

  invalidateStep(stepId: string): void {
    this.generations.set(stepId, (this.generations.get(stepId) ?? 0) + 1);
    for (const channel of [...this.channels.values()]) {
      if (channel.request.stepId === stepId) this.revoke(channel, 'engine run reset');
    }
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
    const now = Date.now();
    for (const [stepId, lease] of [...this.leases.entries()]) {
      if (lease.expiresAt <= now) this.dropLease(stepId, lease.leaseId);
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
      const viewer = /^\/api\/engine-screen\/([a-f0-9]{64})$/.exec(url.pathname);
      const machine = /^\/api\/machine\/engine-screen\/([a-f0-9]{64})$/.exec(url.pathname);
      if (!viewer && !machine) {
        socket.destroy();
        return;
      }
      const channel = this.channels.get((viewer ?? machine)?.[1] ?? '');
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
    for (const [stepId, lease] of [...this.leases.entries()]) {
      this.dropLease(stepId, lease.leaseId);
    }
    for (const [server, listener] of this.servers) server.off('upgrade', listener);
    this.servers.clear();
    this.sockets.close();
  }

  private ownedStep(teamId: string, userId: string, stepId: string): EngineStepRow {
    const row = this.deps.db
      .select({
        id: step.id,
        buildId: step.buildId,
        status: step.status,
        machineId: step.machineId,
        todoTeamId: todo.teamId,
        threadTeamId: chiefThread.teamId,
        threadUserId: chiefThread.userId,
      })
      .from(step)
      .leftJoin(build, eq(build.id, step.buildId))
      .leftJoin(todo, eq(todo.id, build.todoId))
      .leftJoin(chiefThread, eq(chiefThread.id, step.buildId))
      .where(eq(step.id, stepId))
      .get();
    const owned =
      row !== undefined &&
      (row.todoTeamId === teamId || (row.threadTeamId === teamId && row.threadUserId === userId));
    if (!owned) throw new HttpError(404, 'engine run not found');
    return row;
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
    let live: EngineStepRow;
    try {
      live = this.ownedStep(channel.teamId, channel.userId, channel.request.stepId);
    } catch {
      return 'engine run removed';
    }
    if (live.status !== 'claimed') return 'engine run ended';
    if (live.machineId !== channel.machineId) return 'engine run moved';
    if ((this.generations.get(channel.request.stepId) ?? 0) !== channel.request.generation)
      return 'engine run reset';
    if (channel.request.kind === 'takeover') {
      const lease = this.leases.get(channel.request.stepId);
      if (
        lease === undefined ||
        lease.leaseId !== channel.request.takeoverLeaseId ||
        lease.fence !== channel.request.takeoverFence
      )
        return 'takeover lease lost';
    }
    return undefined;
  }

  private dropLease(stepId: string, leaseId: string): void {
    const lease = this.leases.get(stepId);
    if (lease === undefined || lease.leaseId !== leaseId) return;
    this.leases.delete(stepId);
    for (const channel of [...this.channels.values()]) {
      if (channel.request.stepId === stepId && channel.request.kind === 'takeover')
        this.revoke(channel, 'takeover lease lost');
    }
    this.publishLease(stepId, lease, false);
  }

  private publishLease(stepId: string, lease: EngineLease, held: boolean): void {
    this.deps.hub.publishPrivate(lease.teamId, lease.userId, () => ({
      type: 'engine.lease',
      stepId,
      held,
    }));
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

  private revoke(channel: Channel, reason: string): void {
    if (!this.channels.delete(channel.request.id)) return;
    console.info('engine screen closed', {
      channel: channel.request.id.slice(0, 8),
      stepId: channel.request.stepId,
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
    if (channel.request.kind === 'takeover' && channel.request.takeoverLeaseId !== null) {
      this.dropLease(channel.request.stepId, channel.request.takeoverLeaseId);
    }
  }
}
