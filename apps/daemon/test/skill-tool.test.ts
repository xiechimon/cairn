// #1299 Skill 加载工具（pi session 自定义工具）：入参 skill name →
// 校验在可见集 → 返回 SKILL.md 全文 + [skills] invoke 日志。
// 失败方式清单（票 #1299 验收映射）：命中（返回全文 + 日志）/ 未见名
// （错误文本）/ 空名（需要非空提示）/ 读文件失败（错误内嵌原文）。

import { describe, expect, test } from 'vitest';
import { buildSkillLoadTool } from '../src/skill-tool.js';

describe('Skill 工具（#1299 pi 自定义工具）', () => {
  test('命中 → 返回 SKILL.md 全文 + invoke 日志', async () => {
    const invocations: string[] = [];
    const tool = buildSkillLoadTool({
      skillFileMap: new Map([['test-skill', '/tmp/test-skill/SKILL.md']]),
      onInvoke: (name) => invocations.push(name),
    });

    // write a real file for the tool to read
    const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    mkdirSync('/tmp/test-skill', { recursive: true });
    writeFileSync('/tmp/test-skill/SKILL.md', '# Test Skill\n\nBody content.\n', 'utf8');

    try {
      const result = await tool.execute({ skill: 'test-skill' });
      expect(result).toContain('# Test Skill');
      expect(result).toContain('Body content');
      expect(invocations).toEqual(['test-skill']);
    } finally {
      rmSync('/tmp/test-skill', { recursive: true, force: true });
    }
  });

  test('未见名 → 错误文本，不记录 invoke', async () => {
    const invocations: string[] = [];
    const tool = buildSkillLoadTool({
      skillFileMap: new Map([['known', '/tmp/known/SKILL.md']]),
      onInvoke: (name) => invocations.push(name),
    });

    const result = await tool.execute({ skill: 'unknown-skill' });
    expect(result).toContain('not found');
    expect(result).toContain('unknown-skill');
    expect(invocations).toHaveLength(0);
  });

  test('空名 → 需要非空提示', async () => {
    const invocations: string[] = [];
    const tool = buildSkillLoadTool({
      skillFileMap: new Map(),
      onInvoke: (name) => invocations.push(name),
    });

    const result = await tool.execute({ skill: '' });
    expect(result).toContain('non-empty');
    expect(invocations).toHaveLength(0);
  });

  test('读文件失败 → 错误内嵌原文', async () => {
    const invocations: string[] = [];
    const tool = buildSkillLoadTool({
      skillFileMap: new Map([['broken', '/tmp/no-such-file/SKILL.md']]),
      onInvoke: (name) => invocations.push(name),
    });

    const result = await tool.execute({ skill: 'broken' });
    expect(result).toContain('Failed to read');
    expect(result).toContain('broken');
    expect(result).toContain('/tmp/no-such-file/SKILL.md');
    expect(invocations).toEqual(['broken']); // invoke is logged before the read fails
  });

  test('工具名 = Skill（shared/skill-facts.ts skillCallName 同源）', () => {
    const tool = buildSkillLoadTool({ skillFileMap: new Map() });
    expect(tool.name).toBe('Skill');
  });
});
