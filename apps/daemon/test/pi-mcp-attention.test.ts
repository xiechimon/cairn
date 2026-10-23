// #930 MCP 原生桥的失败观察面：pi MCP 扩展在 headless 会话里把连接失败经
// ctx.ui.notify 报告（reportProblems；SDK 面无其它状态出口——探针实测
// 2026-10-08）。失败方式清单（先固化）：
//   A1 attention 块——「MCP servers need attention:」标题 + 缩进行
//       `  <name>: <state>`（state 形：`failed: <reason>` / `needs sign-in`）；
//   A2 非 attention 通知（still connecting / 其它扩展）——不产行；
//   A3 多 server 各一行、行序保持；
//   A4 connectFailedLine 拼形（canon = MCP_CONNECT_FAILED_CANON）。
import { MCP_CONNECT_FAILED_CANON } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { connectFailedLine } from '../src/backend/mcp-config.js';
import { parseMcpAttentionMessage } from '../src/backend/pi.js';

const ATTENTION = [
  'MCP servers need attention:',
  '  dead: failed: fetch failed',
  '  authsrv: needs sign-in',
  'Run /mcp to fix.',
].join('\n');

describe('parseMcpAttentionMessage（A1–A3）', () => {
  test('A1：attention 块逐行解析出 (slug, reason)', () => {
    expect(parseMcpAttentionMessage(ATTENTION)).toEqual([
      { slug: 'dead', reason: 'failed: fetch failed' },
      { slug: 'authsrv', reason: 'needs sign-in' },
    ]);
  });
  test('A2：非 attention 通知与空串不产行', () => {
    expect(
      parseMcpAttentionMessage(
        'MCP servers are still connecting; their tools become available once connected.',
      ),
    ).toEqual([]);
    expect(parseMcpAttentionMessage('MCP failed to load: boom')).toEqual([]);
    expect(parseMcpAttentionMessage('')).toEqual([]);
  });
  test('A3：块内非行（无缩进）跳过不炸', () => {
    const msg = ['MCP servers need attention:', 'garbage line', '  ok: failed: x'].join('\n');
    expect(parseMcpAttentionMessage(msg)).toEqual([{ slug: 'ok', reason: 'failed: x' }]);
  });
});

describe('connectFailedLine（A4：canon 行拼形）', () => {
  test('行形 = `<slug>: <canon>: <reason>`', () => {
    const line = connectFailedLine('dead', 'failed: fetch failed');
    expect(line).toBe(`dead: ${MCP_CONNECT_FAILED_CANON}: failed: fetch failed`);
  });
  test('reason 缺席时仍成行（canon 前缀完整）', () => {
    const line = connectFailedLine('dead', '');
    expect(line).toBe(`dead: ${MCP_CONNECT_FAILED_CANON}: `);
  });
});
