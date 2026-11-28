import { randomUUID } from 'node:crypto';
import type { MachineWakeHub } from './machine-wake-hub.js';

type Failure = { status: 'failed'; failure: 'auth' | 'network' | 'timeout' };
type Assignment = { machineId: string; connectionId: string };

export function runnerProbeQueue<Claim, Result>(
  send: (hub: MachineWakeHub, machineId: string, id: string) => boolean,
) {
  type Pending = Assignment & {
    read: (() => Claim) | null;
    authorized: () => boolean;
    finish: (result: Result | Failure) => void;
  };
  const queues = new WeakMap<MachineWakeHub, Map<string, Pending>>();
  function assigned(hub: MachineWakeHub, id: string, machine: string, connection: string) {
    const pending = queues.get(hub)?.get(id);
    return pending?.machineId === machine &&
      pending.connectionId === connection &&
      hub.connectionId(machine) === connection
      ? pending
      : undefined;
  }
  return {
    dispatch(
      hub: MachineWakeHub,
      candidates: readonly string[],
      read: () => Claim,
      authorize: (machineId: string) => boolean,
      signal?: AbortSignal,
    ): Promise<Result | Failure> {
      if (signal?.aborted) return Promise.resolve({ status: 'failed', failure: 'timeout' });
      const queue = queues.get(hub) ?? new Map<string, Pending>();
      queues.set(hub, queue);
      for (const machineId of candidates) {
        const connectionId = hub.connectionId(machineId);
        if (
          !connectionId ||
          !authorize(machineId) ||
          [...queue.values()].some((p) => p.machineId === machineId)
        )
          continue;
        return new Promise((resolve) => {
          const id = randomUUID();
          const finish = (result: Result | Failure) => {
            if (!queue.delete(id)) return;
            clearTimeout(timer);
            disconnect();
            signal?.removeEventListener('abort', abort);
            resolve(result);
          };
          const abort = () => finish({ status: 'failed', failure: 'timeout' });
          const disconnect = hub.onDisconnect((machine) => {
            if (machine === machineId) finish({ status: 'failed', failure: 'network' });
          });
          const timer = setTimeout(abort, 35_000);
          signal?.addEventListener('abort', abort, { once: true });
          queue.set(id, {
            machineId,
            connectionId,
            read,
            authorized: () => authorize(machineId),
            finish,
          });
          if (!send(hub, machineId, id)) finish({ status: 'failed', failure: 'network' });
        });
      }
      return Promise.resolve({ status: 'failed', failure: 'network' });
    },
    claim(hub: MachineWakeHub, id: string, machine: string, connection: string): Claim | undefined {
      const pending = assigned(hub, id, machine, connection);
      if (!pending?.read) return undefined;
      const read = pending.read;
      pending.read = null;
      try {
        if (pending.authorized()) return read();
      } catch {}
      pending.finish({ status: 'failed', failure: 'auth' });
      return undefined;
    },
    finish(hub: MachineWakeHub, id: string, machine: string, connection: string, result: Result) {
      const pending = assigned(hub, id, machine, connection);
      if (!pending || pending.read !== null) return 'missing';
      if (!pending.authorized()) {
        pending.finish({ status: 'failed', failure: 'auth' });
        return 'revoked';
      }
      pending.finish(result);
      return 'accepted';
    },
  };
}
