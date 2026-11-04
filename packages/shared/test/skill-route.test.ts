import { describe, expect, it } from 'vitest';
import {
  formatSkillRouteSection,
  type SkillRouteHint,
  suggestSkillsForMessage,
} from '../src/index.js';

const installed = [
  { id: 'translator', name: 'translator', description: '中英互译，翻译文档与段落' },
  { id: 'morning-reminder', name: 'morning-reminder', description: '定时提醒与日程通知' },
];

describe('normal conversation zero hits (first failure mode: no hijacking)', () => {
  it('small talk / chit-chat gives no suggestion', () => {
    expect(suggestSkillsForMessage('你好，今天过得怎么样？', installed)).toBeNull();
  });
  it('has time words but no reminder intent -> no suggestion', () => {
    expect(suggestSkillsForMessage('明天的会议纪要帮我整理一下', installed)).toBeNull();
    expect(suggestSkillsForMessage('下周的计划是先把登录页做完', installed)).toBeNull();
  });
  it('has reminder words but no time expression -> no suggestion', () => {
    expect(suggestSkillsForMessage('记得把门带上', installed)).toBeNull();
  });
  it('empty string / whitespace gives no suggestion', () => {
    expect(suggestSkillsForMessage('   ', installed)).toBeNull();
    expect(suggestSkillsForMessage('', [])).toBeNull();
  });
  it('system-triggered prompt ([wake:...] prefix) never suggests', () => {
    expect(suggestSkillsForMessage('[wake:settle] 明天提醒我汇报', installed)).toBeNull();
  });
});

describe('reminder intent (time expression + reminder-verb dual signal)', () => {
  it('user\'s own words trigger as-is: "remind me tomorrow at 9am"', () => {
    const hint = suggestSkillsForMessage('明早 9 点提醒我', installed);
    expect(hint?.ruleId).toBe('reminder');
    expect(hint?.skills.map((s) => s.id)).toEqual(['morning-reminder']);
  });
  it('fullwidth/halfwidth and punctuation normalized, still triggers', () => {
    expect(suggestSkillsForMessage('明早９点，提醒我！', installed)?.ruleId).toBe('reminder');
    expect(suggestSkillsForMessage('每天早上八点叫我起床', installed)?.ruleId).toBe('reminder');
  });
  it("reminder-kind skills not installed -> empty skill set but built-in capability fallback (user's own words work out of the box)", () => {
    const hint = suggestSkillsForMessage('明早 9 点提醒我', [
      { id: 'translator', name: 'translator', description: '中英互译' },
    ]);
    expect(hint?.ruleId).toBe('reminder');
    expect(hint?.skills).toEqual([]);
    expect(hint?.toolHint).toContain('set_wake');
  });
  it('reminder-kind skills installed -> both the skill and the built-in capability named', () => {
    const hint = suggestSkillsForMessage('明早 9 点提醒我', installed);
    expect(hint?.toolHint).toContain('set_wake');
  });
});

describe('explicit mention of an installed skill (highest precision, wins over intent rules)', () => {
  it('naming a skill name hits that skill', () => {
    const hint = suggestSkillsForMessage('用 translator 帮我翻一下这段', installed);
    expect(hint?.ruleId).toBe('explicit-mention');
    expect(hint?.skills.map((s) => s.id)).toEqual(['translator']);
  });
  it('Chinese names match too', () => {
    const zh = [{ id: 's1', name: '周报助手', description: '帮你写周报' }];
    const hint = suggestSkillsForMessage('喊周报助手出来写一下', zh);
    expect(hint?.skills.map((s) => s.id)).toEqual(['s1']);
  });
  it('mentioning a name not installed -> null (no fabrication)', () => {
    expect(suggestSkillsForMessage('用 pdf-polish 排一下版', installed)).toBeNull();
  });
  it('single-character names do not participate in mention matching (prevents single-char false matches)', () => {
    const one = [{ id: 'x', name: 'x', description: '占位' }];
    expect(suggestSkillsForMessage('x 是什么', one)).toBeNull();
  });
});

describe('suggestion-section copy (mis-trigger reversible: always a suggestion)', () => {
  it('carries candidate skill id + description + verify before use', () => {
    const hint = suggestSkillsForMessage('明早 9 点提醒我', installed);
    expect(hint?.ruleId).toBe('reminder');
    const section = formatSkillRouteSection(hint as SkillRouteHint);
    expect(section).toContain('morning-reminder');
    expect(section).toContain('定时提醒与日程通知');
    expect(section).toContain('set_wake');
    expect(section).toMatch(/核对|不切合.*忽略|仅建议/);
  });
  it('null from normal conversation produces no section', () => {
    expect(suggestSkillsForMessage('你好', installed)).toBeNull();
  });
});
