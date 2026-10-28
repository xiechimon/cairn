import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TurnEvidence } from '../eval/chief-dispatch/stack.mts';
import { isLearnCase } from '../eval/learn/grade.mts';
import { isMemoryCase } from '../eval/memory-regression/grade.mts';
import { gradePlanCase, isPlanCase, type PlanCase } from '../eval/plan/grade.mts';
import { isRoutingCase } from '../eval/project-routing/grade.mts';

const FLOW_DIR = join(import.meta.dirname, '../../.claude/hillclimb/plan');
const flow = JSON.parse(readFileSync(join(FLOW_DIR, 'cases.json'), 'utf8')) as {
  roster: unknown[];
  cases: PlanCase[];
};
const state = JSON.parse(readFileSync(join(FLOW_DIR, '_state.json'), 'utf8')) as {
  metrics: { id: string }[];
  perf_fields: { id: string }[];
  harness_paths: string[];
};
const cases = flow.cases;

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

function todoRow(spec: string, title = 'task', id = 't1') {
  return {
    id,
    title,
    spec,
    projectId: 'p1',
    buildAgentId: null,
    planAgentId: null,
    phase: 'todo',
  };
}

function withTodos(specs: string[], over: Partial<TurnEvidence> = {}): { evidence: TurnEvidence } {
  const rows = specs.map((spec, i) => todoRow(spec, `task-${i + 1}`, `t${i + 1}`));
  return {
    evidence: turn({
      createdTodoIds: rows.map((r) => r.id),
      createdTodoRows: rows,
      toolCalls: rows.map(() => ({ name: 'create_todo', arguments: {} })),
      ...over,
    }),
  };
}

const baseExpect = {
  kind: 'plan' as const,
  include: [['download attribute', 'blob url'], ['test']],
  exclude: ['more logging'],
  minSplits: 1,
  maxSplits: 4,
};

const sample: PlanCase = {
  id: 'sample',
  tags: ['plan'],
  prompt: 'Export button does nothing on Safari.',
  expect: baseExpect,
};

describe('plan case ledger', () => {
  test('ids unique and every case is a plan case', () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(flow.roster.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(isPlanCase(c), c.id).toBe(true);
      expect(isMemoryCase(c), c.id).toBe(false);
      expect(isRoutingCase(c), c.id).toBe(false);
      expect(isLearnCase(c), c.id).toBe(false);
    }
  });

  test('covers a required-split case and a no-split case', () => {
    const splits = cases.filter((c) => c.expect.minSplits >= 2);
    const noSplit = cases.filter((c) => c.expect.maxSplits === 1);
    expect(splits.length).toBeGreaterThanOrEqual(1);
    expect(noSplit.length).toBeGreaterThanOrEqual(1);
  });

  test('state declares plan_ok and runner perf fields', () => {
    expect(state.metrics.map((m) => m.id)).toContain('plan_ok');
    for (const id of [
      'in_tokens',
      'out_tokens',
      'cache_read_tokens',
      'tool_calls',
      'cost_usd',
      'latency_s',
    ]) {
      expect(state.perf_fields.map((p) => p.id)).toContain(id);
    }
    expect(state.harness_paths).toContain('integration/eval/plan/grade.mts');
  });
});

describe('gradePlanCase', () => {
  test('a missing required alias group fails', () => {
    const g = gradePlanCase(
      sample,
      withTodos(['download attribute on a blob url; no verification step']),
    );
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/missing/i);
  });

  test('any alias in a group satisfies it', () => {
    const viaBlob = gradePlanCase(sample, withTodos(['fix blob url handling; add a test']));
    const viaDownload = gradePlanCase(
      sample,
      withTodos(['Fix the download attribute; add a test']),
    );
    expect(viaBlob.grade.plan_ok).toBe(1);
    expect(viaDownload.grade.plan_ok).toBe(1);
  });

  test('forbidden content fails', () => {
    const g = gradePlanCase(
      sample,
      withTodos(['Fix download attribute and blob url; add a test; more logging']),
    );
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/forbidden/i);
  });

  test('empty artifacts fail', () => {
    const g = gradePlanCase(sample, { evidence: turn() });
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/no |empty|artifact|todo/i);
  });

  test('an unfinished turn fails', () => {
    const g = gradePlanCase(
      sample,
      withTodos(['download attribute; test'], { stepStatus: 'failed' }),
    );
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/not done|step/i);
  });

  test('split count at the lower bound passes, one below fails', () => {
    const needTwo: PlanCase = {
      ...sample,
      expect: { ...baseExpect, minSplits: 2, maxSplits: 4 },
    };
    const pass = gradePlanCase(
      needTwo,
      withTodos(['download attribute; test', 'blob url follow-up; test']),
    );
    const fail = gradePlanCase(needTwo, withTodos(['download attribute; blob url; test']));
    expect(pass.grade.plan_ok).toBe(1);
    expect(fail.grade.plan_ok).toBe(0);
    expect(fail.explanation.plan_ok).toMatch(/split|count/i);
  });

  test('split count at the upper bound passes, one above fails', () => {
    const capTwo: PlanCase = {
      ...sample,
      expect: { ...baseExpect, minSplits: 1, maxSplits: 2 },
    };
    const pass = gradePlanCase(capTwo, withTodos(['download attribute; test', 'blob url; test']));
    const fail = gradePlanCase(
      capTwo,
      withTodos(['download attribute; test', 'blob url; test', 'extra card; test']),
    );
    expect(pass.grade.plan_ok).toBe(1);
    expect(fail.grade.plan_ok).toBe(0);
    expect(fail.explanation.plan_ok).toMatch(/split|count/i);
  });

  test('assistant prose naming the required items does not substitute for an artifact', () => {
    const g = gradePlanCase(sample, {
      evidence: turn({
        stepStatus: 'done',
        assistantText: 'I will fix the download attribute on the blob url and add a test.',
        createdTodoIds: ['t1'],
        createdTodoRows: [
          { id: 't1', title: 'investigate export', spec: 'look around the export path only' },
        ],
      }),
    });
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/missing/i);
  });
});
