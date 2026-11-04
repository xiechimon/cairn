import type { TurnEvidence } from '../chief-dispatch/stack.mts';

export type LearnArm = 'all' | 'no-memory' | 'correction' | 'oracle' | 'reflect';

export const LEARN_ARMS: readonly LearnArm[] = [
  'all',
  'no-memory',
  'correction',
  'oracle',
  'reflect',
];

export interface LearnCase {
  id: string;
  tags: string[];
  family: 'learn';
  round1: string;
  correction: string;
  round2: string;
  expect: { include: string[][]; exclude: string[] };
  oracle: { title: string; content: string };
}

export interface LearnMemoryRow {
  title: string;
  content: string;
  projectId: string | null;
  invalidAt: number | null;
}

interface Verdict {
  ok: boolean;
  why: string;
}

export function isLearnCase(input: { id: string; family?: string }): input is LearnCase {
  return input.family === 'learn';
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

function statesFact(text: string, input: LearnCase): boolean {
  return missingGroups(text, input.expect.include).length === 0;
}

function statesMistake(text: string, input: LearnCase): boolean {
  return usedExcluded(text, input.expect.exclude).length > 0;
}

function factVerdict(text: string, input: LearnCase, okWhy: string): Verdict {
  const missing = missingGroups(text, input.expect.include);
  const leaked = usedExcluded(text, input.expect.exclude);
  if (missing.length === 0 && leaked.length === 0) return { ok: true, why: okWhy };
  const parts: string[] = [];
  if (missing.length > 0)
    parts.push(`missing ${missing.map((group) => group.join('|')).join('; ')}`);
  if (leaked.length > 0) parts.push(`states the mistake ${leaked.join(', ')}`);
  return { ok: false, why: parts.join('; ') };
}

export function learnCaseProblems(input: LearnCase): string[] {
  const problems: string[] = [];
  if (input.round1.trim() === input.round2.trim()) problems.push('same text');
  const leak = (label: string, text: string) => {
    if (input.expect.include.some((group) => group.some((alt) => mentions(fold(text), alt))))
      problems.push(`${label} names the fact`);
    if (statesMistake(text, input)) problems.push(`${label} names the mistake`);
  };
  leak('round1', input.round1);
  leak('round2', input.round2);
  if (!statesFact(input.correction, input)) problems.push('correction misses');
  const oracle = `${input.oracle.title}\n${input.oracle.content}`;
  if (!statesFact(oracle, input)) problems.push('oracle misses');
  if (statesMistake(oracle, input)) problems.push('oracle repeats the mistake');
  return problems;
}

export function gradeLearnDecision(input: LearnCase, evidence: TurnEvidence): Verdict {
  if (evidence.stepStatus !== 'done')
    return { ok: false, why: `turn did not finish: ${evidence.stepStatus}` };
  if (evidence.createdTodoRows.length === 0) return { ok: false, why: 'no task was created' };
  const output = evidence.createdTodoRows.map((row) => `${row.title}\n${row.spec}`).join('\n');
  return factVerdict(output, input, 'task states the corrected fact');
}

export function gradeMemorySaved(
  input: LearnCase,
  rows: LearnMemoryRow[],
  projectId: string,
): Verdict {
  const valid = rows.filter((row) => row.invalidAt === null);
  const onProject = valid.filter((row) => row.projectId === projectId);
  const textOf = (row: LearnMemoryRow) => `${row.title}\n${row.content}`;
  if (onProject.some((row) => statesFact(textOf(row), input) && !statesMistake(textOf(row), input)))
    return { ok: true, why: 'project memory states the corrected fact' };
  if (onProject.some((row) => statesMistake(textOf(row), input)))
    return { ok: false, why: 'memory states the mistake' };
  if (
    valid.some(
      (row) =>
        row.projectId !== projectId &&
        statesFact(textOf(row), input) &&
        !statesMistake(textOf(row), input),
    )
  )
    return { ok: false, why: 'the fact is stored outside the project' };
  if (
    rows.some(
      (row) =>
        row.invalidAt !== null &&
        row.projectId === projectId &&
        statesFact(textOf(row), input) &&
        !statesMistake(textOf(row), input),
    )
  )
    return { ok: false, why: 'the only matching memory is invalidated' };
  return { ok: false, why: 'no memory states the corrected fact' };
}

export function gradeReflectCandidates(
  input: LearnCase,
  candidates: { title: string; content: string }[],
): { factOk: boolean; wrong: boolean; whyFact: string; whyWrong: string } {
  const texts = candidates.map((candidate) => `${candidate.title}\n${candidate.content}`);
  const factOk = texts.some((text) => statesFact(text, input));
  const wrong = texts.some((text) => statesMistake(text, input));
  return {
    factOk,
    wrong,
    whyFact: factOk
      ? 'a candidate states the corrected fact'
      : 'no candidate states the corrected fact',
    whyWrong: wrong ? 'a candidate states the mistake' : 'no candidate states the mistake',
  };
}

export function learnHeadline(rates: { noMemory: number; correction: number; oracle: number }): {
  repeatRate: number;
  gapClosed: number | null;
} {
  const span = rates.oracle - rates.noMemory;
  return {
    repeatRate: 1 - rates.correction,
    gapClosed: span === 0 ? null : (rates.correction - rates.noMemory) / span,
  };
}

export function learnHeadlineFromRows(
  rows: { grade: Record<string, number> }[],
): { repeatRate: number; gapClosed: number | null } | null {
  const usable = rows.filter(
    (row) =>
      typeof row.grade.decision_ok === 'number' &&
      typeof row.grade.no_memory_ok === 'number' &&
      typeof row.grade.oracle_ok === 'number',
  );
  if (usable.length === 0) return null;
  const mean = (key: string) =>
    usable.reduce((sum, row) => sum + (row.grade[key] ?? 0), 0) / usable.length;
  return learnHeadline({
    noMemory: mean('no_memory_ok'),
    correction: mean('decision_ok'),
    oracle: mean('oracle_ok'),
  });
}

export function learnGradeRecord(input: {
  arm: LearnArm;
  noMemory?: Verdict;
  correctionDecision?: Verdict;
  memorySaved?: Verdict;
  oracle?: Verdict;
  reflect?: { factOk: boolean; wrong: boolean; whyFact: string; whyWrong: string };
}): { grade: Record<string, number>; explanation: Record<string, string> } {
  const grade: Record<string, number> = {};
  const explanation: Record<string, string> = {};
  const need = (label: string, value: Verdict | undefined): Verdict => {
    if (value === undefined) throw new Error(`learn arm ${input.arm} missing ${label}`);
    return value;
  };
  if (input.arm === 'all' || input.arm === 'no-memory') {
    const verdict = need('no-memory', input.noMemory);
    if (input.arm === 'no-memory') {
      grade.decision_ok = verdict.ok ? 1 : 0;
      explanation.decision_ok = verdict.why;
    } else {
      grade.no_memory_ok = verdict.ok ? 1 : 0;
      explanation.no_memory_ok = verdict.why;
    }
  }
  if (input.arm === 'all' || input.arm === 'correction') {
    const decision = need('correction', input.correctionDecision);
    const saved = need('memory', input.memorySaved);
    grade.decision_ok = decision.ok ? 1 : 0;
    explanation.decision_ok = decision.why;
    grade.memory_saved_ok = saved.ok ? 1 : 0;
    explanation.memory_saved_ok = saved.why;
  }
  if (input.arm === 'all' || input.arm === 'oracle') {
    const verdict = need('oracle', input.oracle);
    if (input.arm === 'oracle') {
      grade.decision_ok = verdict.ok ? 1 : 0;
      explanation.decision_ok = verdict.why;
    } else {
      grade.oracle_ok = verdict.ok ? 1 : 0;
      explanation.oracle_ok = verdict.why;
    }
  }
  if (input.arm === 'all' || input.arm === 'reflect') {
    if (input.reflect === undefined) throw new Error(`learn arm ${input.arm} missing reflect`);
    grade.reflect_fact_ok = input.reflect.factOk ? 1 : 0;
    explanation.reflect_fact_ok = input.reflect.whyFact;
    grade.reflect_wrong = input.reflect.wrong ? 1 : 0;
    explanation.reflect_wrong = input.reflect.whyWrong;
  }
  return { grade, explanation };
}
