import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ComputerPresence } from '@cairn/shared';
import { COMPUTER_PRESENCE_LIMIT } from '@cairn/shared';
import { z } from 'zod';
import { ensurePrivateDir, writePrivateFile } from '../private-fs.js';
import { type OrbCommandRunner, runOrbCommand } from './provider.js';

export const COMPUTER_TEMPLATE = 'cairn-orb-computer';
export const PINNED_AGENT_BROWSER_VERSION = '0.41.2';
export const COMPUTER_IDLE_STOP_MS = 10 * 60_000;
export const COMPUTER_TAKEOVER_GRACE_MS = 30 * 60_000;

const computerNamePattern = /^cairn-orb-computer-[a-f0-9]{40}$/;

export function computerMachinesDir(root = process.env.CAIRN_ORB_ROOT ?? ''): string {
  return root === '' ? '/var/lib/machines' : join(root, 'var/lib/machines');
}

export function computerImagePublishedMarkerPath(root = process.env.CAIRN_ORB_ROOT ?? ''): string {
  return join(root === '' ? '/' : root, 'var/lib/cairn-orb/computer-image');
}

export function computerImageOffersBrowser(
  options: {
    root?: string;
    version?: string;
    readFileSync?: (path: string, encoding: 'utf8') => string;
  } = {},
): boolean {
  const version =
    options.version ?? process.env.CAIRN_AGENT_BROWSER_VERSION ?? PINNED_AGENT_BROWSER_VERSION;
  let text: string;
  try {
    text = (options.readFileSync ?? readFileSync)(
      computerImagePublishedMarkerPath(options.root),
      'utf8',
    );
  } catch {
    return false;
  }
  return text.split('\n').includes(`agent-browser=${version}`);
}

const computerStateSchema = z.array(
  z.object({
    scopeKey: z.string().min(1),
    name: z.string().regex(computerNamePattern),
    lastUsedAt: z.number(),
    holdUntil: z.number(),
  }),
);
type ComputerState = z.infer<typeof computerStateSchema>[number];

export function computerMachineName(scopeKey: string): string {
  if (scopeKey === '') throw new Error('Computer scope key is empty');
  return `${COMPUTER_TEMPLATE}-${createHash('sha256').update(scopeKey).digest('hex').slice(0, 40)}`;
}

export class ComputerOrbs {
  private readonly runner: OrbCommandRunner;
  private readonly runtimeRoot: string;
  private readonly machinesRoot: string;
  private readonly stateFile: string | undefined;
  private readonly runtimeDirectoryTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly now: () => number;
  private readonly isBusy: (name: string) => Promise<boolean>;
  private readonly computers = new Map<string, ComputerState>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(
    options: {
      runner?: OrbCommandRunner;
      runtimeRoot?: string;
      machinesRoot?: string;
      stateFile?: string;
      runtimeDirectoryTimeoutMs?: number;
      shutdownTimeoutMs?: number;
      now?: () => number;
      isBusy?: (name: string) => Promise<boolean>;
    } = {},
  ) {
    this.runner = options.runner ?? runOrbCommand;
    this.runtimeRoot = options.runtimeRoot ?? '/run/cairn-orb';
    this.machinesRoot = options.machinesRoot ?? computerMachinesDir();
    this.stateFile = options.stateFile;
    this.runtimeDirectoryTimeoutMs = options.runtimeDirectoryTimeoutMs ?? 60_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.isBusy = options.isBusy ?? (async () => false);
    if (this.stateFile && existsSync(this.stateFile)) {
      for (const computer of computerStateSchema.parse(
        JSON.parse(readFileSync(this.stateFile, 'utf8')),
      )) {
        if (computer.name !== computerMachineName(computer.scopeKey))
          throw new Error('Computer state names a machine that does not match its scope');
        this.computers.set(computer.scopeKey, computer);
      }
    }
  }

  known(): string[] {
    return [...this.computers.values()].map((computer) => computer.name);
  }

  async presence(signal?: AbortSignal): Promise<ComputerPresence[]> {
    const running = await this.runningMachines(signal);
    const scopes = new Set([...this.pending.keys(), ...this.failed, ...this.computers.keys()]);
    return [...scopes].slice(0, COMPUTER_PRESENCE_LIMIT).map((scopeKey) => {
      const providerRef = computerMachineName(scopeKey);
      return {
        scopeKey,
        providerRef,
        state: this.pending.has(scopeKey)
          ? 'starting'
          : this.failed.has(scopeKey)
            ? 'failed'
            : running.has(providerRef)
              ? 'running'
              : 'stopped',
      };
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  ensure(scopeKey: string): Promise<string> {
    const running = this.pending.get(scopeKey);
    if (running) return running;
    this.failed.delete(scopeKey);
    const operation = (this.stopping.get(scopeKey) ?? Promise.resolve())
      .then(() => this.ensureRunning(scopeKey))
      .catch((error: unknown) => {
        this.failed.add(scopeKey);
        throw error;
      })
      .finally(() => {
        this.pending.delete(scopeKey);
        for (const listener of this.listeners) listener();
      });
    this.pending.set(scopeKey, operation);
    for (const listener of this.listeners) listener();
    return operation;
  }

  touch(scopeKey: string): void {
    const computer = this.computers.get(scopeKey);
    if (!computer) return;
    computer.lastUsedAt = this.now();
    this.save();
  }

  hold(scopeKey: string): void {
    const computer = this.computers.get(scopeKey);
    if (!computer) return;
    computer.holdUntil = this.now() + COMPUTER_TAKEOVER_GRACE_MS;
    this.save();
  }

  async sweep(): Promise<void> {
    const running = await this.runningMachines();
    for (const computer of this.computers.values()) {
      if (!running.has(computer.name) || !this.idle(computer)) continue;
      if (await this.isBusy(computer.name)) continue;
      if (!this.idle(computer)) continue;
      const stop = this.stop(computer.name);
      this.stopping.set(computer.scopeKey, stop);
      try {
        await stop;
      } finally {
        this.stopping.delete(computer.scopeKey);
        for (const listener of this.listeners) listener();
      }
    }
  }

  private idle(computer: ComputerState): boolean {
    const now = this.now();
    return (
      !this.pending.has(computer.scopeKey) &&
      !this.stopping.has(computer.scopeKey) &&
      now - computer.lastUsedAt >= COMPUTER_IDLE_STOP_MS &&
      now >= computer.holdUntil
    );
  }

  private async ensureRunning(scopeKey: string): Promise<string> {
    const name = computerMachineName(scopeKey);
    if ((await this.images()).has(name)) {
      if (this.cloneNeedsRefresh(name)) {
        if ((await this.runningMachines()).has(name)) await this.stop(name);
        await this.command(['machinectl', 'remove', name]);
        await this.command(['machinectl', 'clone', COMPUTER_TEMPLATE, name]);
      }
    } else {
      await this.command(['machinectl', 'clone', COMPUTER_TEMPLATE, name]);
    }
    const computer = this.computers.get(scopeKey) ?? {
      scopeKey,
      name,
      lastUsedAt: this.now(),
      holdUntil: 0,
    };
    computer.lastUsedAt = this.now();
    this.computers.set(scopeKey, computer);
    this.save();
    if (!(await this.runningMachines()).has(name)) {
      await this.command(['machinectl', 'start', name]);
    }
    try {
      await this.waitForRuntime(name);
    } catch (error) {
      await this.stop(name);
      throw error;
    }
    return name;
  }

  private cloneNeedsRefresh(name: string): boolean {
    const template = this.readMarker(COMPUTER_TEMPLATE);
    if (template === null) return false;
    const clone = this.readMarker(name);
    return clone !== template;
  }

  private readMarker(name: string): string | null {
    try {
      return readFileSync(join(this.machinesRoot, name, 'etc', 'cairn-orb-computer-image'), 'utf8');
    } catch {
      return null;
    }
  }

  private async waitForRuntime(name: string): Promise<void> {
    const directory = join(this.runtimeRoot, name);
    const deadline = Date.now() + this.runtimeDirectoryTimeoutMs;
    for (;;) {
      const stats = lstatSync(directory, { throwIfNoEntry: false });
      if (stats) {
        if (
          !stats.isDirectory() ||
          stats.uid !== process.getuid?.() ||
          (stats.mode & 0o7777) !== 0o700
        )
          throw new Error(
            `Computer runtime directory must be a 0700 directory owned by the daemon: ${directory}`,
          );
        ensurePrivateDir(join(directory, 'computer'));
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error(`Timed out waiting for computer runtime directory: ${directory}`);
      await delay(Math.min(100, remaining));
    }
  }

  private async stop(name: string): Promise<void> {
    const poweroff = await this.runner(['machinectl', 'poweroff', name]);
    if (poweroff.code === 0) {
      const deadline = Date.now() + this.shutdownTimeoutMs;
      while ((await this.runningMachines()).has(name)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await delay(Math.min(100, remaining));
      }
      if (!(await this.runningMachines()).has(name)) return;
    }
    await this.command(['machinectl', 'terminate', name]);
  }

  private async images(): Promise<Set<string>> {
    const result = await this.runner(['machinectl', 'list-images', '--no-legend', '--no-pager']);
    if (result.code !== 0) throw new Error(`machinectl list-images failed: ${result.stderr}`);
    return new Set(result.stdout.split('\n').map((line) => line.trim().split(/\s+/)[0] ?? ''));
  }

  private async runningMachines(signal?: AbortSignal): Promise<Set<string>> {
    const result = await this.runner(['machinectl', 'list', '--no-legend', '--no-pager'], {
      signal,
    });
    if (result.code !== 0) throw new Error(`machinectl list failed: ${result.stderr}`);
    return new Set(result.stdout.split('\n').map((line) => line.trim().split(/\s+/)[0] ?? ''));
  }

  private async command(argv: readonly string[]): Promise<void> {
    const result = await this.runner(argv);
    if (result.code !== 0)
      throw new Error(`${argv[0]} ${argv[1]} failed (${result.code}): ${result.stderr}`);
  }

  private save(): void {
    if (!this.stateFile) return;
    ensurePrivateDir(dirname(this.stateFile));
    writePrivateFile(this.stateFile, JSON.stringify([...this.computers.values()]));
  }
}
