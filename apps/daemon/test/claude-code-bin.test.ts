// claude 二进制探测（#1050）：`claude --version` + PATH 解析 → 清单里
// 「这台机器到底装没装」的事实源。
//
// 为什么需要它：providers 页的 claude-code 段原来的 installed 只等于
// 「~/.claude/settings.json 在且能解析」，与二进制无关——配置文件在而二进制
// 缺失/太旧时页面照样说「已安装」；反过来「装了但没写配置」显示成「未安装」。
// 探测把这两个方向都摆正，并把解析出的路径钉给 SDK（pathToClaudeCodeExecutable，
// 消掉「探的二进制」与「执行的二进制」可能不是一个）。
//
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 命令不在 PATH / 无执行位 → null（不抛）
//   2. spawn 失败（ENOENT）→ null
//   3. 超时（进程挂住）→ null（2s 上界，presence 30s 节拍不许被拖住）
//   4. stdout 无版本号（wrapper 打别的东西）→ path 照报、version null
//   5. 输出带尾换行/空白 → trim 后解析
//   6. 输出形 `2.1.289 (Claude Code)` → 抽 `2.1.289`
//   7. 输出形 `v2.1.289` → 抽 `2.1.289`（去前导 v）
//   8. 非零退出但 stdout 有版本 → 照常取（退出码不进判定，同 auth 探针先例）
//   9. `CAIRN_CLAUDE_BIN` 指向绝对路径 → 不扫 PATH，但仍校验存在与执行位
//      （不存在 → null：显式路径不校验等于把假绿原样搬进新字段）
//  #1290（launchd 窄 PATH 下探不到 homebrew 装的 claude）：
//  10. PATH 空 + well-known 目录有假 claude → 探到且 source 点名 well-known
//  11. PATH 有 → 不走回落（well-known 目录里的桩不被命中）
//  12. PATH 空 + well-known 全空 → null（不抛）
//  13. well-known 目录里文件无执行位 → 跳过（同 PATH 扫描律）

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseClaudeVersion, probeClaudeBin, resolveCommandPath } from '../src/claude-code-bin.js';

/** 造一个可执行的 shell 桩（真子进程路径，同 claude-code-auth 测试律）。 */
function makeStub(dir: string, name: string, script: string): string {
  const p = join(dir, name);
  writeFileSync(p, script);
  chmodSync(p, 0o755);
  return p;
}

describe('parseClaudeVersion', () => {
  test('失败方式 6：`2.1.289 (Claude Code)` → 2.1.289', () => {
    expect(parseClaudeVersion('2.1.289 (Claude Code)\n')).toBe('2.1.289');
  });

  test('失败方式 7：前导 v 被去掉', () => {
    expect(parseClaudeVersion('v2.1.289')).toBe('2.1.289');
  });

  test('失败方式 5：前后空白被 trim', () => {
    expect(parseClaudeVersion('  2.1.289  \n\n')).toBe('2.1.289');
  });

  test('失败方式 4：没有版本号 → null（装了但版本说不清）', () => {
    for (const raw of ['', '   ', 'not a version', '(Claude Code)']) {
      expect(parseClaudeVersion(raw)).toBeNull();
    }
  });

  test('带预发布后缀的版本号整段保留', () => {
    expect(parseClaudeVersion('2.1.289-beta.3 (Claude Code)')).toBe('2.1.289-beta.3');
  });
});

describe('resolveCommandPath', () => {
  test('失败方式 1：PATH 里没有 → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      expect(resolveCommandPath('claude', { PATH: dir })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PATH 里命中 → 绝对路径', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho 2.1.289\n');
      expect(resolveCommandPath('claude', { PATH: `${dir}:/nowhere` })).toBe(stub);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('失败方式 1b：命中文件但无执行位 → 跳过', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      writeFileSync(join(dir, 'claude'), '#!/bin/sh\necho 2.1.289\n'); // 不给 +x
      expect(resolveCommandPath('claude', { PATH: dir })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('失败方式 9：绝对路径不扫 PATH——存在且可执行则原样返回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho 2.1.289\n');
      expect(resolveCommandPath(stub, { PATH: '/nowhere' })).toBe(stub);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('失败方式 9b：绝对路径不存在 → null（显式路径也要校验存在，否则假绿照旧）', () => {
    expect(resolveCommandPath('/no/such/claude', { PATH: '/nowhere' })).toBeNull();
  });
});

describe('probeClaudeBin well-known 回落（#1290）', () => {
  test('失败方式 10：PATH 空 + well-known 有假 claude → 探到且 source 点名 well-known', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho "2.1.289 (Claude Code)"\n');
      const info = await probeClaudeBin({
        env: { PATH: '/nowhere' },
        wellKnownDirs: [dir],
      });
      expect(info).toEqual({ path: stub, version: '2.1.289', source: 'well-known' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('失败方式 11：PATH 有 → 不走回落（well-known 目录里的桩不被命中）', async () => {
    const pathDir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-path-'));
    const fallbackDir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-fallback-'));
    try {
      const pathStub = makeStub(pathDir, 'claude', '#!/bin/sh\necho 2.1.289\n');
      makeStub(fallbackDir, 'claude', '#!/bin/sh\necho 9.9.9\n');
      const info = await probeClaudeBin({
        env: { PATH: pathDir },
        wellKnownDirs: [fallbackDir],
      });
      expect(info).toEqual({ path: pathStub, version: '2.1.289', source: 'PATH' });
    } finally {
      rmSync(pathDir, { recursive: true, force: true });
      rmSync(fallbackDir, { recursive: true, force: true });
    }
  });

  test('失败方式 12：PATH 空 + well-known 全空 → null（不抛）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const info = await probeClaudeBin({
        command: 'cairn-no-such-claude',
        env: { PATH: '/nowhere' },
        wellKnownDirs: [dir],
      });
      expect(info).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('失败方式 13：well-known 目录里文件无执行位 → 跳过', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      writeFileSync(join(dir, 'claude'), '#!/bin/sh\necho 2.1.289\n'); // 不给 +x
      const info = await probeClaudeBin({
        env: { PATH: '/nowhere' },
        wellKnownDirs: [dir],
      });
      expect(info).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('绝对路径命令不走回落（显式路径的判定不变）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      makeStub(dir, 'claude', '#!/bin/sh\necho 2.1.289\n');
      const info = await probeClaudeBin({
        command: '/no/such/claude',
        env: { PATH: '/nowhere' },
        wellKnownDirs: [dir],
      });
      expect(info).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('probeClaudeBin', () => {
  test('成功：真子进程桩 → {path, version}', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho "2.1.289 (Claude Code)"\n');
      const info = await probeClaudeBin({ command: stub, env: { PATH: dir } });
      expect(info).toEqual({ path: stub, version: '2.1.289', source: 'PATH' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('失败方式 8：非零退出但 stdout 有版本 → 照常取', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho 2.1.289\nexit 1\n');
      const info = await probeClaudeBin({ command: stub, env: { PATH: dir } });
      expect(info).toEqual({ path: stub, version: '2.1.289', source: 'PATH' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('失败方式 1/2：命令不存在 → null（不抛）', async () => {
    expect(await probeClaudeBin({ command: 'cairn-no-such-claude', timeoutMs: 2_000 })).toBeNull();
  });

  test('失败方式 3：超时 → null（进程挂住不拖 presence 节拍）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\nsleep 10\n');
      const started = Date.now();
      const info = await probeClaudeBin({ command: stub, env: { PATH: dir }, timeoutMs: 300 });
      expect(info).toBeNull();
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('失败方式 4：有输出但无版本号 → path 照报、version null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho "hello from a wrapper"\n');
      const info = await probeClaudeBin({ command: stub, env: { PATH: dir } });
      expect(info).toEqual({ path: stub, version: null, source: 'PATH' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('注入 run：解析走 parse（成功路径不发真 CLI）', async () => {
    const info = await probeClaudeBin({
      command: '/fake/claude',
      run: async () => ({ stdout: '2.1.289 (Claude Code)\n' }),
    });
    expect(info).toEqual({ path: '/fake/claude', version: '2.1.289' });
  });

  test('注入 run：run 抛错 → null（原因不外泄、不抛）', async () => {
    const info = await probeClaudeBin({
      command: '/fake/claude',
      run: async () => {
        throw new Error('spawn /fake/claude ENOENT');
      },
    });
    expect(info).toBeNull();
  });

  test('CAIRN_CLAUDE_BIN 覆盖：命令名取环境变量（裸名按 PATH 解析）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    const prev = process.env.CAIRN_CLAUDE_BIN;
    try {
      const stub = makeStub(dir, 'my-claude', '#!/bin/sh\necho 2.1.289\n');
      process.env.CAIRN_CLAUDE_BIN = 'my-claude';
      const info = await probeClaudeBin({ env: { PATH: dir } });
      expect(info).toEqual({ path: stub, version: '2.1.289', source: 'PATH' });
    } finally {
      if (prev === undefined) delete process.env.CAIRN_CLAUDE_BIN;
      else process.env.CAIRN_CLAUDE_BIN = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
