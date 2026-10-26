import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TurnEvidence } from '../eval/chief-dispatch/stack.mts';
import { gradePlanCase, isPlanCase, type PlanCase } from '../eval/plan/grade.mts';

const FLOW_DIR = join(import.meta.dirname, '../../.claude/hillclimb/plan');
const flow = JSON.parse(readFileSync(join(FLOW_DIR, 'cases.json'), 'utf8')) as {
  cases: PlanCase[];
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

function todoRow(spec: string) {
  return { id: 't1', title: 'task', spec, buildAgentId: null, planAgentId: null, phase: 'todo' };
}

describe('case data', () => {
  test('ids unique', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });
  test('each case has at least one', () => {
    expect(cases.length).toBeGreaterThan(0);
  });
  test('all cases satisfy isPlanCase', () => {
    for (const c of cases) {
      expect(isPlanCase(c), c.id).toBe(true);
    }
  });
});

describe('grading', () => {
  test('pass when required present', () => {
    const c = cases[0]!;
    const run = {
      evidence: turn({
        createdTodoIds: ['t1'],
        createdTodoRows: [todoRow('download attribute on a blob url; test step')],
        toolCalls: [{ name: 'create_todo', arguments: {} }],
      }),
    };
    expect(gradePlanCase(c, run).grade.plan_ok).toBe(1);
  });
  test('fail when forbidden present', () => {
    const c = cases[0]!;
    const run = {
      evidence: turn({
        createdTodoIds: ['t1'],
        createdTodoRows: [todoRow('more logging')],
        toolCalls: [{ name: 'create_todo', arguments: {} }],
      }),
    };
    expect(gradePlanCase(c, run).grade.plan_ok).toBe(0);
  });
  test('fail when no feedback arm has no fix', () => {
    const c = cases[1]!;
    const run = {
      evidence: turn({
        createdTodoIds: ['t1'],
        createdTodoRows: [todoRow('add logging to the export handler')],
        toolCalls: [{ name: 'create_todo', arguments: {} }],
      }),
    };
    expect(gradePlanCase(c, run).grade.plan_ok).toBe(0);
  });
});
