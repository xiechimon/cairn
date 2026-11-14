import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { ComputerOrbs } from '../orb/computer.js';
import { ORB_MAX_FRAME_BYTES } from '../orb/protocol.js';
import { AsyncEventQueue } from './host.js';
import type { ComputerInputFence, ComputerInputLease } from './input-fence.js';
import {
  decodeOrbComputerFrame,
  encodeOrbComputerFrame,
  frameFits,
  ORB_COMPUTER_AUTH_LINE_MAX_BYTES,
  ORB_COMPUTER_SOCKET,
  type OrbComputerRequest,
  orbComputerAuthSchema,
  orbComputerEventSchema,
  orbComputerFileEntriesSchema,
  orbComputerGuestFrameSchema,
  readOrbComputerLines,
  writeOrbComputerFrame,
} from './orb-protocol.js';
import {
  type ComputerExecuteRequest,
  type ComputerFileEntry,
  type ComputerFileOptions,
  type ComputerProcessEvent,
  type ComputerProvider,
  ComputerRefusal,
  type ScopedComputerProviders,
} from './provider.js';

export const ORB_COMPUTER_CONNECT_TIMEOUT_MS = 90_000;
export const ORB_COMPUTER_REQUEST_TIMEOUT_MS = 60_000;
export const ORB_COMPUTER_HEARTBEAT_TIMEOUT_MS = 45_000;
export const ORB_COMPUTER_TOUCH_MS = 30_000;
export const ORB_COMPUTER_STOP_GRACE_MS = 10_000;
const AUTH_TIMEOUT_MS = 5_000;
const DEFAULT_RUNTIME_ROOT = '/run/cairn-orb';

export class ComputerTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComputerTransportError';
  }
}

type FileCall = Omit<Exclude<OrbComputerRequest, { method: 'execute' }>, 'id'>;

interface Pending {
  value(value: unknown): void;
  done(): void;
  error(error: Error): void;
}

export interface OrbComputerProviderOptions {
  orbs: Pick<ComputerOrbs, 'ensure' | 'touch'>;
  runtimeRoot?: string | (() => string);
  inputFence?: ComputerInputFence;
  expectedRelease?: () => string | undefined;
  release?: {
    publish(): Promise<string>;
    authenticated(machine: string, release: string): void;
  };
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
  touchMs?: number;
  stopGraceMs?: number;
  onError?: (message: string) => void;
}

type LinkSettings = Required<
  Pick<
    OrbComputerProviderOptions,
    'heartbeatTimeoutMs' | 'requestTimeoutMs' | 'stopGraceMs' | 'touchMs'
  >
> &
  Pick<OrbComputerProviderOptions, 'expectedRelease'> & {
    onAuthenticated?: (machine: string, release: string) => void;
  };

class GuestLink {
  private server: Server | undefined;
  private listening: Promise<void> | undefined;
  private guest: Socket | undefined;
  private lastSeen = Date.now();
  private watchdog: NodeJS.Timeout | undefined;
  private nextId = 0;
  private closed = false;
  private ownsFiles = false;
  private directoryDescriptor: number | undefined;
  private readonly pending = new Map<number, Pending>();
  private readonly waiters = new Set<() => void>();
  private readonly sockets = new Set<Socket>();
  private readonly token = randomBytes(32).toString('hex');

  constructor(
    readonly directory: string,
    private readonly settings: LinkSettings,
  ) {}

  private get socketPath(): string {
    return join(
      process.platform === 'linux' && this.directoryDescriptor !== undefined
        ? `/proc/self/fd/${this.directoryDescriptor}`
        : this.directory,
      ORB_COMPUTER_SOCKET,
    );
  }

  servesCurrentDirectory(): boolean {
    if (this.directoryDescriptor === undefined) return true;
    const current = lstatSync(this.directory, { throwIfNoEntry: false });
    const opened = fstatSync(this.directoryDescriptor);
    return current !== undefined && current.dev === opened.dev && current.ino === opened.ino;
  }

  listen(): Promise<void> {
    this.listening ??= this.startListening().catch((error: unknown) => {
      this.listening = undefined;
      throw error;
    });
    return this.listening;
  }

  private async startListening(): Promise<void> {
    const directory = lstatSync(this.directory);
    if (
      !directory.isDirectory() ||
      directory.uid !== process.getuid?.() ||
      (directory.mode & 0o7777) !== 0o700
    )
      throw new ComputerTransportError(
        'Computer runtime directory must be a 0700 directory owned by the daemon',
      );
    const descriptor = openSync(
      this.directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isDirectory() ||
      opened.dev !== directory.dev ||
      opened.ino !== directory.ino ||
      opened.uid !== process.getuid?.() ||
      (opened.mode & 0o7777) !== 0o700
    ) {
      closeSync(descriptor);
      throw new ComputerTransportError('Computer runtime directory changed before opening');
    }
    this.directoryDescriptor = descriptor;
    const paths = [this.socketPath, `${this.socketPath}.token`];
    for (const path of paths) {
      const metadata = lstatSync(path, { throwIfNoEntry: false });
      if (!metadata) continue;
      if (!metadata.isFile() && !metadata.isSocket())
        throw new ComputerTransportError('Computer socket path must be a regular file or socket');
      unlinkSync(path);
    }
    const server = createServer((socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      const mask = process.umask(0o177);
      try {
        server.listen(this.socketPath, () => {
          server.removeListener('error', reject);
          resolve();
        });
      } finally {
        process.umask(mask);
      }
    });
    if (this.closed) throw new ComputerTransportError('Computer link closed during startup');
    this.ownsFiles = true;
    const current = lstatSync(this.directory);
    if (
      !current.isDirectory() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      current.uid !== opened.uid ||
      (current.mode & 0o7777) !== 0o700
    )
      throw new ComputerTransportError('Computer runtime directory changed while opening');
    const tokenDescriptor = openSync(
      `${this.socketPath}.token`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fchmodSync(tokenDescriptor, 0o600);
      writeFileSync(tokenDescriptor, this.token);
    } finally {
      closeSync(tokenDescriptor);
    }
    this.watchdog = setInterval(
      () => this.checkHeartbeat(),
      Math.max(10, Math.floor(this.settings.heartbeatTimeoutMs / 3)),
    );
    this.watchdog.unref();
  }

  private accept(socket: Socket): void {
    socket.on('error', () => {});
    this.sockets.add(socket);
    let authenticated = false;
    let refused = false;
    const authTimer = setTimeout(() => socket.destroy(), AUTH_TIMEOUT_MS);
    authTimer.unref();
    readOrbComputerLines(
      socket,
      (line) => {
        if (refused) return;
        const frame = decodeOrbComputerFrame(line);
        if (!authenticated) {
          const auth = orbComputerAuthSchema.safeParse(frame);
          if (!auth.success || !this.tokenMatches(auth.data.token)) {
            socket.destroy();
            return;
          }
          clearTimeout(authTimer);
          const expected = this.settings.expectedRelease?.();
          if (this.settings.expectedRelease && auth.data.release !== expected) {
            refused = true;
            socket.end(encodeOrbComputerFrame({ type: 'refused', reason: 'stale-release' }));
            socket.setTimeout(1_000, () => socket.destroy());
            return;
          }
          authenticated = true;
          this.settings.onAuthenticated?.(basename(this.directory), auth.data.release);
          this.attach(socket);
          return;
        }
        this.receive(socket, frame);
      },
      () => (authenticated ? ORB_MAX_FRAME_BYTES : ORB_COMPUTER_AUTH_LINE_MAX_BYTES),
    );
    socket.on('close', () => {
      clearTimeout(authTimer);
      this.sockets.delete(socket);
      if (this.guest === socket) this.detach('The computer disconnected');
    });
  }

  private tokenMatches(candidate: string): boolean {
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(this.token));
  }

  private attach(socket: Socket): void {
    if (this.guest && this.guest !== socket) {
      const previous = this.guest;
      this.detach('The computer reconnected');
      previous.destroy();
    }
    this.guest = socket;
    this.lastSeen = Date.now();
    writeOrbComputerFrame(socket, { type: 'authenticated' });
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }

  private detach(reason: string): void {
    this.guest = undefined;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) request.error(new ComputerTransportError(reason));
  }

  private receive(socket: Socket, raw: unknown): void {
    if (this.guest !== socket) return;
    const parsed = orbComputerGuestFrameSchema.safeParse(raw);
    if (!parsed.success) {
      socket.destroy();
      return;
    }
    this.lastSeen = Date.now();
    const frame = parsed.data;
    if ('heartbeat' in frame) return;
    const request = this.pending.get(frame.id);
    if (!request) return;
    if ('value' in frame) request.value(frame.value);
    else if ('done' in frame) {
      this.pending.delete(frame.id);
      request.done();
    } else {
      this.pending.delete(frame.id);
      request.error(
        frame.refusal ? new ComputerRefusal(frame.error) : new ComputerTransportError(frame.error),
      );
    }
  }

  private checkHeartbeat(): void {
    if (
      this.guest &&
      this.pending.size > 0 &&
      Date.now() - this.lastSeen > this.settings.heartbeatTimeoutMs
    )
      this.guest.destroy();
  }

  connected(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (this.guest) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.waiters.delete(wake);
        if (error) reject(error);
        else resolve();
      };
      const wake = () => finish();
      const onAbort = () =>
        finish(new ComputerRefusal('The call was cancelled before the computer connected'));
      const timer = setTimeout(
        () => finish(new ComputerRefusal('The computer did not connect in time, so nothing ran')),
        timeoutMs,
      );
      timer.unref();
      this.waiters.add(wake);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private send(request: OrbComputerRequest | { cancel: number }): void {
    const guest = this.guest;
    if (!guest) throw new ComputerTransportError('The computer disconnected');
    if (!frameFits(request))
      throw new ComputerRefusal('The request is too large for the computer transport');
    writeOrbComputerFrame(guest, request);
  }

  private register(handler: Pending): number {
    const id = this.nextId++;
    this.pending.set(id, handler);
    return id;
  }

  private cancel(id: number): void {
    if (this.pending.has(id) && this.guest) writeOrbComputerFrame(this.guest, { cancel: id });
  }

  call(request: FileCall, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted)
      return Promise.reject(new ComputerRefusal('The call was cancelled before delivery'));
    return new Promise<unknown>((resolve, reject) => {
      let result: unknown;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
      };
      const onAbort = () => {
        this.cancel(id);
        cleanup();
        reject(new ComputerTransportError('The file operation was cancelled after delivery'));
      };
      const timer = setTimeout(
        () => {
          this.cancel(id);
          cleanup();
          reject(new ComputerTransportError('The computer did not answer in time'));
        },
        Math.min(this.settings.requestTimeoutMs, timeoutMs),
      );
      timer.unref();
      const id = this.register({
        value: (value) => {
          result = value;
        },
        done: () => {
          cleanup();
          resolve(result);
        },
        error: (error) => {
          cleanup();
          reject(error);
        },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        this.send({ id, ...request } as OrbComputerRequest);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  execute(request: ComputerExecuteRequest): AsyncIterable<ComputerProcessEvent> {
    if (request.signal.aborted) throw new ComputerRefusal('The call was cancelled before delivery');
    const queue = new AsyncEventQueue();
    let finished = false;
    let stopTimer: NodeJS.Timeout | undefined;
    let limitTimer: NodeJS.Timeout | undefined;
    const settle = () => {
      finished = true;
      clearTimeout(stopTimer);
      clearTimeout(limitTimer);
      request.signal.removeEventListener('abort', onAbort);
      this.pending.delete(id);
      queue.end();
    };
    let stopReason: 'timeout' | 'aborted' | undefined;
    const forceExit = (code: number, reason: 'timeout' | 'aborted') => {
      if (finished) return;
      queue.push({ kind: 'exit', code, reason });
      settle();
    };
    const abortTimedOut = (reason: unknown): boolean =>
      reason === 'timeout' || (reason instanceof Error && reason.name === 'TimeoutError');
    const onAbort = () => {
      this.cancel(id);
      const reason = abortTimedOut(request.signal.reason) ? 'timeout' : 'aborted';
      stopReason = reason;
      stopTimer ??= setTimeout(
        () => forceExit(reason === 'timeout' ? 124 : 130, reason),
        this.settings.stopGraceMs,
      );
      stopTimer.unref();
    };
    const id = this.register({
      value: (value) => {
        const event = orbComputerEventSchema.safeParse(value);
        if (!event.success || finished) return;
        const reason = stopReason;
        if (event.data.kind === 'exit' && reason) {
          forceExit(reason === 'timeout' ? 124 : event.data.code, reason);
          return;
        }
        queue.push(event.data);
      },
      done: () => {
        if (finished) return;
        const reason = stopReason;
        if (reason) {
          forceExit(reason === 'timeout' ? 124 : 130, reason);
          return;
        }
        settle();
      },
      error: (error) => {
        if (finished) return;
        queue.fail(error);
        settle();
      },
    });
    limitTimer = setTimeout(() => {
      stopReason = 'timeout';
      this.cancel(id);
      forceExit(124, 'timeout');
    }, request.timeoutMs + this.settings.stopGraceMs);
    limitTimer.unref();
    request.signal.addEventListener('abort', onAbort, { once: true });
    try {
      this.send({
        id,
        method: 'execute',
        params: {
          argv: [...request.argv],
          ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
          timeoutMs: request.timeoutMs,
        },
      });
    } catch (error) {
      settle();
      throw error;
    }
    if (request.signal.aborted) onAbort();
    return queue;
  }

  cancelAll(): void {
    for (const id of this.pending.keys()) this.cancel(id);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watchdog);
    this.detach('The daemon closed the computer link');
    for (const socket of this.sockets) socket.destroy();
    const server = this.server;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      if (this.ownsFiles) {
        for (const path of [this.socketPath, `${this.socketPath}.token`]) {
          try {
            const metadata = lstatSync(path, { throwIfNoEntry: false });
            if (metadata?.isFile() || metadata?.isSocket()) unlinkSync(path);
          } catch {}
        }
      }
    } finally {
      if (this.directoryDescriptor !== undefined) closeSync(this.directoryDescriptor);
      this.directoryDescriptor = undefined;
    }
  }
}

export class OrbComputerProvider implements ScopedComputerProviders {
  private readonly links = new Map<string, GuestLink>();
  private readonly inputLeases = new Map<string, ComputerInputLease>();
  private readonly settings: LinkSettings;
  private published: string | undefined;
  private publishing: Promise<string> | undefined;
  private readonly connectTimeoutMs: number;
  private readonly touchMs: number;
  private readonly runtimeRoot: string | (() => string);

  constructor(private readonly options: OrbComputerProviderOptions) {
    this.runtimeRoot = options.runtimeRoot ?? DEFAULT_RUNTIME_ROOT;
    this.connectTimeoutMs = options.connectTimeoutMs ?? ORB_COMPUTER_CONNECT_TIMEOUT_MS;
    this.touchMs = options.touchMs ?? ORB_COMPUTER_TOUCH_MS;
    this.settings = {
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? ORB_COMPUTER_HEARTBEAT_TIMEOUT_MS,
      requestTimeoutMs: options.requestTimeoutMs ?? ORB_COMPUTER_REQUEST_TIMEOUT_MS,
      stopGraceMs: options.stopGraceMs ?? ORB_COMPUTER_STOP_GRACE_MS,
      touchMs: this.touchMs,
      ...(options.release || options.expectedRelease
        ? { expectedRelease: () => this.published ?? options.expectedRelease?.() }
        : {}),
      ...(options.release
        ? {
            onAuthenticated: (machine: string, release: string) =>
              options.release?.authenticated(machine, release),
          }
        : {}),
    };
  }

  private releaseInput(scopeKey: string): void {
    const lease = this.inputLeases.get(scopeKey);
    if (!lease) return;
    this.inputLeases.delete(scopeKey);
    lease.release();
  }

  private async claimInput(scopeKey: string, signal?: AbortSignal): Promise<void> {
    const fence = this.options.inputFence;
    if (!fence || this.inputLeases.has(scopeKey)) return;
    try {
      this.inputLeases.set(scopeKey, await fence.acquire(scopeKey, signal));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ComputerRefusal(message);
    }
  }

  forScope(scopeKey: string): ComputerProvider {
    const keepAlive = async <T>(
      signal: AbortSignal | undefined,
      run: (link: GuestLink) => Promise<T>,
    ): Promise<T> => {
      const link = await this.link(scopeKey, signal);
      this.options.orbs.touch(scopeKey);
      return run(link);
    };
    const fileCall = async (call: FileCall, options: ComputerFileOptions | undefined) => {
      const timeoutMs = Math.min(
        this.settings.requestTimeoutMs,
        options?.timeoutMs ?? this.settings.requestTimeoutMs,
      );
      if (timeoutMs <= 0) throw new ComputerRefusal('No time was left for the file operation');
      const endsAt = Date.now() + timeoutMs;
      const signal = AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...(options?.signal ? [options.signal] : []),
      ]);
      return keepAlive(signal, (link) => {
        const remaining = endsAt - Date.now();
        if (remaining <= 0) throw new ComputerRefusal('No time was left for the file operation');
        return link.call(call, remaining, options?.signal);
      });
    };
    return {
      execute: async (request) => {
        if (request.env && Object.keys(request.env).length > 0)
          throw new ComputerRefusal('The computer does not accept environment overrides');
        if (request.timeoutMs <= 0) throw new ComputerRefusal('No time was left for the command');
        const endsAt = Date.now() + request.timeoutMs;
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs)]);
        return keepAlive(signal, async (link) => {
          const remaining = endsAt - Date.now();
          if (remaining <= 0) throw new ComputerRefusal('No time was left for the command');
          const timer = setInterval(() => this.options.orbs.touch(scopeKey), this.touchMs);
          timer.unref();
          try {
            return this.touching(
              link.execute({ ...request, signal, timeoutMs: remaining }),
              timer,
              scopeKey,
            );
          } catch (error) {
            clearInterval(timer);
            throw error;
          }
        });
      },
      listFiles: async (path, options) =>
        orbComputerFileEntriesSchema.parse(
          await fileCall({ method: 'listFiles', params: { path } }, options),
        ) satisfies ComputerFileEntry[],
      readFile: async (path, options) =>
        z.string().parse(await fileCall({ method: 'readFile', params: { path } }, options)),
      writeFile: async (path, content, options) => {
        await fileCall({ method: 'writeFile', params: { path, content } }, options);
      },
      killAll: async () => this.links.get(scopeKey)?.cancelAll(),
    };
  }

  private touching(
    events: AsyncIterable<ComputerProcessEvent>,
    timer: NodeJS.Timeout,
    scopeKey: string,
  ): AsyncIterable<ComputerProcessEvent> {
    const touch = () => this.options.orbs.touch(scopeKey);
    return (async function* () {
      try {
        yield* events;
      } finally {
        clearInterval(timer);
        touch();
      }
    })();
  }

  private async ensurePublished(): Promise<void> {
    const release = this.options.release;
    if (!release || this.published) return;
    this.publishing ??= release
      .publish()
      .then((key) => {
        this.published = key;
        return key;
      })
      .finally(() => {
        this.publishing = undefined;
      });
    try {
      await this.publishing;
    } catch (error) {
      this.options.onError?.(`computer release could not be published: ${String(error)}`);
      throw new ComputerRefusal('The computer release could not be published, so nothing ran');
    }
  }

  private async beforeDelivery<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new ComputerRefusal('The call was cancelled before delivery');
    if (!signal) return run();
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new ComputerRefusal('The call was cancelled before delivery'));
      signal.addEventListener('abort', onAbort, { once: true });
      void (async () => run())()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  private async link(scopeKey: string, signal?: AbortSignal): Promise<GuestLink> {
    await this.beforeDelivery(() => this.ensurePublished(), signal);
    await this.claimInput(scopeKey, signal);
    let name: string;
    try {
      name = await this.beforeDelivery(() => this.options.orbs.ensure(scopeKey), signal);
    } catch (error) {
      if (!this.links.has(scopeKey)) this.releaseInput(scopeKey);
      this.options.onError?.(`computer ${scopeKey} could not start: ${String(error)}`);
      throw new ComputerRefusal('The computer could not be started, so nothing ran');
    }
    const directory = join(
      typeof this.runtimeRoot === 'function' ? this.runtimeRoot() : this.runtimeRoot,
      name,
    );
    let link = this.links.get(scopeKey);
    if (link && (link.directory !== directory || !link.servesCurrentDirectory())) {
      await link.close();
      this.links.delete(scopeKey);
      this.releaseInput(scopeKey);
      link = undefined;
      await this.claimInput(scopeKey, signal);
    }
    if (!link) {
      link = new GuestLink(directory, this.settings);
      this.links.set(scopeKey, link);
    }
    try {
      await this.beforeDelivery(link.listen.bind(link), signal);
    } catch (error) {
      this.options.onError?.(`computer ${scopeKey} socket failed: ${String(error)}`);
      await link.close();
      if (this.links.get(scopeKey) === link) this.links.delete(scopeKey);
      this.releaseInput(scopeKey);
      throw new ComputerRefusal('The computer link could not be opened, so nothing ran');
    }
    try {
      await link.connected(this.connectTimeoutMs, signal);
      if (signal?.aborted) throw new ComputerRefusal('The call was cancelled before delivery');
    } catch (error) {
      if (signal?.aborted) {
        await link.close();
        if (this.links.get(scopeKey) === link) this.links.delete(scopeKey);
        this.releaseInput(scopeKey);
      }
      throw error;
    }
    return link;
  }

  async killAll(): Promise<void> {
    for (const link of this.links.values()) link.cancelAll();
  }

  async close(): Promise<void> {
    const scopes = [...this.links.keys()];
    const links = [...this.links.values()];
    this.links.clear();
    try {
      await Promise.all(links.map((link) => link.close()));
    } finally {
      for (const scopeKey of scopes) this.releaseInput(scopeKey);
      for (const scopeKey of this.inputLeases.keys()) this.releaseInput(scopeKey);
    }
  }
}
