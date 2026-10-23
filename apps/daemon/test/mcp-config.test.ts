// spec 13 daemon 本机解析面（#368）：claim 载荷 mcpServers = slug 列表 →
// 读本机 config（mcpConfigPath，默认 ~/.claude.json）解析 McpEndpoint[] →
// 喂 pi 原生 MCP（backend/pi.ts registerMcpServer，#930）。密钥值只活在执行机
// （config 文件 → 子进程/请求头），从不跨 wire。失败方式清单：
//   正常——http headers / stdio command+args+env 全保真；
//   未知 slug——跳过 + onMissing 降级回调（canon 行「config 里找不到」）；
//   坏条目——config 里有键但形状坏 = 跳过不炸；
//   文件缺失 / 坏 JSON——全集视为未命中，不炸；
//   大小写——slug 匹配 config 键不区分大小写（与 server 投影小写化同律）。

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCP_NOT_IN_CONFIG_CANON } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { notInConfigLine, resolveMcpEndpoints } from '../src/backend/mcp-config.js';

function cfg(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-mcp-daemon-cfg-'));
  const p = join(dir, 'claude.json');
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return p;
}

const CONFIG = {
  mcpServers: {
    demo: { url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer sec' } },
    local: { command: 'npx', args: ['-y', 'x'], env: { API_KEY: 'k' } },
    broken: { nope: 1 },
  },
};

describe('resolveMcpEndpoints — slug → 本机 config 解析（spec 13）', () => {
  test('正常：http 带 headers、stdio 带 command/args/env，值全保真（执行面本机读）', () => {
    const eps = resolveMcpEndpoints(cfg(CONFIG), ['demo', 'local']);
    expect(eps).toEqual([
      {
        slug: 'demo',
        transport: 'http',
        url: 'https://example.invalid/mcp',
        headers: { Authorization: 'Bearer sec' },
      },
      {
        slug: 'local',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'x'],
        env: { API_KEY: 'k' },
      },
    ]);
  });

  test('未知 slug：跳过 + onMissing 回调；canon 降级行「config 里找不到」', () => {
    const missing: string[] = [];
    const eps = resolveMcpEndpoints(cfg(CONFIG), ['ghost', 'demo'], {
      onMissing: (slug) => missing.push(slug),
    });
    expect(eps.map((e) => e.slug)).toEqual(['demo']);
    expect(missing).toEqual(['ghost']);
    expect(notInConfigLine('ghost')).toBe(`ghost: ${MCP_NOT_IN_CONFIG_CANON}`);
    expect(notInConfigLine('ghost')).toContain('its tools are unavailable this turn');
  });

  test('坏条目：config 里有键但形状坏 = 跳过不炸（与 server 读取缝同律）', () => {
    const eps = resolveMcpEndpoints(cfg(CONFIG), ['broken']);
    expect(eps).toEqual([]);
  });

  test('文件缺失 / 坏 JSON = 空集，全部走 onMissing，不抛', () => {
    const missing: string[] = [];
    const absent = join(tmpdir(), 'cairn-no-such-claude.json');
    expect(resolveMcpEndpoints(absent, ['a'], { onMissing: (s) => missing.push(s) })).toEqual([]);
    expect(missing).toEqual(['a']);
    expect(resolveMcpEndpoints(cfg('{{{ not json'), ['a'])).toEqual([]);
  });

  test('大小写归一匹配：config 键 Playwright ↔ claim slug playwright', () => {
    const eps = resolveMcpEndpoints(cfg({ mcpServers: { Playwright: { command: 'pw' } } }), [
      'playwright',
    ]);
    expect(eps).toEqual([{ slug: 'playwright', transport: 'stdio', command: 'pw' }]);
  });

  test('空 slug 列表 = 空端点集（零开销，不读文件）', () => {
    expect(resolveMcpEndpoints(cfg(CONFIG), [])).toEqual([]);
  });
});
