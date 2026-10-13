// 三态受管 MCP 组装面（#1307，对齐 Multica mcp_config.go 三态语义）：
// agent 勾选集为受管（含空）时，SDK options 必须把用户全局 MCP 锁出会话——
// dogfood 实测继承面 320 工具 / ~960KB schema（mcp__rea 170 条等）吃光
// glm-5.3 小窗口，autocompact thrash 4/4 必现。失败方式先于实现固化：
//   1. 受管空塌回继承：空 record → mcpServers 键被省略 → SDK 回落读用户
//      全局 config（本票主修位，claude-code.ts buildClaudeSdkOptions 的
//      `Object.keys(...).length > 0` 条件）→ strict 态下键必须恒发（{} 也发）
//   2. 受管非空但缺 strict 旗：CLI 在受管集之上**叠加**用户全局 MCP——
//      勾选了 MCP 的 agent 同样泄漏 → 受管态必须带 strictMcpConfig: true
//   3. 逃生门死掉：缺省态（继承）也发 strict → 旧 server 形 / 版本墙机器
//      失去应继承的 runtime 配置 → 缺省态不得发 strictMcpConfig 键
//   4. 旧行为面回归：缺省 + 空 record = mcpServers 键不发（探针面零漂移）；
//      缺省 + 非空 = 键发、无 strict（host 缝存活 + 继承照旧）

import { describe, expect, test } from 'vitest';
import { buildClaudeSdkOptions, type ClaudeSdkOptionParts } from '../src/backend/claude-code.js';

type McpRecord = ClaudeSdkOptionParts['mcpServers'];

function parts(over: Partial<ClaudeSdkOptionParts> = {}): ClaudeSdkOptionParts {
  return {
    cwd: '/tmp/pacman-mcp-strict-wt',
    modelId: 'glm-5.3',
    resumeId: null,
    sessionId: 'sess-1307',
    disallowedTools: [],
    mcpServers: {},
    abortController: new AbortController(),
    ...over,
  };
}

/** 受管集在位形（组装面只认 record 透传，条目取合法 http 形即可）。 */
function withSeam(): McpRecord {
  return { pacman: { type: 'http', url: 'https://example.invalid/mcp' } };
}

describe('buildClaudeSdkOptions 三态（#1307 失败方式 1/2）', () => {
  test('受管空：strictMcpConfig 态下 mcpServers 键恒发（空 record {} 不例外）+ strict 锁', () => {
    const opts = buildClaudeSdkOptions(parts({ mcpServers: {}, strictMcpConfig: true }));
    // 失败方式 1 判据：键在位（SDK 翻译成 --mcp-config 空表 + --strict-mcp-config，
    // CLI 不再回落 ~/.claude.json 用户全局面）。
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
