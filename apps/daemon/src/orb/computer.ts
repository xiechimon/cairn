import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { ensurePrivateDir, writePrivateFile } from '../private-fs.js';
import { type OrbCommandRunner, runOrbCommand } from './provider.js';

export const COMPUTER_TEMPLATE = 'cairn-orb-computer';
export const COMPUTER_IDLE_STOP_MS = 10 * 60_000;
export const COMPUTER_TAKEOVER_GRACE_MS = 30 * 60_000;

const computerNamePattern = /^cairn-orb-computer-[a-f0-9]{40}$/;

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
  private readonly stateFile: string | undefined;
  private readonly runtimeDirectoryTimeoutMs: number;
  private readonly now: () => number;
  private readonly isBusy: (name: string) => Promise<boolean>;
  private readonly computers = new Map<string, ComputerState>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    options: {
      runner?: OrbCommandRunner;
      runtimeRoot?: string;
      stateFile?: string;
      runtimeDirectoryTimeoutMs?: number;
      now?: () => number;
      isBusy?: (name: string) => Promise<boolean>;
    } = {},
  ) {
    this.runner = options.runner ?? runOrbCommand;
    this.runtimeRoot = options.runtimeRoot ?? '/run/cairn-orb';
    this.stateFile = options.stateFile;
    this.runtimeDirectoryTimeoutMs = options.runtimeDirectoryTimeoutMs ?? 60_000;
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

  ensure(scopeKey: string): Promise<string> {
    const running = this.pending.get(scopeKey);
    if (running) return running;
    const operation = this.ensureRunning(scopeKey).finally(() => this.pending.delete(scopeKey));
    this.pending.set(scopeKey, operation);
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
    const now = this.now();
    for (const computer of this.computers.values()) {
      if (!running.has(computer.name) || this.pending.has(computer.scopeKey)) continue;
      if (now - computer.lastUsedAt < COMPUTER_IDLE_STOP_MS || now < computer.holdUntil) continue;
      if (await this.isBusy(computer.name)) continue;
      await this.stop(computer.name);
    }
  }

  private async ensureRunning(scopeKey: string): Promise<string> {
    const name = computerMachineName(scopeKey);
    if (!(await this.images()).has(name)) {
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
    if (poweroff.code === 0 && !(await this.runningMachines()).has(name)) return;
    await this.command(['machinectl', 'terminate', name]);
  }

  private async images(): Promise<Set<string>> {
    const result = await this.runner(['machinectl', 'list-images', '--no-legend', '--no-pager']);
    if (result.code !== 0) throw new Error(`machinectl list-images failed: ${result.stderr}`);
    return new Set(result.stdout.split('\n').map((line) => line.trim().split(/\s+/)[0] ?? ''));
  }

  private async runningMachines(): Promise<Set<string>> {
    const result = await this.runner(['machinectl', 'list', '--no-legend', '--no-pager']);
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
