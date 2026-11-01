import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, expect } from 'vitest';
import {
  NspawnOrbProvider,
  type OrbExecOptions,
  type OrbExecResult,
  type OrbHandle,
} from '../src/orb/provider.js';
import { RelayMachineApi } from '../src/orb/relay.js';
import { createOrbCheckout } from './orb-dist-fixture.js';
import { orbTestRelease } from './orb-release-fixture.js';

const assertions: unknown[] = [];
const workers = new Set<Promise<void>>();
afterEach(async () => {
  await Promise.allSettled([...workers]);
  const failures = assertions.splice(0);
  expect(failures).toEqual([]);
});

export interface FakeWorkerOptions extends OrbExecOptions {
  socketPath: string;
  distRoot: string;
  seedRoot: string;
  outboxRoot: string;
}

export type FakeOrbRunner = (
  argv: readonly string[],
  options?: FakeWorkerOptions,
) => Promise<OrbExecResult>;

export function rejectGuestExec(argv: readonly string[]): void {
  if (
    argv.some((arg) => arg === '-M' || arg === '--machine' || arg.startsWith('--machine=')) ||
    (argv[0] === 'machinectl' && ['bind', 'shell', 'login'].includes(argv[1] ?? ''))
  )
    throw new Error('Forbidden guest transport');
}

export class FakeOrbProvider extends NspawnOrbProvider {
  private readonly worker: FakeOrbRunner;
  constructor(options: { runner: FakeOrbRunner }) {
    const root = mkdtempSync(join(tmpdir(), 'orb-fake-'));
    const { distSource, runner: distRunner } = createOrbCheckout(root);
    for (const name of ['run', 'dist', 'seed']) mkdirSync(join(root, name));
    const running = new Set<string>();
    super({
      runtimeRoot: join(root, 'run'),
      distRoot: join(root, 'dist'),
      seedRoot: join(root, 'seed'),
      distSource,
      runner: async (argv, execOptions) => {
        rejectGuestExec(argv);
        if (argv[0] !== 'machinectl') return distRunner(argv, execOptions);
        const result = await options.runner(argv);
        if (result.code !== 0) return result;
        const machine = argv[2] ?? '';
        if (argv[1] === 'start') {
          mkdirSync(join(root, 'run', machine), { recursive: true, mode: 0o700 });
          running.add(machine);
        }
        if (argv[1] === 'poweroff' || argv[1] === 'terminate') running.delete(machine);
        return argv[1] === 'list' ? { ...result, stdout: [...running].join('\n') } : result;
      },
    });
    this.worker = options.runner;
  }

  override async start(handle: OrbHandle, options: { signal?: AbortSignal } = {}): Promise<void> {
    await super.start(handle, options);
    const directory = join(this.runtimeRoot, handle.id);
    const socketPath = join(directory, 'relay.sock');
    if (!options.signal && !existsSync(socketPath)) return;
    const running = (async () => {
      while (!existsSync(socketPath) || !existsSync(`${socketPath}.token`)) {
        if (options.signal?.aborted) return;
        await delay(1);
      }
      if (options.signal?.aborted) return;
      await this.launchWorker(handle, {
        ...options,
        socketPath: join(this.runtimeRoot, handle.id, 'relay.sock'),
        distRoot: this.distRoot,
        seedRoot: this.seedRoot,
        outboxRoot: join(this.runtimeRoot, handle.id, 'outbox'),
      });
    })();
    workers.add(running);
    void running.finally(() => workers.delete(running));
  }

  async launchWorker(handle: OrbHandle, options: FakeWorkerOptions): Promise<void> {
    const tokenPath = `${options.socketPath}.token`;
    const token = readFileSync(tokenPath, 'utf8');
    try {
      await this.worker(['orb-worker', '--', handle.id], options);
    } catch (error) {
      if (error instanceof Error && error.name === 'AssertionError') assertions.push(error);
    }
    if (!existsSync(tokenPath) || readFileSync(tokenPath, 'utf8') !== token) return;
    try {
      const connection = await RelayMachineApi.connect(
        options.socketPath,
        orbTestRelease(options.socketPath),
      );
      connection.close();
    } catch {}
  }
}
