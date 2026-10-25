import type { MachineStreamEvent, MachineSyncCommand } from '@cairn/shared';

export class MachineWakeHub {
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly streams = new Map<string, Set<(ev: MachineStreamEvent) => void>>();
  private readonly wakeSeqs = new Map<string, number>();
  private readonly streamsByMachine = new Map<
    string,
    { teamId: string; send: (ev: MachineStreamEvent) => void }
  >();

  wakeSeq(teamId: string): number {
    return this.wakeSeqs.get(teamId) ?? 0;
  }

  waitWake(
    teamId: string,
    timeoutMs: number,
    signal?: AbortSignal,
    sinceSeq?: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      if (sinceSeq !== undefined && this.wakeSeq(teamId) > sinceSeq) {
        resolve(true);
        return;
      }
      let settled = false;
      let set = this.waiters.get(teamId);
      if (!set) {
        set = new Set();
        this.waiters.set(teamId, set);
      }
      const holder = set;
      const cleanup = () => {
        holder.delete(fn);
        if (holder.size === 0) this.waiters.delete(teamId);
        signal?.removeEventListener('abort', onAbort);
      };
      const settle = (woken: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(woken);
      };
      const fn = () => settle(true);
      const onAbort = () => settle(false);
      const timer = setTimeout(() => settle(false), timeoutMs);
      holder.add(fn);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  wake(teamId: string): void {
    this.wakeSeqs.set(teamId, (this.wakeSeqs.get(teamId) ?? 0) + 1);
    for (const send of this.streams.get(teamId) ?? []) {
      try {
        send({ type: 'wake' });
      } catch {}
    }
    for (const fn of [...(this.waiters.get(teamId) ?? [])]) fn();
  }

  subscribe(teamId: string, send: (ev: MachineStreamEvent) => void): () => void {
    let set = this.streams.get(teamId);
    if (!set) {
      set = new Set();
      this.streams.set(teamId, set);
    }
    set.add(send);
    return () => {
      set?.delete(send);
      if (set && set.size === 0) this.streams.delete(teamId);
    };
  }

  subscribeMachine(
    teamId: string,
    machineId: string,
    send: (ev: MachineStreamEvent) => void,
  ): () => void {
    const unsubscribeTeam = this.subscribe(teamId, send);
    const prev = this.streamsByMachine.get(machineId);
    if (prev) {
      try {
        prev.send({ type: 'shutdown' });
      } catch {}
    }
    this.streamsByMachine.set(machineId, { teamId, send });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unsubscribeTeam();
      const cur = this.streamsByMachine.get(machineId);
      if (cur && cur.send === send) this.streamsByMachine.delete(machineId);
    };
  }

  pushSync(machineId: string, cmd: MachineSyncCommand): boolean {
    const entry = this.streamsByMachine.get(machineId);
    if (!entry) return false;
    try {
      entry.send({ type: 'sync', sync: cmd });
      return true;
    } catch {
      return false;
    }
  }

  releaseMachine(machineId: string): void {
    this.streamsByMachine.delete(machineId);
  }

  streamCount(teamId: string): number {
    return this.streams.get(teamId)?.size ?? 0;
  }

  steerSignal(teamId: string, stepId: string): void {
    for (const send of this.streams.get(teamId) ?? []) {
      try {
        send({ type: 'steer', stepId });
      } catch {}
    }
  }

  stopSignal(teamId: string, stepId: string): void {
    for (const send of this.streams.get(teamId) ?? []) {
      try {
        send({ type: 'stop', stepId });
      } catch {}
    }
  }
}
