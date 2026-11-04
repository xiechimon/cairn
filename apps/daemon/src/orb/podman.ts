import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { ORB_NAME_PATTERN } from './names.js';
import {
  type OrbCommandRunner,
  type OrbExecOptions,
  type OrbExecResult,
  runOrbCommand,
} from './provider.js';
import type { OrbRuntime, OrbRuntimeState, OrbSpawnSpec } from './runtime.js';

export const ORB_EGRESS_TARGET = '/run/cairn-egress/egress.sock';
export const ORB_EGRESS_ENV = 'CAIRN_ORB_EGRESS_SOCKET';

const ORB_LABEL = 'cairn.orb';
const CONVERSATION_LABEL = 'cairn.conversation';
const NAME_PREFIX = 'cairn-orb-';
const STOP_GRACE_SECONDS = '5';
const KEEP_ID_USERNS = '--userns=keep-id:uid=1000,gid=1000';
const DROPPED_CAPABILITIES = ['FSETID', 'NET_BIND_SERVICE', 'SETPCAP', 'SYS_CHROOT'];
const IMAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/;
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MISSING_CONTAINER = /no such container|no container with name or ID/i;
const NAME_IN_USE = /already in use/i;

const labelsSchema = z.record(z.string(), z.string()).nullish();
const inspectSchema = z
  .array(
    z.object({
      State: z.object({ Status: z.string() }),
      Config: z.object({ Labels: labelsSchema }).optional(),
    }),
  )
  .min(1);
const listSchema = z.array(
  z.object({
    Names: z.array(z.string()).min(1),
    Image: z.string(),
    State: z.string(),
    Labels: labelsSchema,
  }),
);
const infoSchema = z.object({
  version: z.object({ Version: z.string() }),
  host: z.object({ security: z.object({ rootless: z.boolean() }) }),
});

function assertContainerName(orbId: string): void {
  if (!ORB_NAME_PATTERN.test(orbId)) throw new Error('Invalid orb container name');
}

function orbLabelsMatch(orbId: string, labels: Record<string, string> | null | undefined): boolean {
  return (
    labels?.[ORB_LABEL] === '1' && labels[CONVERSATION_LABEL] === orbId.slice(NAME_PREFIX.length)
  );
}

function assertImageReference(reference: string): void {
  if (!IMAGE_REFERENCE.test(reference)) throw new Error(`Invalid image reference: ${reference}`);
}

function assertVariableName(name: string, kind: string): void {
  if (!VARIABLE_NAME.test(name)) throw new Error(`Invalid ${kind} name: ${name}`);
}

function isForbiddenMountSource(source: string): boolean {
  const home = homedir();
  const runtimeDirectory = process.env.XDG_RUNTIME_DIR;
  return (
    source === '/' ||
    source === home ||
    home.startsWith(`${source}/`) ||
    source === runtimeDirectory ||
    ['/run', '/var/run', '/run/user'].includes(source) ||
    /^\/run\/user\/\d+$/.test(source) ||
    /^\/(?:var\/)?run\/(?:docker|podman|containerd)(?:[./]|$)/.test(source) ||
    /\/(?:docker|podman|containerd)\.sock$/.test(source)
  );
}

function assertMountTarget(target: string): void {
  if (!isAbsolute(target) || target.includes(':') || target.includes('\0'))
    throw new Error(`Orb mount target must be an absolute path without ':': ${target}`);
}

function assertMount(source: string, target: string): void {
  if (
    !isAbsolute(source) ||
    source.includes(':') ||
    source.includes('\0') ||
    source.split('/').includes('..')
  )
    throw new Error(`Orb mount source must be an absolute path without ':' or '..': ${source}`);
  if (isForbiddenMountSource(resolve(source)))
    throw new Error(`Orb mount source is not allowed: ${source}`);
  assertMountTarget(target);
}

function assertLimits(limits: OrbSpawnSpec['limits']): void {
  if (
    !Number.isFinite(limits.cpus) ||
    limits.cpus <= 0 ||
    !Number.isInteger(limits.memoryBytes) ||
    limits.memoryBytes <= 0 ||
    !Number.isInteger(limits.pids) ||
    limits.pids <= 0
  )
    throw new Error('Invalid orb resource limits');
}

function bindMount(source: string, target: string, readonly: boolean): string[] {
  assertMount(source, target);
  return ['-v', `${source}:${target}:${readonly ? 'ro' : 'rw'}`];
}

function listedState(state: string): OrbRuntimeState['state'] {
  return state === 'running' || state === 'stopping' ? 'running' : 'paused';
}

export class PodmanOrbRuntime implements OrbRuntime {
  readonly name = 'podman';
  private readonly runner: OrbCommandRunner;
  private readonly binary: string;
  private readonly command: readonly string[];
  private readonly spawning = new Map<string, Promise<void>>();

  constructor(
    options: { runner?: OrbCommandRunner; binary?: string; command?: readonly string[] } = {},
  ) {
    this.runner = options.runner ?? runOrbCommand;
    this.binary = options.binary ?? 'podman';
    this.command = options.command ?? [];
  }

  async health(): Promise<{ version: string; rootless: boolean }> {
    const result = await this.run(['info', '--format', 'json']);
    const info = this.parse('info', result.stdout, infoSchema);
    return { version: info.version.Version, rootless: info.host.security.rootless };
  }

  async buildImage(input: {
    contextDir: string;
    tag: string;
    buildArgs: Record<string, string>;
  }): Promise<void> {
    assertImageReference(input.tag);
    if (!isAbsolute(input.contextDir)) throw new Error('Orb image context must be absolute');
    const buildArgs = Object.entries(input.buildArgs).flatMap(([name, value]) => {
      assertVariableName(name, 'build argument');
      return ['--build-arg', `${name}=${value}`];
    });
    await this.run([
      'build',
      '--http-proxy=false',
      '--tag',
      input.tag,
      ...buildArgs,
      input.contextDir,
    ]);
  }

  async imageExists(ref: string): Promise<boolean> {
    assertImageReference(ref);
    const result = await this.podman(['image', 'exists', ref]);
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw this.failure(['image'], result);
  }

  async spawn(spec: OrbSpawnSpec, options: { signal?: AbortSignal } = {}): Promise<void> {
    const createArgv = this.createArgv(spec);
    options.signal?.throwIfAborted();
    const previous = this.spawning.get(spec.orbId) ?? Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(() => this.spawnContainer(spec, createArgv, options.signal));
    this.spawning.set(spec.orbId, current);
    try {
      await current;
    } finally {
      if (this.spawning.get(spec.orbId) === current) this.spawning.delete(spec.orbId);
    }
  }

  async pause(orbId: string, options: { snapshotImage?: string } = {}): Promise<void> {
    assertContainerName(orbId);
    if (options.snapshotImage !== undefined) assertImageReference(options.snapshotImage);
    const stop = await this.podman(['stop', '--time', STOP_GRACE_SECONDS, orbId]);
    if (stop.code !== 0) {
      if (!MISSING_CONTAINER.test(stop.stderr)) throw this.failure(['stop'], stop);
      if (options.snapshotImage !== undefined)
        throw new Error(`Cannot snapshot ${orbId}: no such container`);
      return;
    }
    if (options.snapshotImage !== undefined)
      await this.run(['commit', '--quiet', orbId, options.snapshotImage]);
  }

  async remove(orbId: string): Promise<void> {
    assertContainerName(orbId);
    const result = await this.podman([
      'rm',
      '--force',
      '--ignore',
      '--time',
      STOP_GRACE_SECONDS,
      orbId,
    ]);
    if (result.code !== 0 && !MISSING_CONTAINER.test(result.stderr))
      throw this.failure(['rm'], result);
  }

  async list(): Promise<OrbRuntimeState[]> {
    const result = await this.run([
      'ps',
      '--all',
      '--filter',
      `label=${ORB_LABEL}=1`,
      '--format',
      'json',
    ]);
    return this.parse('ps', result.stdout, listSchema).flatMap((row) => {
      const orbId = row.Names[0] ?? '';
      return ORB_NAME_PATTERN.test(orbId) && orbLabelsMatch(orbId, row.Labels)
        ? [{ orbId, image: row.Image, state: listedState(row.State) }]
        : [];
    });
  }

  async exec(
    orbId: string,
    argv: readonly string[],
    options: OrbExecOptions = {},
  ): Promise<OrbExecResult> {
    assertContainerName(orbId);
    if (argv.length === 0) throw new Error('Orb exec command is empty');
    const environment = Object.entries(options.env ?? {}).flatMap(([name, value]) => {
      assertVariableName(name, 'environment variable');
      return value === undefined ? [] : ['--env', `${name}=${value}`];
    });
    const interactive = options.input !== undefined || options.onInput !== undefined;
    return this.podman(
      [
        'exec',
        ...(interactive ? ['--interactive'] : []),
        ...environment,
        ...(options.cwd === undefined ? [] : ['--workdir', options.cwd]),
        orbId,
        ...argv,
      ],
      {
        signal: options.signal,
        input: options.input,
        onStdout: options.onStdout,
        onStderr: options.onStderr,
        onInput: options.onInput,
      },
    );
  }

  async removeImage(ref: string): Promise<void> {
    assertImageReference(ref);
    await this.run(['rmi', '--ignore', ref]);
  }

  private createArgv(spec: OrbSpawnSpec, image = spec.image): string[] {
    assertContainerName(spec.orbId);
    assertImageReference(spec.image);
    if (spec.snapshotImage !== undefined) assertImageReference(spec.snapshotImage);
    assertLimits(spec.limits);
    const mounts = spec.mounts.flatMap((mount) =>
      bindMount(mount.source, mount.target, mount.readonly),
    );
    if (spec.persistentHome) {
      const { volume, target } = spec.persistentHome;
      if (!VOLUME_NAME.test(volume)) throw new Error(`Invalid volume name: ${volume}`);
      assertMountTarget(target);
      mounts.push('-v', `${volume}:${target}:rw`);
    }
    const environment = { ...spec.env };
    if (spec.egress !== 'none') {
      mounts.push(...bindMount(spec.egress.socketPath, ORB_EGRESS_TARGET, false));
      environment[ORB_EGRESS_ENV] = ORB_EGRESS_TARGET;
    }
    const variables = Object.entries(environment).flatMap(([name, value]) => {
      assertVariableName(name, 'environment variable');
      return ['-e', `${name}=${value}`];
    });
    return [
      'create',
      '--name',
      spec.orbId,
      '--label',
      `${ORB_LABEL}=1`,
      '--label',
      `${CONVERSATION_LABEL}=${spec.orbId.slice(NAME_PREFIX.length)}`,
      KEEP_ID_USERNS,
      '--network',
      'none',
      ...DROPPED_CAPABILITIES.map((capability) => `--cap-drop=${capability}`),
      '--http-proxy=false',
      '--pull=never',
      '--cpus',
      String(spec.limits.cpus),
      '--memory',
      String(spec.limits.memoryBytes),
      '--memory-swap',
      String(spec.limits.memoryBytes),
      '--pids-limit',
      String(spec.limits.pids),
      '--ulimit',
      'core=0',
      '--init',
      ...mounts,
      ...variables,
      image,
      ...this.command,
    ];
  }

  private async spawnContainer(
    spec: OrbSpawnSpec,
    createArgv: string[],
    signal: AbortSignal | undefined,
  ): Promise<void> {
    signal?.throwIfAborted();
    const existing = await this.containerStatus(spec.orbId, signal);
    if (existing !== undefined) return this.resume(spec.orbId, existing, signal);
    const snapshot =
      spec.snapshotImage !== undefined && (await this.imageExists(spec.snapshotImage))
        ? spec.snapshotImage
        : undefined;
    signal?.throwIfAborted();
    const argv = snapshot === undefined ? createArgv : this.createArgv(spec, snapshot);
    const created = await this.podman(argv, { signal });
    if (created.code !== 0) {
      if (NAME_IN_USE.test(created.stderr)) {
        const raced = await this.containerStatus(spec.orbId, signal);
        if (raced !== undefined) return this.resume(spec.orbId, raced, signal);
      }
      throw this.failure(['create'], created);
    }
    try {
      signal?.throwIfAborted();
      await this.run(['start', spec.orbId], { signal });
    } catch (error) {
      await this.podman([
        'rm',
        '--force',
        '--ignore',
        '--time',
        STOP_GRACE_SECONDS,
        spec.orbId,
      ]).catch(() => {});
      throw error;
    }
  }

  private async resume(
    orbId: string,
    status: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (status === 'running') return;
    if (status === 'paused') {
      await this.run(['unpause', orbId], { signal });
      return;
    }
    if (['created', 'exited', 'stopped', 'configured'].includes(status)) {
      await this.run(['start', orbId], { signal });
      return;
    }
    throw new Error(`podman reported unexpected container state "${status}" for ${orbId}`);
  }

  private async containerStatus(
    orbId: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    const exists = await this.podman(['container', 'exists', orbId], { signal });
    if (exists.code === 1) return undefined;
    if (exists.code !== 0) throw this.failure(['container'], exists);
    const inspect = await this.run(['container', 'inspect', '--format', 'json', orbId], { signal });
    const [container] = this.parse('container inspect', inspect.stdout, inspectSchema);
    if (!container || !orbLabelsMatch(orbId, container.Config?.Labels))
      throw new Error(`Refusing to adopt ${orbId}: Orb ownership labels do not match`);
    return container.State.Status;
  }

  private parse<T>(label: string, stdout: string, schema: z.ZodType<T>): T {
    let value: unknown;
    try {
      value = JSON.parse(stdout);
    } catch {
      throw new Error(`podman ${label} returned malformed JSON: ${stdout.slice(0, 200)}`);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new Error(
        `podman ${label} returned unexpected shape: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    return parsed.data;
  }

  private podman(args: readonly string[], options?: OrbExecOptions): Promise<OrbExecResult> {
    return this.runner([this.binary, ...args], options);
  }

  private async run(args: readonly string[], options?: OrbExecOptions): Promise<OrbExecResult> {
    const result = await this.podman(args, options);
    if (result.code !== 0) throw this.failure(args, result);
    return result;
  }

  private failure(args: readonly string[], result: OrbExecResult): Error {
    return new Error(`podman ${args[0]} failed (${result.code}): ${result.stderr.trim()}`);
  }
}
