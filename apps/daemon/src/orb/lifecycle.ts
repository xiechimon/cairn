import { cpus } from 'node:os';

import type { OrbHandle, OrbProvider } from './provider.js';

export const ORB_IDLE_STOP_MS = 20 * 60_000;
export const ORB_IDLE_REMOVE_MS = 72 * 60 * 60_000;

export const ORB_CONCURRENCY_PER_CPUS = 4;
export const ORB_CONCURRENCY_FLOOR = 1;
export const ORB_CONCURRENCY_CEILING = 8;

export function orbConcurrencyFromCpuCount(cpuCount: number): number {
  const adaptive = Math.floor(cpuCount / ORB_CONCURRENCY_PER_CPUS);
  return Math.min(
    ORB_CONCURRENCY_CEILING,
    Math.max(ORB_CONCURRENCY_FLOOR, Number.isInteger(adaptive) ? adaptive : ORB_CONCURRENCY_FLOOR),
  );
}

export function resolveOrbCap(env: NodeJS.ProcessEnv, localCap: number): number {
  const override = Number(env.CAIRN_ORB_MAX);
  const max =
    Number.isInteger(override) && override > 0
      ? override
      : orbConcurrencyFromCpuCount(cpus().length);
  return Math.min(localCap, max);
}

export class OrbLifecycle {
  private active = 0;
  private readonly running = new Set<string>();
  private readonly waiters: { conversationId: string; resolve: () => void }[] = [];
  private mutation: Promise<unknown> = Promise.resolve();
  private max: number;
  private readonly idleStopMs: number;

  constructor(
    readonly provider: OrbProvider,
    private readonly options: {
      max: number;
      idleStopMs?: number;
      onStopped?: (handle: OrbHandle) => Promise<void>;
      log?: (message: string) => void;
    },
  ) {
    this.max = options.max;
    this.idleStopMs = options.idleStopMs ?? ORB_IDLE_STOP_MS;
  }

  setMax(max: number): void {
    this.max = max;
    this.wake();
  }

  async run<T>(
    input: { conversationId: string; projectId: string },
    fn: (handle: OrbHandle) => Promise<T>,
  ): Promise<T> {
    await new Promise<void>((resolve) => {
      this.waiters.push({ conversationId: input.conversationId, resolve });
      this.wake();
    });
    try {
      const handle = await this.serialize(async () => {
        const handles = await this.provider.list();
        const existing = handles.find((orb) => orb.conversationId === input.conversationId);
        if (!existing?.running) {
          const idle = handles
            .filter((orb) => orb.running && !this.running.has(orb.conversationId))
            .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
          let running = handles.filter(
            (orb) =>
              orb.running ||
              (orb.conversationId !== input.conversationId && this.running.has(orb.conversationId)),
          ).length;
          while (running >= this.max && idle.length > 0) {
            const oldest = idle.shift();
            if (oldest) await this.stop(oldest);
            running -= 1;
          }
        }
        return this.provider.ensure(input);
      });
      try {
        return await fn(handle);
      } finally {
        this.provider.touch(handle, Date.now());
      }
    } finally {
      this.running.delete(input.conversationId);
      this.active -= 1;
      this.wake();
    }
  }

  async sweep(input: {
    activeConversationIds: Iterable<string>;
    closedConversationIds?: Iterable<string>;
    now?: number;
  }): Promise<void> {
    await this.serialize(async () => {
      const pending = new Set(input.activeConversationIds);
      const closed = new Set(input.closedConversationIds);
      const now = input.now ?? Date.now();
      for (const handle of await this.provider.list()) {
        if (this.running.has(handle.conversationId)) continue;
        const idle = now - handle.lastUsedAt;
        if (
          !pending.has(handle.conversationId) &&
          (closed.has(handle.conversationId) || idle >= ORB_IDLE_REMOVE_MS)
        ) {
          await this.stop(handle);
          await this.provider.destroy(handle);
        } else if (idle >= this.idleStopMs) {
          await this.stop(handle);
        }
      }
    });
  }

  private async stop(handle: OrbHandle): Promise<void> {
    if (!handle.running) return;
    await this.provider.stop(handle);
    try {
      await this.options.onStopped?.(handle);
    } catch (error) {
      this.options.log?.(`orb stopped relay failed: ${String(error)}`);
    }
  }

  private wake(): void {
    while (this.active < this.max) {
      const index = this.waiters.findIndex((waiter) => !this.running.has(waiter.conversationId));
      if (index < 0) return;
      const waiter = this.waiters.splice(index, 1)[0];
      if (!waiter) return;
      this.active += 1;
      this.running.add(waiter.conversationId);
      waiter.resolve();
    }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const pending = this.mutation.then(fn, fn);
    this.mutation = pending.catch(() => {});
    return pending;
  }
}
