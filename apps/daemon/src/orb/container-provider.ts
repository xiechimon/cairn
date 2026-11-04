import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ensurePrivateDir, writePrivateFile } from '../private-fs.js';
import { defaultOrbDistSource, publishOrbDist } from './dist.js';
import { assertOrbMachineName, orbMachineName } from './names.js';
import { orbReleaseKeySchema } from './protocol.js';
import {
  type OrbCommandRunner,
  type OrbHandle,
  type OrbProvider,
  orbNote,
  runOrbCommand,
} from './provider.js';
import type { OrbRuntime, OrbSpawnSpec } from './runtime.js';
import { checkOrbDirectory } from './runtime-fs.js';
import { publishOrbSeed } from './seed.js';

export const ORB_IMAGE_PATTERN = /^cairn-orb-base:(?!latest$)[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

const DEFAULT_LIMITS: OrbSpawnSpec['limits'] = { cpus: 4, memoryBytes: 4 * 1024 ** 3, pids: 4096 };

export interface ContainerOrbProviderOptions {
  runtime: OrbRuntime;
  image: string;
  runtimeRoot: string;
  distRoot: string;
  seedRoot: string;
  stateFile?: string;
  runner?: OrbCommandRunner;
  distSource?: string;
  limits?: OrbSpawnSpec['limits'];
  egressSocketPath?: string;
}

export class ContainerOrbProvider implements OrbProvider {
  readonly kind = 'orb';
  readonly runtimeRoot: string;
  readonly distRoot: string;
  readonly seedRoot: string;
  private readonly handles = new Map<string, OrbHandle>();
  private readonly pending = new Map<string, Promise<OrbHandle>>();
  private readonly runtime: OrbRuntime;
  private readonly image: string;
  private readonly runner: OrbCommandRunner;
  private readonly stateFile: string | undefined;
  private readonly distSource: string;
  private readonly limits: OrbSpawnSpec['limits'];
  private readonly egressSocketPath: string | undefined;
  private readonly retainDistReleases = process.env.CAIRN_ORB_RETAIN_RELEASES === '1';
  private readonly starting = new Set<Promise<void>>();
  private publishing: Promise<void> = Promise.resolve();
  private reconciled = false;
  private rootlessChecked = false;

  constructor(options: ContainerOrbProviderOptions) {
    if (!ORB_IMAGE_PATTERN.test(options.image))
      throw new Error(
        `Orb image must be a pinned cairn-orb-base:<recipe hash> tag (got ${JSON.stringify(options.image)})`,
      );
    this.runtime = options.runtime;
    this.image = options.image;
    this.runner = options.runner ?? runOrbCommand;
    this.runtimeRoot = options.runtimeRoot;
    this.distRoot = options.distRoot;
    this.seedRoot = options.seedRoot;
    this.stateFile = options.stateFile;
    this.distSource = options.distSource ?? defaultOrbDistSource();
    this.limits = options.limits ?? DEFAULT_LIMITS;
    this.egressSocketPath = options.egressSocketPath;
    if (this.stateFile && existsSync(this.stateFile)) {
      const handles = JSON.parse(readFileSync(this.stateFile, 'utf8')) as OrbHandle[];
      for (const handle of handles) {
        this.validate(handle);
        if (!handle.expectedReleaseKey) handle.releaseKey = undefined;
        this.handles.set(handle.conversationId, handle);
      }
    }
  }

  ensure(input: { conversationId: string; projectId: string }): Promise<OrbHandle> {
    const pending = this.pending.get(input.conversationId);
    if (pending) return pending;
    const operation = this.register(input).finally(() => this.pending.delete(input.conversationId));
    this.pending.set(input.conversationId, operation);
    return operation;
  }

  private async register(input: { conversationId: string; projectId: string }): Promise<OrbHandle> {
    await this.reconcile();
    let handle = this.handles.get(input.conversationId);
    if (!handle) {
      handle = {
        ...input,
        id: orbMachineName(input.conversationId),
        running: false,
        lastUsedAt: Date.now(),
        notes: [],
      };
      this.handles.set(input.conversationId, handle);
      this.save();
    }
    return handle;
  }

  async prepare(handle: OrbHandle, seed?: string): Promise<string> {
    this.validate(handle);
    const directory = join(this.runtimeRoot, handle.id);
    const starting = [...this.starting];
    const publish = this.publishing.then(async () => {
      await Promise.allSettled(starting);
      mkdirSync(this.distRoot, { recursive: true, mode: 0o755 });
      mkdirSync(this.seedRoot, { recursive: true, mode: 0o755 });
      this.ensureRuntimeDirectory(directory);
      handle.expectedReleaseKey = await publishOrbDist(
        this.distSource,
        this.distRoot,
        this.runner,
        () => {
          if (this.retainDistReleases) return undefined;
          const running = [...this.handles.values()].filter((orb) => orb.running);
          if (running.some((orb) => !orb.releaseKey)) return undefined;
          return new Set(
            running.flatMap((orb) =>
              [orb.releaseKey, orb.expectedReleaseKey].filter(
                (key): key is string => key !== undefined,
              ),
            ),
          );
        },
      );
      this.save();
      if (seed)
        await publishOrbSeed({
          source: seed,
          root: this.seedRoot,
          projectId: handle.projectId,
          runningSeedKeys: () =>
            [...this.handles.values()]
              .filter((orb) => orb.running && orb.projectId === handle.projectId)
              .map((orb) => orb.seedKey),
        });
    });
    this.publishing = publish.catch(() => {});
    await publish;
    return directory;
  }

  async start(handle: OrbHandle, options: { signal?: AbortSignal } = {}): Promise<void> {
    const starting = this.publishing.then(() => this.startContainer(handle, options));
    this.starting.add(starting);
    try {
      await starting;
    } finally {
      this.starting.delete(starting);
    }
  }

  private async startContainer(
    handle: OrbHandle,
    options: { signal?: AbortSignal },
  ): Promise<void> {
    this.validate(handle);
    options.signal?.throwIfAborted();
    await this.requireRootless();
    const release = join(this.distRoot, 'current');
    const seed = join(this.seedRoot, handle.projectId, 'current');
    handle.seedKey = existsSync(seed) ? readlinkSync(seed) : null;
    const listed = (await this.runtime.list()).find((orb) => orb.orbId === handle.id);
    if (!(handle.running && listed?.state === 'running')) {
      handle.running = false;
      handle.releaseKey = existsSync(release) ? basename(readlinkSync(release)) : undefined;
      handle.notes.push(orbNote('orb: setup'));
      if (!listed) await this.requireImage();
      const directory = join(this.runtimeRoot, handle.id);
      if (!checkOrbDirectory(directory, 'Orb runtime directory', 0o700))
        throw new Error(`Orb runtime directory must exist before start: ${directory}`);
      try {
        await this.runtime.spawn(this.spawnSpec(handle), { signal: options.signal });
      } catch (error) {
        await this.runtime.pause(handle.id).catch(() => {});
        throw error;
      }
      handle.running = true;
    }
    this.save();
  }

  authenticateRelease(handle: OrbHandle, release: string): void {
    this.validate(handle);
    orbReleaseKeySchema.parse(release);
    if (release !== handle.expectedReleaseKey)
      throw new Error('Orb authenticated release does not match published release');
    handle.releaseKey = release;
    this.save();
  }

  async stop(handle: OrbHandle): Promise<void> {
    this.validate(handle);
    if (!handle.running) return;
    await this.runtime.pause(handle.id);
    const listed = (await this.runtime.list()).find((orb) => orb.orbId === handle.id);
    if (listed?.state === 'running') throw new Error('Orb container is still running after pause');
    handle.running = false;
    handle.notes.push(orbNote('orb: stopped'));
    this.save();
  }

  async destroy(handle: OrbHandle): Promise<void> {
    await this.stop(handle);
    await this.runtime.remove(handle.id);
    this.handles.delete(handle.conversationId);
    this.save();
  }

  async list(): Promise<OrbHandle[]> {
    await this.reconcile();
    return [...this.handles.values()];
  }

  touch(handle: OrbHandle, now: number): void {
    handle.lastUsedAt = now;
    this.save();
  }

  private spawnSpec(handle: OrbHandle): OrbSpawnSpec {
    return {
      orbId: handle.id,
      image: this.image,
      mounts: [
        { source: join(this.runtimeRoot, handle.id), target: '/run/cairn', readonly: false },
        { source: this.distRoot, target: '/opt/cairn/daemon', readonly: true },
        { source: this.seedRoot, target: '/seed', readonly: true },
      ],
      env: { CAIRN_ORB: '1' },
      limits: this.limits,
      egress: this.egressSocketPath ? { socketPath: this.egressSocketPath } : 'none',
    };
  }

  private ensureRuntimeDirectory(directory: string): void {
    const root = dirname(directory);
    if (!checkOrbDirectory(root, 'Orb runtime root', 0o700)) ensurePrivateDir(root);
    checkOrbDirectory(root, 'Orb runtime root', 0o700);
    if (!lstatSync(directory, { throwIfNoEntry: false })) ensurePrivateDir(directory);
    checkOrbDirectory(directory, 'Orb runtime directory', 0o700);
  }

  private async requireRootless(): Promise<void> {
    if (this.rootlessChecked) return;
    const { rootless } = await this.runtime.health();
    if (!rootless) throw new Error(`Orb ${this.runtime.name} runtime must be rootless`);
    this.rootlessChecked = true;
  }

  private async requireImage(): Promise<void> {
    if (!(await this.runtime.imageExists(this.image)))
      throw new Error(`Orb image ${this.image} is missing; build it before starting an Orb`);
  }

  private async reconcile(): Promise<void> {
    if (this.reconciled) return;
    if (this.handles.size > 0) {
      const listed = new Map((await this.runtime.list()).map((orb) => [orb.orbId, orb.state]));
      for (const handle of this.handles.values())
        handle.running = listed.get(handle.id) === 'running';
      this.save();
    }
    this.reconciled = true;
  }

  private validate(handle: OrbHandle): void {
    assertOrbMachineName(handle.id);
  }

  private save(): void {
    if (!this.stateFile) return;
    ensurePrivateDir(dirname(this.stateFile));
    writePrivateFile(this.stateFile, JSON.stringify([...this.handles.values()]));
  }
}
