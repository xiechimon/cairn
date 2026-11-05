import { existsSync, rmSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { boot } from './machine-loop-harness.js';

const completedHomes: string[] = [];

afterAll(() => {
  try {
    expect(completedHomes.filter((home) => existsSync(home))).toEqual([]);
  } finally {
    for (const home of completedHomes) rmSync(home, { recursive: true, force: true });
  }
});

test('a stopped daemon keeps its home during the test and releases it after teardown', async () => {
  const { handle, home } = await boot({});
  completedHomes.push(home);
  await handle.stop();
  await handle.done;
  expect(existsSync(home)).toBe(true);
});

test.fails('a failed assertion still stops the daemon before releasing its home', async () => {
  const { home } = await boot({});
  completedHomes.push(home);
  throw new Error('deliberate assertion failure');
});

test('initialization failure releases its temporary home immediately', async () => {
  let home = '';
  await expect(
    boot({
      seedJournal(paths) {
        home = paths.home;
        completedHomes.push(home);
        throw new Error('fixture initialization failed');
      },
    }),
  ).rejects.toThrow('fixture initialization failed');
  expect(home).not.toBe('');
  expect(existsSync(home)).toBe(false);
});
