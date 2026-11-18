import { randomBytes } from 'node:crypto';
import type {
  ComputerCall,
  ComputerScreenRequest,
  EngineScreenRequest,
  MachineRepoArchiveCommand,
  MachineStreamEvent,
} from '@cairn/shared';

export const MACHINE_OFFLINE_GRACE_MS = 45_000;

export type PresenceAdmission = 'online' | 'seen' | 'ignore';

interface MachineGrace {
  connectionId: string;
  timer: ReturnType<typeof setTimeout>;
  presenceSinceDrop: boolean;
}

export class MachineWakeHub {
  private readonly graces = new Map<string, MachineGrace>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly streams = new Map<string, Set<(ev: MachineStreamEvent) => void>>();
  private readonly stopListeners = new Map<string, Set<() => void>>();
  private readonly disconnectListeners = new Set<(machineId: string) => void>();
  private readonly wakeSeqs = new Map<string, number>();
  private readonly streamsByMachine = new Map<
    string,
    {
      teamId: string;
      connectionId: string;
      send: (ev: MachineStreamEvent) => void;
      close: () => void;
      release: () => void;
    }
  >();

  constructor(private readonly offlineGraceMs: number = MACHINE_OFFLINE_GRACE_MS) {}

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
    close: () => void = () => {},
  ): () => void {
    this.revokeMachine(machineId);
    const connectionId = randomBytes(16).toString('base64url');
    const unsubscribeTeam = this.subscribe(teamId, send);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      unsubscribeTeam();
      const cur = this.streamsByMachine.get(machineId);
      if (cur && cur.send === send) {
        this.streamsByMachine.delete(machineId);
        for (const listener of this.disconnectListeners) listener(machineId);
      }
    };
    this.streamsByMachine.set(machineId, { teamId, connectionId, send, close, release });
    return release;
  }

  connectionId(machineId: string): string | undefined {
    return this.streamsByMachine.get(machineId)?.connectionId;
  }

  dropConnection(machineId: string, connectionId: string, onExpire: () => void): boolean {
    if (this.streamsByMachine.get(machineId)?.connectionId !== connectionId) return false;
    this.releaseMachine(machineId);
    this.cancelGrace(machineId);
    const timer = setTimeout(() => {
      if (this.graces.get(machineId)?.connectionId !== connectionId) return;
      if (this.streamsByMachine.has(machineId)) return;
      this.graces.delete(machineId);
      onExpire();
    }, this.offlineGraceMs);
    this.graces.set(machineId, { connectionId, timer, presenceSinceDrop: false });
    return true;
  }

  endConnection(machineId: string, connectionId: string): boolean {
    const current = this.streamsByMachine.get(machineId)?.connectionId === connectionId;
    const grace = this.graces.get(machineId)?.connectionId === connectionId;
    if (!current && !grace) return false;
    const entry = current ? this.streamsByMachine.get(machineId) : undefined;
    if (entry) {
      this.releaseMachine(machineId);
      try {
        entry.close();
      } catch {}
    }
    this.cancelGrace(machineId);
    return true;
  }

  cancelGrace(machineId: string): void {
    const grace = this.graces.get(machineId);
    if (!grace) return;
    clearTimeout(grace.timer);
    this.graces.delete(machineId);
  }

  admitPresence(machineId: string, connectionId: string | null | undefined): PresenceAdmission {
    const grace = this.graces.get(machineId);
    if (connectionId === undefined) {
      if (grace) grace.presenceSinceDrop = true;
      return 'online';
    }
    if (connectionId === null) return 'seen';
    if (this.streamsByMachine.get(machineId)?.connectionId === connectionId) return 'online';
    if (grace?.connectionId === connectionId) {
      grace.presenceSinceDrop = true;
      return 'seen';
    }
    return 'ignore';
  }

  silentSinceDrop(machineId: string): boolean {
    const grace = this.graces.get(machineId);
    return grace !== undefined && !grace.presenceSinceDrop;
  }

  revokeMachine(machineId: string): void {
    this.cancelGrace(machineId);
    const entry = this.streamsByMachine.get(machineId);
    if (!entry) return;
    this.streamsByMachine.delete(machineId);
    for (const listener of this.disconnectListeners) listener(machineId);
    entry.release();
    try {
      entry.send({ type: 'shutdown' });
    } catch {}
    try {
      entry.close();
    } catch {}
  }

  pushRepoArchive(machineId: string, cmd: MachineRepoArchiveCommand): boolean {
    const entry = this.streamsByMachine.get(machineId);
    if (!entry) return false;
    try {
      entry.send({ type: 'repo.archive', archive: cmd });
      return true;
    } catch {
      return false;
    }
  }

  isConnected(machineId: string): boolean {
    return this.streamsByMachine.has(machineId);
  }

  pushComputer(machineId: string, call: ComputerCall): boolean {
    const entry = this.streamsByMachine.get(machineId);
    if (!entry) return false;
    try {
      entry.send({ type: 'computer', call });
      return true;
    } catch {
      return false;
    }
  }

  pushComputerCancel(machineId: string, callId: string): boolean {
    const entry = this.streamsByMachine.get(machineId);
    if (!entry) return false;
    try {
      entry.send({ type: 'computer.cancel', callId });
      return true;
    } catch {
      return false;
    }
  }

  onStop(stepId: string, listener: () => void): () => void {
    let set = this.stopListeners.get(stepId);
    if (!set) {
      set = new Set();
      this.stopListeners.set(stepId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.stopListeners.delete(stepId);
    };
  }

  onDisconnect(listener: (machineId: string) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  pushComputerScreen(machineId: string, channel: ComputerScreenRequest): boolean {
    const entry = this.streamsByMachine.get(machineId);
    if (!entry) return false;
    try {
      entry.send({ type: 'computer.screen', channel });
      return true;
    } catch {
      return false;
    }
  }

  pushEngineScreen(machineId: string, channel: EngineScreenRequest): boolean {
    const entry = this.streamsByMachine.get(machineId);
    if (!entry) return false;
    try {
      entry.send({ type: 'engine.screen', channel });
      return true;
    } catch {
      return false;
    }
  }

  releaseMachine(machineId: string): void {
    if (this.streamsByMachine.delete(machineId)) {
      for (const listener of this.disconnectListeners) listener(machineId);
    }
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
    for (const listener of [...(this.stopListeners.get(stepId) ?? [])]) listener();
  }
}
