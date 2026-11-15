import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, test } from 'vitest';
import {
  type ConnectAllocation,
  type ConnectHandle,
  type ConnectIntent,
  type ConnectLifecycleInput,
  createConnectLifecycle,
} from '../src/services/connect-lifecycle.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const allocation: ConnectAllocation = { id: 'allocation-a', hostname: 'a.connect.example' };

function world(blocked: 'allocate' | 'listener' | 'connector' | 'probe' | null = null) {
  let saved: ConnectIntent = {
    intent: 'off',
    generation: 0,
    reservationId: null,
    allocation: null,
  };
  const gate = deferred<void>();
  const reached = deferred<void>();
  const listeners = new Set<ConnectHandle>();
  const connectors = new Set<ConnectHandle>();
  const reservations: string[] = [];
  const removals: Array<{ reservationId: string; allocation: ConnectAllocation | null }> = [];
  let persistFails = false;
  let closeFails = false;
  let grants = true;
  let sessions = true;

  async function pause(at: typeof blocked) {
    if (blocked !== at) return;
    reached.resolve();
    await gate.promise;
  }

  function handle(at: 'listener' | 'connector', set: Set<ConnectHandle>): ConnectHandle {
    const resource: ConnectHandle = {
      ready: pause(at),
      close: async () => {
        if (closeFails) throw new Error('close failed');
        set.delete(resource);
      },
    };
    set.add(resource);
    return resource;
  }

  const input: ConnectLifecycleInput = {
    load: () => saved,
    save: (next) => {
      if (persistFails) throw new Error('disk full');
      saved = structuredClone(next);
    },
    allocate: async (reservationId) => {
      reservations.push(reservationId);
      await pause('allocate');
      return allocation;
    },
    remove: async (reservationId, found) => {
      removals.push({ reservationId, allocation: found });
    },
    openListener: () => handle('listener', listeners),
    startConnector: () => handle('connector', connectors),
    probe: () => pause('probe'),
    invalidatePairing: (removeSessions) => {
      grants = false;
      if (removeSessions) sessions = false;
    },
  };
  const lifecycle = createConnectLifecycle(input);
  return {
    lifecycle,
    input,
    gate,
    reached,
    listeners,
    connectors,
    reservations,
    removals,
    saved: () => saved,
    access: () => ({ grants, sessions }),
    failPersistence: () => {
      persistFails = true;
    },
    failClose: (fail: boolean) => {
      closeFails = fail;
    },
  };
}

describe('Connect local intent fences', () => {
  test.each(['allocate', 'listener', 'connector', 'probe'] as const)(
    'disable during %s closes owned resources and never publishes a stale URL',
    async (at) => {
      const w = world(at);
      const enabling = w.lifecycle.enable();
      await w.reached.promise;
      await w.lifecycle.disable();
      expect(w.saved().intent).toBe('off');
      expect(w.listeners.size + w.connectors.size).toBe(0);
      expect(w.access()).toEqual({ grants: false, sessions: true });
      w.gate.resolve();
      await enabling;
      expect(w.lifecycle.status()).toMatchObject({ phase: 'off', url: null });
      expect(w.listeners.size + w.connectors.size).toBe(0);
      expect(w.saved().allocation).toEqual(allocation);
      const restored = createConnectLifecycle(w.input);
      await restored.resume();
      expect(w.listeners.size + w.connectors.size).toBe(0);
    },
  );

  test.each(['allocate', 'listener', 'connector', 'probe'] as const)(
    'disable then enable while %s is suspended only activates the new generation',
    async (at) => {
      const w = world(at);
      const old = w.lifecycle.enable();
      await w.reached.promise;
      await w.lifecycle.disable();
      const latest = w.lifecycle.enable();
      const duplicate = w.lifecycle.enable();
      expect(duplicate).toBe(latest);
      w.gate.resolve();
      await Promise.all([old, latest]);
      expect(w.lifecycle.status()).toEqual({
        phase: 'ready',
        generation: 3,
        url: 'https://a.connect.example',
      });
      expect(w.reservations).toHaveLength(1);
      expect(w.listeners.size).toBe(1);
      expect(w.connectors.size).toBe(1);
      await w.lifecycle.disable();
    },
  );

  test.each(['allocate', 'listener', 'connector', 'probe'] as const)(
    'remove during %s blocks re-enrollment until the saved reservation is retired',
    async (at) => {
      const w = world(at);
      const enabling = w.lifecycle.enable();
      await w.reached.promise;
      const reservationId = w.saved().reservationId;
      const removing = w.lifecycle.remove();
      expect(w.saved().intent).toBe('removing');
      await expect(w.lifecycle.enable()).rejects.toThrow('Finish removing');
      expect(w.access()).toEqual({ grants: false, sessions: false });
      w.gate.resolve();
      await Promise.all([enabling, removing]);
      expect(w.removals).toEqual([{ reservationId, allocation }]);
      expect(w.saved()).toMatchObject({ intent: 'off', reservationId: null, allocation: null });
      expect(w.listeners.size + w.connectors.size).toBe(0);
    },
  );

  test('a late rejected probe cannot overwrite a newer ready generation', async () => {
    const w = world('probe');
    const old = w.lifecycle.enable();
    await w.reached.promise;
    await w.lifecycle.disable();
    w.input.probe = async () => {};
    await w.lifecycle.enable();
    w.gate.reject(new Error('old probe failed'));
    await old;
    expect(w.lifecycle.status().phase).toBe('ready');
    expect(w.listeners.size).toBe(1);
    await w.lifecycle.disable();
  });

  test('failed cleanup remains restartable and never permits a fresh reservation', async () => {
    const w = world();
    await w.lifecycle.enable();
    w.input.remove = async () => {
      throw new Error('broker offline');
    };
    await expect(w.lifecycle.remove()).rejects.toThrow('broker offline');
    expect(w.saved().intent).toBe('removing');
    await expect(w.lifecycle.enable()).rejects.toThrow('Finish removing');
    const restored = createConnectLifecycle(w.input);
    w.input.remove = async (reservationId, found) => {
      w.removals.push({ reservationId, allocation: found });
    };
    await restored.resume();
    expect(restored.status().phase).toBe('off');
    expect(w.reservations).toHaveLength(1);
    expect(w.removals[0]?.allocation).toEqual(allocation);
  });

  test('a failed close is not reported Off and can be retried', async () => {
    const w = world();
    await w.lifecycle.enable();
    w.failClose(true);
    await expect(w.lifecycle.disable()).rejects.toThrow('close failed');
    expect(w.lifecycle.status()).toMatchObject({ phase: 'error', url: null });
    expect(w.listeners.size + w.connectors.size).toBe(2);
    w.failClose(false);
    await w.lifecycle.disable();
    expect(w.lifecycle.status().phase).toBe('off');
    expect(w.listeners.size + w.connectors.size).toBe(0);
  });

  test('failure persisting disable still fences callbacks and closes local exposure', async () => {
    const w = world('probe');
    const enabling = w.lifecycle.enable();
    await w.reached.promise;
    w.failPersistence();
    await expect(w.lifecycle.disable()).rejects.toThrow('disk full');
    expect(w.listeners.size + w.connectors.size).toBe(0);
    w.gate.resolve();
    await enabling;
    expect(w.lifecycle.status()).toMatchObject({ phase: 'error', url: null });
  });

  test('failed enable persistence cannot allocate or report an active connection', async () => {
    const w = world();
    w.failPersistence();
    await expect(w.lifecycle.enable()).rejects.toThrow('disk full');
    expect(w.lifecycle.status()).toMatchObject({ phase: 'error', url: null });
    expect(w.reservations).toEqual([]);
    expect(w.listeners.size + w.connectors.size).toBe(0);
  });

  test('failed removal persistence still closes exposure without deleting cloud resources', async () => {
    const w = world();
    await w.lifecycle.enable();
    w.failPersistence();
    await expect(w.lifecycle.remove()).rejects.toThrow('disk full');
    expect(w.lifecycle.status()).toMatchObject({ phase: 'error', url: null });
    expect(w.listeners.size + w.connectors.size).toBe(0);
    expect(w.removals).toEqual([]);
    await expect(w.lifecycle.enable()).rejects.toThrow('Finish removing');
  });

  test.each(['allocate', 'listener', 'connector', 'probe'] as const)(
    'shutdown during %s closes exposure but preserves restart intent',
    async (at) => {
      const w = world(at);
      const enabling = w.lifecycle.enable();
      await w.reached.promise;
      await w.lifecycle.shutdown();
      w.gate.resolve();
      await enabling;
      expect(w.lifecycle.status()).toMatchObject({ phase: 'off', url: null });
      expect(w.saved().intent).toBe('on');
      expect(w.listeners.size + w.connectors.size).toBe(0);
      await expect(w.lifecycle.enable()).rejects.toThrow('shutting down');
      const restarted = createConnectLifecycle(w.input);
      await restarted.resume();
      expect(restarted.status().phase).toBe('ready');
      expect(w.reservations).toHaveLength(1);
      await restarted.shutdown();
    },
  );

  test('disable closes a real listener and disconnects its active response', async () => {
    const w = world();
    const server = createServer((_req, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: connected\n\n');
    });
    w.input.openListener = () => {
      server.listen(0, '127.0.0.1');
      return {
        ready: once(server, 'listening').then(() => {}),
        close: async () => {
          const closed = once(server, 'close');
          server.close();
          server.closeAllConnections();
          await closed;
        },
      };
    };
    try {
      await w.lifecycle.enable();
      const { port } = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${port}/`;
      const response = await fetch(url);
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: connected\n\n');
      const disconnected = reader.read();
      const rejected = expect(disconnected).rejects.toThrow();
      await w.lifecycle.disable();
      await rejected;
      await expect(fetch(url)).rejects.toThrow();
      expect(w.lifecycle.status()).toMatchObject({ phase: 'off', url: null });
    } finally {
      await w.lifecycle.shutdown();
    }
  });
});
