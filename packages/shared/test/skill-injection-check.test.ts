import { describe, expect, test } from 'vitest';
import {
  assertSkillInjection,
  type SkillInjectionInput,
  skillFactsFromContents,
} from '../src/skill-injection-check.js';

const emptyNames = {
  injected: [] as string[],
  omitted: [] as string[],
  unrendered: [] as string[],
};

function check(
  partial: Partial<SkillInjectionInput> & Pick<SkillInjectionInput, 'skillsAllowlist'>,
): ReturnType<typeof assertSkillInjection> {
  return assertSkillInjection({
    defaultSkill: null,
    requested: [],
    names: emptyNames,
    facts: [],
    ...partial,
  });
}

describe('assertSkillInjection（#1186）', () => {
  test('A1 allowlist [] → red allowlist-closed', () => {
    const v = check({ skillsAllowlist: [], requested: [], names: emptyNames });
    expect(v.level).toBe('red');
    expect(v.reds.map((r) => r.code)).toContain('allowlist-closed');
  });

  test('A2 defaultSkill not in array allowlist -> red default-skill-unauthorized + not-injected', () => {
    const v = check({
      skillsAllowlist: ['other'],
      defaultSkill: 'carry',
      requested: ['carry'],
      names: emptyNames,
    });
    expect(v.level).toBe('red');
    expect(v.reds.map((r) => r.code)).toEqual(
      expect.arrayContaining(['default-skill-unauthorized', 'not-injected']),
    );
    expect(v.reds.filter((r) => r.code === 'not-injected').map((r) => r.skill)).toEqual(['carry']);
  });

  test('A3 selected names lost to budget -> not-injected; remaining unread names stay yellow', () => {
    const v = check({
      skillsAllowlist: null,
      requested: ['a', 'b'],
      names: { injected: ['a'], omitted: ['b'], unrendered: [] },
    });
    expect(v.level).toBe('red');
    expect(v.reds).toEqual([expect.objectContaining({ code: 'not-injected', skill: 'b' })]);
    expect(v.yellows).toEqual([expect.objectContaining({ code: 'injected-unread', skill: 'a' })]);
  });

  test('A4 without requested, omitted names are red; injected-unread is yellow', () => {
    const v = check({
      skillsAllowlist: null,
      requested: undefined,
      names: { injected: ['a'], omitted: ['b'], unrendered: [] },
    });
    expect(v.level).toBe('red');
    expect(v.reds).toEqual([expect.objectContaining({ code: 'not-injected', skill: 'b' })]);
    expect(v.yellows.map((y) => y.skill)).toEqual(['a']);
  });

  test('A5 authorized and injected but no fact -> yellow, reds empty', () => {
    const v = check({
      skillsAllowlist: ['demo-skill'],
      requested: ['demo-skill'],
      names: { injected: ['demo-skill'], omitted: [], unrendered: [] },
    });
    expect(v.level).toBe('yellow');
    expect(v.reds).toEqual([]);
    expect(v.yellows).toEqual([
      expect.objectContaining({ code: 'injected-unread', skill: 'demo-skill' }),
    ]);
  });

  test('A6 denied reads still count as hits, not yellow', () => {
    const v = check({
      skillsAllowlist: ['demo-skill'],
      requested: ['demo-skill'],
      names: { injected: ['demo-skill'], omitted: [], unrendered: [] },
      facts: [{ name: 'demo-skill', denied: true }],
    });
    expect(v.level).toBe('ok');
    expect(v.yellows).toEqual([]);
  });

  test('A7 successful reads are not yellow', () => {
    const v = check({
      skillsAllowlist: ['demo-skill'],
      requested: ['demo-skill'],
      names: { injected: ['demo-skill'], omitted: [], unrendered: [] },
      facts: [{ name: 'demo-skill', denied: false }],
    });
    expect(v.level).toBe('ok');
  });

  test('A8 authorized but unselected names are not red (#1106)', () => {
    const v = check({
      skillsAllowlist: ['a', 'b'],
      requested: ['a'],
      names: { injected: ['a'], omitted: [], unrendered: [] },
      facts: [{ name: 'a', denied: false }],
    });
    expect(v.level).toBe('ok');
    expect(v.reds.map((r) => r.skill)).not.toContain('b');
  });

  test('A9 zero hits + null allowlist + empty injection = ok', () => {
    const v = check({ skillsAllowlist: null, requested: [], names: emptyNames });
    expect(v).toEqual({ level: 'ok', reds: [], yellows: [] });
  });

  test('A10 unrendered selected names are not red', () => {
    const v = check({
      skillsAllowlist: ['hidden'],
      requested: ['hidden'],
      names: { injected: [], omitted: [], unrendered: ['hidden'] },
    });
    expect(v.level).toBe('ok');
    expect(v.reds).toEqual([]);
  });

  test('A12 defaultSkill unauthorized but injected: red only, not yellow', () => {
    const v = check({
      skillsAllowlist: ['other'],
      defaultSkill: 'carry',
      requested: ['carry'],
      names: { injected: ['carry'], omitted: [], unrendered: [] },
    });
    expect(v.level).toBe('red');
    expect(v.reds.map((r) => r.code)).toContain('default-skill-unauthorized');
    expect(v.yellows).toEqual([]);
  });
});

describe('skillFactsFromContents（#1186）', () => {
  const call = {
    kind: 'toolcall',
    call: {
      name: 'read',
      arguments: { path: '/s/demo-skill/SKILL.md' },
      result: 'x',
    },
  };

  test('F1 object form and JSON string form both extract the skill name', () => {
    expect(skillFactsFromContents([call, JSON.stringify(call)])).toEqual([
      { name: 'demo-skill', denied: false },
      { name: 'demo-skill', denied: false },
    ]);
  });
});
