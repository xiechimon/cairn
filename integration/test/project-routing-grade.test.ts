import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TurnEvidence } from '../eval/chief-dispatch/stack.mts';
import {
  gradeRoutingCase,
  isRoutingCase,
  type RoutingCase,
} from '../eval/project-routing/grade.mts';
import { ROUTING_PROJECTS } from '../eval/project-routing/projects.mts';

const FLOW_DIR = join(import.meta.dirname, '../../.claude/hillclimb/project-routing');
const flow = JSON.parse(readFileSync(join(FLOW_DIR, 'cases.json'), 'utf8')) as {
  cases: RoutingCase[];
};
const cases = flow.cases;
const names = ROUTING_PROJECTS.map((p) => p.name);
const ids = Object.fromEntries(names.map((n) => [n, `id-${n}`]));

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

function todoIn(project: string, n = 1) {
  return {
    id: `t-${project}-${n}`,
    title: '任务',
    spec: '',
    projectId: ids[project] ?? 'unknown',
    buildAgentId: null,
    planAgentId: null,
    phase: 'backlog',
  };
}

const route = (projects: string[]): RoutingCase => ({
  id: 'r',
  tags: ['route'],
  prompt: 'p',
  expect: { kind: 'route', projects },
});
const ask = (candidates: string[]): RoutingCase => ({
  id: 'a',
  tags: ['ask'],
  prompt: 'p',
  expect: { kind: 'ask', candidates },
});
const answer: RoutingCase = { id: 'q', tags: ['answer'], prompt: 'p', expect: { kind: 'answer' } };

describe('project-routing case ledger', () => {
  test('every case is a routing case and every project it names exists in the seeded world', () => {
    for (const c of cases) {
      expect(isRoutingCase(c), c.id).toBe(true);
      const named =
        c.expect.kind === 'route'
          ? c.expect.projects
          : c.expect.kind === 'ask'
            ? c.expect.candidates
            : [];
      for (const n of named) expect(names, `${c.id} names ${n}`).toContain(n);
    }
  });

  test('covers named, inferable, tied, cross-project and question-only requests', () => {
    const tagged = (t: string) => cases.filter((c) => c.tags.includes(t)).length;
    expect(tagged('named')).toBeGreaterThanOrEqual(2);
    expect(tagged('inferable')).toBeGreaterThanOrEqual(3);
    expect(tagged('tied')).toBeGreaterThanOrEqual(2);
    expect(tagged('cross')).toBeGreaterThanOrEqual(2);
    expect(tagged('answer')).toBeGreaterThanOrEqual(2);
    for (const c of cases.filter((x) => x.tags.includes('cross')))
      expect(c.expect.kind === 'route' && c.expect.projects.length, c.id).toBe(2);
    for (const c of cases.filter((x) => x.tags.includes('tied')))
      expect(c.expect.kind === 'ask' && c.expect.candidates.length, c.id).toBeGreaterThanOrEqual(2);
  });

  test('every seeded project has a description and a repo seed directory', () => {
    for (const p of ROUTING_PROJECTS) {
      expect(p.description.length, p.name).toBeGreaterThan(0);
      expect(existsSync(p.seedDir), p.seedDir).toBe(true);
    }
  });

  test('the inferable broken-link case is decidable from the seeds alone', () => {
    const readme = (name: string) => {
      const p = ROUTING_PROJECTS.find((x) => x.name === name);
      if (p === undefined) throw new Error(name);
      return readFileSync(join(p.seedDir, 'README.md'), 'utf8');
    };
    const linkTargets = (text: string) =>
      [...text.matchAll(/\]\((?!https?:)([^)#]+)\)/g)].map((m) => m[1] ?? '');
    const broken = ROUTING_PROJECTS.filter((p) =>
      linkTargets(readme(p.name)).some((t) => !existsSync(join(p.seedDir, t))),
    ).map((p) => p.name);
    const linkCase = cases.find((c) => c.tags.includes('broken-links'));
    expect(linkCase?.expect.kind === 'route' && linkCase.expect.projects).toEqual(broken);
  });
});

describe('gradeRoutingCase', () => {
  test('route: exactly the expected projects pass; a wrong or extra project fails', () => {
    const c = route(['docs-site']);
    expect(
      gradeRoutingCase(c, turn({ createdTodoRows: [todoIn('docs-site')] }), ids).grade.decision_ok,
    ).toBe(1);
    expect(
      gradeRoutingCase(c, turn({ createdTodoRows: [todoIn('eval-project')] }), ids).grade
        .decision_ok,
    ).toBe(0);
    expect(
      gradeRoutingCase(
        c,
        turn({ createdTodoRows: [todoIn('docs-site'), todoIn('eval-project')] }),
        ids,
      ).grade.decision_ok,
    ).toBe(0);
    expect(gradeRoutingCase(c, turn(), ids).grade.decision_ok).toBe(0);
  });

  test('route across two projects needs one todo in each, not two in one', () => {
    const c = route(['eval-project', 'docs-site']);
    expect(
      gradeRoutingCase(
        c,
        turn({ createdTodoRows: [todoIn('docs-site'), todoIn('eval-project')] }),
        ids,
      ).grade.decision_ok,
    ).toBe(1);
    expect(
      gradeRoutingCase(
        c,
        turn({ createdTodoRows: [todoIn('docs-site', 1), todoIn('docs-site', 2)] }),
        ids,
      ).grade.decision_ok,
    ).toBe(0);
  });

  test('route receipt: the reply names the chosen project', () => {
    const c = route(['digest-bot']);
    const rows = [todoIn('digest-bot')];
    expect(
      gradeRoutingCase(c, turn({ createdTodoRows: rows, assistantText: '放在 digest-bot' }), ids)
        .grade.receipt_ok,
    ).toBe(1);
    expect(
      gradeRoutingCase(c, turn({ createdTodoRows: rows, assistantText: '好的' }), ids).grade
        .receipt_ok,
    ).toBe(0);
  });

  test('ask: no todo, every candidate named, no project outside the candidates named', () => {
    const c = ask(['eval-project', 'docs-site']);
    const text = 'eval-project 和 docs-site 都有网页，放哪个？';
    expect(gradeRoutingCase(c, turn({ assistantText: text }), ids).grade.decision_ok).toBe(1);
    expect(
      gradeRoutingCase(c, turn({ assistantText: `${text} 还是 bench？` }), ids).grade.decision_ok,
    ).toBe(0);
    expect(
      gradeRoutingCase(c, turn({ assistantText: '放 eval-project 吗？' }), ids).grade.decision_ok,
    ).toBe(0);
    expect(
      gradeRoutingCase(
        c,
        turn({ assistantText: text, createdTodoRows: [todoIn('docs-site')] }),
        ids,
      ).grade.decision_ok,
    ).toBe(0);
  });

  test('ask: a todo-shaped project name inside a longer name does not count as naming it', () => {
    const c = ask(['eval-project', 'docs-site']);
    expect(
      gradeRoutingCase(c, turn({ assistantText: 'eval-project 还是 docs-site？' }), ids).grade
        .decision_ok,
    ).toBe(1);
  });

  test('answer: a reply and no todo pass; an empty or truncated turn fails', () => {
    expect(
      gradeRoutingCase(answer, turn({ assistantText: '用 Python' }), ids).grade.decision_ok,
    ).toBe(1);
    expect(gradeRoutingCase(answer, turn(), ids).grade.decision_ok).toBe(0);
    expect(
      gradeRoutingCase(answer, turn({ assistantText: 'x', stepStatus: 'failed' }), ids).grade
        .decision_ok,
    ).toBe(0);
    expect(
      gradeRoutingCase(
        answer,
        turn({ assistantText: 'x', createdTodoRows: [todoIn('bench')] }),
        ids,
      ).grade.decision_ok,
    ).toBe(0);
  });
});
