import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import {
  claudeRateLimitReportSchema,
  type MachineDoneBody,
  machineDoneBodySchema,
  normalizeClaudeResetsAt,
} from '@cairn/shared';
import { z } from 'zod';
import { type MachineApi, MachineApiError } from '../machine-client.js';
import { writePrivateFile } from '../private-fs.js';
import { deliverOrbBundle, type OrbLocalDelivery } from './delivery.js';
import {
  decodeOrbFrame,
  encodeOrbFrame,
  ORB_MAX_FRAME_BYTES,
  ORB_RELAY_METHODS,
  ORB_STEP_METHODS,
  type OrbFrame,
  type OrbStepInput,
  type OrbStepMethod,
  orbBundleArgsSchema,
  orbWorkerFrameSchema,
} from './protocol.js';

const callSchema = z
  .object({
    type: z.literal('call'),
    id: z.number().int().nonnegative(),
    method: z.string(),
    args: z.array(z.unknown()),
    cancellable: z.boolean().optional(),
  })
  .strict();

export class RelayMachineError extends MachineApiError {
  constructor(message: string) {
    super(403, message);
    this.name = 'RelayMachineError';
  }
}

export class RelayMachineServer {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly uploads = new Set<string>();
  private readonly requests = new Map<Socket, Map<number, AbortController>>();
  private closing: Promise<void> | undefined;
  private reporting: Promise<unknown> | undefined;
  private completed = false;
  private delivery: Promise<void> | undefined;
  private ownsSocket = false;
  private connected = false;
  private readonly authenticated = new Set<Socket>();
  private readonly token = randomBytes(32).toString('hex');
  private lastRateLimitAt: number | undefined;

  constructor(
    private readonly options: {
      socketPath: string;
      stepId: string;
      machineId?: string;
      upstream: MachineApi;
      localDelivery?: OrbLocalDelivery;
      input?: OrbStepInput | (() => OrbStepInput);
      onFrame?: (frame: OrbFrame) => void;
      onActivity?: () => void;
      onReporting?: (body: MachineDoneBody) => void;
      onDone?: () => void;
      onDisconnect?: () => void;
    },
  ) {
    this.server = createServer((socket) => {
      socket.on('error', () => {});
      if (this.connected) {
        socket.destroy();
        return;
      }
      this.sockets.add(socket);
      const requests = new Map<number, AbortController>();
      this.requests.set(socket, requests);
      let buffer = Buffer.allocUnsafe(1024);
      let size = 0;
      const authTimeout = setTimeout(() => socket.destroy(), 5_000);
      authTimeout.unref();
      socket.on('data', (chunk: Buffer) => {
        let start = 0;
        while (start < chunk.length && !socket.destroyed) {
          const end = chunk.indexOf(10, start);
          const part = chunk.subarray(start, end < 0 ? chunk.length : end);
          size += part.length;
          if (size > buffer.length) {
            socket.destroy();
            return;
          }
          part.copy(buffer, size - part.length);
          if (end < 0) return;
          const frame = decodeOrbFrame(buffer.toString('utf8', 0, size));
          size = 0;
          start = end + 1;
          if (!this.authenticated.has(socket)) {
            const auth = z
              .object({ type: z.literal('auth'), token: z.string().regex(/^[a-f0-9]{64}$/) })
              .strict()
              .safeParse(frame);
            if (
              !auth.success ||
              this.connected ||
              !timingSafeEqual(Buffer.from(auth.data.token), Buffer.from(this.token))
            ) {
              socket.destroy();
              return;
            }
            clearTimeout(authTimeout);
            this.connected = true;
            this.authenticated.add(socket);
            buffer = Buffer.allocUnsafe(ORB_MAX_FRAME_BYTES);
            this.write(socket, encodeOrbFrame({ type: 'authenticated' }));
            if (options.input)
              this.write(
                socket,
                encodeOrbFrame({
                  type: 'init',
                  input: typeof options.input === 'function' ? options.input() : options.input,
                }),
              );
            continue;
          }
          if (frame?.type === 'call') {
            void this.receive(socket, frame);
            continue;
          }
          const parsed = orbWorkerFrameSchema.safeParse(frame);
          if (!parsed.success) {
            socket.destroy();
            return;
          }
          if (parsed.data.type === 'cancel') requests.get(parsed.data.id)?.abort();
          else this.options.onFrame?.(parsed.data);
        }
      });
      socket.on('close', () => {
        clearTimeout(authTimeout);
        if (this.authenticated.delete(socket)) this.options.onDisconnect?.();
        for (const request of requests.values()) request.abort();
        this.requests.delete(socket);
        this.sockets.delete(socket);
        buffer = Buffer.alloc(0);
      });
    });
  }

  async listen(): Promise<void> {
    mkdirSync(dirname(this.options.socketPath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.options.socketPath), 0o700);
    if (existsSync(this.options.socketPath)) {
      if (!lstatSync(this.options.socketPath).isSocket())
        throw new RelayMachineError('Relay path is not a socket');
      await new Promise<void>((resolve, reject) => {
        const probe = createConnection(this.options.socketPath);
        probe.once('connect', () => {
          probe.destroy();
          reject(new RelayMachineError('Relay socket already has a live listener'));
        });
        probe.once('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'ECONNREFUSED') resolve();
          else reject(error);
        });
      });
      rmSync(this.options.socketPath);
    }
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.socketPath, () => {
        this.server.removeListener('error', reject);
        this.ownsSocket = true;
        resolve();
      });
    });
    chmodSync(this.options.socketPath, 0o600);
    writePrivateFile(`${this.options.socketPath}.token`, this.token);
  }

  send(frame: OrbFrame): void {
    for (const socket of this.authenticated) this.write(socket, encodeOrbFrame(frame));
  }

  get isComplete(): boolean {
    return this.completed;
  }

  private write(socket: Socket, data: string): void {
    if (socket.destroyed) return;
    if (socket.writableLength + Buffer.byteLength(data) > ORB_MAX_FRAME_BYTES) {
      socket.destroy();
      return;
    }
    socket.write(data);
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      for (const socket of this.sockets) socket.destroy();
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
      if (this.reporting) await this.reporting.catch(() => {});
      if (this.delivery) await this.delivery.catch(() => {});
      if (this.ownsSocket) {
        rmSync(this.options.socketPath, { force: true });
        rmSync(`${this.options.socketPath}.token`, { force: true });
      }
    })();
    return this.closing;
  }

  private async receive(socket: Socket, raw: unknown): Promise<void> {
    const parsed = callSchema.safeParse(raw);
    if (!parsed.success) {
      socket.destroy();
      return;
    }
    const { id, method, args, cancellable } = parsed.data;
    const controller = new AbortController();
    this.requests.get(socket)?.set(id, controller);
    let report: Promise<unknown> | undefined;
    try {
      if (!(ORB_RELAY_METHODS as readonly string[]).includes(method))
        throw new RelayMachineError('Relay method is forbidden');
      if (
        !['putUpload', 'reportClaudeRateLimit'].includes(method) &&
        args[0] !== this.options.stepId
      )
        throw new RelayMachineError('Relay step does not match claim');
      if (method === 'putUpload' && !this.uploads.has(String(args[0])))
        throw new RelayMachineError('Relay upload URL was not issued for this step');
      if (method === 'reportClaudeRateLimit') {
        const parsed = claudeRateLimitReportSchema.safeParse(args[0]);
        if (!parsed.success || !this.options.machineId)
          throw new RelayMachineError('Invalid relay rate-limit report');
        const now = Date.now();
        if (this.lastRateLimitAt !== undefined && now - this.lastRateLimitAt < 30_000)
          throw new RelayMachineError('Relay rate-limit report throttled');
        this.lastRateLimitAt = now;
        const resetsAt = normalizeClaudeResetsAt(parsed.data.resetsAt);
        args[0] = {
          ...parsed.data,
          machineId: this.options.machineId,
          ...(resetsAt !== null ? { resetsAt: Math.min(resetsAt, now + 8 * 86_400_000) } : {}),
        };
      }
      if (this.completed) throw new RelayMachineError('Relay step is complete');
      if (method === 'deliverBundle') {
        const bundleArgs = orbBundleArgsSchema.safeParse(args);
        if (!bundleArgs.success || cancellable !== undefined || !this.options.localDelivery)
          throw new RelayMachineError('Invalid local bundle delivery call');
        if (this.delivery || this.reporting)
          throw new RelayMachineError('Bundle delivery or completion is already in flight');
        this.options.onActivity?.();
        const delivery = deliverOrbBundle(this.options.localDelivery, bundleArgs.data[1]);
        this.delivery = delivery;
        try {
          await delivery;
          this.write(socket, encodeOrbFrame({ type: 'reply', id }));
        } finally {
          this.delivery = undefined;
        }
        return;
      }
      if (method === 'done' && this.delivery) await this.delivery;
      const operation = this.options.upstream[method as (typeof ORB_STEP_METHODS)[number]];
      if (typeof operation !== 'function')
        throw new RelayMachineError('Relay method is unavailable');
      if (cancellable && (method === 'relayTool' || method === 'askUser')) {
        const index = method === 'relayTool' ? 3 : 2;
        args[index] = { ...(args[index] as object), signal: controller.signal };
      }
      if (method === 'done') {
        if (this.reporting) throw new RelayMachineError('Relay completion is already in flight');
        const body = machineDoneBodySchema.safeParse(args[1]);
        if (!body.success) throw new RelayMachineError('Invalid relay done body');
        args[1] = body.data;
        this.options.onReporting?.(body.data);
      }
      this.options.onActivity?.();
      const result = Promise.resolve(Reflect.apply(operation, this.options.upstream, args));
      if (method === 'done') {
        report = result;
        this.reporting = result;
      }
      const value: unknown = await result;
      if (method === 'done') {
        this.completed = true;
        this.options.onDone?.();
      }
      if (method === 'uploadUrls') {
        for (const upload of (value as Awaited<ReturnType<MachineApi['uploadUrls']>>).uploads)
          this.uploads.add(upload.url);
      }
      this.write(socket, encodeOrbFrame({ type: 'reply', id, value }));
    } catch (error) {
      if (report && this.reporting === report) this.reporting = undefined;
      if (!socket.destroyed)
        this.write(
          socket,
          encodeOrbFrame({
            type: 'reply',
            id,
            error: error instanceof Error ? error.message : String(error),
            ...(error instanceof MachineApiError ? { status: error.status, body: error.body } : {}),
            ...(error instanceof RelayMachineError ? { forbidden: true } : {}),
          }),
        );
    } finally {
      this.requests.get(socket)?.delete(id);
    }
  }
}

export class RelayMachineApi {
  readonly api: MachineApi;
  readonly input: Promise<OrbStepInput>;
  private readonly authentication: Promise<void>;
  private nextId = 0;
  private available: readonly string[] = ORB_STEP_METHODS;
  private disconnected = false;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly socket: Socket;
  private constructor(
    socketPath: string,
    token: string,
    onFrame?: (frame: OrbFrame) => void,
    onClose?: () => void,
  ) {
    this.socket = createConnection(socketPath);
    this.socket.once('connect', () => this.send({ type: 'auth', token }));
    let authenticated: () => void = () => {};
    let rejectAuthentication: (error: Error) => void = () => {};
    this.authentication = new Promise((resolve, reject) => {
      authenticated = resolve;
      rejectAuthentication = reject;
    });
    void this.authentication.catch(() => {});
    let resolveInput: (value: OrbStepInput) => void = () => {};
    let rejectInput: (error: Error) => void = () => {};
    this.input = new Promise((resolve, reject) => {
      resolveInput = resolve;
      rejectInput = reject;
    });
    void this.input.catch(() => {});
    const lines = createInterface({ input: this.socket });
    lines.on('line', (line) => {
      const frame = decodeOrbFrame(line);
      if (!frame) return;
      if (frame.type === 'authenticated') {
        authenticated();
      } else if (frame.type === 'init') {
        this.available = frame.input.methods;
        resolveInput(frame.input);
      } else if (frame.type === 'reply') {
        const pending = this.pending.get(frame.id);
        this.pending.delete(frame.id);
        if (frame.error)
          pending?.reject(
            frame.forbidden
              ? new RelayMachineError(frame.body ?? frame.error)
              : frame.status !== undefined
                ? new MachineApiError(frame.status, frame.body ?? frame.error)
                : new Error(frame.error),
          );
        else pending?.resolve(frame.value);
      } else onFrame?.(frame);
    });
    const closed = () => {
      if (this.disconnected) return;
      this.disconnected = true;
      const error = new MachineApiError(410, 'Orb relay connection closed');
      rejectInput(error);
      rejectAuthentication(error);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      lines.close();
      onClose?.();
    };
    lines.on('error', closed);
    this.socket.on('error', closed);
    this.socket.on('close', closed);
    this.api = new Proxy(
      {},
      {
        get: (_target, method: string) => {
          if (!this.available.includes(method)) return undefined;
          return (...args: unknown[]) => this.call(method, args);
        },
      },
    ) as MachineApi;
  }

  static async connect(
    socketPath: string,
    onFrame?: (frame: OrbFrame) => void,
    onClose?: () => void,
  ): Promise<RelayMachineApi> {
    const token = readFileSync(`${socketPath}.token`, 'utf8');
    const client = new RelayMachineApi(socketPath, token, onFrame, onClose);
    await client.authentication;
    return client;
  }

  async call(method: string, args: unknown[]): Promise<unknown> {
    if (this.disconnected || this.socket.destroyed || this.socket.writableEnded)
      throw new MachineApiError(410, 'Orb relay connection closed');
    const id = this.nextId++;
    const index = method === 'relayTool' ? 3 : method === 'askUser' ? 2 : -1;
    const signal =
      index >= 0 ? (args[index] as { signal?: AbortSignal } | undefined)?.signal : undefined;
    signal?.throwIfAborted();
    const cancel = () => {
      this.send({ type: 'cancel', id });
      this.pending.get(id)?.reject(new Error('Orb relay request aborted'));
      this.pending.delete(id);
    };
    const response = new Promise<unknown>((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
    this.send({
      type: 'call',
      id,
      method: method as OrbStepMethod,
      args,
      ...(signal ? { cancellable: true } : {}),
    });
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const result = await response;
      return method === 'skillFile' ? Buffer.from((result as { data: number[] }).data) : result;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  send(frame: OrbFrame): void {
    if (!this.socket.destroyed && !this.socket.writableEnded)
      this.socket.write(encodeOrbFrame(frame));
  }

  close(): void {
    this.socket.end();
  }
}
