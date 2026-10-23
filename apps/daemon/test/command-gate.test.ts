// 命令闸 bash 分类器 + tool_call 阻断缝（#866 T5 → #929 换挂点）。
// 失败方式清单（先固化，代码是让场景通过的手段）：
// F1 误拦合法命令 → 默认放行 + 引号内字面不判 + worktree 内 rm -rf 放行；
// F2 漏放（变量/转义/编码绕行）→ 非目标（防误不防恶），但多命令链（;/&&/换行）
//   必须整串扫描，不能只看首命令；
// F3 前缀形态（sudo/env/command/nice）→ 片段 glob 全串匹配，前缀天然覆盖；
// F4 无人值守安全 → 拒绝路径只返回 block+reason，签名无 ctx/ui（不依赖交互确认）；
// F5 超时/取消/截断/流式 → 全在 pi 内建 bash 执行面（闸不再包 operations，
//   #929 起挂 tool_call handler，执行面零改动——行为 pi 原生）；
// F6 覆盖面 → 非 bash 工具（含 MCP mcp__*）走规则表同一条闸（#929 新获能力）；
// F7 bash 规则双名形（'bash'/'Bash'）照旧（decideBashCommand 既有语义）；
// F10 claude-code 覆盖缺口 → 本文件只管 pi 面，缺口在 PR/报告里明示。
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BASH_PATTERNS,
  decideBashCommand,
  decideToolCall,
  formatGateRefusal,
  formatToolRefusal,
  gateToolCallHandler,
  type PermissionRule,
} from '../src/backend/command-gate.js';

/** pi ToolCallEvent 最小同形（类型面在 pi.ts 缝接；本文件只考纯裁决）。 */
function bashEvent(command: string) {
  return { type: 'tool_call' as const, toolCallId: 't1', toolName: 'bash', input: { command } };
}
function toolEvent(toolName: string, input: Record<string, unknown> = {}) {
  return { type: 'tool_call' as const, toolCallId: 't2', toolName, input };
}

describe('默认放行（F1：合法命令一律 allow）', () => {
  const allowed = [
    'ls -la',
    'pnpm test',
    'pnpm --filter @cairn/web e2e:affected',
    'git status && git diff --stat',
    'git push origin session-123',
    'git push --force-with-lease origin session-123',
    'rm -rf ./dist',
    'rm -rf apps/web/dist node_modules/.cache',
    'rm -rf /tmp/cairn-before-main',
    'grep -r "rm -rf /" .',
    'echo "rm -rf /"',
    "echo 'mkfs.ext4 /dev/sda'",
    'find . -name "*.log" -delete',
    'vite build --mode fixture',
    '',
    '   ',
  ];
  for (const command of allowed) {
    it(JSON.stringify(command), () => {
      expect(decideBashCommand(command).action).toBe('allow');
    });
  }
});

describe('不可逆形态设闸（只对不可逆形态）', () => {
  const asked: Array<[string, string]> = [
    ['rm -rf /', 'ask-rm-rf-root'],
    ['sudo rm -rf /', 'ask-rm-rf-root'],
    ['rm -rf /*', 'ask-rm-rf-root'],
    ['rm -rf ~', 'ask-rm-rf-home'],
    ['rm -rf $HOME', 'ask-rm-rf-home'],
    // 花括号取值形（拼串避 noTemplateCurlyInString：此处 `${HOME}` 是有意的
    // shell 字面量，不是写错的模板）。
    [`rm -rf ${'$'}{HOME}`, 'ask-rm-rf-home'],
    [`rm -rf ${'$'}{HOME}/tmp`, 'ask-rm-rf-home'],
    ['rm -rf / --no-preserve-root', 'ask-rm-rf-root'],
    ['rm --recursive --force /', 'ask-rm-rf-root'],
    ['true; rm -rf /', 'ask-rm-rf-root'],
    ['ls /tmp && rm -rf ~', 'ask-rm-rf-home'],
    ['mkfs.ext4 /dev/sda1', 'ask-mkfs'],
    ['sudo mkfs -t ext4 /dev/sdb', 'ask-mkfs'],
    ['dd if=/dev/zero of=/dev/sda bs=1M', 'ask-dd-disk'],
    ['shutdown -h now', 'ask-power'],
    ['sudo reboot', 'ask-power'],
    ['halt', 'ask-power'],
  ];
  for (const [command, ruleId] of asked) {
    it(`${command} → ${ruleId}`, () => {
      const d = decideBashCommand(command);
      expect(d.action).toBe('ask');
      expect(d.ruleId).toBe(ruleId);
    });
  }
  it('fork 炸弹直拒（reject：恒无合法用途）', () => {
    const d = decideBashCommand(':(){ :|:& };:');
    expect(d.action).toBe('reject');
    expect(d.ruleId).toBe('reject-forkbomb');
  });
});

describe('规则表可编程（调用方自带表优先于默认表）', () => {
  it('自定义表命中则按自定义表裁决', () => {
    const custom: PermissionRule[] = [
      { id: 'deny-test', tool: 'Bash', matches: { command: '*test*' }, action: 'reject' },
    ];
    const d = decideBashCommand('pnpm test', custom);
    expect(d).toEqual({ action: 'reject', ruleId: 'deny-test' });
  });
  it('自定义表未命中回落默认表', () => {
    const custom: PermissionRule[] = [
      { id: 'other', tool: 'Bash', matches: { command: '*nope*' }, action: 'reject' },
    ];
    const d = decideBashCommand('rm -rf /', custom);
    expect(d.action).toBe('ask');
  });
  it('默认模式非空、id 唯一且全小写连字符形（审计口径）', () => {
    expect(DEFAULT_BASH_PATTERNS.length).toBeGreaterThan(0);
    const ids = DEFAULT_BASH_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe('拒绝文案（agent 能照着改）', () => {
  it('含规则 id、动作与改道建议', () => {
    const text = formatGateRefusal('rm -rf /', { action: 'ask', ruleId: 'ask-rm-rf-root' });
    expect(text).toContain('ask-rm-rf-root');
    expect(text).toContain('rm -rf /');
    expect(text).toMatch(/confirm|review|replan/i);
  });
  it('工具面拒绝文案同族（含工具名与规则 id）', () => {
    const text = formatToolRefusal('mcp__demo__echo', { action: 'reject', ruleId: 'deny-echo' });
    expect(text).toContain('deny-echo');
    expect(text).toContain('mcp__demo__echo');
    expect(text).toMatch(/confirm|review|replan/i);
  });
});

describe('规则表通用裁决（F6：非 bash 工具走同一条闸）', () => {
  it('MCP 工具名精确规则命中 → 按表裁决', () => {
    const rules: PermissionRule[] = [
      { id: 'deny-echo', tool: 'mcp__demo__echo', action: 'reject' },
    ];
    expect(decideToolCall('mcp__demo__echo', { text: 'hi' }, rules)).toEqual({
      action: 'reject',
      ruleId: 'deny-echo',
    });
  });
  it('`*` 全工具规则命中 MCP 调用（含参数槽 glob）', () => {
    const rules: PermissionRule[] = [
      { id: 'deny-write', tool: '*', matches: { uri: 'secret:*' }, action: 'ask' },
    ];
    expect(decideToolCall('read_mcp_resource', { uri: 'secret://x' }, rules)?.ruleId).toBe(
      'deny-write',
    );
    expect(decideToolCall('read_mcp_resource', { uri: 'public://x' }, rules)).toBeUndefined();
  });
  it('首命中胜出；未命中 / 无规则表 = undefined（默认放行）', () => {
    const rules: PermissionRule[] = [
      { id: 'allow-demo', tool: 'mcp__demo__echo', action: 'allow' },
      { id: 'deny-all', tool: '*', action: 'reject' },
    ];
    expect(decideToolCall('mcp__demo__echo', {}, rules)).toEqual({
      action: 'allow',
      ruleId: 'allow-demo',
    });
    expect(decideToolCall('mcp__other__t', {}, rules)?.ruleId).toBe('deny-all');
    expect(decideToolCall('mcp__demo__echo', {})).toBeUndefined();
    expect(decideToolCall('mcp__demo__echo', {}, [])).toBeUndefined();
  });
  it('非字符串参数槽按空串匹配（glob 不炸）', () => {
    const rules: PermissionRule[] = [
      { id: 'slot', tool: 'mcp__demo__echo', matches: { n: '*' }, action: 'reject' },
    ];
    expect(decideToolCall('mcp__demo__echo', { n: 3 }, rules)?.ruleId).toBe('slot');
  });
});

describe('tool_call 阻断 handler（#929 挂点；F4 无人值守）', () => {
  it('bash ask → block + reason（含规则 id 与命令），不依赖交互面', async () => {
    const handler = gateToolCallHandler({});
    const result = await handler(bashEvent('rm -rf /'));
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('ask-rm-rf-root');
    expect(result?.reason).toContain('rm -rf /');
  });
  it('bash allow → undefined（执行面零参与，pi 内建 bash 原样跑）', async () => {
    const handler = gateToolCallHandler({});
    expect(await handler(bashEvent('ls -la'))).toBeUndefined();
  });
  it('非 bash 无规则 → undefined（MCP 调用照常放行）', async () => {
    const handler = gateToolCallHandler({});
    expect(await handler(toolEvent('mcp__demo__echo', { text: 'hi' }))).toBeUndefined();
  });
  it('非 bash 规则命中（MCP 面）→ block + 工具面文案', async () => {
    const handler = gateToolCallHandler({
      rules: [{ id: 'deny-echo', tool: 'mcp__demo__echo', action: 'reject' }],
    });
    const result = await handler(toolEvent('mcp__demo__echo', { text: 'hi' }));
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('deny-echo');
    expect(result?.reason).toContain('mcp__demo__echo');
  });
  it("bash 双名形规则照旧（F7：'bash'/'Bash' 都命中）", async () => {
    const handler = gateToolCallHandler({
      rules: [
        { id: 'deny-test', tool: 'Bash', matches: { command: '*secret*' }, action: 'reject' },
      ],
    });
    expect((await handler(bashEvent('echo secret-data')))?.reason).toContain('deny-test');
  });
  it('ask/reject 落一行 gate 日志；allow 静默（非常态不征税）', async () => {
    const log = vi.fn();
    const handler = gateToolCallHandler({ log });
    await handler(bashEvent('ls -la'));
    await handler(toolEvent('mcp__demo__echo'));
    expect(log).not.toHaveBeenCalled();
    await handler(bashEvent('rm -rf /'));
    await gateToolCallHandler({
      rules: [{ id: 'deny-echo', tool: 'mcp__demo__echo', action: 'reject' }],
      log,
    })(toolEvent('mcp__demo__echo'));
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]?.[0]).toContain('ask-rm-rf-root');
    expect(log.mock.calls[1]?.[0]).toContain('deny-echo');
  });
});
