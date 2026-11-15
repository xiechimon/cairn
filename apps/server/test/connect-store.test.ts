import { chmodSync, mkdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createConnectLifecycle } from '../src/services/connect-lifecycle.js';
import { openConnectStore } from '../src/services/connect-store.js';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) releaseTestTempDir(home);
});

function homeDir(): string {
  const home = makeTestTempDir('connect-');
  homes.push(home);
  return home;
}

test('Connect stores intent durably and exclusively without changing the application database', () => {
  const home = homeDir();
  const store = openConnectStore(home);
  const intent = {
    intent: 'removing' as const,
    generation: 7,
    reservationId: 'cd96c004-e86c-42b2-9657-dbd2261d3fb8',
    allocation: { id: 'allocation-a', hostname: 'a.connect.example' },
  };
  try {
    expect(store.load()).toEqual({
      intent: 'off',
      generation: 0,
      reservationId: null,
      allocation: null,
    });
    store.save(intent);
    expect(() => openConnectStore(home)).toThrow(/locked/);
    expect(statSync(join(home, 'connect')).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, 'connect', 'state.sqlite')).mode & 0o777).toBe(0o600);
  } finally {
    store.close();
  }
  const restored = openConnectStore(home);
  try {
    expect(restored.load()).toEqual(intent);
    expect(() => restored.save({ ...intent, generation: -1 })).toThrow();
    expect(restored.load()).toEqual(intent);
  } finally {
    restored.close();
  }
});

test('a late allocation remains dormant across durable disable and restart', async () => {
  const home = homeDir();
  let store = openConnectStore(home);
  let complete!: () => void;
  let allocating!: () => void;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    allocating = resolve;
  });
  const allocation = { id: 'allocation-a', hostname: 'a.connect.example' };
  const input = {
    load: () => store.load(),
    save: (state: Parameters<typeof store.save>[0]) => store.save(state),
    allocate: async () => {
      allocating();
      await pending;
      return allocation;
    },
    remove: async () => {},
    openListener: () => {
      throw new Error('disabled listener must not open');
    },
    startConnector: () => {
      throw new Error('disabled connector must not start');
    },
    probe: async () => {},
    invalidatePairing: () => {},
  };
  try {
    const lifecycle = createConnectLifecycle(input);
    const enabling = lifecycle.enable();
    await reached;
    await lifecycle.disable();
    complete();
    await enabling;
    store.close();
    store = openConnectStore(home);
    expect(store.load()).toMatchObject({ intent: 'off', generation: 2, allocation });
    const restarted = createConnectLifecycle(input);
    await restarted.resume();
    expect(restarted.status()).toMatchObject({ phase: 'off', url: null });
  } finally {
    complete();
    store.close();
  }
});

test.each(['directory', 'file', 'symlink', 'corrupt', 'empty', 'missing'] as const)(
  'Connect refuses %s state instead of silently allocating again',
  (at) => {
    const home = homeDir();
    const directory = join(home, 'connect');
    const path = join(directory, 'state.sqlite');
    if (at === 'symlink') {
      const target = join(home, 'target');
      mkdirSync(target, { mode: 0o700 });
      symlinkSync(target, directory);
    } else {
      const store = openConnectStore(home);
      store.close();
      if (at === 'directory') chmodSync(directory, 0o755);
      if (at === 'file') chmodSync(path, 0o644);
      if (at === 'corrupt') writeFileSync(path, 'not a database');
      if (at === 'empty') writeFileSync(path, '');
      if (at === 'missing') unlinkSync(path);
    }
    expect(() => openConnectStore(home)).toThrow();
  },
);
