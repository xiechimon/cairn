import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { openMemoryDb } from '../../apps/server/src/db/client.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { composeChiefSystemPrompt } from '../../apps/server/src/services/chief.js';
import { TeamStreamHub } from '../../apps/server/src/services/events.js';
import {
  type ArmInput,
  buildComparisonMarkdown,
  meanInterval,
  type PromptSetResultRow,
  parsePromptSetRows,
  wilsonInterval,
} from '../eval/chief-dispatch/compare-prompt-sets.mts';
import {
  applyPromptSet,
  CHIEF_CONVENTIONS_HEADER,
  CUT_CONVENTIONS,
  PROMPT_SET_IDS,
  rewriteClaimResponseBody,
} from '../eval/chief-dispatch/prompt-set.mts';
import {
  bootStack,
  disposeLeftovers,
  driveTurn,
  type RosterAgent,
  seedWorld,
} from '../eval/chief-dispatch/stack.mts';
import { startStubLlm } from './stub-llm.js';

let promptFixture: string;
let fixtureSkillsDir: string | undefined;

function currentChiefPrompt(): string {
  if (promptFixture === undefined) {
    const db = openMemoryDb();
    const { user, team } = seed(db);
    fixtureSkillsDir = mkdtempSync(join(tmpdir(), 'cairn-prompt-set-'));
    promptFixture = composeChiefSystemPrompt(
      { db, hub: new TeamStreamHub(), user, skillsDir: fixtureSkillsDir },
      team.id,
    );
  }
  return promptFixture;
}

describe('prompt-set splice', () => {
  test('PROMPT_SET_IDS is exactly current and cut', () => {
    expect([...PROMPT_SET_IDS]).toEqual(['current', 'cut']);
  });

  test('current leaves the composed production prompt byte-identical', () => {
    const prompt = currentChiefPrompt();
    expect(applyPromptSet(prompt, 'current')).toBe(prompt);
  });

  test('cut keeps the dynamic inventory and swaps only the standing rules', () => {
    const prompt = currentChiefPrompt();
    const cut = applyPromptSet(prompt, 'cut');
    const headerAt = prompt.lastIndexOf(CHIEF_CONVENTIONS_HEADER);
    expect(headerAt).toBeGreaterThan(0);
    expect(cut.startsWith(prompt.slice(0, headerAt))).toBe(true);
    expect(cut.endsWith(CUT_CONVENTIONS)).toBe(true);
    expect(cut).toContain('## 章程（常设指示）');
    expect(cut).toContain('## 团队资源清单');
    expect(cut).toContain('## 记忆');
    for (const dropped of ['ADR 0026', 'confirm 关口自动确认', 'wake 轮', '技能路由提示节']) {
      expect(cut).not.toContain(dropped);
    }
  });

  test('cut keeps the rules no gate enforces and the bench grades', () => {
    const cut = applyPromptSet(currentChiefPrompt(), 'cut');
    for (const kept of [
      '交付物优先于路径',
      '主任务定归属',
      '症状按改动范围定',
      'dispatchReason',
      'ask_user',
      'save_memory',
    ]) {
      expect(cut).toContain(kept);
    }
  });

  test('cut is at most 60 percent of the current standing rules', () => {
    const prompt = currentChiefPrompt();
    const currentSection = prompt.slice(prompt.lastIndexOf(CHIEF_CONVENTIONS_HEADER));
    expect(CUT_CONVENTIONS.length).toBeLessThanOrEqual(currentSection.length * 0.6);
  });

  test('cut throws when the conventions header is missing', () => {
    expect(() => applyPromptSet('no sections here', 'cut')).toThrow(/chief system prompt has no/);
  });
});

describe('claim response rewrite', () => {
  test('parked claim (step null) passes through byte-identical', () => {
    const body = JSON.stringify({ step: null });
    expect(rewriteClaimResponseBody(body, 'cut')).toBe(body);
    expect(rewriteClaimResponseBody(body, 'current')).toBe(body);
  });

  test('build-step claim without chief context passes through byte-identical', () => {
    const body = JSON.stringify({
      step: { id: 'st-1', kind: 'build', todo: { id: 't-1', title: 'x' }, agent: null },
    });
    expect(rewriteClaimResponseBody(body, 'cut')).toBe(body);
  });

  test('chief claim with current passes through byte-identical', () => {
    const body = JSON.stringify({
      step: {
        id: 'st-1',
        kind: 'chief',
        chief: { threadId: 'th-1', systemPrompt: currentChiefPrompt(), trigger: 'user' },
      },
    });
    expect(rewriteClaimResponseBody(body, 'current')).toBe(body);
  });

  test('chief claim with cut rewrites the system prompt and preserves the rest', () => {
    const body = JSON.stringify({
      step: {
        id: 'st-1',
        kind: 'chief',
        chief: { threadId: 'th-1', systemPrompt: currentChiefPrompt(), trigger: 'user' },
      },
    });
    const rewritten = JSON.parse(rewriteClaimResponseBody(body, 'cut')) as {
      step: {
        id: string;
        kind: string;
        chief: { threadId: string; trigger: string; systemPrompt: string };
      };
    };
    expect(rewritten.step.id).toBe('st-1');
    expect(rewritten.step.kind).toBe('chief');
    expect(rewritten.step.chief.threadId).toBe('th-1');
    expect(rewritten.step.chief.trigger).toBe('user');
    expect(rewritten.step.chief.systemPrompt).toBe(applyPromptSet(currentChiefPrompt(), 'cut'));
    expect(rewritten.step.chief.systemPrompt).not.toContain('ADR 0026');
  });
});

describe('ablation report statistics', () => {
  test('wilson interval matches the closed form for 3 of 4', () => {
    const { lo, hi } = wilsonInterval(3, 4);
    expect(lo).toBeCloseTo(0.3006, 3);
    expect(hi).toBeCloseTo(0.9545, 3);
  });

  test('wilson interval saturates at the bounds', () => {
    expect(wilsonInterval(0, 10).lo).toBe(0);
    expect(wilsonInterval(10, 10).hi).toBe(1);
    expect(wilsonInterval(10, 10).lo).toBeGreaterThan(0.69);
    expect(wilsonInterval(0, 10).hi).toBeLessThan(0.31);
  });

  test('wilson interval rejects empty or out-of-range input', () => {
    expect(() => wilsonInterval(0, 0)).toThrow(/n > 0/);
    expect(() => wilsonInterval(3, 2)).toThrow(/out of range/);
  });

  test('mean interval matches the normal approximation for 1..4', () => {
    const { mean, halfWidth, n } = meanInterval([1, 2, 3, 4]);
    expect(n).toBe(4);
    expect(mean).toBe(2.5);
    expect(halfWidth).toBeCloseTo(1.2652, 3);
  });

  test('mean interval rejects an empty sample', () => {
    expect(() => meanInterval([])).toThrow(/at least one/);
  });

  test('parsePromptSetRows reads jsonl rows with blank-line tolerance', () => {
    const rows = parsePromptSetRows(
      [
        JSON.stringify({
          prompt_id: 'd01',
          rep: 0,
          status: 'ok',
          in_tokens: 100,
          out_tokens: 20,
          cache_read_tokens: 5,
          cost_usd: 0.01,
          grade: { decision_ok: 1, receipt_ok: 1 },
          tags: ['dispatch', 'doc'],
        }),
        '',
        JSON.stringify({
          prompt_id: 'd02',
          rep: 0,
          status: 'truncated',
          in_tokens: 50,
          out_tokens: 5,
          grade: { decision_ok: 0, receipt_ok: 0 },
          meta: { prompt_set: 'cut' },
        }),
      ].join('\n'),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.grade?.decision_ok).toBe(1);
    expect(rows[1]?.meta?.prompt_set).toBe('cut');
  });

  test('buildComparisonMarkdown reports both arms with intervals, tokens per task, and warnings', () => {
    const mk = (
      id: string,
      ok: number,
      tokens: number,
      extra: object = {},
    ): PromptSetResultRow => ({
      prompt_id: id,
      rep: 0,
      status: 'ok',
      in_tokens: tokens,
      out_tokens: Math.round(tokens / 5),
      cache_read_tokens: 0,
      cost_usd: 0.01,
      grade: { decision_ok: ok, receipt_ok: ok },
      ...extra,
    });
    const current: ArmInput = {
      label: 'baseline',
      rows: [mk('d01', 1, 10000), mk('d02', 1, 12000), mk('d03', 0, 9000), mk('d04', 1, 11000)],
      errorRows: 1,
    };
    const cut: ArmInput = {
      label: 'v1',
      rows: [
        mk('d01', 1, 6000),
        mk('d02', 0, 6500, { meta: { prompt_set: 'current' } }),
        mk('d03', 1, 5500),
        mk('d04', 1, 6200),
      ],
      errorRows: 0,
    };
    const md = buildComparisonMarkdown({ flow: '.claude/hillclimb/chief-dispatch', current, cut });
    expect(md).toContain('# Prompt-set ablation');
    expect(md).toContain('baseline');
    expect(md).toContain('v1');
    expect(md).toContain('75.0% [');
    expect(md).toContain('| cut |');
    expect(md).toContain('error attempts: 1');
    expect(md).toContain('| d02 |');
    expect(md).toContain('prompt_set=current');
    expect(md).toMatch(/in tok\/task/);
    expect(md).toMatch(/cost \$\/task/);
  });
});

afterAll(() => {
  if (fixtureSkillsDir !== undefined) rmSync(fixtureSkillsDir, { recursive: true, force: true });
});

const STUB_ROSTER: RosterAgent[] = [
  {
    key: 'doc',
    displayName: '阿岚',
    modelId: 'qwen3.8-max',
    description: '负责 README、用户手册、教程、变更日志等面向读者的文档产出。',
  },
  {
    key: 'code',
    displayName: '老周',
    modelId: 'glm-5.3',
    description: '负责后端功能实现、缺陷修复、重构与性能优化。',
  },
];

async function driveChiefTurnWithPromptSet(promptSet: 'current' | 'cut'): Promise<string> {
  const stub = await startStubLlm([{ content: '已收到，稍后汇报。' }]);
  const stack = await bootStack({ promptSet });
  try {
    await seedWorld(stack, {
      relayBaseUrl: stub.url,
      relayKey: 'sk-stub-eval',
      roster: STUB_ROSTER,
      chiefModelId: 'glm-5.3',
    });
    const ev = await driveTurn(stack, 'README 的安装步骤不全，帮我补一份新手能照着走的教程。', {
      timeoutMs: 150_000,
    });
    expect(ev.stepStatus).toBe('done');
    return JSON.stringify(stub.requests);
  } finally {
    await stack.close();
    await stub.close();
    disposeLeftovers();
  }
}

describe('chief-dispatch prompt-set switch (real stack, stub relay)', () => {
  test('cut arm: the claimed chief session carries the cut rules, not the dropped ones', async () => {
    const flat = await driveChiefTurnWithPromptSet('cut');
    expect(flat).toContain('## 工作约定');
    expect(flat).toContain('交付物优先于路径');
    expect(flat).toContain('## 团队资源清单');
    expect(flat).not.toContain('ADR 0026');
    expect(flat).not.toContain('confirm 关口自动确认');
    expect(flat).not.toContain('技能路由提示节');
  }, 240_000);

  test('current arm control: the claimed chief session carries the full production rules', async () => {
    const flat = await driveChiefTurnWithPromptSet('current');
    expect(flat).toContain('## 工作约定');
    expect(flat).toContain('ADR 0026');
    expect(flat).toContain('confirm 关口自动确认');
    expect(flat).toContain('技能路由提示节');
  }, 240_000);
});
