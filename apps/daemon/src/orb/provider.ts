import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { constants } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkspaceHookNoteData } from '@cairn/shared';
import { ensurePrivateDir, writePrivateFile } from '../private-fs.js';
import { prepareOrbSeed } from './seed.js';

export interface OrbHandle {
  id: string;
  conversationId: string;
  projectId: string;
  running: boolean;
  lastUsedAt: number;
  notes: WorkspaceHookNoteData[];
  lastStepId?: string;
}

export interface OrbExecOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  signal?: AbortSignal;
  input?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onInput?: (write: (data: string) => void) => void;
}

export interface OrbExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type OrbCommandRunner = (
  argv: readonly string[],
  options?: OrbExecOptions,
) => Promise<OrbExecResult>;

export interface OrbProvider {
  readonly kind: 'host' | 'orb';
  ensure(input: { conversationId: string; projectId: string }): Promise<OrbHandle>;
  prepare(handle: OrbHandle, seed?: string): Promise<string>;
  start(handle: OrbHandle, options?: { signal?: AbortSignal }): Promise<void>;
  stop(handle: OrbHandle): Promise<void>;
  destroy(handle: OrbHandle): Promise<void>;
  list(): Promise<OrbHandle[]>;
  touch(handle: OrbHandle, now: number): void;
}

export const runOrbCommand: OrbCommandRunner = (argv, options = {}) =>
  new Promise((resolve, reject) => {
    const [command, ...args] = argv;
    if (!command) {
      reject(new Error('Orb command is empty'));
      return;
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (options.onStdout) options.onStdout(text);
      else stdout += text;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (options.onStderr) options.onStderr(text);
      stderr = (stderr + text).slice(-10_000);
    });
    options.onInput?.((data) => child.stdin.write(data));
    if (options.input !== undefined) child.stdin.write(options.input);
    if (!options.onInput) child.stdin.end();
    child.on('close', (code, signal) =>
      resolve({ code: code ?? (signal ? 128 + constants.signals[signal] : 1), stdout, stderr }),
    );
  });

export function orbNote(output: string, ms = 0): WorkspaceHookNoteData {
  return { name: 'setup', status: 'ok', exitCode: 0, output, totalChars: output.length, ms };
}

export class HostOrbProvider implements OrbProvider {
  readonly kind = 'host';
  protected readonly handles = new Map<string, OrbHandle>();
  constructor(protected readonly runner: OrbCommandRunner = runOrbCommand) {}

  async ensure(input: { conversationId: string; projectId: string }): Promise<OrbHandle> {
    let handle = this.handles.get(input.conversationId);
    if (!handle) {
      handle = {
        ...input,
        id: input.conversationId,
        running: true,
        lastUsedAt: Date.now(),
        notes: [],
      };
      this.handles.set(input.conversationId, handle);
    }
    handle.running = true;
    return handle;
  }

  async prepare(): Promise<string> {
    throw new Error('Host steps do not use orb transport');
  }

  async start(handle: OrbHandle): Promise<void> {
    handle.running = true;
  }

  exec(
    _handle: OrbHandle,
    argv: readonly string[],
    options: OrbExecOptions,
  ): Promise<OrbExecResult> {
    const env = { ...process.env, ...options.env };
    delete env.CAIRN_ORB;
    return this.runner(argv, { ...options, env });
  }

  async stop(handle: OrbHandle): Promise<void> {
    handle.running = false;
  }
  async destroy(handle: OrbHandle): Promise<void> {
    this.handles.delete(handle.conversationId);
  }
  async list(): Promise<OrbHandle[]> {
    return [...this.handles.values()];
  }
  touch(handle: OrbHandle, now: number): void {
    handle.lastUsedAt = now;
  }
}

export class NspawnOrbProvider implements OrbProvider {
  readonly kind = 'orb';
  private readonly handles = new Map<string, OrbHandle>();
  private readonly pending = new Map<string, Promise<OrbHandle>>();
  private readonly runner: OrbCommandRunner;
  private readonly stateFile: string | undefined;
  private reconciled = false;
  readonly runtimeRoot: string;
  readonly distRoot: string;
  readonly seedRoot: string;
  private readonly distSource: string;
  private readonly shutdownTimeoutMs: number;
  private publishing: Promise<void> = Promise.resolve();

  constructor(
    options: {
      runner?: OrbCommandRunner;
      stateFile?: string;
      runtimeRoot?: string;
      distRoot?: string;
      seedRoot?: string;
      distSource?: string;
      shutdownTimeoutMs?: number;
    } = {},
  ) {
    this.runner = options.runner ?? runOrbCommand;
    this.runtimeRoot = options.runtimeRoot ?? '/run/cairn-orb';
    this.distRoot = options.distRoot ?? '/var/lib/cairn-orb/dist';
    this.seedRoot = options.seedRoot ?? '/var/lib/cairn-orb/seed';
    this.distSource =
      options.distSource ??
      (import.meta.url.endsWith('.ts')
        ? join(dirname(fileURLToPath(import.meta.url)), '../../dist')
        : dirname(fileURLToPath(import.meta.url)));
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
    this.stateFile = options.stateFile;
    if (this.stateFile && existsSync(this.stateFile)) {
      const handles = JSON.parse(readFileSync(this.stateFile, 'utf8')) as OrbHandle[];
      for (const handle of handles) {
        this.validate(handle);
        this.handles.set(handle.conversationId, handle);
      }
    }
  }

  ensure(input: { conversationId: string; projectId: string }): Promise<OrbHandle> {
    const pending = this.pending.get(input.conversationId);
    if (pending) return pending;
    const operation = this.ensureContainer(input).finally(() =>
      this.pending.delete(input.conversationId),
    );
    this.pending.set(input.conversationId, operation);
    return operation;
  }

  private async ensureContainer(input: {
    conversationId: string;
    projectId: string;
  }): Promise<OrbHandle> {
    await this.reconcile();
    const startedAt = Date.now();
    let handle = this.handles.get(input.conversationId);
    if (!handle) {
      const suffix =
        input.conversationId !== 'base' &&
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,44}[a-zA-Z0-9])?$/.test(input.conversationId)
          ? input.conversationId
          : createHash('sha256').update(input.conversationId).digest('hex').slice(0, 54);
      handle = {
        ...input,
        id: `cairn-orb-${suffix}`,
        running: false,
        lastUsedAt: startedAt,
        notes: [],
      };
      await this.command(['machinectl', 'clone', 'cairn-orb-base', handle.id]);
      handle.notes.push(orbNote('orb: creating'));
      this.handles.set(input.conversationId, handle);
      this.save();
    }
    return handle;
  }

  async prepare(handle: OrbHandle, seed?: string): Promise<string> {
    this.validate(handle);
    const directory = join(this.runtimeRoot, handle.id);
    ensurePrivateDir(directory);
    const publish = this.publishing.then(async () => {
      mkdirSync(this.distRoot, { recursive: true, mode: 0o755 });
      chmodSync(this.distRoot, 0o755);
      const release = mkdtempSync(join(this.distRoot, '.release-'));
      try {
        cpSync(this.distSource, release, { recursive: true, dereference: true });
        if (!existsSync(join(release, 'cli.mjs')))
          throw new Error('Orb daemon build is missing cli.mjs');
        const entry = join(this.distRoot, `.entry-${randomUUID()}`);
        try {
          symlinkSync('current/cli.mjs', entry);
          renameSync(entry, join(this.distRoot, 'cli.mjs'));
        } finally {
          rmSync(entry, { force: true });
        }
        await this.publish(release, join(this.distRoot, 'current'));
      } catch (error) {
        rmSync(release, { recursive: true, force: true });
        throw error;
      }
      if (seed) {
        if (!/^[a-zA-Z0-9-]+$/.test(handle.projectId)) throw new Error('Invalid orb project id');
        mkdirSync(this.seedRoot, { recursive: true, mode: 0o755 });
        chmodSync(this.seedRoot, 0o755);
        const project = join(this.seedRoot, handle.projectId);
        mkdirSync(project, { recursive: true, mode: 0o755 });
        const snapshot = mkdtempSync(join(project, '.snapshot-'));
        try {
          await prepareOrbSeed({ source: seed, directory: snapshot, projectId: handle.projectId });
          await this.publish(snapshot, join(project, 'current'));
          const link = join(project, `.repo-${randomUUID()}`);
          try {
            symlinkSync('current/repo', link);
            renameSync(link, join(project, 'repo'));
          } finally {
            rmSync(link, { force: true });
          }
        } catch (error) {
          rmSync(snapshot, { recursive: true, force: true });
          throw error;
        }
      }
    });
    this.publishing = publish.catch(() => {});
    await publish;
    return directory;
  }

  async start(handle: OrbHandle, options: { signal?: AbortSignal } = {}): Promise<void> {
    this.validate(handle);
    options.signal?.throwIfAborted();
    if (handle.running && (await this.runningMachines()).has(handle.id)) return;
    handle.running = false;
    handle.notes.push(orbNote('orb: setup'));
    await this.command(['machinectl', 'start', handle.id]);
    handle.running = true;
    this.save();
    if (options.signal?.aborted) {
      await this.stop(handle);
      options.signal.throwIfAborted();
    }
  }

  async stop(handle: OrbHandle): Promise<void> {
    this.validate(handle);
    if (!handle.running) return;
    try {
      await this.command(['machinectl', 'poweroff', handle.id]);
    } catch (error) {
      if (!/No machine|does not exist|not found/i.test(String(error))) throw error;
      const machines = await this.runningMachines();
      if (machines.has(handle.id)) throw error;
      handle.running = false;
    }
    if (handle.running) {
      const deadline = Date.now() + this.shutdownTimeoutMs;
      while ((await this.runningMachines()).has(handle.id)) {
        if (Date.now() >= deadline) {
          await this.command(['machinectl', 'terminate', handle.id]);
          if ((await this.runningMachines()).has(handle.id))
            throw new Error('Orb machine is still running after terminate');
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
    }
    handle.running = false;
    handle.notes.push(orbNote('orb: stopped'));
    this.save();
  }

  async destroy(handle: OrbHandle): Promise<void> {
    await this.stop(handle);
    const result = await this.runner(['machinectl', 'remove', handle.id]);
    if (result.code !== 0 && !/No (?:machine|image)|does not exist|not found/i.test(result.stderr))
      throw new Error(`machinectl remove failed (${result.code}): ${result.stderr}`);
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

  private async runningMachines(): Promise<Set<string>> {
    const result = await this.runner(['machinectl', 'list', '--no-legend', '--no-pager']);
    if (result.code !== 0) throw new Error(`machinectl list failed: ${result.stderr}`);
    return new Set(result.stdout.split('\n').map((line) => line.trim().split(/\s+/)[0] ?? ''));
  }

  private async reconcile(): Promise<void> {
    if (this.reconciled) return;
    if (this.handles.size > 0) {
      const machines = await this.runningMachines();
      for (const handle of this.handles.values()) handle.running = machines.has(handle.id);
      this.save();
    }
    this.reconciled = true;
  }

  private async command(argv: readonly string[]): Promise<void> {
    const result = await this.runner(argv);
    if (result.code !== 0)
      throw new Error(`${argv[0]} ${argv[1]} failed (${result.code}): ${result.stderr}`);
  }

  private async publish(directory: string, target: string): Promise<void> {
    chmodSync(directory, 0o755);
    const hash = createHash('sha256');
    const files = readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
      .sort();
    for (const file of files) {
      const path = join(directory, file);
      hash.update(JSON.stringify([file, statSync(path).size]));
      for await (const chunk of createReadStream(path)) hash.update(chunk);
    }
    const version = join(dirname(target), `.data-${hash.digest('hex')}`);
    if (existsSync(version)) rmSync(directory, { recursive: true, force: true });
    else renameSync(directory, version);
    const link = `${target}-${randomUUID()}`;
    try {
      symlinkSync(basename(version), link);
      renameSync(link, target);
    } finally {
      rmSync(link, { force: true });
    }
  }

  private validate(handle: OrbHandle): void {
    if (
      !/^cairn-orb-[a-zA-Z0-9][a-zA-Z0-9-]{0,53}$/.test(handle.id) ||
      handle.id === 'cairn-orb-base'
    )
      throw new Error('Invalid orb machine name');
  }

  private save(): void {
    if (!this.stateFile) return;
    ensurePrivateDir(dirname(this.stateFile));
    writePrivateFile(this.stateFile, JSON.stringify([...this.handles.values()]));
  }
}
