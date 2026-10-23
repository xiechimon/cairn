// claude-code 凭据预检（#867 T6）：`claude auth status` 读数 → 三态判定 +
// 显式失败文案。
//
// 为什么需要它：claude-code 步的认证是机器本地的（spec 17 A4 零凭据通道），
// 机器没登录时 CLI 把「Not logged in · Please run /login」当**普通回答**回给
// runner，result 帧 subtype 仍是 success（is_error=true 被丢弃）→ 步静默
// success、零产出、无错误面。预检把这种机器在步执行前拦下并点名。
//
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 未登录（loggedIn:false / authMethod:none）→ not-logged-in
//   2. OAuth 登录（macOS keychain / ~/.claude/.credentials.json）→ logged-in
//   3. api_key_helper / apiKeySource → logged-in
//   4. 第三方 provider（bedrock / vertex，authMethod:third_party）→ logged-in
//      ——判定只认 loggedIn，不认 authMethod 词表（CLI 自己已经算过）
//   5. 输出非 JSON / 非对象 / 缺 loggedIn（老 CLI）→ unknown（不拦步）
//   6. `claude` 不在 PATH / 超时 / 非零退出 → unknown（不拦步）
//   7. 失败文案点名：机器名 + 凭据类 + 补法（三件齐）

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  claudeCodeAuthFailureMessage,
  parseClaudeCodeAuthStatus,
  probeClaudeCodeAuth,
} from '../src/claude-code-auth.js';

/** `claude auth status` 实测输出形（2026-10-05 本机 / mea 双端取样）。 */
function statusJson(fields: Record<string, unknown>): string {
  return JSON.stringify({
    loggedIn: true,
    authMethod: 'oauth_token',
    apiProvider: 'firstParty',
    analyticsDisabled: false,
    projectsDirectory: '/home/u/.claude/projects',
    configDirectory: '/home/u/.claude',
    ...fields,
  });
}

describe('parseClaudeCodeAuthStatus', () => {
  test('失败方式 1：未登录 → not-logged-in', () => {
    expect(parseClaudeCodeAuthStatus(statusJson({ loggedIn: false, authMethod: 'none' }))).toEqual({
      state: 'not-logged-in',
      provider: 'firstParty',
    });
  });

  test('失败方式 2：OAuth 登录 → logged-in', () => {
    expect(parseClaudeCodeAuthStatus(statusJson({ authMethod: 'oauth_token' }))).toEqual({
      state: 'logged-in',
      method: 'oauth_token',
      provider: 'firstParty',
    });
  });

  test('失败方式 3：apiKeyHelper → logged-in（apiKeySource 随行）', () => {
    const raw = statusJson({ authMethod: 'api_key_helper', apiKeySource: 'apiKeyHelper' });
    expect(parseClaudeCodeAuthStatus(raw)).toEqual({
      state: 'logged-in',
      method: 'api_key_helper',
      provider: 'firstParty',
    });
  });

  test('失败方式 4：第三方 provider（bedrock）→ logged-in（判定只认 loggedIn）', () => {
    const raw = statusJson({ authMethod: 'third_party', apiProvider: 'bedrock' });
    expect(parseClaudeCodeAuthStatus(raw)).toEqual({
      state: 'logged-in',
      method: 'third_party',
      provider: 'bedrock',
    });
  });

  test('失败方式 5：非 JSON / 非对象 / 缺 loggedIn → unknown（不拦步）', () => {
    for (const raw of ['', 'not json', '[]', '"str"', JSON.stringify({ authMethod: 'none' })]) {
      const parsed = parseClaudeCodeAuthStatus(raw);
      expect(parsed.state).toBe('unknown');
    }
  });
});

describe('probeClaudeCodeAuth', () => {
  test('失败方式 6：命令不可执行 → unknown（不抛、不拦步）', async () => {
    const probe = await probeClaudeCodeAuth({
      command: 'cairn-no-such-claude-binary',
      timeoutMs: 2_000,
    });
    expect(probe.state).toBe('unknown');
  });

  test('注入 run：stdout 走 parse（成功路径不发真 CLI）', async () => {
    const probe = await probeClaudeCodeAuth({
      run: async () => ({ stdout: statusJson({ loggedIn: false, authMethod: 'none' }) }),
    });
    expect(probe).toEqual({ state: 'not-logged-in', provider: 'firstParty' });
  });

  test('失败方式 6b：真子进程 rc=1 + stdout 有 JSON → 照常判定（不被退出码折成 unknown）', async () => {
    // 实测形（2026-10-05）：未登录时 `claude auth status` 写完整 JSON 到
    // stdout 后 **exit 1**。按退出码判会把这一步折成 unknown → 预检静默失效
    // （live 跑踩到过），故用真子进程钉住「退出码不进判定」。
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-auth-'));
    const stub = join(dir, 'claude');
    writeFileSync(
      stub,
      `#!/bin/sh\necho '${statusJson({ loggedIn: false, authMethod: 'none' })}'\nexit 1\n`,
    );
    chmodSync(stub, 0o755);
    try {
      const probe = await probeClaudeCodeAuth({ command: stub, timeoutMs: 5_000 });
      expect(probe).toEqual({ state: 'not-logged-in', provider: 'firstParty' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('注入 run：run 抛错 → unknown（原因留在 reason 里）', async () => {
    const probe = await probeClaudeCodeAuth({
      run: async () => {
        throw new Error('spawn claude ENOENT');
      },
    });
    expect(probe.state).toBe('unknown');
    expect(probe.state === 'unknown' && probe.reason).toContain('ENOENT');
  });
});

describe('claudeCodeAuthFailureMessage', () => {
  test('失败方式 7：点名机器 + 凭据类 + 补法', () => {
    const msg = claudeCodeAuthFailureMessage('daemon-mea');
    expect(msg).toContain('daemon-mea'); // 哪台机器
    expect(msg).toContain('claude-code'); // 哪个 runtime
    expect(msg).toContain('ANTHROPIC_API_KEY'); // 凭据类
    expect(msg).toContain('ANTHROPIC_AUTH_TOKEN');
    expect(msg).toContain('/login'); // 补法
    expect(msg).toContain('不跨机'); // 为什么这台机器要自己配
  });
});
