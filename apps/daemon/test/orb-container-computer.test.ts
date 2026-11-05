import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  COMPUTER_IDLE_STOP_MS,
  COMPUTER_TAKEOVER_GRACE_MS,
  computerMachineName,
} from '../src/orb/computer.js';
import {
  ContainerComputerOrbs,
  type ContainerComputerOrbsOptions,
} from '../src/orb/container-computer.js';
import type { OrbExecOptions, OrbExecResult } from '../src/orb/provider.js';
import type { OrbRuntime, OrbRuntimeState, OrbSpawnSpec } from '../src/orb/runtime.js';

const IMAGE = 'cairn-orb-computer:0123456789abcdef';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) expect(releaseTestTempDir(root)).toBe(true);
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function bounded<T>(pending: Promise<T>, ms = 500): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('manager operation did not settle')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class RuntimeFixture implements OrbRuntime {
  readonly name = 'podman';
  readonly containers = new Map<string, OrbRuntimeState>();
  readonly specs: OrbSpawnSpec[] = [];
  readonly signals: Array<AbortSignal | undefined> = [];
  readonly paused: string[] = [];
  readonly removed: string[] = [];
  readonly calls: string[] = [];
  readonly volumes = new Map<string, Map<string, string>>();
  rootless = true;
  imagePresent = true;
  ignoreAbort = false;
  beforeList: (() => Promise<OrbRuntimeState[]>) | undefined;
  beforeSpawn: (() => Promise<void>) | undefined;
  beforePause: (() => Promise<void>) | undefined;

  async health() {
    this.calls.push('health');
    return { version: '5', rootless: this.rootless };
  }
  async buildImage() {
    throw new Error('manager must not build images');
  }
  async imageExists(_ref: string) {
    this.calls.push('imageExists');
    return this.imagePresent;
  }
  async spawn(spec: OrbSpawnSpec, options: { signal?: AbortSignal } = {}) {
    this.calls.push('spawn');
    this.specs.push(structuredClone(spec));
    this.signals.push(options.signal);
    await this.beforeSpawn?.();
    if (!this.ignoreAbort) options.signal?.throwIfAborted();
    if (spec.persistentHome && !this.volumes.has(spec.persistentHome.volume)) {
      this.volumes.set(spec.persistentHome.volume, new Map());
    }
    this.containers.set(spec.orbId, { orbId: spec.orbId, image: spec.image, state: 'running' });
  }
  async pause(id: string) {
    this.calls.push('pause');
    this.paused.push(id);
    await this.beforePause?.();
    const found = this.containers.get(id);
    if (found) this.containers.set(id, { ...found, state: 'paused' });
  }
  async remove(id: string) {
    this.removed.push(id);
    this.containers.delete(id);
  }
  async list() {
    this.calls.push('list');
    return this.beforeList
      ? this.beforeList()
      : [...this.containers.values()].map((entry) => ({ ...entry }));
  }
  async exec(
    _id: string,
    _argv: readonly string[],
    _options?: OrbExecOptions,
  ): Promise<OrbExecResult> {
    return { code: 0, stdout: '', stderr: '' };
  }
  async removeImage() {
    throw new Error('manager must not remove images');
  }
}

function fixture(overrides: Partial<ContainerComputerOrbsOptions> = {}) {
  const allocated = makeTestTempDir('cc-');
  roots.push(allocated);
  const root = realpathSync(allocated);
  const runtimeRoot = join(root, 'run');
  const distRoot = join(root, 'dist');
  const stateRoot = join(root, 'state');
  for (const path of [runtimeRoot, stateRoot]) mkdirSync(path, { mode: 0o700 });
  mkdirSync(distRoot, { mode: 0o755 });
  const runtime = new RuntimeFixture();
  let now = 0;
  const options: ContainerComputerOrbsOptions = {
    runtime,
    ownerId: 'machine-a',
    image: IMAGE,
    runtimeRoot,
    distRoot,
    stateRoot,
    operationTimeoutMs: 1000,
    now: () => now,
    ...overrides,
  };
  return {
    root,
    runtimeRoot,
    distRoot,
    stateRoot,
    runtime,
    options,
    manager: new ContainerComputerOrbs(options),
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('container computer identity and private resources', () => {
  test('enrollment is lazy, required, and pinned on first valid use', async () => {
    let owner = '';
    let reads = 0;
    const f = fixture({
      ownerId: () => {
        reads += 1;
        return owner;
      },
    });
    expect(reads).toBe(0);
    expect(f.runtime.calls).toEqual([]);
    await expect(f.manager.ensure('chief:one')).rejects.toThrow(/owner|enroll|machine/i);
    expect(f.runtime.calls).toEqual([]);
    owner = 'machine-a';
    const logical = await f.manager.ensure('chief:one');
    const pinnedReads = reads;
    owner = 'machine-b';
    await f.manager.ensure('chief:one');
    expect(reads).toBe(pinnedReads);
    expect(logical).toBe(computerMachineName('chief:one'));
  });

  test('same owner and scope share container/home, but different owners do not', async () => {
    const a = fixture();
    const again = new ContainerComputerOrbs(a.options);
    const b = fixture({ ownerId: 'machine-b', runtime: a.runtime });
    const logical = await a.manager.ensure('chief:one');
    await again.ensure('chief:one');
    await b.manager.ensure('chief:one');
    expect(new Set(a.runtime.specs.slice(0, 2).map((spec) => spec.orbId)).size).toBe(1);
    expect(a.runtime.specs.at(-1)?.orbId).not.toBe(a.runtime.specs[0]?.orbId);
    expect(a.runtime.specs.at(-1)?.persistentHome?.volume).not.toBe(
      a.runtime.specs[0]?.persistentHome?.volume,
    );
    expect(logical).toBe(computerMachineName('chief:one'));
    expect(await b.manager.ensure('chief:one')).toBe(logical);
  });

  test('a shared provider root keeps different enrolled owners in disjoint transport namespaces', async () => {
    const f = fixture();
    await f.manager.ensure('chief:one');
    const foreign = new ContainerComputerOrbs({ ...f.options, ownerId: 'machine-b' });
    await foreign.ensure('chief:one');
    expect(foreign.transportRoot).not.toBe(f.manager.transportRoot);
    expect(f.runtime.specs.at(-1)?.mounts).toContainEqual({
      source: join(foreign.transportRoot, computerMachineName('chief:one')),
      target: '/run/cairn-computer',
      readonly: false,
    });
    expect(f.runtime.specs[0]?.mounts).toContainEqual({
      source: join(f.manager.transportRoot, computerMachineName('chief:one')),
      target: '/run/cairn-computer',
      readonly: false,
    });
  });

  test('scope text never becomes a disk/container/volume path component', async () => {
    const f = fixture();
    const scope = 'chief:../../sensitive/with spaces';
    const logical = await f.manager.ensure(scope);
    const spec = f.runtime.specs[0];
    expect(logical).toBe(computerMachineName(scope));
    expect(spec?.orbId).toMatch(/^cairn-orb-computer-[a-f0-9]{40}$/);
    expect(spec?.orbId).not.toContain('sensitive');
    expect(spec?.persistentHome?.volume).toMatch(/^cairn-computer-home-[a-f0-9]{40}$/);
    expect(spec?.persistentHome?.target).toBe('/home/user');
    expect(spec?.mounts).toContainEqual({
      source: join(f.manager.transportRoot, logical),
      target: '/run/cairn-computer',
      readonly: false,
    });
    expect(spec?.mounts).toContainEqual({
      source: f.distRoot,
      target: '/opt/cairn/daemon',
      readonly: true,
    });
    expect(spec?.egress).toBe('none');
  });

  test.each(['cairn-orb-computer:latest', 'cairn-orb-base:0123456789abcdef', 'cairn-orb-computer'])(
    'refuses unpinned/wrong image %s',
    (image) => {
      expect(() => fixture({ image })).toThrow(/image|pinned/i);
    },
  );

  test.each([
    { cpus: 0, memoryBytes: 1024, pids: 10 },
    { cpus: Number.NaN, memoryBytes: 1024, pids: 10 },
    { cpus: 1, memoryBytes: Number.POSITIVE_INFINITY, pids: 10 },
    { cpus: 1, memoryBytes: 1024, pids: 0.5 },
  ])('fails closed on invalid resource limits %#', (limits) => {
    expect(() => fixture({ limits })).toThrow(/resource|limit/i);
  });

  test('keeps resource limits, agent environment and egress outside writable transport', async () => {
    const f = fixture();
    const socketPath = join(f.root, 'egress.sock');
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    try {
      const manager = new ContainerComputerOrbs({ ...f.options, egressSocketPath: socketPath });
      await manager.ensure('chief:one');
      const spec = f.runtime.specs[0];
      expect(spec?.limits).toEqual({ cpus: 4, memoryBytes: 4 * 1024 ** 3, pids: 4096 });
      expect(spec?.env).toEqual({ CAIRN_ORB: '1', HOME: '/home/user' });
      expect(spec?.egress).toEqual({ socketPath });
      expect(spec?.mounts).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test('refuses egress aliases and egress inside writable computer transport', async () => {
    const f = fixture();
    const inside = join(f.manager.transportRoot, computerMachineName('chief:one'), 'egress.sock');
    const mixed = new ContainerComputerOrbs({ ...f.options, egressSocketPath: inside });
    await expect(mixed.ensure('chief:one')).rejects.toThrow(/separate|transport/i);
    const alias = join(f.root, 'egress-alias');
    symlinkSync(join(f.root, 'missing'), alias);
    const linked = new ContainerComputerOrbs({ ...f.options, egressSocketPath: alias });
    await expect(linked.ensure('chief:one')).rejects.toThrow(/socket/i);
    expect(f.runtime.specs).toEqual([]);
  });

  test('refuses a symlink transport directory without following or replacing it', async () => {
    const f = fixture();
    const target = join(f.root, 'other');
    mkdirSync(target, { mode: 0o700 });
    mkdirSync(f.manager.transportRoot, { recursive: true, mode: 0o700 });
    const transport = join(f.manager.transportRoot, computerMachineName('chief:one'));
    symlinkSync(target, transport);
    await expect(f.manager.ensure('chief:one')).rejects.toThrow(/directory|symlink/i);
    expect(lstatSync(transport).isSymbolicLink()).toBe(true);
    expect(f.runtime.specs).toEqual([]);
  });

  test('refuses unsafe existing modes instead of silently chmodding them', async () => {
    const f = fixture();
    chmodSync(f.runtimeRoot, 0o755);
    await expect(f.manager.ensure('chief:one')).rejects.toThrow(/0700|mode/i);
    expect(lstatSync(f.runtimeRoot).mode & 0o777).toBe(0o755);
    expect(f.runtime.specs).toEqual([]);
  });
});

describe('container computer lifecycle and presence', () => {
  test('concurrent ensure is deduplicated and emits starting/running changes', async () => {
    const f = fixture();
    const gate = deferred<void>();
    f.runtime.beforeSpawn = () => gate.promise;
    let changes = 0;
    const unsubscribe = f.manager.subscribe(() => {
      changes += 1;
    });
    const first = f.manager.ensure('chief:one');
    expect(f.manager.ensure('chief:one')).toBe(first);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await f.manager.presence()).toContainEqual({
      scopeKey: 'chief:one',
      providerRef: computerMachineName('chief:one'),
      state: 'starting',
    });
    gate.resolve();
    await first;
    expect(f.runtime.specs).toHaveLength(1);
    expect(await f.manager.presence()).toContainEqual({
      scopeKey: 'chief:one',
      providerRef: computerMachineName('chief:one'),
      state: 'running',
    });
    expect(changes).toBeGreaterThanOrEqual(2);
    unsubscribe();
  });

  test('presence uses actual runtime state and never imports unknown workers', async () => {
    const f = fixture();
    await f.manager.ensure('chief:one');
    const id = f.runtime.specs[0]?.orbId;
    if (!id) throw new Error('missing computer container');
    await f.runtime.pause(id);
    f.runtime.containers.set('cairn-orb-worker', {
      orbId: 'cairn-orb-worker',
      image: IMAGE,
      state: 'running',
    });
    expect(await f.manager.presence()).toEqual([
      { scopeKey: 'chief:one', providerRef: computerMachineName('chief:one'), state: 'stopped' },
    ]);
    expect(f.manager.known()).toEqual([computerMachineName('chief:one')]);
  });

  test.each(['rootful', 'missing image'] as const)(
    'a %s runtime fails without spawning',
    async (failure) => {
      const f = fixture();
      if (failure === 'rootful') f.runtime.rootless = false;
      else f.runtime.imagePresent = false;
      await expect(f.manager.ensure('chief:one')).rejects.toThrow(/rootless|image/i);
      expect(f.runtime.specs).toEqual([]);
      expect((await f.manager.presence())[0]?.state).toBe('failed');
    },
  );

  test.each(['list', 'spawn'] as const)(
    'stalled %s is bounded and late success is never published as running',
    async (stage) => {
      const f = fixture({ operationTimeoutMs: 30 });
      const gate = deferred<void>();
      if (stage === 'list')
        f.runtime.beforeList = async () => {
          await gate.promise;
          return [];
        };
      else {
        f.runtime.beforeSpawn = () => gate.promise;
        f.runtime.ignoreAbort = true;
      }
      await expect(bounded(f.manager.ensure('chief:one'))).rejects.toThrow(/time|deadline/i);
      if (stage === 'spawn') expect(f.runtime.signals[0]?.aborted).toBe(true);
      gate.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      f.runtime.beforeList = undefined;
      expect((await f.manager.presence())[0]?.state).not.toBe('running');
      expect(f.runtime.removed).toEqual([]);
      if (stage === 'list') expect(f.runtime.specs).toEqual([]);
    },
  );

  test('caller abort bounds startup and its failed event cannot turn into late running', async () => {
    const f = fixture();
    const gate = deferred<void>();
    f.runtime.beforeSpawn = () => gate.promise;
    f.runtime.ignoreAbort = true;
    const controller = new AbortController();
    const operation = f.manager.ensure('chief:one', { signal: controller.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort(new Error('caller stopped'));
    await expect(bounded(operation)).rejects.toThrow(/caller stopped|abort|cancel/i);
    gate.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await f.manager.presence())[0]?.state).toBe('failed');
    expect(f.runtime.removed).toEqual([]);
  });

  test('a second caller can abort its wait without cancelling the shared startup', async () => {
    const f = fixture();
    const gate = deferred<void>();
    f.runtime.beforeSpawn = () => gate.promise;
    const first = f.manager.ensure('chief:one');
    await new Promise<void>((resolve) => setImmediate(resolve));
    const controller = new AbortController();
    const second = f.manager.ensure('chief:one', { signal: controller.signal });
    controller.abort(new Error('second caller stopped'));
    await expect(bounded(second)).rejects.toThrow('second caller stopped');
    expect(f.runtime.signals[0]?.aborted).toBe(false);
    gate.resolve();
    await expect(first).resolves.toBe(computerMachineName('chief:one'));
    expect(f.runtime.specs).toHaveLength(1);
  });

  test('retry after restart clears a persisted failed state once startup succeeds', async () => {
    const f = fixture();
    f.runtime.imagePresent = false;
    await expect(f.manager.ensure('chief:one')).rejects.toThrow(/image/i);
    f.runtime.imagePresent = true;
    const restarted = new ContainerComputerOrbs(f.options);
    await restarted.ensure('chief:one');
    expect((await restarted.presence())[0]?.state).toBe('running');
  });

  test('a timed-out idle stop remains serialized before a later ensure', async () => {
    const f = fixture({ operationTimeoutMs: 30 });
    await f.manager.ensure('chief:one');
    f.advance(COMPUTER_IDLE_STOP_MS);
    const gate = deferred<void>();
    f.runtime.beforePause = () => gate.promise;
    await expect(bounded(f.manager.sweep())).rejects.toThrow(/time|deadline/i);
    await expect(bounded(f.manager.ensure('chief:one'))).rejects.toThrow(/time|deadline/i);
    expect(f.runtime.specs).toHaveLength(1);
    expect(f.runtime.removed).toEqual([]);
    gate.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await f.manager.ensure('chief:one');
    expect((await f.manager.presence())[0]?.state).toBe('running');
  });

  test('idle stop preserves home and never inherits worker removal/max policy', async () => {
    const f = fixture();
    await f.manager.ensure('chief:one');
    const first = f.runtime.specs[0];
    const volume = first?.persistentHome?.volume;
    if (!volume) throw new Error('missing persistent home');
    f.runtime.volumes.get(volume)?.set('notes', 'keep');
    f.advance(COMPUTER_IDLE_STOP_MS - 1);
    await f.manager.sweep();
    expect(f.runtime.paused).toEqual([]);
    f.advance(1);
    await f.manager.sweep();
    expect(f.runtime.paused).toEqual([first?.orbId]);
    f.advance(73 * 60 * 60_000);
    await f.manager.sweep();
    expect(f.runtime.removed).toEqual([]);
    await f.manager.ensure('chief:one');
    expect(f.runtime.specs.at(-1)?.persistentHome?.volume).toBe(volume);
    expect(f.runtime.volumes.get(volume)?.get('notes')).toBe('keep');
    await Promise.all(
      ['chief:two', 'chief:three', 'chief:four'].map((scope) => f.manager.ensure(scope)),
    );
    expect(f.manager.known()).toHaveLength(4);
  });

  test('busy work, takeover grace and a touch during a busy probe prevent idle stop', async () => {
    let busy = true;
    const f = fixture({ isBusy: async () => busy });
    await f.manager.ensure('chief:one');
    f.advance(COMPUTER_IDLE_STOP_MS);
    await f.manager.sweep();
    expect(f.runtime.paused).toEqual([]);
    busy = false;
    f.manager.hold('chief:one');
    f.advance(COMPUTER_TAKEOVER_GRACE_MS - 1);
    await f.manager.sweep();
    expect(f.runtime.paused).toEqual([]);
    f.advance(1);
    await f.manager.sweep();
    expect(f.runtime.paused).toHaveLength(1);
    await f.manager.ensure('chief:one');
    f.advance(COMPUTER_IDLE_STOP_MS);
    const touched = new ContainerComputerOrbs({
      ...f.options,
      isBusy: async () => {
        touched.touch('chief:one');
        return false;
      },
    });
    await touched.presence();
    await touched.sweep();
    expect(f.runtime.paused).toHaveLength(1);
  });

  test('invalid state never partially adopts earlier valid records', async () => {
    const f = fixture();
    await f.manager.ensure('chief:one');
    const files = readdirSync(f.stateRoot, { recursive: true }).filter(
      (name): name is string => typeof name === 'string' && name.endsWith('.json'),
    );
    const statePath = join(f.stateRoot, files[0] ?? '');
    const saved = JSON.parse(readFileSync(statePath, 'utf8')) as {
      computers: Array<{ scopeKey: string; name: string; lastUsedAt: number; holdUntil: number }>;
    };
    saved.computers.push({
      scopeKey: 'chief:two',
      name: computerMachineName('chief:foreign'),
      lastUsedAt: 0,
      holdUntil: 0,
    });
    writeFileSync(statePath, JSON.stringify(saved));
    const restarted = new ContainerComputerOrbs(f.options);
    await expect(restarted.presence()).rejects.toThrow(/scope|name/i);
    expect(restarted.known()).toEqual([]);
    saved.computers.pop();
    writeFileSync(statePath, JSON.stringify(saved));
    expect((await restarted.presence())[0]?.state).toBe('running');
  });

  test('persisted scope mapping binds owner and verifies its logical name', async () => {
    const f = fixture();
    await f.manager.ensure('chief:one');
    const restarted = new ContainerComputerOrbs(f.options);
    expect((await restarted.presence())[0]?.state).toBe('running');
    const files = readdirSync(f.stateRoot, { recursive: true }).filter(
      (name): name is string => typeof name === 'string' && name.endsWith('.json'),
    );
    expect(files).toHaveLength(1);
    const statePath = join(f.stateRoot, files[0] ?? '');
    const saved = JSON.parse(readFileSync(statePath, 'utf8')) as {
      ownerId: string;
      computers: Array<{ name: string }>;
    };
    saved.computers[0]!.name = computerMachineName('chief:foreign');
    writeFileSync(statePath, JSON.stringify(saved));
    const invalid = new ContainerComputerOrbs(f.options);
    await expect(invalid.presence()).rejects.toThrow(/scope|name/i);
    saved.computers[0]!.name = computerMachineName('chief:one');
    saved.ownerId = 'machine-other';
    writeFileSync(statePath, JSON.stringify(saved));
    const foreign = new ContainerComputerOrbs(f.options);
    await expect(foreign.presence()).rejects.toThrow(/owner/i);
  });
});
