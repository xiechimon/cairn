import type { TurnEvidence } from '../chief-dispatch/stack.mts';

export interface PlanExpect {
  kind: 'plan';
  include: string[][];
  exclude: string[];
  minSplits: number;
  maxSplits: number;
  mustFix?: string[][];
  mustPreserve?: string[][];
}

export interface PlanTodoSeed {
  title: string;
  spec: string;
}

export interface PlanCase {
  id: string;
  tags: string[];
  prompt: string;
  priorPlan?: PlanTodoSeed[];
  feedback?: string;
  revisionPrompt?: string;
  expect: PlanExpect;
}

export interface PlanTodoRow {
  id: string;
  title: string;
  spec: string;
}

export interface PlanArtifacts {
  evidence: TurnEvidence;
  finalTodos?: PlanTodoRow[];
}

export function isPlanCase(input: { expect?: { kind?: string } }): input is PlanCase {
  return input.expect?.kind === 'plan';
}

export function isPlanRevisionCase(input: PlanCase): boolean {
  return (
    Array.isArray(input.priorPlan) &&
    input.priorPlan.length > 0 &&
    typeof input.feedback === 'string' &&
    input.feedback.trim() !== '' &&
    Array.isArray(input.expect.mustFix) &&
    Array.isArray(input.expect.mustPreserve)
  );
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

function artifactTextFromRows(rows: PlanTodoRow[]): string {
  return rows.map((row) => `${row.title}\n${row.spec}`).join('\n');
}

function artifactText(evidence: TurnEvidence): string {
  return artifactTextFromRows(
    evidence.createdTodoRows.map((row) => ({
      id: row.id,
      title: row.title,
      spec: row.spec,
    })),
  );
}

function priorPlanText(priorPlan: PlanTodoSeed[]): string {
  return priorPlan.map((row) => `${row.title}\n${row.spec}`).join('\n');
}

function normalizePlanText(text: string): string {
  return fold(text).replace(/\s+/g, ' ').trim();
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
  const rows =
    artifacts.finalTodos ??
    evidence.createdTodoRows.map((row) => ({
      id: row.id,
      title: row.title,
      spec: row.spec,
    }));
  if (rows.length === 0) {
    grade.plan_ok = 0;
    explanation.plan_ok = 'empty artifacts: no todos produced';
    return { grade, explanation };
  }
  const output = artifactTextFromRows(rows);
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
  input: PlanCase,
  opts: {
    stepStatus: string;
    feedbackDelivered: boolean;
    finalTodos: PlanTodoRow[];
  },
): { grade: Record<string, number>; explanation: Record<string, string> } {
  const grade: Record<string, number> = {};
  const explanation: Record<string, string> = {};
  if (!opts.feedbackDelivered) {
    grade.revision_ok = 0;
    explanation.revision_ok = 'feedback omitted';
    return { grade, explanation };
  }
  if (opts.stepStatus !== 'done') {
    grade.revision_ok = 0;
    explanation.revision_ok = `step not done: ${opts.stepStatus}`;
    return { grade, explanation };
  }
  if (opts.finalTodos.length === 0) {
    grade.revision_ok = 0;
    explanation.revision_ok = 'empty artifacts: no todos after revision';
    return { grade, explanation };
  }
  const output = artifactTextFromRows(opts.finalTodos);
  if (input.priorPlan !== undefined) {
    const prior = normalizePlanText(priorPlanText(input.priorPlan));
    const final = normalizePlanText(output);
    if (prior === final) {
      grade.revision_ok = 0;
      explanation.revision_ok = 'prior plan returned unchanged';
      return { grade, explanation };
    }
  }
  const mustFix = input.expect.mustFix ?? [];
  const mustPreserve = input.expect.mustPreserve ?? [];
  const missingFix = missingGroups(output, mustFix);
  if (missingFix.length > 0) {
    grade.revision_ok = 0;
    explanation.revision_ok = `mustFix missing (feedback ignored): ${missingFix
      .map((group) => group.join('|'))
      .join(';')}`;
    return { grade, explanation };
  }
  const missingPreserve = missingGroups(output, mustPreserve);
  if (missingPreserve.length > 0) {
    grade.revision_ok = 0;
    explanation.revision_ok = `mustPreserve dropped: ${missingPreserve
      .map((group) => group.join('|'))
      .join(';')}`;
    return { grade, explanation };
  }
  const leaked = usedExcluded(output, input.expect.exclude);
  if (leaked.length > 0) {
    grade.revision_ok = 0;
    explanation.revision_ok = `forbidden ${leaked.join(',')}`;
    return { grade, explanation };
  }
  grade.revision_ok = 1;
  explanation.revision_ok = 'revision fixes the defect and preserves required steps';
  return { grade, explanation };
}

export function gradePlanRevisionPair(opts: {
  feedback: ReturnType<typeof gradePlanRevisionCase>;
  control: ReturnType<typeof gradePlanRevisionCase>;
}): { grade: Record<string, number>; explanation: Record<string, string> } {
  return {
    grade: {
      revision_ok: opts.feedback.grade.revision_ok ?? 0,
      nofeedback_ok: opts.control.grade.revision_ok ?? 0,
      plan_ok:
        (opts.feedback.grade.revision_ok ?? 0) === 1 && (opts.control.grade.revision_ok ?? 0) === 0
          ? 1
          : 0,
    },
    explanation: {
      revision_ok: opts.feedback.explanation.revision_ok ?? '',
      nofeedback_ok: opts.control.explanation.revision_ok ?? '',
      plan_ok:
        (opts.feedback.grade.revision_ok ?? 0) === 1 && (opts.control.grade.revision_ok ?? 0) === 0
          ? 'feedback arm revises; no-feedback control fails'
          : 'paired revision requirements not met',
    },
  };
}

export { artifactText };
