// chief-dispatch 评测的 teardown 回归。被测 agent 会在 workspaces/<uuid>/ 下用
// `nohup vite &` 起 dev server——它不在 harness 持有的任何 handle 里：close() 的
// handle.stop()/server.close() 够不着，disposeLeftovers() 又只 rmSync 目录
// （rmSync 不杀进程）。不清理就会以 ppid=1 的孤儿形态继续 LISTEN 5173，跑 N 轮
// 从 5173 排到 5173+N，把后续本机 dev 一路往后挤（2026-09-29 实测占满 5173-5179）。
// 本测复刻该形态，验证 reapEscapees 能反查清掉。

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { reapEscapees } from '../eval/chief-dispatch/stack.mts';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('reapEscapees', () => {
  const homes: string[] = [];
  const pids: number[] = [];

  const makeHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-eval-chief-test-'));
    homes.push(home);
    return home;
  };

  /** 复刻孤儿形态：detached（独立进程组）+ unref（父不等待），cwd 落在 home 下。 */
  const spawnEscapee = (home: string): number => {
    const webDir = join(home, 'workspaces', 'fake-uuid-0001', 'apps', 'web');
    mkdirSync(webDir, { recursive: true });
    const script = join(webDir, 'fake-dev-server.mjs');
    writeFileSync(script, 'setInterval(() => {}, 1000);\n');
    const child = spawn(process.execPath, [script], {
      cwd: webDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    const pid = child.pid as number;
    pids.push(pid);
    return pid;
  };

  afterEach(() => {
    // 兜底：测中若断言提前失败，别把假 dev server 留成真孤儿。
    for (const pid of pids.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* 已被 reapEscapees 清掉 */
      }
    }
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  test('清掉工作区里逃逸的 dev server', async () => {
    const home = makeHome();
    const pid = spawnEscapee(home);
    await new Promise((r) => setTimeout(r, 400));
    expect(alive(pid)).toBe(true);

    const reaped = await reapEscapees(home);

    expect(reaped).toBeGreaterThanOrEqual(1);
    expect(alive(pid)).toBe(false);
  });

  test('pgrep -f 的子串匹配跨过 /var 与 /private/var 的 symlink 差异', async () => {
    const home = makeHome();
    const pid = spawnEscapee(home);
    await new Promise((r) => setTimeout(r, 400));

    // home 取 tmpdir() 形式（macOS 上是 /var/folders/...），进程 cmdline 里却是
    // /private/var/folders/...。反查依赖 pgrep -f 的子串匹配而非 realpath——
    // realpathSync 在目录已删时会抛，home 字符串则始终可用。
    const out = execFileSync('pgrep', ['-f', home], { encoding: 'utf8' });

    expect(out.split('\n').map((s) => Number(s.trim()))).toContain(pid);
  });

  test('没有逃逸进程时返回 0', async () => {
    expect(await reapEscapees(makeHome())).toBe(0);
  });

  test('目录不存在时返回 0 而不抛', async () => {
    expect(await reapEscapees(join(tmpdir(), 'cairn-eval-chief-absent-xyz'))).toBe(0);
  });
});
