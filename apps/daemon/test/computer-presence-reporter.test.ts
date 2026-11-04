import type { ComputerPresence, MachinePresenceBody } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { ComputerPresenceReporter } from '../src/computer/presence.js';

const report: ComputerPresence = {
  scopeKey: 'chief:one',
  providerRef: 'ref-one',
  state: 'running',
};

function source() {
  const listeners = new Set<() => void>();
  let state = report;
  return {
    presence: vi.fn(async () => [state]),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: ComputerPresence) {
      state = next;
      for (const listener of listeners) listener();
    },
    get listeners() {
      return listeners.size;
    },
  };
}

describe('computer presence transport', () => {
  test('sends actual observations and keeps probe failures separate from machine presence', async () => {
    const observed = source();
    const bodies: MachinePresenceBody[] = [];
    const reporter = new ComputerPresenceReporter({
      source: observed,
      body: () => ({ cliVersion: 'test' }),
      send: async (body) => {
        bodies.push(body);
      },
    });
    await reporter.send();
    expect(bodies[0]).toEqual({ cliVersion: 'test', computers: [report] });
    observed.presence.mockRejectedValueOnce(new Error('runtime probe unavailable'));
    await reporter.send();
    expect(bodies[1]).toEqual({ cliVersion: 'test' });
    await reporter.close();
  });

  test('coalesces changes during an in-flight request without overlapping writes', async () => {
    const observed = source();
    const bodies: MachinePresenceBody[] = [];
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const reporter = new ComputerPresenceReporter({
      source: observed,
      body: () => ({}),
      send: async (body) => {
        bodies.push(body);
        if (bodies.length === 1) {
          entered?.();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      },
    });
    const pending = reporter.send();
    await started;
    observed.set({ ...report, state: 'starting' });
    observed.set({ ...report, state: 'stopped' });
    expect(bodies).toHaveLength(1);
    release?.();
    await pending;
    expect(bodies.map((body) => body.computers?.[0]?.state)).toEqual(['running', 'stopped']);
    await reporter.close();
  });

  test('deadline aborts a stalled real transport signal and rejects promptly', async () => {
    let sentSignal: AbortSignal | undefined;
    const reporter = new ComputerPresenceReporter({
      body: () => ({}),
      timeoutMs: 40,
      send: async (_body, signal) => {
        sentSignal = signal;
        await new Promise<void>(() => {});
      },
    });
    await expect(reporter.send()).rejects.toThrow('presence');
    expect(sentSignal?.aborted).toBe(true);
    await reporter.close();
  });

  test('a hung runtime probe cannot prevent machine presence or survive reporter closure', async () => {
    const observed = source();
    observed.presence.mockImplementation(async () => new Promise<ComputerPresence[]>(() => {}));
    const send = vi.fn(async (_body: MachinePresenceBody, _signal: AbortSignal) => {});
    const reporter = new ComputerPresenceReporter({
      source: observed,
      body: () => ({ cliVersion: 'test' }),
      send,
      probeTimeoutMs: 10,
    });
    await reporter.send();
    expect(send.mock.calls[0]?.[0]).toEqual({ cliVersion: 'test' });
    await reporter.close();
    expect(observed.listeners).toBe(0);
    observed.set({ ...report, state: 'stopped' });
    expect(send).toHaveBeenCalledOnce();
    await expect(reporter.send()).rejects.toThrow('closed');
  });

  test('probe deadlines abort the runtime command signal before sending machine presence', async () => {
    let probeSignal: AbortSignal | undefined;
    const reporter = new ComputerPresenceReporter({
      source: {
        presence: async (signal?: AbortSignal) => {
          probeSignal = signal;
          return new Promise<ComputerPresence[]>(() => {});
        },
        subscribe: () => () => {},
      },
      body: () => ({}),
      send: async () => {},
      probeTimeoutMs: 10,
    });
    await reporter.send();
    expect(probeSignal?.aborted).toBe(true);
    await reporter.close();
  });
});
