import type { TurnEvidence } from '../chief-dispatch/stack.mts';

export interface PlanExpect {
  kind: 'plan';
  include: string[][];
  exclude: string[];
  minSplits: number;
  maxSplits: number;
}

export interface PlanCase {
  id: string;
  tags: string[];
  prompt: string;
  expect: PlanExpect;
}

export interface PlanArtifacts {
  evidence: TurnEvidence;
}

export function isPlanCase(input: { expect?: { kind?: string } }): input is PlanCase {
  return input.expect?.kind === 'plan';
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

function artifactText(evidence: TurnEvidence): string {
  return evidence.createdTodoRows.map((row) => `${row.title}\n${row.spec}`).join('\n');
}

export function gradePlanCase(
  input: PlanCase,
  artifacts: PlanArtifacts,
): { grade: Record<string, number>; explanation: Record<string, string> } {
  const { evidence } = artifacts;
  const grade: Record<string, number> = {};
  const explanation: Record<string, string> = {};
  if (evidence.stepStatus !== 'done') {
    grade.plan_ok = 0;
    explanation.plan_ok = `step not done: ${evidence.stepStatus}`;
    return { grade, explanation };
  }
  if (evidence.createdTodoRows.length === 0) {
    grade.plan_ok = 0;
    explanation.plan_ok = 'empty artifacts: no todos produced';
    return { grade, explanation };
  }
  const output = artifactText(evidence);
  const count = evidence.createdTodoRows.length;
  const missing = missingGroups(output, input.expect.include);
  const leaked = usedExcluded(output, input.expect.exclude);
  const countOk = count >= input.expect.minSplits && count <= input.expect.maxSplits;
  const ok = missing.length === 0 && leaked.length === 0 && countOk;
  grade.plan_ok = ok ? 1 : 0;
  const parts: string[] = [];
  if (missing.length > 0)
    parts.push(`missing ${missing.map((group) => group.join('|')).join(';')}`);
  if (leaked.length > 0) parts.push(`forbidden ${leaked.join(',')}`);
  if (!countOk)
    parts.push(`split count ${count} not in [${input.expect.minSplits},${input.expect.maxSplits}]`);
  explanation.plan_ok = parts.length === 0 ? 'plan covers required items' : parts.join('; ');
  return { grade, explanation };
}
