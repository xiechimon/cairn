import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { basename, join } from 'node:path';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { ContainerOrbProvider } from '../src/orb/container-provider.js';
import { OrbLifecycle } from '../src/orb/lifecycle.js';
import { PodmanOrbRuntime } from '../src/orb/podman.js';
import type { OrbExecOptions, OrbExecResult, OrbHandle } from '../src/orb/provider.js';
import type { OrbRuntime, OrbRuntimeState, OrbSpawnSpec } from '../src/orb/runtime.js';
import { createOrbCheckout } from './orb-dist-fixture.js';
import { FakePodman } from './podman-fake.js';

const IMAGE = 'cairn-orb-base:0123456789ab';

class FakeRuntime implements OrbRuntime {
  readonly name = 'podman';
  readonly calls: string[] = [];
  readonly specs: OrbSpawnSpec[] = [];
  readonly containers = new Map<string, { image: string; state: 'running' | 'paused' }>();
  readonly images = new Set([IMAGE]);
  rootless = true;
  spawnError: Error | undefined;
  pauseLeavesRunning = false;

  async health() {
    this.calls.push('health');
    return { version: '6.1.4', rootless: this.rootless };
  }
  async buildImage(): Promise<void> {
    this.calls.push('buildImage');
  }
  async imageExists(ref: string) {
    this.calls.push(`imageExists ${ref}`);
    return this.images.has(ref);
  }
  async spawn(spec: OrbSpawnSpec, options: { signal?: AbortSignal } = {}) {
    this.calls.push(`spawn ${spec.orbId}`);
    this.specs.push(spec);
    options.signal?.throwIfAborted();
    if (this.spawnError) throw this.spawnError;
    const existing = this.containers.get(spec.orbId);
    this.containers.set(spec.orbId, { image: existing?.image ?? spec.image, state: 'running' });
  }
  async pause(orbId: string) {
    this.calls.push(`pause ${orbId}`);
    const container = this.containers.get(orbId);
    if (container && !this.pauseLeavesRunning) container.state = 'paused';
  }
  async remove(orbId: string) {
    this.calls.push(`remove ${orbId}`);
    this.containers.delete(orbId);
  }
  async list(): Promise<OrbRuntimeState[]> {
    this.calls.push('list');
    return [...this.containers].map(([orbId, container]) => ({ orbId, ...container }));
  }
  async exec(_orbId: string, _argv: readonly string[], _options?: OrbExecOptions) {
    return { code: 0, stdout: '', stderr: '' } satisfies OrbExecResult;
  }
  async removeImage(): Promise<void> {
    this.calls.push('removeImage');
  }

  callsTo(verb: string): string[] {
    return this.calls.filter((call) => call.split(' ')[0] === verb);
  }
}

function fixture(overrides: { runtime?: OrbRuntime; egressSocketPath?: string } = {}) {
  const root = makeTestTempDir('container-provider-');
  onTestFinished(() => {
    releaseTestTempDir(root);
  });
  const checkout = createOrbCheckout(root);
  const fake = new FakeRuntime();
  const runtimeRoot = join(root, 'run', 'cairn-orb');
  const distRoot = join(root, 'home', 'orb', 'dist');
  const seedRoot = join(root, 'home', 'orb', 'seed');
  const stateFile = join(root, 'home', 'orb-state', 'containers.json');
  const options = {
    runtime: overrides.runtime ?? fake,
    image: IMAGE,
    runtimeRoot,
    distRoot,
    seedRoot,
    stateFile,
    distSource: checkout.distSource,
    runner: checkout.runner,
    egressSocketPath: overrides.egressSocketPath,
  };
  const provider = new ContainerOrbProvider(options);
  return { root, fake, provider, options, runtimeRoot, distRoot, seedRoot, stateFile, checkout };
}

async function providerEgressSocket(name = 'cairn-orb-egress') {
  const root = makeTestTempDir('egr-');
  const directory = join(root, name);
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(directory, 0o700);
  const socketPath = join(directory, 'egress.sock');
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  chmodSync(socketPath, 0o600);
  onTestFinished(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    releaseTestTempDir(root);
  });
  return socketPath;
}

async function started(context: ReturnType<typeof fixture>, conversationId = 'C') {
  const handle = await context.provider.ensure({ conversationId, projectId: 'P' });
  await context.provider.prepare(handle);
  await context.provider.start(handle);
  return handle;
}

describe('ContainerOrbProvider construction', () => {
  test.each([
    'alpine:latest',
    'cairn-orb-base:latest',
    'cairn-orb-base',
    'cairn-orb-base:',
    'cairn-orb-snap:abc',
    'docker.io/cairn-orb-base:abc',
    'cairn-orb-base:a b',
    '--rm',
    '',
  ])('refuses the image tag %j', (image) => {
    const { options } = fixture();
    expect(() => new ContainerOrbProvider({ ...options, image })).toThrow(
      'Orb image must be a pinned cairn-orb-base:<recipe hash> tag',
    );
  });

  test('rejects persisted names outside its namespace before any runtime call', () => {
    const { options, fake, stateFile } = fixture();
    mkdirSync(join(stateFile, '..'), { recursive: true });
    writeFileSync(stateFile, JSON.stringify([{ id: 'unrelated', conversationId: 'A' }]));
    expect(() => new ContainerOrbProvider(options)).toThrow('Invalid orb machine name');
    expect(fake.calls).toEqual([]);
  });
});

describe('ContainerOrbProvider.ensure', () => {
  test('registers one handle per conversation without touching the runtime', async () => {
    const { provider, fake } = fixture();
    const [first, again] = await Promise.all([
      provider.ensure({ conversationId: 'C', projectId: 'P' }),
      provider.ensure({ conversationId: 'C', projectId: 'P' }),
    ]);
    expect(again).toBe(first);
    expect(first).toMatchObject({ id: 'cairn-orb-C', running: false, projectId: 'P' });
    expect(fake.calls).toEqual([]);
  });

  test('bounds names, keeps them unique and never aliases base or computer', async () => {
    const { provider } = fixture();
    const long = await provider.ensure({ conversationId: 'a'.repeat(150), projectId: 'P' });
    const other = await provider.ensure({ conversationId: `${'a'.repeat(149)}b`, projectId: 'P' });
    expect(long.id.length).toBeLessThanOrEqual(64);
    expect(other.id).not.toBe(long.id);
    for (const conversationId of ['base', 'computer', 'Computer-a']) {
      const handle = await provider.ensure({ conversationId, projectId: 'P' });
      expect(handle.id).not.toBe(`cairn-orb-${conversationId}`);
      expect(handle.id).toMatch(/^cairn-orb-[a-f0-9]{54}$/);
    }
  });

  test('persists the handle in the state file', async () => {
    const { provider, stateFile } = fixture();
    await provider.ensure({ conversationId: 'C', projectId: 'P' });
    const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as OrbHandle[];
    expect(saved.map((handle) => handle.id)).toEqual(['cairn-orb-C']);
    expect(lstatSync(stateFile).mode & 0o777).toBe(0o600);
  });
});

describe('ContainerOrbProvider.prepare', () => {
  test('creates the dist, seed and 0700 runtime directories and publishes the release', async () => {
    const { provider, distRoot, seedRoot, runtimeRoot } = fixture();
    const handle = await provider.ensure({ conversationId: 'C', projectId: 'P' });
    const directory = await provider.prepare(handle);
    expect(directory).toBe(join(runtimeRoot, 'cairn-orb-C'));
    expect(lstatSync(directory).mode & 0o7777).toBe(0o700);
    expect(lstatSync(runtimeRoot).mode & 0o7777).toBe(0o700);
    expect(lstatSync(directory).uid).toBe(process.getuid?.());
    expect(existsSync(seedRoot)).toBe(true);
    expect(handle.expectedReleaseKey).toBe(basename(readlinkSync(join(distRoot, 'current'))));
    expect(existsSync(join(distRoot, 'current', 'dist', 'cli.mjs'))).toBe(true);
  });

  test('publishes a project seed under the seed root', async () => {
    const { provider, seedRoot, checkout } = fixture();
    const handle = await provider.ensure({ conversationId: 'C', projectId: 'P' });
    await provider.prepare(handle, checkout.checkout);
    expect(readFileSync(join(seedRoot, 'P', 'repo', 'HEAD'), 'utf8')).toContain('refs/heads');
  });

  test('refuses a runtime directory that is not owned and private', async () => {
    const { provider, runtimeRoot } = fixture();
    const handle = await provider.ensure({ conversationId: 'C', projectId: 'P' });
    await provider.prepare(handle);
    chmodSync(join(runtimeRoot, handle.id), 0o755);
    await expect(provider.prepare(handle)).rejects.toThrow('must have mode 0700');
  });

  test('refuses a runtime directory replaced by a symlink', async () => {
    const { provider, runtimeRoot, root } = fixture();
    mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
    chmodSync(runtimeRoot, 0o700);
    mkdirSync(join(root, 'elsewhere'));
    symlinkSync(join(root, 'elsewhere'), join(runtimeRoot, 'cairn-orb-C'));
    const handle = await provider.ensure({ conversationId: 'C', projectId: 'P' });
    await expect(provider.prepare(handle)).rejects.toThrow('must be a real directory');
  });

  test('rejects a handle outside the namespace before touching the disk', async () => {
    const { provider, distRoot } = fixture();
    const handle = await provider.ensure({ conversationId: 'C', projectId: 'P' });
    await expect(provider.prepare({ ...handle, id: '../../etc' })).rejects.toThrow(
      'Invalid orb machine name',
    );
    expect(existsSync(distRoot)).toBe(false);
  });
});

describe('ContainerOrbProvider.start', () => {
  test('spawns with the daemon directories, limits and no egress', async () => {
    const context = fixture();
    const handle = await started(context);
    expect(context.fake.specs).toEqual([
      {
        orbId: 'cairn-orb-C',
        image: IMAGE,
        mounts: [
          {
            source: join(context.runtimeRoot, 'cairn-orb-C'),
            target: '/run/cairn',
            readonly: false,
          },
          { source: context.distRoot, target: '/opt/cairn/daemon', readonly: true },
          { source: context.seedRoot, target: '/seed', readonly: true },
        ],
        env: { CAIRN_ORB: '1' },
        limits: { cpus: 4, memoryBytes: 4 * 1024 ** 3, pids: 4096 },
        egress: 'none',
      },
    ]);
    expect(handle.running).toBe(true);
    expect(handle.releaseKey).toBe(handle.expectedReleaseKey);
    expect(handle.seedKey).toBeNull();
  });

  test('passes the egress socket when one is configured', async () => {
    const context = fixture({ egressSocketPath: '/run/user/1000/cairn-orb/egress.sock' });
    await started(context);
    expect(context.fake.specs[0]?.egress).toEqual({
      socketPath: '/run/user/1000/cairn-orb/egress.sock',
    });
  });

  test('a running container is offered again with the current egress policy', async () => {
    const context = fixture();
    const handle = await started(context);
    const release = handle.releaseKey;
    await context.provider.start(handle);
    expect(context.fake.callsTo('spawn')).toHaveLength(2);
    expect(context.fake.specs[1]?.egress).toBe('none');
    expect(handle.releaseKey).toBe(release);
    expect(handle.notes).toHaveLength(1);
    expect(handle.running).toBe(true);
  });

  test('a stopped container is spawned again and resets the authenticated release', async () => {
    const context = fixture();
    const handle = await started(context);
    context.provider.authenticateRelease(handle, handle.expectedReleaseKey ?? '');
    await context.provider.stop(handle);
    await context.provider.start(handle);
    expect(context.fake.callsTo('spawn')).toHaveLength(2);
    expect(context.fake.containers.size).toBe(1);
    expect(handle.running).toBe(true);
  });

  test('a container removed or stopped outside the daemon is spawned again', async () => {
    const context = fixture();
    const handle = await started(context);
    context.fake.containers.clear();
    await context.provider.start(handle);
    expect(context.fake.callsTo('spawn')).toHaveLength(2);
  });

  test('the spawn timeline is health, list, image check, spawn for a new container', async () => {
    const context = fixture();
    await started(context);
    expect(context.fake.calls).toEqual([
      'health',
      'list',
      `imageExists ${IMAGE}`,
      'spawn cairn-orb-C',
    ]);
  });

  test('a missing image fails with an actionable message and never spawns', async () => {
    const context = fixture();
    context.fake.images.clear();
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    await expect(context.provider.start(handle)).rejects.toThrow(
      `Orb image ${IMAGE} is missing; build it before starting an Orb`,
    );
    expect(context.fake.callsTo('spawn')).toEqual([]);
    expect(handle.running).toBe(false);
  });

  test('an existing container does not need the image', async () => {
    const context = fixture();
    const handle = await started(context);
    await context.provider.stop(handle);
    context.fake.images.clear();
    await context.provider.start(handle);
    expect(handle.running).toBe(true);
  });

  test('a runtime that is not rootless is refused before anything is spawned', async () => {
    const context = fixture();
    context.fake.rootless = false;
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    await expect(context.provider.start(handle)).rejects.toThrow(
      'Orb podman runtime must be rootless',
    );
    expect(context.fake.callsTo('spawn')).toEqual([]);
  });

  test('start before prepare fails because the runtime directory is missing', async () => {
    const context = fixture();
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await expect(context.provider.start(handle)).rejects.toThrow(
      'Orb runtime directory must exist before start',
    );
    expect(context.fake.callsTo('spawn')).toEqual([]);
  });

  test('a failing spawn surfaces the error without pausing an absent container', async () => {
    const context = fixture();
    context.fake.spawnError = new Error('podman create failed (125): boom');
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    await expect(context.provider.start(handle)).rejects.toThrow('boom');
    expect(handle.running).toBe(false);
    expect(context.fake.callsTo('pause')).toEqual([]);
    const saved = JSON.parse(readFileSync(context.stateFile, 'utf8')) as OrbHandle[];
    expect(saved[0]?.running).toBe(false);
  });

  test('a spawn that leaves an owned container running pauses it on failure', async () => {
    const context = fixture();
    context.fake.spawn = async (spec) => {
      context.fake.containers.set(spec.orbId, { image: spec.image, state: 'running' });
      throw new Error('partial spawn');
    };
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    await expect(context.provider.start(handle)).rejects.toThrow('partial spawn');
    expect(context.fake.callsTo('pause')).toEqual(['pause cairn-orb-C']);
    expect(handle.running).toBe(false);
  });

  test('a failed start can be retried', async () => {
    const context = fixture();
    context.fake.spawnError = new Error('boom');
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    await expect(context.provider.start(handle)).rejects.toThrow('boom');
    context.fake.spawnError = undefined;
    await context.provider.start(handle);
    expect(handle.running).toBe(true);
  });

  test('an aborted signal reaches the runtime and leaves the handle stopped', async () => {
    const context = fixture();
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    const controller = new AbortController();
    controller.abort();
    await expect(context.provider.start(handle, { signal: controller.signal })).rejects.toThrow();
    expect(context.fake.callsTo('spawn')).toEqual([]);
    expect(handle.running).toBe(false);
  });

  test('an abort before the container is created leaves nothing to pause', async () => {
    const context = fixture();
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    const controller = new AbortController();
    const spawn = context.fake.spawn.bind(context.fake);
    context.fake.spawn = async (spec, options) => {
      controller.abort();
      return spawn(spec, options);
    };
    await expect(context.provider.start(handle, { signal: controller.signal })).rejects.toThrow();
    expect(context.fake.callsTo('pause')).toEqual([]);
    expect(handle.running).toBe(false);
  });

  test('operations reject a handle outside the namespace before any runtime call', async () => {
    const context = fixture();
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    const forged = { ...handle, id: 'cairn-orb-base' };
    await expect(context.provider.start(forged)).rejects.toThrow('Invalid orb machine name');
    await expect(context.provider.stop(forged)).rejects.toThrow('Invalid orb machine name');
    await expect(context.provider.destroy(forged)).rejects.toThrow('Invalid orb machine name');
    expect(() => context.provider.authenticateRelease(forged, 'x')).toThrow(
      'Invalid orb machine name',
    );
    expect(context.fake.calls).toEqual([]);
  });
});

describe('ContainerOrbProvider.stop and destroy', () => {
  test('stop pauses the container and records it', async () => {
    const context = fixture();
    const handle = await started(context);
    await context.provider.stop(handle);
    expect(context.fake.callsTo('pause')).toEqual(['pause cairn-orb-C']);
    expect(handle.running).toBe(false);
    expect(context.fake.containers.get('cairn-orb-C')?.state).toBe('paused');
  });

  test('stop clears a stale outbox so a recovered step can recreate it', async () => {
    const context = fixture();
    const handle = await started(context);
    const directory = join(context.runtimeRoot, handle.id);
    const outside = join(context.root, 'outside');
    writeFileSync(outside, 'keep');
    mkdirSync(join(directory, 'outbox'), { mode: 0o700 });
    writeFileSync(join(directory, 'outbox', 'step-1.jsonl'), 'x');
    symlinkSync(outside, join(directory, 'outbox', 'link'));
    await context.provider.stop(handle);
    expect(existsSync(join(directory, 'outbox'))).toBe(false);
    expect(readFileSync(outside, 'utf8')).toBe('keep');
    expect(lstatSync(directory).isDirectory()).toBe(true);
    mkdirSync(join(directory, 'outbox'), { mode: 0o700 });
  });

  test('a stop that fails to pause leaves the outbox in place', async () => {
    const context = fixture();
    const handle = await started(context);
    const outbox = join(context.runtimeRoot, handle.id, 'outbox');
    mkdirSync(outbox, { mode: 0o700 });
    context.fake.pauseLeavesRunning = true;
    await expect(context.provider.stop(handle)).rejects.toThrow();
    expect(existsSync(outbox)).toBe(true);
  });

  test('stop of a handle that is not running does nothing', async () => {
    const context = fixture();
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.stop(handle);
    expect(context.fake.calls).toEqual([]);
  });

  test('a container that survives pause is reported and the handle stays running', async () => {
    const context = fixture();
    const handle = await started(context);
    context.fake.pauseLeavesRunning = true;
    await expect(context.provider.stop(handle)).rejects.toThrow(
      'Orb container is still running after pause',
    );
    expect(handle.running).toBe(true);
  });

  test('destroy removes the container and forgets the handle, also for an absent container', async () => {
    const context = fixture();
    const handle = await started(context);
    await context.provider.destroy(handle);
    expect(context.fake.callsTo('remove')).toEqual(['remove cairn-orb-C']);
    expect(await context.provider.list()).toEqual([]);
    expect(JSON.parse(readFileSync(context.stateFile, 'utf8'))).toEqual([]);
    const idle = await context.provider.ensure({ conversationId: 'D', projectId: 'P' });
    await context.provider.destroy(idle);
    expect(context.fake.callsTo('remove')).toEqual(['remove cairn-orb-C', 'remove cairn-orb-D']);
  });
});

describe('ContainerOrbProvider recovery', () => {
  test('reconciles persisted handles with the runtime on first use', async () => {
    const context = fixture();
    const first = await started(context, 'A');
    await started(context, 'B');
    await context.provider.stop(first);
    const recovered = new ContainerOrbProvider(context.options);
    const handles = await recovered.list();
    expect(handles.map((handle) => [handle.conversationId, handle.running])).toEqual([
      ['A', false],
      ['B', true],
    ]);
    context.fake.containers.clear();
    const again = new ContainerOrbProvider(context.options);
    expect((await again.list()).map((handle) => handle.running)).toEqual([false, false]);
  });

  test('a restarted daemon starts a stopped container without creating a second one', async () => {
    const context = fixture();
    const handle = await started(context);
    await context.provider.stop(handle);
    const recovered = new ContainerOrbProvider(context.options);
    const restored = await recovered.ensure({ conversationId: 'C', projectId: 'P' });
    await recovered.prepare(restored);
    await recovered.start(restored);
    expect(context.fake.containers.size).toBe(1);
    expect(restored.running).toBe(true);
  });

  test('a container left by a crash before the state file was written is adopted by name', async () => {
    const context = fixture();
    context.fake.containers.set('cairn-orb-C', { image: IMAGE, state: 'paused' });
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    await context.provider.start(handle);
    expect(context.fake.containers.size).toBe(1);
    expect(context.fake.specs[0]?.orbId).toBe('cairn-orb-C');
    expect(context.fake.callsTo('imageExists')).toEqual([]);
  });

  test('authenticateRelease accepts only the published release', async () => {
    const context = fixture();
    const handle = await started(context);
    expect(() => context.provider.authenticateRelease(handle, 'not-a-release')).toThrow();
    expect(() =>
      context.provider.authenticateRelease(handle, '9.9.9-abcd-dist-bbbbbbbbbbbbbbbb'),
    ).toThrow('Orb authenticated release does not match published release');
    context.provider.authenticateRelease(handle, handle.expectedReleaseKey ?? '');
    expect(handle.releaseKey).toBe(handle.expectedReleaseKey);
  });
});

describe('ContainerOrbProvider over PodmanOrbRuntime', () => {
  test('refuses a foreign same-name container without pausing or adopting it', async () => {
    const podman = new FakePodman();
    podman.images.add(IMAGE);
    podman.containers.set('cairn-orb-C', {
      name: 'cairn-orb-C',
      image: IMAGE,
      state: 'running',
      labels: {},
      create: [],
    });
    const context = fixture({
      runtime: new PodmanOrbRuntime({ ownerId: 'machine-alpha', runner: podman.runner }),
    });
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    await expect(context.provider.start(handle)).rejects.toThrow(
      'Orb ownership labels do not match',
    );
    expect(podman.containers.get('cairn-orb-C')?.state).toBe('running');
    expect(handle.running).toBe(false);
    await expect(context.provider.destroy(handle)).rejects.toThrow(
      'Orb ownership labels do not match',
    );
    expect(podman.containers.get('cairn-orb-C')?.state).toBe('running');
    const lifecycle = new OrbLifecycle(context.provider, { max: 2 });
    await lifecycle
      .sweep({ activeConversationIds: [], now: Date.now() + 73 * 60 * 60_000 })
      .catch(() => {});
    expect(podman.containers.get('cairn-orb-C')?.state).toBe('running');
  });
  test('every create carries --network none and no widening flag', async () => {
    const podman = new FakePodman();
    podman.images.add(IMAGE);
    const context = fixture({
      runtime: new PodmanOrbRuntime({ ownerId: 'machine-alpha', runner: podman.runner }),
    });
    for (const conversationId of ['A', 'B']) await started(context, conversationId);
    const creates = podman.callsOf('create');
    expect(creates).toHaveLength(2);
    for (const argv of creates) {
      const joined = argv.join(' ');
      expect(joined).toContain('--network none');
      expect(joined).not.toMatch(/--privileged|--cap-drop=all|no-new-privileges|--network host/i);
      expect(argv).toContain(`${context.distRoot}:/opt/cairn/daemon:ro`);
      expect(argv).toContain(`${context.seedRoot}:/seed:ro`);
      expect(argv.at(-1)).toBe(IMAGE);
    }
    expect(podman.calls[0]).toEqual(['podman', 'info', '--format', 'json']);
  });

  test('restarting without an egress socket replaces a retained running container', async () => {
    const socketPath = await providerEgressSocket();
    const podman = new FakePodman();
    podman.images.add(IMAGE);
    const runtime = new PodmanOrbRuntime({ ownerId: 'machine-alpha', runner: podman.runner });
    const context = fixture({ runtime, egressSocketPath: socketPath });
    await started(context);
    const restarted = new ContainerOrbProvider({ ...context.options, egressSocketPath: undefined });
    const handle = await restarted.ensure({ conversationId: 'C', projectId: 'P' });
    await restarted.prepare(handle);
    await restarted.start(handle);
    const creates = podman.callsOf('create');
    expect(creates).toHaveLength(2);
    expect(creates[1]?.join(' ')).not.toContain('CAIRN_ORB_EGRESS_SOCKET');
    expect(creates[1]?.join(' ')).not.toContain(socketPath);
    expect(podman.callsOf('rm')).toHaveLength(1);
    expect(podman.callsOf('rm')[0]).not.toContain('--volumes');
    expect(podman.containers.get('cairn-orb-C')?.state).toBe('running');
    expect(existsSync(join(context.runtimeRoot, 'cairn-orb-C'))).toBe(true);
    expect(handle.running).toBe(true);
  });

  test('restarting without an egress socket replaces a paused container instead of resuming it', async () => {
    const socketPath = await providerEgressSocket();
    const podman = new FakePodman();
    podman.images.add(IMAGE);
    const runtime = new PodmanOrbRuntime({ ownerId: 'machine-alpha', runner: podman.runner });
    const context = fixture({ runtime, egressSocketPath: socketPath });
    const handle = await started(context);
    await context.provider.stop(handle);
    const restarted = new ContainerOrbProvider({ ...context.options, egressSocketPath: undefined });
    const restored = await restarted.ensure({ conversationId: 'C', projectId: 'P' });
    await restarted.prepare(restored);
    await restarted.start(restored);
    expect(podman.callsOf('unpause')).toEqual([]);
    expect(podman.callsOf('create')).toHaveLength(2);
    expect(podman.callsOf('create')[1]?.join(' ')).not.toContain(socketPath);
    expect(podman.containers.get('cairn-orb-C')?.state).toBe('running');
    expect(existsSync(join(context.runtimeRoot, 'cairn-orb-C'))).toBe(true);
  });

  test('a rootful podman is refused', async () => {
    const podman = new FakePodman();
    podman.images.add(IMAGE);
    podman.info = { version: { Version: '6.1.4' }, host: { security: { rootless: false } } };
    const context = fixture({
      runtime: new PodmanOrbRuntime({ ownerId: 'machine-alpha', runner: podman.runner }),
    });
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    await expect(context.provider.start(handle)).rejects.toThrow('must be rootless');
    expect(podman.callsOf('create')).toEqual([]);
  });

  test('malformed podman output fails the start with a clear error', async () => {
    const podman = new FakePodman();
    podman.images.add(IMAGE);
    podman.psOutput = 'Error: database is locked';
    const context = fixture({
      runtime: new PodmanOrbRuntime({ ownerId: 'machine-alpha', runner: podman.runner }),
    });
    const handle = await context.provider.ensure({ conversationId: 'C', projectId: 'P' });
    await context.provider.prepare(handle);
    await expect(context.provider.start(handle)).rejects.toThrow(
      'podman ps returned malformed JSON',
    );
    expect(podman.callsOf('create')).toEqual([]);
    expect(handle.running).toBe(false);
  });
});

describe('ContainerOrbProvider with OrbLifecycle', () => {
  test('caps concurrency, evicts idle containers and removes closed ones', async () => {
    const context = fixture();
    const lifecycle = new OrbLifecycle(context.provider, { max: 2 });
    const releases: (() => void)[] = [];
    const runs = ['A', 'B', 'C'].map((conversationId) =>
      lifecycle.run({ conversationId, projectId: 'P' }, async (handle) => {
        await context.provider.prepare(handle);
        await context.provider.start(handle);
        await new Promise<void>((resolve) => releases.push(resolve));
      }),
    );
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]?.();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[1]?.();
    releases[2]?.();
    await Promise.all(runs);
    expect((await context.provider.list()).filter((handle) => handle.running)).toHaveLength(2);
    expect(context.fake.callsTo('pause').length).toBeGreaterThan(0);
    await lifecycle.sweep({ activeConversationIds: ['A'], now: Date.now() + 73 * 60 * 60_000 });
    expect((await context.provider.list()).map((handle) => handle.conversationId)).toEqual(['A']);
    expect([...context.fake.containers.keys()]).toEqual(['cairn-orb-A']);
  });
});
