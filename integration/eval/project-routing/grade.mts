import type { TurnEvidence } from '../chief-dispatch/stack.mts';
import { ROUTING_PROJECTS } from './projects.mts';

export type RoutingExpect =
  | { kind: 'route'; projects: string[] }
  | { kind: 'ask'; candidates: string[] }
  | { kind: 'answer' };

export interface RoutingCase {
  id: string;
  tags: string[];
  chip?: string;
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

function askedText(ev: TurnEvidence): string | null {
  const asked = ev.toolCalls
    .filter((c) => c.name === 'ask_user')
    .map((c) => JSON.stringify(c.arguments));
  return asked.length > 0 ? asked.join('\n') : null;
}

function placedProjects(ev: TurnEvidence, idsByName: Record<string, string>): string[] {
  const nameById = new Map(Object.entries(idsByName).map(([name, id]) => [id, name]));
  return ev.createdTodoRows
    .filter((t) => t.phase !== 'closed')
    .map((t) => nameById.get(t.projectId) ?? `?${t.projectId}`);
}

function sameMultiset(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
}

function gradeAsk(candidates: string[], ev: TurnEvidence): { ok: boolean; why: string } {
  const question = askedText(ev);
  const text = question ?? ev.assistantText;
  const missing = candidates.filter((n) => !mentionsProject(text, n));
  const extra =
    question === null
      ? []
      : ROUTING_PROJECTS.map((p) => p.name).filter(
          (n) => !candidates.includes(n) && mentionsProject(question, n),
        );
  if (missing.length === 0 && extra.length === 0)
    return { ok: true, why: `asked about the tied candidates only: ${candidates.join(', ')}` };
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`question leaves out ${missing.join(', ')}`);
  if (extra.length > 0) parts.push(`question lists ruled-out ${extra.join(', ')}`);
  return { ok: false, why: parts.join('; ') };
}

function gradeDecision(
  input: RoutingCase,
  ev: TurnEvidence,
  idsByName: Record<string, string>,
): { ok: boolean; why: string } {
  if (ev.stepStatus !== 'done') return { ok: false, why: `step not done: ${ev.stepStatus}` };
  const placed = placedProjects(ev, idsByName);
  const expect = input.expect;
  if (expect.kind === 'route') {
    const ok = sameMultiset(placed, expect.projects);
    return {
      ok,
      why: ok
        ? `one todo per project: ${placed.join(', ')}`
        : `expected [${expect.projects.join(', ')}], got [${placed.join(', ') || 'none'}]`,
    };
  }
  if (placed.length > 0)
    return { ok: false, why: `should not create a todo, created in ${placed.join(', ')}` };
  if (expect.kind === 'answer') {
    const ok = ev.assistantText !== '';
    return { ok, why: ok ? 'answered without a todo' : 'no todo, but no answer either' };
  }
  return gradeAsk(expect.candidates, ev);
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
      unnamed.length === 0
        ? 'reply names the project'
        : `reply does not name ${unnamed.join(', ')}`;
  }
  return { grade, explanation };
}
