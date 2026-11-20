import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { parentPidFromEnv, pidAlive, watchParentProcess } from './parent-watch.js';

const ENV_KEY = 'CAIRN_PARENT_PID';

test('parentPidFromEnv parses a positive integer pid and rejects junk', () => {
  expect(parentPidFromEnv({ [ENV_KEY]: '1234' })).toBe(1234);
  expect(parentPidFromEnv({})).toBeNull();
  expect(parentPidFromEnv({ [ENV_KEY]: '0' })).toBeNull();
  expect(parentPidFromEnv({ [ENV_KEY]: '-5' })).toBeNull();
  expect(parentPidFromEnv({ [ENV_KEY]: 'abc' })).toBeNull();
  expect(parentPidFromEnv({ [ENV_KEY]: '12.5' })).toBeNull();
});

test('pidAlive sees pid 1 as alive even without signal permission', () => {
  expect(pidAlive(1)).toBe(true);
});

test('pidAlive reports a reaped child as dead', { timeout: 20_000 }, async () => {
  const parent = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((done) => parent.once('exit', done));
  expect(pidAlive(parent.pid as number)).toBe(false);
});

test('a parent that exits fires onDead once', { timeout: 20_000 }, async () => {
  const parent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60)'], {
    stdio: 'ignore',
  });
  expect(parent.pid).toBeTypeOf('number');
  const exited = new Promise((done) => parent.once('exit', done));
  let calls = 0;
  const stop = watchParentProcess({
    pid: parent.pid as number,
    intervalMs: 10,
    onDead: () => {
      calls += 1;
    },
  });
  try {
    await exited;
    await delay(80);
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    await delay(80);
    expect(calls).toBe(seen);
  } finally {
    stop();
  }
});

test('a live parent never fires onDead', async () => {
  let calls = 0;
  const stop = watchParentProcess({
    pid: process.pid,
    intervalMs: 10,
    onDead: () => {
      calls += 1;
    },
  });
  try {
    await delay(80);
    expect(calls).toBe(0);
  } finally {
    stop();
  }
});

test('a parent that is already dead fires onDead immediately', { timeout: 20_000 }, async () => {
  const parent = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((done) => parent.once('exit', done));
  let calls = 0;
  const stop = watchParentProcess({
    pid: parent.pid as number,
    intervalMs: 10_000,
    onDead: () => {
      calls += 1;
    },
  });
  try {
    expect(calls).toBe(1);
  } finally {
    stop();
  }
});
