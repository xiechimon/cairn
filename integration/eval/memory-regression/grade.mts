import type { TurnEvidence } from '../chief-dispatch/stack.mts';

export type MemoryCaseKind = 'conflict' | 'leak' | 'stale' | 'adjacent' | 'irrelevant';

export type MemoryScope = 'eval-project' | 'other-project' | null;

export interface MemorySeed {
  key: string;
  title: string;
  content: string;
  scope: MemoryScope;
  ageDays: number;
  invalidatedBy?: string;
}

export interface MemoryCase {
  id: string;
  tags: string[];
  prompt: string;
  memories: MemorySeed[];
  expect: {
    kind: MemoryCaseKind;
    include: string[][];
    exclude: string[];
    staleMemory?: string;
    untouchedMemory?: string;
  };
}

export interface MemoryRowLite {
  id: string;
  title: string;
  content: string;
  invalidAt: number | null;
  supersededBy: string | null;
}

export interface MemoryRun {
  evidence: TurnEvidence;
  memoryAfter: MemoryRowLite[];
}

const MEMORY_CASE_KINDS: readonly string[] = [
  'conflict',
  'leak',
  'stale',
  'adjacent',
  'irrelevant',
];

export function isMemoryCase(input: { expect: { kind: string } }): input is MemoryCase {
  return MEMORY_CASE_KINDS.includes(input.expect.kind);
}

export const memoryIdFor = (caseId: string, key: string): string => `mem-${caseId}-${key}`;

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

function gradeDecision(input: MemoryCase, run: MemoryRun): { ok: boolean; why: string } {
  const { evidence } = run;
  if (evidence.stepStatus !== 'done') return { ok: false, why: `步未完成：${evidence.stepStatus}` };
  if (evidence.createdTodoRows.length === 0)
    return { ok: false, why: '没有产出任务（读终态，正文不计）' };
  const output = evidence.createdTodoRows.map((t) => `${t.title}\n${t.spec}`).join('\n');
  const missing = missingGroups(output, input.expect.include);
  const leaked = usedExcluded(output, input.expect.exclude);
  if (missing.length === 0 && leaked.length === 0)
    return { ok: true, why: '产出遵循应采信的那条事实' };
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`缺少 ${missing.map((g) => g.join('|')).join('；')}`);
  if (leaked.length > 0) parts.push(`出现不该采信的 ${leaked.join('、')}`);
  return { ok: false, why: parts.join('；') };
}

function untouchedOthersOk(input: MemoryCase, rows: Map<string, MemoryRowLite>): string | null {
  for (const seed of input.memories) {
    if (seed.key === input.expect.staleMemory || seed.invalidatedBy !== undefined) continue;
    const row = rows.get(memoryIdFor(input.id, seed.key));
    if (row === undefined) return `误删了无关记忆 ${seed.key}`;
    if (row.invalidAt !== null || row.content !== seed.content) return `误改了无关记忆 ${seed.key}`;
  }
  return null;
}

function latestInChain(
  start: MemoryRowLite,
  rows: Map<string, MemoryRowLite>,
): MemoryRowLite | undefined {
  const visited = new Set<string>();
  let current: MemoryRowLite | undefined = start;
  while (current !== undefined && current.invalidAt !== null) {
    if (visited.has(current.id) || current.supersededBy === null) return undefined;
    visited.add(current.id);
    current = rows.get(current.supersededBy);
  }
  return current;
}

function gradeUntouched(
  input: MemoryCase,
  rows: Map<string, MemoryRowLite>,
): { ok: boolean; why: string } {
  const key = input.expect.untouchedMemory;
  if (key === undefined) throw new Error(`${input.id} is adjacent but names no untouched memory`);
  const seed = input.memories.find((m) => m.key === key);
  if (seed === undefined)
    throw new Error(`${input.id}: untouched memory ${key} is not in the case`);
  const row = rows.get(memoryIdFor(input.id, key));
  if (row === undefined) return { ok: false, why: `unrelated memory ${key} is missing` };
  if (row.content !== seed.content || row.supersededBy !== null || row.invalidAt !== null)
    return { ok: false, why: `unrelated memory ${key} was changed or superseded` };
  return { ok: true, why: 'unrelated memory is unchanged' };
}

function gradeMemoryWrite(input: MemoryCase, run: MemoryRun): { ok: boolean; why: string } {
  const staleKey = input.expect.staleMemory;
  if (staleKey === undefined) throw new Error(`${input.id} 是过期类却没给 staleMemory`);
  const rows = new Map(run.memoryAfter.map((r) => [r.id, r]));
  const collateral = untouchedOthersOk(input, rows);
  if (collateral !== null) return { ok: false, why: collateral };
  const stale = rows.get(memoryIdFor(input.id, staleKey));
  if (stale === undefined) return { ok: true, why: '过期条已删除' };
  const successor = latestInChain(stale, rows);
  if (successor === undefined || successor === stale)
    return { ok: false, why: '过期条仍有效，或被标失效却没有有效的后继条' };
  const missing = missingGroups(successor.content, input.expect.include);
  const leaked = usedExcluded(successor.content, input.expect.exclude);
  if (missing.length > 0 || leaked.length > 0) return { ok: false, why: '后继条写的不是仓库实况' };
  return { ok: true, why: '过期条已被取代，后继条为仓库实况' };
}

export function gradeMemoryCase(
  input: MemoryCase,
  run: MemoryRun,
): { grade: Record<string, number>; explanation: Record<string, string> } {
  const decision = gradeDecision(input, run);
  const grade: Record<string, number> = { decision_ok: decision.ok ? 1 : 0 };
  const explanation: Record<string, string> = { decision_ok: decision.why };
  if (input.expect.kind === 'stale') {
    const write = gradeMemoryWrite(input, run);
    grade.memory_write_ok = write.ok ? 1 : 0;
    explanation.memory_write_ok = write.why;
  }
  if (input.expect.kind === 'adjacent') {
    const untouched = gradeUntouched(input, new Map(run.memoryAfter.map((r) => [r.id, r])));
    grade.untouched_ok = untouched.ok ? 1 : 0;
    explanation.untouched_ok = untouched.why;
  }
  return { grade, explanation };
}
