import { describe, expect, test } from 'vitest';
import {
  AGENT_DESC_MAX_LENGTH,
  agentRecordSchema,
  createAgentBodySchema,
  PERSONA_ROLES,
  REVIEW_FANOUT_ROLES,
} from '../src/records/agent.js';
import { PERSONA_PROFILES, personaByRole } from '../src/records/persona.js';
import { assignmentSchema } from '../src/records/todo.js';

describe('persona roster (#1250 / ADR 0018 decision 0)', () => {
  test('failure mode 1: roster has exactly six, roles unique, profiles retrievable', () => {
    expect([...PERSONA_ROLES]).toHaveLength(6);
    expect(new Set(PERSONA_PROFILES.map((p) => p.role)).size).toBe(6);
    for (const role of PERSONA_ROLES) {
      expect(personaByRole(role).role).toBe(role);
    }
  });

  test("failure mode 2: each description has the contract's four elements + Composition block (entry step kinds + no mutual calls)", () => {
    for (const p of PERSONA_PROFILES) {
      expect(p.description, p.role).toContain('角色：');
      expect(p.description, p.role).toContain('职责：');
      expect(p.description, p.role).toContain('产出形态：');
      expect(p.description, p.role).toContain('规则：');
      expect(p.description, p.role).toContain('Composition：');
      expect(p.description, p.role).toContain('禁止被其他 persona 调用');
    }
    expect(personaByRole('planner').description).toContain('plan 步');
    expect(personaByRole('implementer').description).toContain('build 步');
    expect(personaByRole('verifier').description).toContain('verify 步');
    expect(personaByRole('code_reviewer').description).toContain('review 步');
  });

  test('failure mode 3: all three model tiers present (ADR note -> effort tiers)', () => {
    const levels = new Set(PERSONA_PROFILES.map((p) => p.thinkingLevel));
    expect(levels).toEqual(new Set(['xhigh', 'high', 'medium']));
    expect(personaByRole('planner').thinkingLevel).toBe('xhigh');
    expect(personaByRole('implementer').thinkingLevel).toBe('high');
    expect(personaByRole('verifier').thinkingLevel).toBe('medium');
    expect(personaByRole('code_reviewer').thinkingLevel).toBe('medium');
    expect(personaByRole('security_auditor').thinkingLevel).toBe('medium');
    expect(personaByRole('test_engineer').thinkingLevel).toBe('medium');
  });

  test('failure mode 4: review trio carries reviewFocus, the rest do not', () => {
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

describe('Implementer repo rules (#1406 P5-3)', () => {
  const implementer = personaByRole('implementer').description;

  test('F11: every profile stays within the agent.description length gate', () => {
    for (const p of PERSONA_PROFILES) {
      expect(p.description.length, p.role).toBeLessThanOrEqual(AGENT_DESC_MAX_LENGTH);
    }
  });

  test('F13: repo-rule points complete, pointing at the repo-root AGENTS.md / CLAUDE.md', () => {
    for (const needle of [
      'AGENTS.md',
      'CLAUDE.md',
      'pr-cairn',
      'verify-cairn',
      '<scope>(<票号>): <subject>',
      'closes #',
      'commit message',
      'docs/verify/<票号>/',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm spec:parse',
      'vitest run --changed',
      'e2e:affected',
      '【GitHub issue 原文',
    ]) {
      expect(implementer, needle).toContain(needle);
    }
    expect(implementer).toContain('Composition：入口 = build 步');
  });
});

describe("assignment's four slots and the agent persona slot (#1250)", () => {
  test('failure mode 5: new slots nullish -- existing two-slot rows still parse; four-slot new shape parses', () => {
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

  test('agent record/create body carries the persona slot (values outside the vocabulary rejected)', () => {
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
    expect(
      createAgentBodySchema.safeParse({ displayName: 'X', persona: 'chief', machineId: 'm-1' })
        .success,
    ).toBe(false);
    expect(
      createAgentBodySchema.parse({ displayName: 'X', persona: null, machineId: 'm-1' }).persona,
    ).toBeNull();
  });
});
