import { describe, expect, test } from 'vitest';
import { buildSkillLoadTool } from '../src/skill-tool.js';

describe('Skill tool (#1299 pi custom tool)', () => {
  test('hit → returns the full SKILL.md text + invoke log', async () => {
    const invocations: string[] = [];
    const tool = buildSkillLoadTool({
      skillFileMap: new Map([['test-skill', '/tmp/test-skill/SKILL.md']]),
      onInvoke: (name) => invocations.push(name),
    });

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

  test('unknown name → error text, no invoke recorded', async () => {
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

  test('empty name → non-empty prompt required', async () => {
    const invocations: string[] = [];
    const tool = buildSkillLoadTool({
      skillFileMap: new Map(),
      onInvoke: (name) => invocations.push(name),
    });

    const result = await tool.execute({ skill: '' });
    expect(result).toContain('non-empty');
    expect(invocations).toHaveLength(0);
  });

  test('file read failure → error embeds the original text', async () => {
    const invocations: string[] = [];
    const tool = buildSkillLoadTool({
      skillFileMap: new Map([['broken', '/tmp/no-such-file/SKILL.md']]),
      onInvoke: (name) => invocations.push(name),
    });

    const result = await tool.execute({ skill: 'broken' });
    expect(result).toContain('Failed to read');
    expect(result).toContain('broken');
    expect(result).toContain('/tmp/no-such-file/SKILL.md');
    expect(invocations).toEqual(['broken']);
  });

  test('tool name = Skill (same source as shared/skill-facts.ts skillCallName)', () => {
    const tool = buildSkillLoadTool({ skillFileMap: new Map() });
    expect(tool.name).toBe('Skill');
  });
});
