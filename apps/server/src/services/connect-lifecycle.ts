import { randomUUID } from 'node:crypto';

export interface ConnectAllocation {
  id: string;
  hostname: string;
}

export interface ConnectIntent {
  intent: 'on' | 'off' | 'removing';
  generation: number;
  reservationId: string | null;
  allocation: ConnectAllocation | null;
}

export interface ConnectHandle {
  ready: Promise<void>;
  close(): Promise<void>;
}

export interface ConnectLifecycleInput {
  load(): ConnectIntent;
  save(state: ConnectIntent): void;
  allocate(reservationId: string): Promise<ConnectAllocation>;
  remove(reservationId: string, allocation: ConnectAllocation | null): Promise<void>;
  openListener(allocation: ConnectAllocation): ConnectHandle;
  startConnector(allocation: ConnectAllocation): ConnectHandle;
  probe(allocation: ConnectAllocation, signal: AbortSignal): Promise<void>;
  invalidatePairing(removeSessions: boolean): void;
}

export interface ConnectStatus {
  phase: 'off' | 'allocating' | 'starting' | 'ready' | 'stopping' | 'removing' | 'error';
  generation: number;
  url: string | null;
}

export function createConnectLifecycle(input: ConnectLifecycleInput) {
  let state = structuredClone(input.load());
  let phase: ConnectStatus['phase'] = state.intent === 'removing' ? 'removing' : 'off';
  let active: ConnectHandle[] = [];
  let closing: Promise<void> = Promise.resolve();
  let allocationPending: Promise<ConnectAllocation> | null = null;
  let operation: Promise<void> | null = null;
  let probeAbort: AbortController | null = null;
  let shuttingDown = false;

  function persist(patch: Partial<ConnectIntent>): void {
    state = { ...state, ...patch };
    input.save(structuredClone(state));
  }

  function current(generation: number): boolean {
    return !shuttingDown && state.intent === 'on' && state.generation === generation;
  }

  function closeHandles(): Promise<void> {
    probeAbort?.abort();
    probeAbort = null;
    closing = closing
      .catch(() => {})
      .then(async () => {
        const handles = active;
        active = [];
        const stopped = handles.map(async (handle) => {
          try {
            await handle.close();
          } catch (error) {
            active.push(handle);
            throw error;
          }
        });
        const results = await Promise.allSettled(stopped);
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      });
    return closing;
  }

  function allocate(): Promise<ConnectAllocation> {
    if (state.allocation !== null) return Promise.resolve(state.allocation);
    if (allocationPending !== null) return allocationPending;
    const reservationId = state.reservationId;
    if (reservationId === null) throw new Error('Connect reservation is missing');
    allocationPending = Promise.resolve()
      .then(() => input.allocate(reservationId))
      .then((allocation) => {
        if (state.reservationId === reservationId) persist({ allocation });
        return allocation;
      })
      .finally(() => {
        allocationPending = null;
      });
    return allocationPending;
  }

  async function start(generation: number): Promise<void> {
    try {
      await closing;
      if (!current(generation)) return;
      phase = 'allocating';
      const allocation = await allocate();
      if (!current(generation)) return;
      phase = 'starting';
      const listener = input.openListener(allocation);
      active.push(listener);
      await listener.ready;
      if (!current(generation)) return;
      const connector = input.startConnector(allocation);
      active.push(connector);
      await connector.ready;
      if (!current(generation)) return;
      const abort = new AbortController();
      probeAbort = abort;
      await input.probe(allocation, abort.signal);
      if (current(generation)) phase = 'ready';
    } catch (error) {
      if (!current(generation)) return;
      phase = 'error';
      await closeHandles();
      throw error;
    }
  }

  function enable(): Promise<void> {
    if (shuttingDown) return Promise.reject(new Error('Connect is shutting down'));
    if (state.intent === 'removing') {
      return Promise.reject(new Error('Finish removing the public address before enabling'));
    }
    if (state.intent === 'on' && operation !== null && phase !== 'error') return operation;
    try {
      persist({
        intent: 'on',
        generation: state.generation + 1,
        reservationId: state.reservationId ?? randomUUID(),
      });
    } catch (error) {
      phase = 'error';
      operation = closeHandles().then(() => {
        throw error;
      });
      return operation;
    }
    operation = start(state.generation);
    return operation;
  }

  async function disable(): Promise<void> {
    if (state.intent === 'removing') {
      throw new Error('Finish removing the public address before disabling');
    }
    const generation = state.generation + 1;
    phase = 'stopping';
    try {
      try {
        persist({ intent: 'off', generation });
        input.invalidatePairing(false);
      } finally {
        await closeHandles();
      }
      if (state.generation === generation) phase = 'off';
    } catch (error) {
      if (state.generation === generation) phase = 'error';
      throw error;
    }
  }

  async function remove(): Promise<void> {
    const generation = state.generation + 1;
    phase = 'removing';
    try {
      try {
        persist({ intent: 'removing', generation });
        input.invalidatePairing(true);
      } finally {
        await closeHandles();
      }
      const reservationId = state.reservationId;
      if (reservationId !== null) {
        try {
          await allocationPending;
        } catch {
          void 0;
        }
        if (state.generation !== generation) return;
        await input.remove(reservationId, state.allocation);
      }
      if (state.generation !== generation) return;
      persist({ intent: 'off', reservationId: null, allocation: null });
      phase = 'off';
    } catch (error) {
      if (state.generation === generation) phase = 'error';
      throw error;
    }
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true;
    phase = 'stopping';
    try {
      await closeHandles();
      phase = 'off';
    } catch (error) {
      phase = 'error';
      throw error;
    }
  }

  return {
    enable,
    disable,
    remove,
    shutdown,
    resume: () =>
      state.intent === 'on' ? enable() : state.intent === 'removing' ? remove() : Promise.resolve(),
    status: (): ConnectStatus => ({
      phase,
      generation: state.generation,
      url:
        phase === 'ready' && state.allocation !== null
          ? `https://${state.allocation.hostname}`
          : null,
    }),
  };
}
