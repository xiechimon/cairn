// 技能注入三前置条件（#1186）失败方式，先于判定固化：
//   A1 RED：skillsAllowlist 为 []（#1169 历史形，显式全拒）→ allowlist-closed。
//      步仍可成功；本断言只报红，不改授权语义。
//   A2 RED：defaultSkill 非空，且 allowlist 是数组但不含它 →
//      default-skill-unauthorized。两字段互相矛盾。
//   A3 RED：选择集（requested）里的名字既不在 injected 也不在 unrendered
//      → not-injected。在 omitted 里 = 字节预算丢掉；否则 = 缺失/碰撞/扫描空。
//   A4 RED：requested 缺省（chief / 无选择收窄）时，omitted 里每个名字
//      都是 not-injected（全量目录上的预算丢弃）。
//   A5 YELLOW 不是 RED：授权面内且实际注入，但整次运行没有该名的
//      classifySkillFact → injected-unread。模型没用它。不得升红。
//   A6 拒绝的读取仍是命中：isError 的技能事实不算未读。
//   A7 成功读取不算未读。
//   A8 #1106：授权了但没被选择的名字不红（选择收窄注入，不收窄授权）。
//   A9 requested 空 + allowlist null + 注入空 = ok（零注入不是故障）。
//   A10 disableModelInvocation（unrendered）的被选名字不红。
//   A11 红与黄可并存：level = red，yellows 仍列出。
//   A12 defaultSkill 不在 allowlist 时不再另记一条黄（已经是红）。
//   F1 skillFactsFromContents：对象形与 JSON 串形的 toolcall 都抽出技能名。

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

  test('A2 defaultSkill 不在数组 allowlist → red default-skill-unauthorized + not-injected', () => {
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

  test('A3 预算丢掉的被选名字 → not-injected，留下的未读名字仍是黄', () => {
    const v = check({
      skillsAllowlist: null,
      requested: ['a', 'b'],
      names: { injected: ['a'], omitted: ['b'], unrendered: [] },
    });
    expect(v.level).toBe('red');
    expect(v.reds).toEqual([expect.objectContaining({ code: 'not-injected', skill: 'b' })]);
    expect(v.yellows).toEqual([expect.objectContaining({ code: 'injected-unread', skill: 'a' })]);
  });

  test('A4 requested 缺省时 omitted 名是红，注入未读是黄', () => {
    const v = check({
      skillsAllowlist: null,
      requested: undefined,
      names: { injected: ['a'], omitted: ['b'], unrendered: [] },
    });
    expect(v.level).toBe('red');
    expect(v.reds).toEqual([expect.objectContaining({ code: 'not-injected', skill: 'b' })]);
    expect(v.yellows.map((y) => y.skill)).toEqual(['a']);
  });

  test('A5 授权且注入但无事实 → yellow，reds 空', () => {
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

  test('A6 被拒的读取仍是命中，不黄', () => {
    const v = check({
      skillsAllowlist: ['demo-skill'],
      requested: ['demo-skill'],
      names: { injected: ['demo-skill'], omitted: [], unrendered: [] },
      facts: [{ name: 'demo-skill', denied: true }],
    });
    expect(v.level).toBe('ok');
    expect(v.yellows).toEqual([]);
  });

  test('A7 成功读取不黄', () => {
    const v = check({
      skillsAllowlist: ['demo-skill'],
      requested: ['demo-skill'],
      names: { injected: ['demo-skill'], omitted: [], unrendered: [] },
      facts: [{ name: 'demo-skill', denied: false }],
    });
    expect(v.level).toBe('ok');
  });

  test('A8 授权但没被选择的名字不红（#1106）', () => {
    const v = check({
      skillsAllowlist: ['a', 'b'],
      requested: ['a'],
      names: { injected: ['a'], omitted: [], unrendered: [] },
      facts: [{ name: 'a', denied: false }],
    });
    expect(v.level).toBe('ok');
    expect(v.reds.map((r) => r.skill)).not.toContain('b');
  });

  test('A9 零命中 + null allowlist + 空注入 = ok', () => {
    const v = check({ skillsAllowlist: null, requested: [], names: emptyNames });
    expect(v).toEqual({ level: 'ok', reds: [], yellows: [] });
  });

  test('A10 unrendered 的被选名字不红', () => {
    const v = check({
      skillsAllowlist: ['hidden'],
      requested: ['hidden'],
      names: { injected: [], omitted: [], unrendered: ['hidden'] },
    });
    expect(v.level).toBe('ok');
    expect(v.reds).toEqual([]);
  });

  test('A12 defaultSkill 未授权且被注入：只红不黄', () => {
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

  test('F1 对象形与 JSON 串形都抽出技能名', () => {
    expect(skillFactsFromContents([call, JSON.stringify(call)])).toEqual([
      { name: 'demo-skill', denied: false },
      { name: 'demo-skill', denied: false },
    ]);
  });
});
