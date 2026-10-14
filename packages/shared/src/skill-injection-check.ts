// 技能注入三前置条件的机器断言（#1186）。判定源 = 授权面（skillsAllowlist /
// defaultSkill）× 实际注入名集（scan + 字节预算之后）× 技能事实
// （classifySkillFact）。期望声明（「这张票应该用技能 X」）不在本层。
// 失败方式枚举见 test/skill-injection-check.test.ts（A1–A12、F1）。
//
// 红 = 授权面与实际注入互相矛盾。黄 = 授权且已注入，但模型一次都没用。
// 黄不得升红。断言不改步结果、不改 deny 语义（#1169：null 不限制、[] 显式
// 全拒、数组白名单）。

import { z } from 'zod';
import type { ToolCallRecord } from './agent-backend.js';
import { classifySkillFact, type SkillFact } from './skill-facts.js';

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

function authorized(allow: readonly string[] | null, name: string): boolean {
  return allow === null || allow.includes(name);
}

export function assertSkillInjection(input: SkillInjectionInput): SkillInjectionVerdict {
  const reds: SkillInjectionRed[] = [];
  const yellows: SkillInjectionYellow[] = [];
  const allow = input.skillsAllowlist;
  const injected = new Set(input.names.injected);
  const unrendered = new Set(input.names.unrendered);
  const omitted = new Set(input.names.omitted);
  const seen = new Set(input.facts.map((f) => f.name));
  const defaultSkill = input.defaultSkill;
  const defaultClosed =
    defaultSkill !== null && defaultSkill !== '' && allow !== null && !allow.includes(defaultSkill);

  if (allow !== null && allow.length === 0) {
    reds.push({
      code: 'allowlist-closed',
      detail: 'skillsAllowlist is []: the skill surface is closed',
    });
  }
  if (defaultClosed && defaultSkill !== null) {
    reds.push({
      code: 'default-skill-unauthorized',
      skill: defaultSkill,
      detail: 'defaultSkill is set but absent from skillsAllowlist',
    });
  }

  if (input.requested !== undefined) {
    for (const name of input.requested) {
      if (injected.has(name) || unrendered.has(name)) continue;
      reds.push({
        code: 'not-injected',
        skill: name,
        detail: omitted.has(name)
          ? 'requested skill was omitted by the byte budget'
          : 'requested skill is not in the injected catalog',
      });
    }
  } else {
    for (const name of input.names.omitted) {
      reds.push({
        code: 'not-injected',
        skill: name,
        detail: 'skill was omitted by the byte budget',
      });
    }
  }

  for (const name of input.names.injected) {
    if (!authorized(allow, name)) continue;
    if (defaultClosed && name === defaultSkill) continue;
    if (seen.has(name)) continue;
    yellows.push({
      code: 'injected-unread',
      skill: name,
      detail: 'skill was injected and no skill fact names it',
    });
  }

  const level: SkillInjectionVerdict['level'] =
    reds.length > 0 ? 'red' : yellows.length > 0 ? 'yellow' : 'ok';
  return { level, reds, yellows };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseContent(content: unknown): Record<string, unknown> | null {
  if (typeof content === 'string') {
    try {
      return asRecord(JSON.parse(content) as unknown);
    } catch {
      return null;
    }
  }
  return asRecord(content);
}

function asToolCall(value: unknown): ToolCallRecord | null {
  const rec = asRecord(value);
  if (rec === null || typeof rec.name !== 'string') return null;
  return {
    id: typeof rec.id === 'string' ? rec.id : '',
    name: rec.name,
    arguments: rec.arguments ?? {},
    ...(rec.result !== undefined ? { result: rec.result } : {}),
    ...(typeof rec.isError === 'boolean' ? { isError: rec.isError } : {}),
  };
}

/** transcript 行 → 技能事实。行形 = `{kind:'toolcall', call}` 对象，或该
 * 对象的 JSON 串（daemon 上传与 system 行两种落库形）。非工具行跳过。 */
export function skillFactsFromContents(contents: readonly unknown[]): SkillFact[] {
  const facts: SkillFact[] = [];
  for (const content of contents) {
    const obj = parseContent(content);
    if (obj === null || obj.kind !== 'toolcall') continue;
    const call = asToolCall(obj.call);
    if (call === null) continue;
    const fact = classifySkillFact(call);
    if (fact !== null) facts.push(fact);
  }
  return facts;
}
