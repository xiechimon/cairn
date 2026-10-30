import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorkspaceHookNoteData } from '@cairn/shared';
import { ensurePrivateDir, writePrivateFile } from '../private-fs.js';

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
  binds?: readonly { source: string; target: string; readonly?: boolean }[];
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
  exec(handle: OrbHandle, argv: readonly string[], options: OrbExecOptions): Promise<OrbExecResult>;
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
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
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

  constructor(options: { runner?: OrbCommandRunner; stateFile?: string } = {}) {
    this.runner = options.runner ?? runOrbCommand;
    this.stateFile = options.stateFile;
    if (this.stateFile && existsSync(this.stateFile)) {
      const handles = JSON.parse(readFileSync(this.stateFile, 'utf8')) as OrbHandle[];
      for (const handle of handles) this.handles.set(handle.conversationId, handle);
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
    const startedAt = Date.now();
    let handle = this.handles.get(input.conversationId);
    if (!handle) {
      const suffix = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,44}[a-zA-Z0-9])?$/.test(input.conversationId)
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
    if (!handle.running) {
      await this.command(['machinectl', 'start', handle.id]);
      handle.running = true;
      handle.notes.push(orbNote('orb: setup'));
      handle.notes.push(
        orbNote(`orb: started in ${Date.now() - startedAt}ms`, Date.now() - startedAt),
      );
      this.save();
    }
    return handle;
  }

  async exec(
    handle: OrbHandle,
    argv: readonly string[],
    options: OrbExecOptions,
  ): Promise<OrbExecResult> {
    for (const bind of options.binds ?? []) {
      await this.command([
        'machinectl',
        'bind',
        '--mkdir',
        ...(bind.readonly ? ['--read-only'] : []),
        handle.id,
        bind.source,
        bind.target,
      ]);
    }
    const env = { ...options.env, CAIRN_ORB: '1' };
    const flags = Object.entries(env).flatMap(([key, value]) =>
      value === undefined ? [] : [`--setenv=${key}=${value}`],
    );
    return this.runner(
      [
        'systemd-run',
        '-M',
        handle.id,
        '--uid=agent',
        '--wait',
        '--pipe',
        '--quiet',
        ...(options.cwd ? [`--working-directory=${options.cwd}`] : []),
        ...flags,
        '--',
        ...argv,
      ],
      { ...options, env: undefined },
    );
  }

  async stop(handle: OrbHandle): Promise<void> {
    if (!handle.running) return;
    await this.command(['machinectl', 'poweroff', handle.id]);
    await this.command(['systemctl', 'stop', `systemd-nspawn@${handle.id}.service`]);
    handle.running = false;
    handle.notes.push(orbNote('orb: stopped'));
    this.save();
  }

  async destroy(handle: OrbHandle): Promise<void> {
    await this.stop(handle);
    await this.command(['machinectl', 'remove', handle.id]);
    this.handles.delete(handle.conversationId);
    this.save();
  }

  async list(): Promise<OrbHandle[]> {
    return [...this.handles.values()];
  }
  touch(handle: OrbHandle, now: number): void {
    handle.lastUsedAt = now;
    this.save();
  }

  private async command(argv: readonly string[]): Promise<void> {
    const result = await this.runner(argv);
    if (result.code !== 0)
      throw new Error(`${argv[0]} ${argv[1]} failed (${result.code}): ${result.stderr}`);
  }

  private save(): void {
    if (!this.stateFile) return;
    ensurePrivateDir(dirname(this.stateFile));
    writePrivateFile(this.stateFile, JSON.stringify([...this.handles.values()]));
  }
}
