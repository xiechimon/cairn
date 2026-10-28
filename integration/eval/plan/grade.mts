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

export interface PlanRowSeed {
  title: string;
  spec: string;
}

export interface PlanRevisionExpect {
  kind: 'plan-revision';
  mustFix: string[][];
  mustPreserve: string[][];
  exclude: string[];
  minSplits?: number;
  maxSplits?: number;
}

export interface PlanRevisionCase {
  id: string;
  tags: string[];
  prompt: string;
  priorPlan: PlanRowSeed[];
  feedback: string;
  expect: PlanRevisionExpect;
}

export type AnyPlanCase = PlanCase | PlanRevisionCase;

export interface PlanTodoRow {
  id: string;
  title: string;
  spec: string;
}

export interface PlanArtifacts {
  evidence: TurnEvidence;
  todos?: PlanTodoRow[];
}

export const PLAN_REVISION_ARMS = ['feedback', 'no-feedback'] as const;
export type PlanRevisionArm = (typeof PLAN_REVISION_ARMS)[number];

export function isPlanCase(input: unknown): input is PlanCase {
  if (typeof input !== 'object' || input === null) return false;
  const expect = (input as { expect?: { kind?: string } }).expect;
  return expect?.kind === 'plan';
}

export function isPlanRevisionCase(input: unknown): input is PlanRevisionCase {
  if (typeof input !== 'object' || input === null) return false;
  const row = input as {
    expect?: { kind?: string };
    priorPlan?: unknown;
    feedback?: unknown;
  };
  return (
    row.expect?.kind === 'plan-revision' &&
    Array.isArray(row.priorPlan) &&
    typeof row.feedback === 'string' &&
    row.feedback.trim() !== ''
  );
}

export function isAnyPlanCase(input: unknown): input is AnyPlanCase {
  return isPlanCase(input) || isPlanRevisionCase(input);
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

function rowsText(rows: PlanTodoRow[]): string {
  return rows.map((row) => `${row.title}\n${row.spec}`).join('\n');
}

function artifactRows(artifacts: PlanArtifacts): PlanTodoRow[] {
  if (artifacts.todos !== undefined) return artifacts.todos;
  return artifacts.evidence.createdTodoRows.map((row) => ({
    id: row.id,
    title: row.title,
    spec: row.spec,
  }));
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
  const rows = artifactRows(artifacts);
  if (rows.length === 0) {
    grade.plan_ok = 0;
    explanation.plan_ok = 'empty artifacts: no todos produced';
    return { grade, explanation };
  }
  const output = rowsText(rows);
  const count = rows.length;
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

export function gradePlanRevisionCase(
  input: PlanRevisionCase,
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
  const rows = artifactRows(artifacts);
  if (rows.length === 0) {
    grade.plan_ok = 0;
    explanation.plan_ok = 'empty artifacts: no todos produced';
    return { grade, explanation };
  }
  const output = rowsText(rows);
  const missingFix = missingGroups(output, input.expect.mustFix);
  const missingPreserve = missingGroups(output, input.expect.mustPreserve);
  const leaked = usedExcluded(output, input.expect.exclude);
  const min = input.expect.minSplits;
  const max = input.expect.maxSplits;
  const countOk =
    (min === undefined || rows.length >= min) && (max === undefined || rows.length <= max);
  const ok =
    missingFix.length === 0 && missingPreserve.length === 0 && leaked.length === 0 && countOk;
  grade.plan_ok = ok ? 1 : 0;
  const parts: string[] = [];
  if (missingFix.length > 0)
    parts.push(`missing fix ${missingFix.map((group) => group.join('|')).join(';')}`);
  if (missingPreserve.length > 0)
    parts.push(`dropped preserved ${missingPreserve.map((group) => group.join('|')).join(';')}`);
  if (leaked.length > 0) parts.push(`forbidden ${leaked.join(',')}`);
  if (!countOk) parts.push(`split count ${rows.length} out of bounds`);
  explanation.plan_ok =
    parts.length === 0 ? 'revision covers fix and preserved steps' : parts.join('; ');
  return { grade, explanation };
}

export function revisionCaseProblems(input: PlanRevisionCase): string[] {
  const problems: string[] = [];
  if (input.priorPlan.length === 0) problems.push('empty priorPlan');
  if (input.feedback.trim() === '') problems.push('empty feedback');
  if (input.expect.mustFix.length === 0) problems.push('no mustFix');
  if (input.expect.mustPreserve.length === 0) problems.push('no mustPreserve');
  const prompt = fold(input.prompt);
  for (const marker of input.expect.mustFix.flat()) {
    if (prompt.includes(fold(marker))) problems.push(`mustFix alias echoes prompt: ${marker}`);
  }
  return problems;
}
