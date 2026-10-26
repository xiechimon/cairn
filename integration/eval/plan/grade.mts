import type { TurnEvidence } from '../chief-dispatch/stack.mts';

export interface PlanExpect {
  include: string[][];
  exclude: string[];
  minTodos: number;
  maxTodos: number;
}

export interface PlanCase {
  id: string;
  tags: string[];
  prompt: string;
  priorPlan?: string;
  feedback?: string;
  expect: PlanExpect;
}

export interface PlanRun {
  evidence: TurnEvidence;
}

export function isPlanCase(input: { expect: PlanExpect }): input is PlanCase {
  return typeof input.expect.minTodos === 'number';
}

const fold = (text: string): string => text.toLowerCase();
const mentions = (haystack: string, marker: string): boolean => haystack.includes(fold(marker));

function missingGroups(text: string, include: string[][]): string[][] {
  const haystack = fold(text);
  return include.filter((group) => !group.some((alt) => mentions(haystack, alt)));
}

function usedExcluded(text: string, exclude: string[]): string[] {
  const haystack = fold(text);
  return exclude.filter((marker) => mentions(haystack, marker));
}

export function gradePlanCase(
  input: PlanCase,
  run: PlanRun,
): { grade: Record<string, number>; explanation: Record<string, string> } {
  const { evidence } = run;
  const grade: Record<string, number> = {};
  const explanation: Record<string, string> = {};
  if (evidence.stepStatus !== 'done') {
    grade.plan_ok = 0;
    explanation.plan_ok = `step not done: ${evidence.stepStatus}`;
    return { grade, explanation };
  }
  if (evidence.createdTodoRows.length === 0) {
    grade.plan_ok = 0;
    explanation.plan_ok = 'no todos produced';
    return { grade, explanation };
  }
  const output = evidence.createdTodoRows.map((t) => `${t.title}\n${t.spec}`).join('\n');
  const count = evidence.createdTodoRows.length;
  const missing = missingGroups(output, input.expect.include);
  const leaked = usedExcluded(output, input.expect.exclude);
  const countOk = count >= input.expect.minTodos && count <= input.expect.maxTodos;
  const ok = missing.length === 0 && leaked.length === 0 && countOk;
  grade.plan_ok = ok ? 1 : 0;
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing ${missing.map((g) => g.join('|')).join(';')}`);
  if (leaked.length > 0) parts.push(`forbidden ${leaked.join(',')}`);
  if (!countOk)
    parts.push(`count ${count} not in [${input.expect.minTodos},${input.expect.maxTodos}]`);
  explanation.plan_ok = parts.length === 0 ? 'plan covers required items' : parts.join(';');
  return { grade, explanation };
}
