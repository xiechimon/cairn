import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { COMPUTER_IDLE_STOP_MS, ComputerOrbs, computerMachineName } from '../src/orb/computer.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) expect(releaseTestTempDir(root)).toBe(true);
});

function fixture() {
  const root = makeTestTempDir('computer-presence-');
  roots.push(root);
  const running = new Set<string>();
  let now = 0;
  let fail = false;
  let failList = false;
  let releaseStart: (() => void) | undefined;
  let entered: (() => void) | undefined;
  let waitStart = false;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const computers = new ComputerOrbs({
    runtimeRoot: root,
    now: () => now,
    runner: async (argv) => {
      const [, command, name] = argv;
      if ((command === 'list' && failList) || (command === 'clone' && fail))
        return { code: 1, stdout: '', stderr: 'probe failed' };
      if (command === 'start') {
        entered?.();
        if (waitStart)
          await new Promise<void>((resolve) => {
            releaseStart = resolve;
          });
        running.add(name ?? '');
        mkdirSync(join(root, name ?? ''), { mode: 0o700 });
      }
      if (command === 'poweroff' || command === 'terminate') running.delete(name ?? '');
      return { code: 0, stdout: command === 'list' ? [...running].join('\n') : '', stderr: '' };
    },
  });
  return {
    computers,
    running,
    started,
    failClone: () => {
      fail = true;
    },
    failProbe: () => {
      failList = true;
    },
    pauseStart: () => {
      waitStart = true;
    },
    releaseStart: () => releaseStart?.(),
    advance: () => {
      now += COMPUTER_IDLE_STOP_MS + 1;
    },
  };
}

describe('actual computer runtime observations', () => {
  test('reports starting while provision is pending, then actual running and idle stopped', async () => {
    const f = fixture();
    f.pauseStart();
    const pending = f.computers.ensure('chief:one');
    await f.started;
    expect(await f.computers.presence()).toEqual([
      { scopeKey: 'chief:one', providerRef: computerMachineName('chief:one'), state: 'starting' },
    ]);
    f.releaseStart();
    await pending;
    expect((await f.computers.presence())[0]?.state).toBe('running');
    f.advance();
    await f.computers.sweep();
    expect((await f.computers.presence())[0]?.state).toBe('stopped');
  });

  test('an external stop is discovered from runtime instead of a cached success', async () => {
    const f = fixture();
    await f.computers.ensure('chief:one');
    f.running.clear();
    expect((await f.computers.presence())[0]?.state).toBe('stopped');
  });

  test('a failed provision reports failed without creating a running computer', async () => {
    const f = fixture();
    f.failClone();
    await expect(f.computers.ensure('chief:one')).rejects.toThrow('probe failed');
    expect((await f.computers.presence())[0]?.state).toBe('failed');
    expect(f.running.size).toBe(0);
  });

  test('runtime probe failure rejects rather than reporting every computer stopped', async () => {
    const f = fixture();
    await f.computers.ensure('chief:one');
    f.failProbe();
    await expect(f.computers.presence()).rejects.toThrow('probe failed');
  });
});
