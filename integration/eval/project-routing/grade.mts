import type { TurnEvidence } from '../chief-dispatch/stack.mts';
import { ROUTING_PROJECTS } from './projects.mts';

export type RoutingExpect =
  | { kind: 'route'; projects: string[] }
  | { kind: 'ask'; candidates: string[] }
  | { kind: 'answer' };

export interface RoutingCase {
  id: string;
  tags: string[];
  prompt: string;
  expect: RoutingExpect;
}

const ROUTING_KINDS: readonly string[] = ['route', 'ask', 'answer'];

export function isRoutingCase(input: { expect: { kind: string } }): input is RoutingCase {
  return ROUTING_KINDS.includes(input.expect.kind);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentionsProject(text: string, name: string): boolean {
  const project = ROUTING_PROJECTS.find((p) => p.name === name);
  const terms = [name, ...(project?.aliases ?? [])];
  return terms.some((term) =>
    new RegExp(`(?<![A-Za-z0-9-])${escapeRe(term)}(?![A-Za-z0-9-])`, 'i').test(text),
  );
}

function questionText(ev: TurnEvidence): string {
  const asked = ev.toolCalls
    .filter((c) => c.name === 'ask_user')
    .map((c) => JSON.stringify(c.arguments));
  return [ev.assistantText, ...asked].join('\n');
}

function projectNamesOf(ev: TurnEvidence, idsByName: Record<string, string>): string[] {
  const nameById = new Map(Object.entries(idsByName).map(([name, id]) => [id, name]));
  return ev.createdTodoRows.map((t) => nameById.get(t.projectId) ?? `?${t.projectId}`);
}

function sameMultiset(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
}

function gradeDecision(
  input: RoutingCase,
  ev: TurnEvidence,
  idsByName: Record<string, string>,
): { ok: boolean; why: string } {
  if (ev.stepStatus !== 'done') return { ok: false, why: `步未完成：${ev.stepStatus}` };
  const placed = projectNamesOf(ev, idsByName);
  const expect = input.expect;
  if (expect.kind === 'route') {
    const ok = sameMultiset(placed, expect.projects);
    return {
      ok,
      why: ok
        ? `每个项目各一张：${placed.join('、')}`
        : `期望 [${expect.projects.join('、')}]，实际 [${placed.join('、') || '无'}]`,
    };
  }
  if (placed.length > 0) return { ok: false, why: `不该建任务，却建在 ${placed.join('、')}` };
  if (expect.kind === 'answer') {
    const ok = ev.assistantText !== '';
    return { ok, why: ok ? '只回答，没建任务' : '没建任务但也没回答' };
  }
  const text = questionText(ev);
  const missing = expect.candidates.filter((n) => !mentionsProject(text, n));
  const extra = ROUTING_PROJECTS.map((p) => p.name).filter(
    (n) => !expect.candidates.includes(n) && mentionsProject(text, n),
  );
  if (missing.length === 0 && extra.length === 0)
    return { ok: true, why: `只问了仍分不出的候选：${expect.candidates.join('、')}` };
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`没问到 ${missing.join('、')}`);
  if (extra.length > 0) parts.push(`列了已能排除的 ${extra.join('、')}`);
  return { ok: false, why: parts.join('；') };
}

export function gradeRoutingCase(
  input: RoutingCase,
  ev: TurnEvidence,
  idsByName: Record<string, string>,
): { grade: Record<string, number>; explanation: Record<string, string> } {
  const decision = gradeDecision(input, ev, idsByName);
  const grade: Record<string, number> = { decision_ok: decision.ok ? 1 : 0 };
  const explanation: Record<string, string> = { decision_ok: decision.why };
  if (input.expect.kind === 'route') {
    const unnamed = input.expect.projects.filter((n) => !mentionsProject(ev.assistantText, n));
    grade.receipt_ok = unnamed.length === 0 ? 1 : 0;
    explanation.receipt_ok =
      unnamed.length === 0 ? '回执点名了项目' : `回执没提到 ${unnamed.join('、')}`;
  }
  return { grade, explanation };
}
