// 三态受管 MCP（#1307）加上 #1314 的真实 spawn argv 判据。
//
// 产品语义：claim / SessionOpts 字段缺省 = 继承机器自己的 MCP 配置，不上
// strict；字段是数组（含 []）= 只加载列出的 server，并打开 strict。#1314 把
// strictMcpConfig 无条件钉成 true，会把缺省态塌成受管空锁，这里不采。
//
// 组装面（Options 字段，先于实现固化的四态）：
//   1. 受管空：mcpServers 键恒发（{} 也发）+ strictMcpConfig: true
//   2. 受管非空：集原样透传 + strict
//   3. 缺省 + 空 record：两键都不发
//   4. 缺省 + 非空：键发、strict 不发
//
// spawn 面（query → spawnClaudeCodeProcess 的真实 argv，#1314）：SDK 在组
// argv 前丢掉空表和仅 in-process sdk server，所以 --mcp-config 只出现在有
// 外部端点时。锁是 --strict-mcp-config，且只在受管态出现。

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createSdkMcpServer, query, type SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test } from 'vitest';
import {
  buildClaudeSdkOptions,
  type ClaudeSdkOptionParts,
  mapMcpEndpoint,
} from '../src/backend/claude-code.js';

type McpRecord = ClaudeSdkOptionParts['mcpServers'];

function parts(over: Partial<ClaudeSdkOptionParts> = {}): ClaudeSdkOptionParts {
  return {
    cwd: '/tmp/cairn-mcp-strict-wt',
    modelId: 'glm-5.3',
    resumeId: null,
    sessionId: 'sess-1307',
    disallowedTools: ['AskUserQuestion'],
    mcpServers: {},
    abortController: new AbortController(),
    ...over,
  };
}

/** 受管集在位形（组装面只认 record 透传，条目取合法 http 形即可）。 */
function withSeam(): McpRecord {
  return { cairn: { type: 'http', url: 'https://example.invalid/mcp' } };
}

function fakeProcess(): SpawnedProcess {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const emitter = new EventEmitter();
  let killed = false;
  let exitCode: number | null = null;
  const proc: SpawnedProcess = {
    stdin,
    stdout,
    get killed() {
      return killed;
    },
    get exitCode() {
      return exitCode;
    },
    signalCode: null,
    kill() {
      killed = true;
      return true;
    },
    on(event, listener) {
      emitter.on(event, listener);
      return proc;
    },
    once(event, listener) {
      emitter.once(event, listener);
      return proc;
    },
    off(event, listener) {
      emitter.off(event, listener);
      return proc;
    },
  };
  queueMicrotask(() => {
    exitCode = 0;
    stdout.end();
    emitter.emit('exit', 0, null);
  });
  return proc;
}

async function spawnArgs(input: ClaudeSdkOptionParts): Promise<{
  options: ReturnType<typeof buildClaudeSdkOptions>;
  args: string[];
}> {
  const options = buildClaudeSdkOptions(input);
  let args: string[] | null = null;
  const q = query({
    prompt: 'ping',
    options: {
      ...options,
      spawnClaudeCodeProcess: (spawn) => {
        args = spawn.args;
        return fakeProcess();
      },
    },
  });
  for await (const message of q) {
    void message;
  }
  if (args === null) throw new Error('claude was not spawned');
  return { options, args };
}

function mcpConfig(args: string[]): string | null {
  const index = args.indexOf('--mcp-config');
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

describe('buildClaudeSdkOptions 三态（#1307 失败方式 1/2）', () => {
  test('受管空：strictMcpConfig 态下 mcpServers 键恒发（空 record {} 不例外）+ strict 锁', () => {
    const opts = buildClaudeSdkOptions(parts({ mcpServers: {}, strictMcpConfig: true }));
    expect('mcpServers' in opts).toBe(true);
    expect(opts.mcpServers).toEqual({});
    expect(opts.strictMcpConfig).toBe(true);
  });

  test('受管非空：managed 集原样透传 + strict 锁（host 缝在集内）', () => {
    const record = withSeam();
    const opts = buildClaudeSdkOptions(parts({ mcpServers: record, strictMcpConfig: true }));
    expect(opts.mcpServers).toBe(record);
    expect(opts.strictMcpConfig).toBe(true);
  });
});

describe('buildClaudeSdkOptions 继承态（#1307 失败方式 3/4：逃生门 + 零回归）', () => {
  test('缺省（继承）+ 空 record：mcpServers 与 strictMcpConfig 两键都不发', () => {
    const opts = buildClaudeSdkOptions(parts({ mcpServers: {} }));
    expect('mcpServers' in opts).toBe(false);
    expect('strictMcpConfig' in opts).toBe(false);
  });

  test('缺省（继承）+ 非空 record：mcpServers 键发（host 缝存活）、strict 键不发', () => {
    const record = withSeam();
    const opts = buildClaudeSdkOptions(parts({ mcpServers: record }));
    expect(opts.mcpServers).toBe(record);
    expect('strictMcpConfig' in opts).toBe(false);
  });
});

describe('claude-code spawn MCP isolation (#1307, tri-state)', () => {
  test('受管空：--strict-mcp-config，不带 --mcp-config，setting sources 仍在', async () => {
    const { options, args } = await spawnArgs(parts({ mcpServers: {}, strictMcpConfig: true }));
    expect(options.strictMcpConfig).toBe(true);
    expect(args).toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(null);
    expect(args).toContain('--setting-sources=user,project,local');
  });

  test('缺省空：argv 不上 --strict-mcp-config，也不带 --mcp-config', async () => {
    const { options, args } = await spawnArgs(parts({ mcpServers: {} }));
    expect('strictMcpConfig' in options).toBe(false);
    expect(args).not.toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(null);
    expect(args).toContain('--setting-sources=user,project,local');
  });

  test('受管、仅 in-process cairn：严格模式，argv 不序列化 sdk server', async () => {
    const cairn = createSdkMcpServer({ name: 'cairn', alwaysLoad: true, tools: [] });
    const { options, args } = await spawnArgs(
      parts({ mcpServers: { cairn }, strictMcpConfig: true }),
    );
    expect(options.mcpServers?.cairn).toBe(cairn);
    expect(args).toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(null);
  });

  test('受管、显式 stdio 端点：--mcp-config 只有该端点，并带严格模式', async () => {
    const cairn = createSdkMcpServer({ name: 'cairn', alwaysLoad: true, tools: [] });
    const figma = mapMcpEndpoint({
      slug: 'figma',
      transport: 'stdio',
      command: 'figma-mcp',
      args: ['--stdio'],
    });
    const { options, args } = await spawnArgs(
      parts({ mcpServers: { cairn, figma }, strictMcpConfig: true }),
    );
    expect(options.mcpServers?.cairn).toBe(cairn);
    expect(options.mcpServers?.figma).toBe(figma);
    expect(args).toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(
      '{"mcpServers":{"figma":{"type":"stdio","command":"figma-mcp","args":["--stdio"],"alwaysLoad":true}}}',
    );
  });

  test('缺省 + 显式 stdio：--mcp-config 在，--strict-mcp-config 不在', async () => {
    const figma = mapMcpEndpoint({
      slug: 'figma',
      transport: 'stdio',
      command: 'figma-mcp',
      args: ['--stdio'],
    });
    const { options, args } = await spawnArgs(parts({ mcpServers: { figma } }));
    expect('strictMcpConfig' in options).toBe(false);
    expect(args).not.toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(
      '{"mcpServers":{"figma":{"type":"stdio","command":"figma-mcp","args":["--stdio"],"alwaysLoad":true}}}',
    );
  });
});
