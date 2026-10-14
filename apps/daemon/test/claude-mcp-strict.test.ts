// #1307：daemon 拉起的 claude-code 会话不得继承 ~/.claude.json 的全局 MCP。
// 判定面是 SDK 真实 spawn argv（query → spawnClaudeCodeProcess），不是
// Options 上的字段自述。空 allowlist、仅 in-process pacman、以及显式 stdio
// 端点三条都要带 --strict-mcp-config；--mcp-config 只出现在有外部端点时，
// 且 JSON 里只有那个端点。

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createSdkMcpServer, query, type SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test } from 'vitest';
import { buildClaudeSdkOptions, mapMcpEndpoint } from '../src/backend/claude-code.js';

function baseParts() {
  return {
    cwd: '/tmp',
    modelId: 'glm-5.3',
    resumeId: null,
    sessionId: 'sid-1307',
    disallowedTools: ['AskUserQuestion'],
    mcpServers: {},
    abortController: new AbortController(),
  };
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

async function spawnArgs(
  parts: Parameters<typeof buildClaudeSdkOptions>[0],
): Promise<{ args: string[] }> {
  const options = buildClaudeSdkOptions(parts);
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
  for await (const _message of q) {
    void _message;
  }
  if (args === null) throw new Error('claude was not spawned');
  return { args };
}

function mcpConfig(args: string[]): string | null {
  const index = args.indexOf('--mcp-config');
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

describe('claude-code spawn MCP isolation (#1307)', () => {
  test('空 allowlist：--strict-mcp-config，不带 --mcp-config，setting sources 仍在', async () => {
    const { args } = await spawnArgs(baseParts());
    expect(args).toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(null);
    expect(args).toContain('--setting-sources=user,project,local');
  });

  test('仅 in-process pacman：严格模式，argv 不序列化 sdk server', async () => {
    const pacman = createSdkMcpServer({ name: 'pacman', alwaysLoad: true, tools: [] });
    const { args } = await spawnArgs({ ...baseParts(), mcpServers: { pacman } });
    expect(args).toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(null);
  });

  test('显式 stdio 端点：--mcp-config 只有该端点，并带严格模式', async () => {
    const pacman = createSdkMcpServer({ name: 'pacman', alwaysLoad: true, tools: [] });
    const { args } = await spawnArgs({
      ...baseParts(),
      mcpServers: {
        pacman,
        figma: mapMcpEndpoint({
          slug: 'figma',
          transport: 'stdio',
          command: 'figma-mcp',
          args: ['--stdio'],
        }),
      },
    });
    expect(args).toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(
      '{"mcpServers":{"figma":{"type":"stdio","command":"figma-mcp","args":["--stdio"],"alwaysLoad":true}}}',
    );
  });
});
