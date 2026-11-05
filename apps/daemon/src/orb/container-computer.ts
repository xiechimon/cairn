import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { writePrivateFile } from '../private-fs.js';
import {
  COMPUTER_IDLE_STOP_MS,
  COMPUTER_TAKEOVER_GRACE_MS,
  COMPUTER_TEMPLATE,
  computerMachineName,
} from './computer.js';
import type { OrbRuntime, OrbSpawnSpec } from './runtime.js';
import { checkOrbDirectory, readOrbFile } from './runtime-fs.js';

const COMPUTER_IMAGE_PATTERN = /^(?:localhost\/)?cairn-orb-computer:[a-f0-9]{16}$/;
const OWNER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_LIMITS: OrbSpawnSpec['limits'] = { cpus: 4, memoryBytes: 4 * 1024 ** 3, pids: 4096 };
const STATE_MAX_BYTES = 8 * 1024 * 1024;
const PRESENCE_LIMIT = 250;
const stateSchema = z.object({
  version: z.literal(1),
  ownerId: z.string().regex(OWNER_PATTERN),
  computers: z.array(
    z.object({
      scopeKey: z.string().min(1).max(256),
      name: z.string(),
      lastUsedAt: z.number().finite().nonnegative(),
      holdUntil: z.number().finite().nonnegative(),
      failed: z.boolean().optional(),
    }),
  ),
});
type ComputerRecord = z.infer<typeof stateSchema>['computers'][number];

export interface ContainerComputerPresence {
  scopeKey: string;
  providerRef: string;
  state: 'starting' | 'running' | 'stopped' | 'failed';
}

export interface ContainerComputerOrbsOptions {
  runtime: OrbRuntime;
  ownerId: string | (() => string);
  image: string;
  runtimeRoot: string;
  distRoot: string;
  stateRoot?: string;
  limits?: OrbSpawnSpec['limits'];
  egressSocketPath?: string;
  operationTimeoutMs?: number;
  now?: () => number;
  isBusy?: (logicalName: string) => Promise<boolean>;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 40);
}

function validatePath(path: string): void {
  if (
    !isAbsolute(path) ||
    path.includes('\0') ||
    path.includes(':') ||
    path.split('/').includes('..')
  ) {
    throw new Error('Computer root must be an absolute path without traversal or mount separators');
  }
}

function privateDirectory(path: string, label: string): void {
  if (!checkOrbDirectory(path, label, 0o700)) mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!checkOrbDirectory(path, label, 0o700)) throw new Error(`${label} is missing`);
}

function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export class ContainerComputerOrbs {
  private readonly records = new Map<string, ComputerRecord>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly limits: OrbSpawnSpec['limits'];
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private owner: string | undefined;
  private loaded = false;
  private presenceOffset = 0;

  constructor(private readonly options: ContainerComputerOrbsOptions) {
    if (!COMPUTER_IMAGE_PATTERN.test(options.image))
      throw new Error('Computer image must be a pinned cairn-orb-computer recipe tag');
    for (const path of [
      options.runtimeRoot,
      options.distRoot,
      ...(options.stateRoot ? [options.stateRoot] : []),
    ])
      validatePath(path);
    this.limits = { ...(options.limits ?? DEFAULT_LIMITS) };
    if (
      !Number.isFinite(this.limits.cpus) ||
      this.limits.cpus <= 0 ||
      !Number.isSafeInteger(this.limits.memoryBytes) ||
      this.limits.memoryBytes <= 0 ||
      !Number.isSafeInteger(this.limits.pids) ||
      this.limits.pids <= 0
    ) {
      throw new Error('Invalid computer resource limits');
    }
    this.timeoutMs = options.operationTimeoutMs ?? 60_000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > 2_147_483_647
    )
      throw new Error('Invalid computer operation timeout');
    this.now = options.now ?? Date.now;
  }

  get transportRoot(): string {
    return join(this.options.runtimeRoot, 'computers', hash(this.ownerId()));
  }

  known(): string[] {
    return [...this.records.values()].map((record) => record.name);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  ensure(scopeKey: string, options: { signal?: AbortSignal } = {}): Promise<string> {
    if (
      typeof scopeKey !== 'string' ||
      !scopeKey ||
      scopeKey.length > 256 ||
      scopeKey.includes('\0')
    )
      return Promise.reject(new Error('Computer scope must be nonempty and bounded'));
    const pending = this.pending.get(scopeKey);
    if (pending) return options.signal ? untilAborted(pending, options.signal) : pending;
    const operation = this.withDeadline(async (signal) => {
      this.load();
      this.failed.delete(scopeKey);
      const stopping = this.stopping.get(scopeKey);
      if (stopping) await untilAborted(stopping, signal);
      const name = computerMachineName(scopeKey);
      const record = this.records.get(scopeKey) ?? {
        scopeKey,
        name,
        lastUsedAt: this.now(),
        holdUntil: 0,
      };
      record.lastUsedAt = this.now();
      record.failed = false;
      this.records.set(scopeKey, record);
      this.save();
      await this.ensureRunning(record, signal);
      return name;
    }, options.signal)
      .catch((error: unknown) => {
        this.failed.add(scopeKey);
        const record = this.records.get(scopeKey);
        if (record) {
          record.failed = true;
          this.save();
        }
        throw error;
      })
      .finally(() => {
        this.pending.delete(scopeKey);
        this.changed();
      });
    this.pending.set(scopeKey, operation);
    this.changed();
    return operation;
  }

  touch(scopeKey: string): void {
    const record = this.records.get(scopeKey);
    if (!record) return;
    record.lastUsedAt = this.now();
    this.save();
  }

  hold(scopeKey: string): void {
    const record = this.records.get(scopeKey);
    if (!record) return;
    record.holdUntil = this.now() + COMPUTER_TAKEOVER_GRACE_MS;
    this.save();
  }

  async presence(signal?: AbortSignal): Promise<ContainerComputerPresence[]> {
    return this.withDeadline(async (active) => {
      this.load();
      const listed = await untilAborted(this.options.runtime.list(), active);
      const actual = new Map(listed.map((container) => [container.orbId, container.state]));
      const scopes = [...new Set([...this.pending.keys(), ...this.failed, ...this.records.keys()])];
      const ordered = [
        ...scopes.slice(this.presenceOffset),
        ...scopes.slice(0, this.presenceOffset),
      ];
      const batch = ordered.slice(0, PRESENCE_LIMIT);
      this.presenceOffset = scopes.length
        ? (this.presenceOffset + batch.length) % scopes.length
        : 0;
      return batch.map((scopeKey) => ({
        scopeKey,
        providerRef: computerMachineName(scopeKey),
        state: this.failed.has(scopeKey)
          ? 'failed'
          : this.pending.has(scopeKey)
            ? 'starting'
            : actual.get(this.containerId(scopeKey)) === 'running'
              ? 'running'
              : 'stopped',
      }));
    }, signal);
  }

  async sweep(): Promise<void> {
    await this.withDeadline(async (signal) => {
      this.load();
      const listed = await untilAborted(this.options.runtime.list(), signal);
      const actual = new Map(listed.map((container) => [container.orbId, container.state]));
      for (const record of this.records.values()) {
        if (actual.get(this.containerId(record.scopeKey)) !== 'running' || !this.idle(record))
          continue;
        if (
          await untilAborted(this.options.isBusy?.(record.name) ?? Promise.resolve(false), signal)
        )
          continue;
        if (!this.idle(record)) continue;
        const stopping = Promise.resolve()
          .then(() => {
            signal.throwIfAborted();
            return this.options.runtime.pause(this.containerId(record.scopeKey));
          })
          .finally(() => {
            this.stopping.delete(record.scopeKey);
            this.changed();
          });
        this.stopping.set(record.scopeKey, stopping);
        try {
          await untilAborted(stopping, signal);
        } catch (error) {
          record.failed = true;
          this.failed.add(record.scopeKey);
          this.save();
          this.changed();
          throw error;
        }
      }
    });
  }

  private ownerId(): string {
    if (this.owner !== undefined) return this.owner;
    const owner =
      typeof this.options.ownerId === 'function' ? this.options.ownerId() : this.options.ownerId;
    if (typeof owner !== 'string' || !OWNER_PATTERN.test(owner))
      throw new Error('Computer owner requires an enrolled machine identifier');
    this.owner = owner;
    return owner;
  }

  private containerId(scopeKey: string): string {
    return `${COMPUTER_TEMPLATE}-${hash(JSON.stringify([this.ownerId(), scopeKey]))}`;
  }

  private idle(record: ComputerRecord): boolean {
    return (
      !this.pending.has(record.scopeKey) &&
      !this.stopping.has(record.scopeKey) &&
      this.now() - record.lastUsedAt >= COMPUTER_IDLE_STOP_MS &&
      this.now() >= record.holdUntil
    );
  }

  private async ensureRunning(record: ComputerRecord, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    privateDirectory(this.options.runtimeRoot, 'Computer provider runtime root');
    privateDirectory(join(this.options.runtimeRoot, 'computers'), 'Computer namespace root');
    privateDirectory(this.transportRoot, 'Computer owner transport root');
    const directory = join(this.transportRoot, record.name);
    privateDirectory(directory, 'Computer transport directory');
    if (
      !checkOrbDirectory(this.options.distRoot, 'Computer release root') ||
      (lstatSync(this.options.distRoot).mode & 0o022) !== 0
    )
      throw new Error('Computer release root must be an owned non-writable-by-others directory');
    const egress = this.options.egressSocketPath;
    if (egress) {
      validatePath(egress);
      if (egress === directory || egress.startsWith(`${directory}/`))
        throw new Error('Computer egress must be separate from its writable transport directory');
      const socket = lstatSync(egress, { throwIfNoEntry: false });
      if (!socket?.isSocket() || socket.uid !== process.getuid?.())
        throw new Error('Computer egress must be an owned Unix socket');
    }
    const health = await untilAborted(this.options.runtime.health(), signal);
    if (!health.rootless) throw new Error('Computer runtime must be rootless');
    const listed = await untilAborted(this.options.runtime.list(), signal);
    const id = this.containerId(record.scopeKey);
    const existing = listed.find((container) => container.orbId === id);
    if (
      existing &&
      existing.image.replace(/^localhost\//, '') !== this.options.image.replace(/^localhost\//, '')
    )
      throw new Error('Computer container image differs from the pinned image');
    if (
      !existing &&
      !(await untilAborted(this.options.runtime.imageExists(this.options.image), signal))
    )
      throw new Error('Computer image is missing; build the pinned image first');
    signal.throwIfAborted();
    await untilAborted(
      this.options.runtime.spawn(
        {
          orbId: id,
          image: this.options.image,
          mounts: [
            { source: directory, target: '/run/cairn-computer', readonly: false },
            { source: this.options.distRoot, target: '/opt/cairn/daemon', readonly: true },
          ],
          env: { CAIRN_ORB: '1', HOME: '/home/user' },
          limits: { ...this.limits },
          egress: egress ? { socketPath: egress } : 'none',
          persistentHome: {
            volume: `cairn-computer-home-${hash(JSON.stringify([this.ownerId(), record.scopeKey]))}`,
            target: '/home/user',
          },
        },
        { signal },
      ),
      signal,
    );
    const running = await untilAborted(this.options.runtime.list(), signal);
    signal.throwIfAborted();
    if (!running.some((container) => container.orbId === id && container.state === 'running'))
      throw new Error('Computer runtime did not confirm a running container');
  }

  private load(): void {
    const owner = this.ownerId();
    if (this.loaded) return;
    const root = this.stateDirectory();
    if (root) {
      privateDirectory(this.options.stateRoot ?? '', 'Computer state root');
      privateDirectory(root, 'Computer owner state root');
      const path = join(root, 'computers.json');
      const stat = lstatSync(path, { throwIfNoEntry: false });
      if (stat) {
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.uid !== process.getuid?.() ||
          (stat.mode & 0o7777) !== 0o600
        )
          throw new Error('Computer state must be an owned private regular file');
        const saved = stateSchema.parse(
          JSON.parse(readOrbFile(root, 'computers.json', STATE_MAX_BYTES).toString('utf8')),
        );
        if (saved.ownerId !== owner)
          throw new Error('Computer state owner does not match enrollment');
        const records = new Map<string, ComputerRecord>();
        for (const record of saved.computers) {
          if (
            record.name !== computerMachineName(record.scopeKey) ||
            records.has(record.scopeKey) ||
            record.scopeKey.includes('\0')
          )
            throw new Error('Computer state logical name does not match its unique scope');
          records.set(record.scopeKey, record);
        }
        for (const record of records.values()) {
          this.records.set(record.scopeKey, record);
          if (record.failed) this.failed.add(record.scopeKey);
        }
      }
    }
    this.loaded = true;
  }

  private stateDirectory(): string | undefined {
    return this.options.stateRoot ? join(this.options.stateRoot, hash(this.ownerId())) : undefined;
  }

  private save(): void {
    const root = this.stateDirectory();
    if (!root) return;
    privateDirectory(root, 'Computer owner state root');
    const path = join(root, 'computers.json');
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (
      stat &&
      (!stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o7777) !== 0o600)
    )
      throw new Error('Computer state must remain an owned private regular file');
    writePrivateFile(
      path,
      JSON.stringify({
        version: 1,
        ownerId: this.ownerId(),
        computers: [...this.records.values()],
      }),
    );
  }

  private withDeadline<T>(
    run: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const deadline = new AbortController();
    const active = AbortSignal.any([deadline.signal, ...(signal ? [signal] : [])]);
    const timer = setTimeout(
      () => deadline.abort(new Error('Computer operation timed out')),
      this.timeoutMs,
    );
    timer.unref();
    return untilAborted(
      Promise.resolve().then(() => {
        active.throwIfAborted();
        return run(active);
      }),
      active,
    ).finally(() => clearTimeout(timer));
  }

  private changed(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {}
    }
  }
}
