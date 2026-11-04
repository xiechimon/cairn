import { describe, expect, test } from 'vitest';
import type { ToolCallRecord } from '../src/agent-backend.js';
import { classifySkillFact, skillCallName } from '../src/skill-facts.js';

function call(partial: Partial<ToolCallRecord> & { name: string }): ToolCallRecord {
  return { id: 'call-1', arguments: {}, ...partial };
}

const done = { result: 'ok', isError: false } as const;

describe('skillCallName (in-progress display name, S5)', () => {
  test('pi read form: {path} pointing at SKILL.md -> parent directory name', () => {
    expect(
      skillCallName(call({ name: 'read', arguments: { path: '/skills/to-spec/SKILL.md' } })),
    ).toBe('to-spec');
  });

  test('claude-code Read form: {file_path}', () => {
    expect(
      skillCallName(
        call({ name: 'Read', arguments: { file_path: '/home/u/.claude/skills/kami/SKILL.md' } }),
      ),
    ).toBe('kami');
  });

  test('Skill native tools: {skill} / {command} / skill: prefixes (S3)', () => {
    expect(skillCallName(call({ name: 'Skill', arguments: { skill: 'probe-skill' } }))).toBe(
      'probe-skill',
    );
    expect(skillCallName(call({ name: 'Skill', arguments: { command: 'to-spec' } }))).toBe(
      'to-spec',
    );
    expect(skillCallName(call({ name: 'Skill', arguments: { skill: 'skill:to-spec' } }))).toBe(
      'to-spec',
    );
  });

  test('half-call (no result) still has a display name (S5)', () => {
    expect(
      skillCallName(call({ name: 'read', arguments: { path: '/s/implement/SKILL.md' } })),
    ).toBe('implement');
  });

  test('non-skill calls -> null (S1)', () => {
    expect(
      skillCallName(call({ name: 'bash', arguments: { command: 'cat SKILL.md' } })),
    ).toBeNull();
    expect(
      skillCallName(call({ name: 'read', arguments: { path: '/s/to-spec/refs/deep.md' } })),
    ).toBeNull();
    expect(skillCallName(call({ name: 'read', arguments: { path: '/src/main.ts' } }))).toBeNull();
    expect(skillCallName(call({ name: 'edit', arguments: { path: '/s/x/SKILL.md' } }))).toBeNull();
  });

  test('case-sensitive: skill.md / Skill.md are not facts (S4)', () => {
    expect(skillCallName(call({ name: 'read', arguments: { path: '/s/x/skill.md' } }))).toBeNull();
    expect(skillCallName(call({ name: 'read', arguments: { path: '/s/x/Skill.md' } }))).toBeNull();
  });

  test('path boundaries: Windows separators / bare SKILL.md / deep nesting (S7)', () => {
    expect(
      skillCallName(call({ name: 'read', arguments: { path: 'C:\\skills\\to-spec\\SKILL.md' } })),
    ).toBe('to-spec');
    expect(skillCallName(call({ name: 'read', arguments: { path: 'SKILL.md' } }))).toBeNull();
    expect(
      skillCallName(call({ name: 'read', arguments: { path: '/a/b/c/deep-skill/SKILL.md' } })),
    ).toBe('deep-skill');
  });

  test('dirty input does not throw (S8)', () => {
    expect(skillCallName(call({ name: 'read' }))).toBeNull();
    expect(skillCallName(call({ name: 'read', arguments: null }))).toBeNull();
    expect(skillCallName(call({ name: 'read', arguments: { path: 42 } }))).toBeNull();
    expect(skillCallName(call({ name: 'Skill', arguments: {} }))).toBeNull();
    expect(skillCallName(call({ name: '' }))).toBeNull();
  });
});

describe('classifySkillFact (terminal fact, S5/S6)', () => {
  test('successful read -> {name, denied:false}', () => {
    expect(
      classifySkillFact(
        call({ name: 'read', arguments: { path: '/s/demo-skill/SKILL.md' }, ...done }),
      ),
    ).toEqual({ name: 'demo-skill', denied: false });
  });

  test('pi gated read denied (tool error) -> denied:true (S6)', () => {
    expect(
      classifySkillFact(
        call({
          name: 'read',
          arguments: { path: '/s/extra-skill/SKILL.md' },
          result: "read denied: skill 'extra-skill' is not in the agent allowlist",
          isError: true,
        }),
      ),
    ).toEqual({ name: 'extra-skill', denied: true });
  });

  test('claude-code deny rule (is_error tool_result) -> denied:true (S6)', () => {
    expect(
      classifySkillFact(
        call({
          name: 'Read',
          arguments: { file_path: '/skills/beta/SKILL.md' },
          result: [
            {
              type: 'text',
              text: "Permission to read /skills/beta/SKILL.md has been denied by permission rule 'Read(//skills/beta/**)'.",
            },
          ],
          isError: true,
        }),
      ),
    ).toEqual({ name: 'beta', denied: true });
  });

  test('Skill native call blocked by a deny rule -> denied:true', () => {
    expect(
      classifySkillFact(
        call({
          name: 'Skill',
          arguments: { skill: 'probe-skill' },
          result: 'denied',
          isError: true,
        }),
      ),
    ).toEqual({ name: 'probe-skill', denied: true });
  });

  test('half-call (no result) is not a fact (S5)', () => {
    expect(
      classifySkillFact(call({ name: 'read', arguments: { path: '/s/x/SKILL.md' } })),
    ).toBeNull();
  });

  test('non-skill calls -> null (S1)', () => {
    expect(
      classifySkillFact(call({ name: 'bash', arguments: { command: 'ls' }, ...done })),
    ).toBeNull();
  });

  test('isError default = not denied (old records / some backends omit the field)', () => {
    expect(
      classifySkillFact(
        call({ name: 'read', arguments: { path: '/s/x/SKILL.md' }, result: 'body' }),
      ),
    ).toEqual({ name: 'x', denied: false });
  });
});
