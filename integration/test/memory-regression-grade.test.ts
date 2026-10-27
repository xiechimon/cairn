import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { overlaps } from '../../apps/server/src/services/memory.js';
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
    projectId: 'p1',
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

describe('case data', () => {
  test('each of the three classes has 6 to 8 entries', () => {
    for (const kind of ['conflict', 'leak', 'stale'] as const) {
      expect(byClass(kind).length, kind).toBeGreaterThanOrEqual(6);
      expect(byClass(kind).length, kind).toBeLessThanOrEqual(8);
    }
  });

  test('ids unique, memory keys unique within a case, invalidatedBy points at a memory in the same case', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      const keys = c.memories.map((m) => m.key);
      expect(new Set(keys).size, c.id).toBe(keys.length);
      for (const m of c.memories) {
        if (m.invalidatedBy !== undefined) expect(keys, c.id).toContain(m.invalidatedBy);
      }
    }
  });

  test('criterion words absent from the prompt, otherwise quoting the user verbatim in the spec would score for free', () => {
    for (const c of cases) {
      const prompt = lower(c.prompt);
      for (const marker of [...c.expect.include.flat(), ...c.expect.exclude]) {
        expect(prompt.includes(lower(marker)), `${c.id}: ${marker}`).toBe(false);
      }
    }
  });

  test('exclusion words must not appear in the scenario repo, otherwise reading the repo itself triggers a false positive', () => {
    for (const c of cases) {
      for (const marker of c.expect.exclude) {
        expect(repoText.includes(lower(marker)), `${c.id}: ${marker}`).toBe(false);
      }
    }
  });

  test('every stale-class case carries one unrelated keep memory to surface collateral damage', () => {
    for (const c of byClass('stale'))
      expect(
        c.memories.map((m) => m.key),
        c.id,
      ).toContain('keep');
  });

  test('stale class: every required-word group is findable in the live repo, exclusion words appear only in the stale memory', () => {
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

  test('conflict class: first entry is the old one carrying exclusion words, second is the new one carrying all required words and created later', () => {
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

  test('conflict class has both shapes: old entry invalidated, old entry merely earlier', () => {
    const invalidated = byClass('conflict').filter((c) => c.memories[0]?.invalidatedBy);
    expect(invalidated.length).toBeGreaterThanOrEqual(3);
    expect(byClass('conflict').length - invalidated.length).toBeGreaterThanOrEqual(3);
  });

  test('cross-project class: the other project memory names its own project, exclusion words appear only inside it', () => {
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

  test('cross-project class: required words non-empty and derivable from the live repo or this project memory; an empty task must not pass', () => {
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

  test('metrics declare decision_ok, memory_write_ok and untouched_ok', () => {
    expect(state.metrics.map((m) => m.id)).toEqual([
      'decision_ok',
      'memory_write_ok',
      'untouched_ok',
    ]);
  });

  test('adjacent and irrelevant families each have 4 to 6 cases', () => {
    for (const kind of ['adjacent', 'irrelevant'] as const) {
      expect(byClass(kind).length, kind).toBeGreaterThanOrEqual(4);
      expect(byClass(kind).length, kind).toBeLessThanOrEqual(6);
    }
  });

  test('adjacent: the untouched memory shares a project with a lookalike and the pair overlaps', () => {
    for (const c of byClass('adjacent')) {
      const key = c.expect.untouchedMemory;
      const keep = c.memories.find((m) => m.key === key);
      const others = c.memories.filter((m) => m.key !== key);
      expect(keep, c.id).toBeDefined();
      expect(others.length, c.id).toBeGreaterThan(0);
      for (const memory of c.memories) expect(memory.scope, c.id).toBe('eval-project');
      const keepTitle = keep?.title ?? '';
      const keepContent = keep?.content ?? '';
      expect(
        others.some(
          (other) => overlaps(other.title, keepTitle) || overlaps(other.content, keepContent),
        ),
        c.id,
      ).toBe(true);
      const keepText = lower(`${keepTitle} ${keepContent}`);
      expect(
        c.expect.exclude.some((marker) => keepText.includes(lower(marker))),
        c.id,
      ).toBe(true);
      const applicable = lower(others.map((m) => `${m.title}\n${m.content}`).join('\n'));
      for (const group of c.expect.include) {
        expect(
          group.some((alt) => applicable.includes(lower(alt)) || repoText.includes(lower(alt))),
          `${c.id}: ${group.join('|')}`,
        ).toBe(true);
      }
    }
  });

  test('irrelevant: the in-scope memory does not contain the answer, and the answer is in the repo', () => {
    for (const c of byClass('irrelevant')) {
      expect(c.expect.include.length, c.id).toBeGreaterThan(0);
      expect(c.expect.untouchedMemory, c.id).toBeUndefined();
      const memoryText = lower(c.memories.map((m) => `${m.title}\n${m.content}`).join('\n'));
      for (const memory of c.memories) expect(memory.scope, c.id).toBe('eval-project');
      for (const group of c.expect.include) {
        expect(
          group.some((alt) => repoText.includes(lower(alt))),
          `${c.id}: ${group.join('|')}`,
        ).toBe(true);
        expect(
          group.every((alt) => !memoryText.includes(lower(alt))),
          `${c.id}: ${group.join('|')}`,
        ).toBe(true);
      }
      expect(
        c.expect.exclude.some((marker) => memoryText.includes(lower(marker))),
        c.id,
      ).toBe(true);
    }
  });

  test('isMemoryCase separates memory cases from dispatch cases', () => {
    expect(isMemoryCase(cases[0] as MemoryCase)).toBe(true);
    expect(isMemoryCase({ expect: { kind: 'dispatch' } })).toBe(false);
  });

  test('isMemoryCase accepts the adjacent and irrelevant families', () => {
    expect(isMemoryCase({ expect: { kind: 'adjacent' } })).toBe(true);
    expect(isMemoryCase({ expect: { kind: 'irrelevant' } })).toBe(true);
  });
});

describe('gradeMemoryCase: fixture end state', () => {
  test.each(cases.map((c) => [c.id, c] as const))('%s 期望行为全做对 → decision_ok=1', (_id, c) => {
    const memoryAfter =
      c.expect.kind === 'stale'
        ? afterUpdate(c, c.expect.include.map((g) => g[0]).join(' '))
        : seededRows(c);
    const g = gradeMemoryCase(c, { evidence: withSpec(oracleSpec(c)), memoryAfter });
    expect(g.grade.decision_ok, g.explanation.decision_ok).toBe(1);
    if (c.expect.kind === 'adjacent') expect(g.grade.untouched_ok, c.id).toBe(1);
    if (c.expect.kind === 'irrelevant') expect(g.grade, c.id).toEqual({ decision_ok: 1 });
  });

  test.each(cases.map((c) => [c.id, c] as const))('%s 空回合 → 全 0', (_id, c) => {
    const g = gradeMemoryCase(c, { evidence: turn(), memoryAfter: seededRows(c) });
    expect(g.grade.decision_ok).toBe(0);
    if (c.expect.kind === 'stale') expect(g.grade.memory_write_ok).toBe(0);
    if (c.expect.kind === 'adjacent') expect(g.grade.untouched_ok).toBe(1);
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

  test('states the reason in the explanation when no task was produced', () => {
    const c = cases[0] as MemoryCase;
    const g = gradeMemoryCase(c, { evidence: turn(), memoryAfter: seededRows(c) });
    expect(g.explanation.decision_ok).toContain('没有产出任务');
  });

  test('a turn whose step never reached done scores nothing', () => {
    const c = cases[0] as MemoryCase;
    const g = gradeMemoryCase(c, {
      evidence: withSpec(oracleSpec(c), { stepStatus: 'failed' }),
      memoryAfter: seededRows(c),
    });
    expect(g.grade.decision_ok).toBe(0);
  });

  test('required-word groups: at least one alias hit per group counts', () => {
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

  test('conflict, cross-project and irrelevant classes produce no memory-table metric', () => {
    for (const c of [...byClass('conflict'), ...byClass('leak'), ...byClass('irrelevant')]) {
      const g = gradeMemoryCase(c, {
        evidence: withSpec(oracleSpec(c)),
        memoryAfter: seededRows(c),
      });
      expect(g.grade, c.id).not.toHaveProperty('memory_write_ok');
      expect(g.grade, c.id).not.toHaveProperty('untouched_ok');
    }
  });
});

describe('gradeMemoryCase: memory_write_ok (stale class reads the memory table end state)', () => {
  const c = byClass('stale')[0] as MemoryCase;
  const fact = c.expect.include.map((g) => g[0]).join(' ');
  const staleId = memoryIdFor(c.id, staleKeyOf(c));
  const evidence = withSpec(oracleSpec(c));

  test('stale entry deleted → 1', () => {
    const memoryAfter = seededRows(c).filter((r) => r.id !== staleId);
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(1);
  });

  test('stale entry superseded and the successor states live repo facts → 1', () => {
    expect(
      gradeMemoryCase(c, { evidence, memoryAfter: afterUpdate(c, fact) }).grade.memory_write_ok,
    ).toBe(1);
  });

  test('stale entry handled correctly but unrelated memories deleted along the way → 0', () => {
    const keepId = memoryIdFor(c.id, 'keep');
    const memoryAfter = afterUpdate(c, fact).filter((r) => r.id !== keepId);
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test.each([{ title: 'Changed unrelated title' }, { supersededBy: 'unrelated-successor' }])(
    'correcting stale memory does not permit collateral mutation %j',
    (mutation) => {
      const keepId = memoryIdFor(c.id, 'keep');
      const memoryAfter = afterUpdate(c, fact).map((row) =>
        row.id === keepId ? { ...row, ...mutation } : row,
      );
      expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
    },
  );

  test('only a new correct memory saved, stale entry still active → 0', () => {
    const memoryAfter = seededRows(c).concat({
      id: 'extra',
      title: 'x',
      content: fact,
      invalidAt: null,
      supersededBy: null,
    });
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('memory table untouched → 0', () => {
    expect(gradeMemoryCase(c, { evidence, memoryAfter: seededRows(c) }).grade.memory_write_ok).toBe(
      0,
    );
  });

  test('superseded, but the successor copies the stale facts → 0', () => {
    const memoryAfter = afterUpdate(c, `${fact} ${c.expect.exclude[0]}`);
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('the successor itself later invalidated (latest in the chain counts) → 0', () => {
    const memoryAfter = afterUpdate(c, fact).map((r) =>
      r.id === `${staleId}-v2` ? { ...r, invalidAt: 3 } : r,
    );
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('corrected twice in a row: walk the supersede chain to the latest entry; it states live repo facts → 1', () => {
    const v3 = `${staleId}-v3`;
    const memoryAfter = afterUpdate(c, `${fact} 草稿`)
      .map((r) => (r.id === `${staleId}-v2` ? { ...r, invalidAt: 3, supersededBy: v3 } : r))
      .concat({ id: v3, title: 'new', content: fact, invalidAt: null, supersededBy: null });
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(1);
  });

  test('supersede chain cycles → 0, no infinite loop', () => {
    const memoryAfter = afterUpdate(c, fact).map((r) =>
      r.id === `${staleId}-v2` ? { ...r, invalidAt: 3, supersededBy: staleId } : r,
    );
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('marked invalidated but no successor exists → 0', () => {
    const memoryAfter = seededRows(c).map((r) =>
      r.id === staleId ? { ...r, invalidAt: 2, supersededBy: 'ghost' } : r,
    );
    expect(gradeMemoryCase(c, { evidence, memoryAfter }).grade.memory_write_ok).toBe(0);
  });

  test('memory written correctly but the output still uses stale facts: the two metrics are independent', () => {
    const wrongOutput = withSpec(`${oracleSpec(c)}\n- ${c.expect.exclude[0]}`);
    const g = gradeMemoryCase(c, { evidence: wrongOutput, memoryAfter: afterUpdate(c, fact) });
    expect(g.grade.decision_ok).toBe(0);
    expect(g.grade.memory_write_ok).toBe(1);
  });

  test('output correct but memory not fixed: decision_ok=1 while memory_write_ok=0', () => {
    const g = gradeMemoryCase(c, { evidence, memoryAfter: seededRows(c) });
    expect(g.grade.decision_ok).toBe(1);
    expect(g.grade.memory_write_ok).toBe(0);
  });
});

function adjacentFixture(): MemoryCase {
  return {
    id: 'a-fixture',
    tags: ['adjacent'],
    prompt: 'Write the design-review task for eval-project.',
    memories: [
      {
        key: 'target',
        title: 'Design review feedback',
        content: 'Design reviews use async written notes.',
        scope: 'eval-project',
        ageDays: 4,
      },
      {
        key: 'keep',
        title: 'Incident feedback',
        content: 'Incidents use a sync call.',
        scope: 'eval-project',
        ageDays: 40,
      },
    ],
    expect: {
      kind: 'adjacent',
      include: [['async written notes']],
      exclude: ['sync call'],
      untouchedMemory: 'keep',
    },
  };
}

describe('gradeMemoryCase: untouched memory (adjacent family reads the memory table end state)', () => {
  test('superseding the unrelated row scores untouched_ok 0 while the todo can still be right', () => {
    const c = adjacentFixture();
    const memoryAfter = seededRows(c).map((row) =>
      row.id === memoryIdFor(c.id, 'keep') ? { ...row, supersededBy: 'mem-other' } : row,
    );
    const g = gradeMemoryCase(c, {
      evidence: withSpec('async written notes'),
      memoryAfter,
    });
    expect(g.grade.decision_ok).toBe(1);
    expect(g.grade.untouched_ok).toBe(0);
  });

  test('changing the unrelated row content scores untouched_ok 0', () => {
    const c = adjacentFixture();
    const memoryAfter = seededRows(c).map((row) =>
      row.id === memoryIdFor(c.id, 'keep')
        ? { ...row, content: 'Incidents use a written note.' }
        : row,
    );
    const g = gradeMemoryCase(c, {
      evidence: withSpec('async written notes'),
      memoryAfter,
    });
    expect(g.grade.untouched_ok).toBe(0);
  });

  test('changing only the unrelated row title scores untouched_ok 0', () => {
    const c = adjacentFixture();
    const memoryAfter = seededRows(c).map((row) =>
      row.id === memoryIdFor(c.id, 'keep') ? { ...row, title: 'Design review feedback' } : row,
    );
    const g = gradeMemoryCase(c, {
      evidence: withSpec('async written notes'),
      memoryAfter,
    });
    expect(g.grade.decision_ok).toBe(1);
    expect(g.grade.untouched_ok).toBe(0);
  });

  test('deleting the unrelated row scores untouched_ok 0', () => {
    const c = adjacentFixture();
    const memoryAfter = seededRows(c).filter((row) => row.id !== memoryIdFor(c.id, 'keep'));
    const g = gradeMemoryCase(c, {
      evidence: withSpec('async written notes'),
      memoryAfter,
    });
    expect(g.grade.untouched_ok).toBe(0);
  });

  test('updating the matching memory leaves untouched_ok 1 when the unrelated row is unchanged', () => {
    const c = adjacentFixture();
    const targetId = memoryIdFor(c.id, 'target');
    const memoryAfter = seededRows(c).map((row) =>
      row.id === targetId
        ? { ...row, content: 'Design reviews use a message board.', supersededBy: null }
        : row,
    );
    const g = gradeMemoryCase(c, {
      evidence: withSpec('async written notes'),
      memoryAfter,
    });
    expect(g.grade.decision_ok).toBe(1);
    expect(g.grade.untouched_ok).toBe(1);
    expect(g.grade).not.toHaveProperty('memory_write_ok');
  });
});

describe('gradeMemoryCase: irrelevant family', () => {
  const c: MemoryCase = {
    id: 'i-fixture',
    tags: ['irrelevant'],
    prompt: 'Write how to start eval-project locally.',
    memories: [
      {
        key: 'aside',
        title: 'Pantry note',
        content: 'The snack cupboard code is pantry-19.',
        scope: 'eval-project',
        ageDays: 3,
      },
    ],
    expect: {
      kind: 'irrelevant',
      include: [['pnpm dev']],
      exclude: ['pantry-19'],
    },
  };

  test('decision_ok follows the todo text and no memory-table metric is emitted', () => {
    const pass = gradeMemoryCase(c, {
      evidence: withSpec('pnpm dev'),
      memoryAfter: [],
    });
    const fail = gradeMemoryCase(c, {
      evidence: withSpec('pnpm dev and pantry-19'),
      memoryAfter: seededRows(c),
    });
    expect(pass.grade).toEqual({ decision_ok: 1 });
    expect(fail.grade).toEqual({ decision_ok: 0 });
  });
});
