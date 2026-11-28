import { describe, expect, test } from 'vitest';
import { createBootWaiter } from '../src/server-boot.js';

const server = (exitCode: number | null) => ({ origin: 'http://127.0.0.1:54400', exitCode });

describe('boot waiter', () => {
  test('follows the restart when the first server dies before it answers', async () => {
    let current = server(null);
    let calls = 0;
    const waitReady = async (): Promise<void> => {
      calls += 1;
      if (calls === 1) {
        current = server(null);
        throw new Error('The Cairn server exited with code 15 before it was ready.');
      }
      return Promise.resolve();
    };
    const started = await createBootWaiter({
      current: () => current,
      waitReady,
      timeoutMs: 1_000,
    })();
    expect(calls).toBe(2);
    expect(started).toBe(current);
  });

  test('reports the boot failure when no replacement took over', async () => {
    const dead = server(15);
    const waiter = createBootWaiter({
      current: () => dead,
      waitReady: () => Promise.reject(new Error('exited before it was ready')),
      timeoutMs: 1_000,
      attempts: 2,
    });
    await expect(waiter()).rejects.toThrow('exited before it was ready');
  });

  test('gives up when the replacement never becomes ready', async () => {
    let current = server(null);
    const waiter = createBootWaiter({
      current: () => current,
      waitReady: async () => {
        current = server(15);
        throw new Error('exited before it was ready');
      },
      timeoutMs: 1_000,
      attempts: 2,
    });
    await expect(waiter()).rejects.toThrow('exited before it was ready');
  });
});
