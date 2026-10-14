// 技能注入三前置条件的机器断言（#1186）。判定源 = 授权面（skillsAllowlist /
// defaultSkill）× 实际注入名集（scan + 字节预算之后）× 技能事实
// （classifySkillFact）。期望声明（「这张票应该用技能 X」）不在本层。
//
// 本文件先落类型与恒 ok 桩，失败方式由 test/skill-injection-check.test.ts
// 钉死；真实判定随后替换桩。

import { z } from 'zod';
import type { SkillFact } from './skill-facts.js';

/** 落库 system 行 kind。web mapper 对未知 system kind 退场，不渲染成裸 JSON。 */
export const SKILL_INJECTION_CHECK_KIND = 'skill_injection_check';

/** 目录构造之后的名集：injected = 进了 catalog 的名字；omitted = 字节预算
 * 丢掉的全名（不是日志 100 名截断）；unrendered = disableModelInvocation
 * 有意不渲染的名字（不是故障）。 */
export interface SkillsInjectionNames {
  injected: string[];
  omitted: string[];
  unrendered: string[];
}

export const skillInjectionFactsSchema = z.object({
  injected: z.array(z.string()),
  omitted: z.array(z.string()),
  unrendered: z.array(z.string()),
});
export type SkillInjectionFacts = z.infer<typeof skillInjectionFactsSchema>;

export interface SkillInjectionRed {
  code: 'allowlist-closed' | 'default-skill-unauthorized' | 'not-injected';
  skill?: string;
  detail: string;
}

export interface SkillInjectionYellow {
  code: 'injected-unread';
  skill: string;
  detail: string;
}

export interface SkillInjectionVerdict {
  level: 'red' | 'yellow' | 'ok';
  reds: SkillInjectionRed[];
  yellows: SkillInjectionYellow[];
}

export interface SkillInjectionInput {
  /** null = 不限制；[] = 显式全拒；数组 = 白名单。 */
  skillsAllowlist: readonly string[] | null;
  defaultSkill: string | null;
  /** undefined = 没有选择收窄（chief / 旧 server 未携带 skillInjection）。 */
  requested: readonly string[] | undefined;
  names: SkillsInjectionNames;
  facts: readonly SkillFact[];
}

/** 桩：忽略入参，恒 ok。真实三色判定替换本函数。 */
export function assertSkillInjection(_input: SkillInjectionInput): SkillInjectionVerdict {
  return { level: 'ok', reds: [], yellows: [] };
}

/** 桩：忽略 transcript，恒空。真实解析替换本函数。 */
export function skillFactsFromContents(_contents: readonly unknown[]): SkillFact[] {
  return [];
}
