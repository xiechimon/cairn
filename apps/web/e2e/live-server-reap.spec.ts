// e2e 起的真 apps/server 必须随调用方一起消失。失败方式：
//   1. dispose 只打到包装层：corepack 的 pnpm shim 收到 SIGTERM 自己退出、
//      不转发，pnpm-native → tsx → server → esbuild 整串被 PID 1 收养
//   2. 调用方被 SIGKILL / 崩溃（Bash 超时、Ctrl-C、worker 崩），afterAll
//      没机会跑，server 树原样留存
// 判据与实现无关：按 CAIRN_HOME=<本次 home> 反查整机进程环境——包装层、
// tsx、server、esbuild 任一层还活着都算残留。

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { ENV_VARS } from '@cairn/shared';
import { expect, test } from '@playwright/test';
import { bootLiveServer } from './live-server';

const SERVER_DIR = resolve(import.meta.dirname, '..', '..', 'server');
const SPAWNER = resolve(import.meta.dirname, 'live-server-spawner.ts');

function pidsCarrying(home: string): number[] {
  const marker = ` ${ENV_VARS.home}=${home} `;
  return execFileSync('ps', ['axeww', '-o', 'pid=,command='], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\n')
    .filter((line) => `${line} `.includes(marker))
    .map((line) => Number.parseInt(line, 10));
}

const homes: string[] = [];
const spawners: ChildProcess[] = [];

test.afterEach(() => {
  for (const spawner of spawners.splice(0)) spawner.kill('SIGKILL');
  for (const home of homes.splice(0)) {
    for (const pid of pidsCarrying(home)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test('dispose 之后 server 整棵进程树不留一个', async () => {
  const server = await bootLiveServer(null);
  homes.push(server.home);
  expect(pidsCarrying(server.home).length).toBeGreaterThan(0);

  await server.dispose();

  expect(pidsCarrying(server.home)).toEqual([]);
});

test('调用方被 SIGKILL、teardown 没机会跑 → server 树自行退出', async () => {
  const spawner = spawn(process.execPath, ['--import', 'tsx', SPAWNER], {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  spawners.push(spawner);
  const [home] = (await Promise.race([
    once(createInterface({ input: spawner.stdout }), 'line'),
    once(spawner, 'exit').then(() => {
      throw new Error('spawner exited before the live server was ready');
    }),
  ])) as [string];
  homes.push(home);
  expect(pidsCarrying(home).length).toBeGreaterThan(0);

  spawner.kill('SIGKILL');

  await expect.poll(() => pidsCarrying(home), { timeout: 10_000 }).toEqual([]);
});
