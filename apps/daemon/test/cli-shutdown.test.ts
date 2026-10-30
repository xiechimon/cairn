import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { runForeground } from '../src/cli.js';
import { runMachine } from '../src/machine-loop.js';

vi.mock('../src/machine-loop.js', () => ({ runMachine: vi.fn() }));

test.each(['SIGINT', 'SIGTERM'] as const)(
  '%s exits even when an active prompt keeps the machine done promise pending',
  async (signal) => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-cli-shutdown-'));
    vi.stubEnv('CAIRN_HOME', home);
    const listeners = new Map(
      (['SIGINT', 'SIGTERM'] as const).map((name) => [name, process.listeners(name)]),
    );
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const stop = vi.fn(async () => {});
    vi.mocked(runMachine).mockResolvedValue({ machineId: 'm1', stop, done });
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const foreground = runForeground({});
    try {
      await vi.waitFor(() =>
        expect(process.listenerCount(signal)).toBe(listeners.get(signal)!.length + 1),
      );
      const listener = process
        .listeners(signal)
        .find((value) => !listeners.get(signal)!.includes(value));
      listener?.(signal);
      await vi.waitFor(() => expect(exit).toHaveBeenCalledOnce());
      expect(stop).toHaveBeenCalledWith(signal);
    } finally {
      finish();
      await foreground;
      for (const [name, previous] of listeners) {
        for (const listener of process.listeners(name)) {
          if (!previous.includes(listener)) process.removeListener(name, listener);
        }
      }
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    }
  },
);
