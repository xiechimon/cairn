// persona 名册契约（#1250 / ADR 0018 决策 0）：外部行为 = 「六名角色 agent
// seeding 时拿到什么身份」。失败方式枚举先于实现固化：
//   1. 名册恰六名（Chief 不在列——既有 chief 机制）、角色不重、每名有档案。
//   2. 每名 description 含 persona 契约四要素（角色/职责/产出形态/规则）+
//      Composition 块（入口步种 + 禁止互调）——这是注入 agent 每个任务的行为
//      正本，缺一角 = 角色行为退化。
//   3. 模型档位按 ADR 注记落位 thinkingLevel：高档/中高档/中档 三档齐全
//      （xhigh/high/medium），不是拍脑袋单档。
//   4. review 族三员带 reviewFocus（fan-out 各视角的 focus 文案源）。
//   5. assignment 四槽：新槽 nullish（存量双槽行照常解析）；非对象槽 400。

import { describe, expect, test } from 'vitest';
import {
  agentRecordSchema,
  createAgentBodySchema,
  PERSONA_ROLES,
  REVIEW_FANOUT_ROLES,
} from '../src/records/agent.js';
import { PERSONA_PROFILES, personaByRole } from '../src/records/persona.js';
import { assignmentSchema } from '../src/records/todo.js';

describe('persona 名册（#1250 / ADR 0018 决策 0）', () => {
  test('失败方式 1：名册恰六名、角色不重、档案可查', () => {
    expect([...PERSONA_ROLES]).toHaveLength(6);
    expect(new Set(PERSONA_PROFILES.map((p) => p.role)).size).toBe(6);
    for (const role of PERSONA_ROLES) {
      expect(personaByRole(role).role).toBe(role);
    }
  });

  test('失败方式 2：每名 description 含契约四要素 + Composition 块（入口步种 + 禁止互调）', () => {
    for (const p of PERSONA_PROFILES) {
      expect(p.description, p.role).toContain('角色：');
      expect(p.description, p.role).toContain('职责：');
      expect(p.description, p.role).toContain('产出形态：');
      expect(p.description, p.role).toContain('规则：');
      expect(p.description, p.role).toContain('Composition：');
      expect(p.description, p.role).toContain('禁止被其他 persona 调用');
    }
    // 入口步种逐名钉（ADR 决策 0 表）。
    expect(personaByRole('planner').description).toContain('plan 步');
    expect(personaByRole('implementer').description).toContain('build 步');
    expect(personaByRole('verifier').description).toContain('verify 步');
    expect(personaByRole('code_reviewer').description).toContain('review 步');
  });

  test('失败方式 3：模型档位三档齐全（ADR 注记 → effort 档位）', () => {
    const levels = new Set(PERSONA_PROFILES.map((p) => p.thinkingLevel));
    expect(levels).toEqual(new Set(['xhigh', 'high', 'medium']));
    expect(personaByRole('planner').thinkingLevel).toBe('xhigh');
    expect(personaByRole('implementer').thinkingLevel).toBe('high');
    expect(personaByRole('verifier').thinkingLevel).toBe('medium');
    expect(personaByRole('code_reviewer').thinkingLevel).toBe('medium');
    expect(personaByRole('security_auditor').thinkingLevel).toBe('medium');
    expect(personaByRole('test_engineer').thinkingLevel).toBe('medium');
  });

  test('失败方式 4：review 族三员带 reviewFocus，其余不带', () => {
    expect([...REVIEW_FANOUT_ROLES]).toEqual([
      'code_reviewer',
      'security_auditor',
      'test_engineer',
    ]);
    for (const role of REVIEW_FANOUT_ROLES) {
      expect(personaByRole(role).reviewFocus, role).toBeTruthy();
    }
    for (const p of PERSONA_PROFILES) {
      if (!REVIEW_FANOUT_ROLES.includes(p.role)) {
        expect(p.reviewFocus, p.role).toBeUndefined();
      }
    }
  });
});

describe('assignment 四槽与 agent persona 位（#1250）', () => {
  test('失败方式 5：新槽 nullish——存量双槽行照常解析；四槽新形可解析', () => {
    expect(assignmentSchema.parse({ plan: { agentId: 'a1' }, build: { agentId: 'a2' } })).toEqual({
      plan: { agentId: 'a1' },
      build: { agentId: 'a2' },
    });
    expect(
      assignmentSchema.parse({
        plan: { agentId: 'a1' },
        build: { agentId: 'a2' },
        review: { agentId: 'a3' },
        verify: { agentId: 'a4' },
      }),
    ).toEqual({
      plan: { agentId: 'a1' },
      build: { agentId: 'a2' },
      review: { agentId: 'a3' },
      verify: { agentId: 'a4' },
    });
    expect(assignmentSchema.parse({ plan: null, build: null }).review).toBeUndefined();
  });

  test('agent 记录/创建体带 persona 位（词表外值拒）', () => {
    expect(
      agentRecordSchema.parse({
        id: 'ag1',
        displayName: 'Planner',
        description: null,
        status: 'active',
        avatarUrl: null,
        provider: null,
        modelId: null,
        persona: 'planner',
        thinkingLevel: null,
        tools: [],
        secrets: [],
        defaultSkill: null,
        skillsAllowlist: null,
        mcpServers: [],
      }).persona,
    ).toBe('planner');
    // #1259：创建体 machineId 必填——词表校验的合法 body 都带上它。
    expect(
      createAgentBodySchema.safeParse({ displayName: 'X', persona: 'chief', machineId: 'm-1' })
        .success,
    ).toBe(false);
    expect(
      createAgentBodySchema.parse({ displayName: 'X', persona: null, machineId: 'm-1' }).persona,
    ).toBeNull();
  });
});
