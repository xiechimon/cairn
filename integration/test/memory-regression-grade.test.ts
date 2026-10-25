import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TurnEvidence } from '../eval/chief-dispatch/stack.mts';
import {
  gradeMemoryCase,
  isMemoryCase,
  type MemoryCase,
  type MemoryRowLite,
  memoryIdFor,
} from '../eval/memory-regression/grade.mts';

const REPO_SEED_DIR = join(import.meta.dirname, '../eval/chief-dispatch/repo-seed');
const FLOW_DIR = join(import.meta.dirname, '../../.claude/hillclimb/memory-regression');
const flow = JSON.parse(readFileSync(join(FLOW_DIR, 'cases.json'), 'utf8')) as {
  cases: MemoryCase[];
};
const state = JSON.parse(readFileSync(join(FLOW_DIR, '_state.json'), 'utf8')) as {
  metrics: { id: string }[];
};
const cases = flow.cases;
const byClass = (kind: MemoryCase['expect']['kind']) => cases.filter((c) => c.expect.kind === kind);

const lower = (s: string) => s.toLowerCase();

function walk(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, walk(join(dir, entry.name), rel));
    else out[rel] = readFileSync(join(dir, entry.name), 'utf8');
  }
  return out;
}
const repoText = lower(Object.values(walk(REPO_SEED_DIR)).join('\n'));

function turn(over: Partial<TurnEvidence> = {}): TurnEvidence {
  return {
    threadId: 't',
    stepStatus: 'done',
    toolCalls: [],
    runBuildsArgs: [],
    assistantText: '',
    createdTodoIds: [],
    createdTodoRows: [],
    buildRows: [],
    model: 'glm-5.3',
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
    wallMs: 1000,
    ...over,
  };
}

function todoRow(spec: string, title = '任务') {
  return {
    id: 't1',
    title,
    spec,
    buildAgentId: null,
    planAgentId: null,
    phase: 'todo',
  };
}

function withSpec(spec: string, over: Partial<TurnEvidence> = {}): TurnEvidence {
  return turn({
    createdTodoIds: ['t1'],
    createdTodoRows: [todoRow(spec)],
    toolCalls: [{ name: 'create_todo', arguments: {} }],
    ...over,
  });
}

function oracleSpec(c: MemoryCase): string {
  return `> ${c.prompt}\n\n要求：\n${c.expect.include.map((g) => `- ${g[0]}`).join('\n')}`;
}

function seededRows(c: MemoryCase): MemoryRowLite[] {
  return c.memories.map((m) => ({
    id: memoryIdFor(c.id, m.key),
    title: m.title,
    content: m.content,
    invalidAt: m.invalidatedBy ? 1 : null,
    supersededBy: m.invalidatedBy ? memoryIdFor(c.id, m.invalidatedBy) : null,
  }));
}

function staleKeyOf(c: MemoryCase): string {
  if (c.expect.staleMemory === undefined) throw new Error(`${c.id} 缺 staleMemory`);
  return c.expect.staleMemory;
}

function afterUpdate(c: MemoryCase, successorContent: string): MemoryRowLite[] {
  const staleId = memoryIdFor(c.id, staleKeyOf(c));
  const successorId = `${staleId}-v2`;
  return seededRows(c)
    .map((r) => (r.id === staleId ? { ...r, invalidAt: 2, supersededBy: successorId } : r))
    .concat({
      id: successorId,
      title: 'new',
      content: successorContent,
      invalidAt: null,
      supersededBy: null,
    });
}

describe('用例数据', () => {
  test('三类各 6 到 8 条', () => {
    for (const kind of ['conflict', 'leak', 'stale'] as const) {
      expect(byClass(kind).length, kind).toBeGreaterThanOrEqual(6);
      expect(byClass(kind).length, kind).toBeLessThanOrEqual(8);
    }
  });

  test('id 唯一、记忆 key 在用例内唯一、invalidatedBy 指向同例里存在的记忆', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      const keys = c.memories.map((m) => m.key);
      expect(new Set(keys).size, c.id).toBe(keys.length);
      for (const m of c.memories) {
        if (m.invalidatedBy !== undefined) expect(keys, c.id).toContain(m.invalidatedBy);
      }
    }
  });

  test('判据词不在题面里，否则 spec 里引用用户原文就白得分', () => {
    for (const c of cases) {
      const prompt = lower(c.prompt);
      for (const marker of [...c.expect.include.flat(), ...c.expect.exclude]) {
        expect(prompt.includes(lower(marker)), `${c.id}: ${marker}`).toBe(false);
      }
    }
  });

  test('排除词不能出现在场景仓里，否则读仓库本身就会触发误判', () => {
    for (const c of cases) {
      for (const marker of c.expect.exclude) {
        expect(repoText.includes(lower(marker)), `${c.id}: ${marker}`).toBe(false);
      }
    }
  });

  test('过期类每例带一条无关记忆 keep，用来发现误伤', () => {
    for (const c of byClass('stale'))
      expect(
        c.memories.map((m) => m.key),
        c.id,
      ).toContain('keep');
  });

  test('过期类：每组必含词能在仓库实况里找到，排除词只出现在过期记忆里', () => {
    for (const c of byClass('stale')) {
      for (const group of c.expect.include) {
        expect(
          group.some((alt) => repoText.includes(lower(alt))),
          `${c.id}: ${group.join('|')}`,
        ).toBe(true);
      }
      const stale = c.memories.find((m) => m.key === staleKeyOf(c));
      expect(stale, c.id).toBeDefined();
      const staleText = lower(`${stale?.title} ${stale?.content}`);
      expect(
        c.expect.exclude.some((marker) => staleText.includes(lower(marker))),
        c.id,
      ).toBe(true);
    }
  });

  test('冲突类：第一条是旧条且含排除词，第二条是新条且含全部必含词，新条创建得更晚', () => {
    for (const c of byClass('conflict')) {
      const [oldMem, newMem] = c.memories;
      if (oldMem === undefined || newMem === undefined) throw new Error(`${c.id} 缺记忆`);
      const oldText = lower(oldMem.content);
      const newText = lower(newMem.content);
      expect(
        c.expect.exclude.some((m) => oldText.includes(lower(m))),
        c.id,
      ).toBe(true);
      expect(
        c.expect.include.every((g) => g.some((a) => newText.includes(lower(a)))),
        c.id,
      ).toBe(true);
      expect(newMem.ageDays, c.id).toBeLessThan(oldMem.ageDays);
    }
  });

  test('冲突类两种形态都有：旧条被标失效、旧条仅较早', () => {
    const invalidated = byClass('conflict').filter((c) => c.memories[0]?.invalidatedBy);
    expect(invalidated.length).toBeGreaterThanOrEqual(3);
    expect(byClass('conflict').length - invalidated.length).toBeGreaterThanOrEqual(3);
  });

  test('跨项目类：别的项目的记忆自己点名项目，排除词只出现在它里面', () => {
    for (const c of byClass('leak')) {
      const foreign = c.memories.filter((m) => m.scope !== null && m.scope !== 'eval-project');
      expect(c.prompt, c.id).toContain('eval-project');
      expect(foreign.length, c.id).toBeGreaterThan(0);
      for (const m of foreign) expect(`${m.title}${m.content}`, c.id).toContain('other-project');
      expect(
        c.expect.exclude.every((m) => foreign.some((f) => lower(f.content).includes(lower(m)))),
        c.id,
      ).toBe(true);
    }
  });

  test('跨项目类：必含词非空，且能从仓库实况或本项目记忆得到，空任务不能过', () => {
    for (const c of byClass('leak')) {
      expect(c.expect.include.length, c.id).toBeGreaterThan(0);
      const own = lower(
        c.memories
          .filter((m) => m.scope === 'eval-project')
          .map((m) => m.content)
          .join('\n'),
      );
      for (const group of c.expect.include) {
        expect(
          group.some((a) => repoText.includes(lower(a)) || own.includes(lower(a))),
          `${c.id}: ${group.join('|')}`,
        ).toBe(true);
      }
    }
  });

  test('metrics 声明了 decision_ok 与 memory_write_ok', () => {
    expect(state.metrics.map((m) => m.id)).toEqual(['decision_ok', 'memory_write_ok']);
  });

  test('isMemoryCase 区分记忆用例与派发用例', () => {
    expect(isMemoryCase(cases[0] as MemoryCase)).toBe(true);
    expect(isMemoryCase({ expect: { kind: 'dispatch' } })).toBe(false);
  });
});

describe('gradeMemoryCase：夹具终态', () => {
  test.each(cases.map((c) => [c.id, c] as const))('%s 期望行为全做对 → decision_ok=1', (_id, c) => {
    const memoryAfter =
      c.expect.kind === 'stale'
        ? afterUpdate(c, c.expect.include.map((g) => g[0]).join(' '))
        : seededRows(c);
    const g = gradeMemoryCase(c, { evidence: withSpec(oracleSpec(c)), memoryAfter });
    expect(g.grade.decision_ok, g.explanation.decision_ok).toBe(1);
  });

  test.each(cases.map((c) => [c.id, c] as const))('%s 空回合 → 全 0', (_id, c) => {
    const g = gradeMemoryCase(c, { evidence: turn(), memoryAfter: seededRows(c) });
    expect(g.grade.decision_ok).toBe(0);
    if (c.expect.kind === 'stale') expect(g.grade.memory_write_ok).toBe(0);
  });

  test.each(cases.map((c) => [c.id, c] as const))(
    '%s 答了但用了应排除的那条事实 → decision_ok=0',
    (_id, c) => {
      const wrong = `${oracleSpec(c)}\n- ${c.expect.exclude[0]}`;
      const g = gradeMemoryCase(c, { evidence: withSpec(wrong), memoryAfter: seededRows(c) });
      expect(g.grade.decision_ok).toBe(0);
    },
  );

  test.each(cases.map((c) => [c.id, c] as const))(
    '%s 只在正文里说对、没建任务 → decision_ok=0（读终态，不读话术）',
    (_id, c) => {
      const g = gradeMemoryCase(c, {
        evidence: turn({ assistantText: oracleSpec(c) }),
        memoryAfter: seededRows(c),
      });
      expect(g.grade.decision_ok).toBe(0);
    },
  );

  test.each(cases.map((c) => [c.id, c] as const))(
    '%s 任务 spec 没写对、正文里说对了 → decision_ok=0',
    (_id, c) => {
      const g = gradeMemoryCase(c, {
        evidence: withSpec('照常处理', { assistantText: oracleSpec(c) }),
        memoryAfter: seededRows(c),
      });
      expect(g.grade.decision_ok).toBe(0);
    },
  );

  test('没有产出任务时说明里点明原因', () => {
    const c = cases[0] as MemoryCase;
    const g = gradeMemoryCase(c, { evidence: turn(), memoryAfter: seededRows(c) });
    expect(g.explanation.decision_ok).toContain('没有产出任务');
  });

  test('步没有走到 done 的回合不得得分', () => {
    const c = cases[0] as MemoryCase;
    const g = gradeMemoryCase(c, {
      evidence: withSpec(oracleSpec(c), { stepStatus: 'failed' }),
      memoryAfter: seededRows(c),
    });
    expect(g.grade.decision_ok).toBe(0);
  });

  test('必含词分组：每组至少命中一个别名才算', () => {
    const c = byClass('conflict')[0] as MemoryCase;
    const partial: MemoryCase = {
      ...c,
      expect: { ...c.expect, include: [['甲', 'A'], ['乙']] },
    };
    const hitOnlyFirst = gradeMemoryCase(partial, {
      evidence: withSpec('只有 a'),
      memoryAfter: [],
    });
    const hitBoth = gradeMemoryCase(partial, {
      evidence: withSpec('a 与 乙'),
      memoryAfter: [],
    });
    expect(hitOnlyFirst.grade.decision_ok).toBe(0);
    expect(hitBoth.grade.decision_ok).toBe(1);
  });

  test('冲突与跨项目类不产出 memory_write_ok', () => {
    for (const c of [...byClass('conflict'), ...byClass('leak')]) {
      const g = gradeMemoryCase(c, {
        evidence: withSpec(oracleSpec(c)),
        memoryAfter: seededRows(c),
      });
      expect(g.grade, c.id).not.toHaveProperty('memory_write_ok');
    }
  });
});

describe('gradeMemoryCase：memory_write_ok（过期类读记忆表终态）', () => {
  const c = byClass('stale')[0] as MemoryCase;
  const fact = c.expect.include.map((g) => g[0]).join(' ');
  const staleId = memoryIdFor(c.id, staleKeyOf(c));
  const evidence = withSpec(oracleSpec(c));

  test('过期条被删除 → 1', () => {
    const memoryAfter = seededRows(c).filter((r) => r.id !== staleId);
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(1);
  });

  test('过期条被取代，且后继条写的是仓库实况 → 1', () => {
    expect(
      gradeMemoryCase(c, { evidence, memoryAfter: afterUpdate(c, fact) }).grade.memory_write_ok,
    ).toBe(1);
  });

  test('过期条处理对了，但顺手把无关的记忆也删了 → 0', () => {
    const keepId = memoryIdFor(c.id, 'keep');
    const memoryAfter = afterUpdate(c, fact).filter((r) => r.id !== keepId);
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('只另存了一条正确的新记忆，过期条仍有效 → 0', () => {
    const memoryAfter = seededRows(c).concat({
      id: 'extra',
      title: 'x',
      content: fact,
      invalidAt: null,
      supersededBy: null,
    });
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('记忆表原样没动 → 0', () => {
    expect(gradeMemoryCase(c, { evidence, memoryAfter: seededRows(c) }).grade.memory_write_ok).toBe(
      0,
    );
  });

  test('被取代了，但后继条抄的还是过期事实 → 0', () => {
    const memoryAfter = afterUpdate(c, `${fact} ${c.expect.exclude[0]}`);
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('后继条自己又被标失效（链上最新一条才算数）→ 0', () => {
    const memoryAfter = afterUpdate(c, fact).map((r) =>
      r.id === `${staleId}-v2` ? { ...r, invalidAt: 3 } : r,
    );
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('连续修正两次：沿取代链走到最新一条，它是仓库实况 → 1', () => {
    const v3 = `${staleId}-v3`;
    const memoryAfter = afterUpdate(c, `${fact} 草稿`)
      .map((r) => (r.id === `${staleId}-v2` ? { ...r, invalidAt: 3, supersededBy: v3 } : r))
      .concat({ id: v3, title: 'new', content: fact, invalidAt: null, supersededBy: null });
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(1);
  });

  test('取代链成环 → 0，不死循环', () => {
    const memoryAfter = afterUpdate(c, fact).map((r) =>
      r.id === `${staleId}-v2` ? { ...r, invalidAt: 3, supersededBy: staleId } : r,
    );
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('被标失效但后继条根本不存在 → 0', () => {
    const memoryAfter = seededRows(c).map((r) =>
      r.id === staleId ? { ...r, invalidAt: 2, supersededBy: 'ghost' } : r,
    );
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('写对了记忆但产出仍用旧事实：两个指标互相独立', () => {
    const wrongOutput = withSpec(`${oracleSpec(c)}\n- ${c.expect.exclude[0]}`);
    const g = gradeMemoryCase(c, { evidence: wrongOutput, memoryAfter: afterUpdate(c, fact) });
    expect(g.grade.decision_ok).toBe(0);
    expect(g.grade.memory_write_ok).toBe(1);
  });

  test('产出对但没修正记忆：decision_ok=1 而 memory_write_ok=0', () => {
    const g = gradeMemoryCase(c, { evidence, memoryAfter: seededRows(c) });
    expect(g.grade.decision_ok).toBe(1);
    expect(g.grade.memory_write_ok).toBe(0);
  });
});
