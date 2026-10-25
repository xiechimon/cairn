import { describe, expect, test } from 'vitest';
import type { Case, RosterAgent } from '../eval/chief-dispatch/grade.mts';
import { scoreTrace } from '../eval/chief-dispatch/process.mts';
import type { TurnEvidence } from '../eval/chief-dispatch/stack.mts';

const roster: RosterAgent[] = [
  { key: 'doc', displayName: '阿岚', modelId: 'qwen3.8-max', description: '文档' },
  { key: 'code', displayName: '老周', modelId: 'glm-5.3', description: '后端' },
  { key: 'frontend', displayName: '小柯', modelId: 'kimi-k3', description: '前端' },
  { key: 'ops', displayName: '铁手', modelId: 'glm-5.3', description: '运维' },
];

const agentIds: Record<string, string> = {
  doc: 'a-doc',
  code: 'a-code',
  frontend: 'a-front',
  ops: 'a-ops',
};

const dispatchCase = (agent: string): Case => ({
  id: 'x',
  tags: [],
  prompt: 'p',
  expect: { kind: 'dispatch', agent },
});

const holdCase: Case = { id: 'h', tags: [], prompt: 'p', expect: { kind: 'hold' } };

function base(): TurnEvidence {
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
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    wallMs: 0,
  };
}

const row = (todoId: string, buildAgentId: string | null) => ({
  id: todoId,
  title: 'x',
  spec: 's',
  buildAgentId,
  planAgentId: null,
  phase: 'queued',
});

const find = (s: ReturnType<typeof scoreTrace>, check: string) => {
  const f = s.findings.find((x) => x.check === check);
  if (f === undefined) throw new Error(`没有 ${check} 这条 finding`);
  return f;
};

describe('tools.assignment_resolvable', () => {
  test('fails and names the id when a persisted agentId does not resolve in the roster', () => {
    const ev = base();
    ev.createdTodoRows = [row('t1', 'a-ghost')];
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    const f = find(s, 'tools.assignment_resolvable');
    expect(f.ok).toBe(false);
    expect(f.detail).toContain('a-ghost');
  });

  test('fails when an agentId from arguments does not resolve in the roster either (persisted row not yet visible)', () => {
    const ev = base();
    ev.runBuildsArgs = [{ todoIds: ['t1'], assignment: { build: { agentId: 'a-ghost' } } }];
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    expect(find(s, 'tools.assignment_resolvable').ok).toBe(false);
  });

  test('passes when all ids resolve', () => {
    const ev = base();
    ev.createdTodoRows = [row('t1', 'a-ops')];
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    expect(find(s, 'tools.assignment_resolvable').ok).toBe(true);
  });
});

describe('tools.attribution_consistent (load-bearing check)', () => {
  test('fails when the text names Tieshou but the persisted id is Xiaoke, and both names appear in the detail', () => {
    const ev = base();
    ev.createdTodoRows = [row('t1', 'a-front')];
    ev.assistantText = '已立任务，由 [铁手](agent:a-ops) 承接运维职责。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    const f = find(s, 'tools.attribution_consistent');
    expect(f.ok).toBe(false);
    expect(f.detail).toContain('铁手');
    expect(f.detail).toContain('小柯');
    expect(f.locus).toContain('t1');
  });

  test('passes when the text cites the same id as persisted', () => {
    const ev = base();
    ev.createdTodoRows = [row('t1', 'a-ops')];
    ev.assistantText = '已立任务，由 [铁手](agent:a-ops) 承接。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    expect(find(s, 'tools.attribution_consistent').ok).toBe(true);
  });

  test('still compares by display name when the text only gives the display name (no id form)', () => {
    const ev = base();
    ev.createdTodoRows = [row('t1', 'a-front')];
    ev.assistantText = '已立任务，由铁手承接。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    expect(find(s, 'tools.attribution_consistent').ok).toBe(false);
  });

  test('is unobserved (null) for a turn with no dispatch, never counted as pass', () => {
    const ev = base();
    ev.assistantText = '当前没有在跑的任务。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: holdCase.expect });
    expect(find(s, 'tools.attribution_consistent').ok).toBeNull();
  });
});

describe('evidence.mentioned_agents_exist', () => {
  test('fails when the text cites a nonexistent agent id (the programmable form of a hallucinated citation)', () => {
    const ev = base();
    ev.assistantText = '已派给 [老王](agent:a-nobody)。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: holdCase.expect });
    const f = find(s, 'evidence.mentioned_agents_exist');
    expect(f.ok).toBe(false);
    expect(f.detail).toContain('a-nobody');
  });

  test('is unobserved when the text cites no id form', () => {
    const ev = base();
    ev.assistantText = '好的。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: holdCase.expect });
    expect(find(s, 'evidence.mentioned_agents_exist').ok).toBeNull();
  });
});

describe('repair', () => {
  test('passes when the same tool is retried after an error with new arguments', () => {
    const ev = base();
    ev.toolCalls = [
      {
        name: 'run_builds',
        arguments: { assignment: { build: { agentId: 'a-ghost' } } },
        isError: true,
      },
      { name: 'run_builds', arguments: { assignment: { build: { agentId: 'a-ops' } } } },
    ];
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    expect(find(s, 'repair.retry_after_error').ok).toBe(true);
  });

  test('fails and names the tool when there is no retry after an error', () => {
    const ev = base();
    ev.toolCalls = [{ name: 'run_builds', arguments: {}, isError: true }];
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    const f = find(s, 'repair.retry_after_error');
    expect(f.ok).toBe(false);
    expect(f.detail).toContain('run_builds');
  });

  test('is unobserved for a turn with no tool errors', () => {
    const ev = base();
    ev.toolCalls = [{ name: 'todos', arguments: {} }];
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: holdCase.expect });
    expect(find(s, 'repair.retry_after_error').ok).toBeNull();
  });

  test('fails on repeated failures with the same tool and arguments (same source as the duplicate-call rate)', () => {
    const ev = base();
    const args = { todoIds: ['t1'] };
    ev.toolCalls = [
      { name: 'run_builds', arguments: args, isError: true },
      { name: 'run_builds', arguments: args, isError: true },
    ];
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    expect(find(s, 'repair.no_repeat_failed_call').ok).toBe(false);
  });
});

describe('coherence', () => {
  test('fails when the step ends in failure (incomplete trace)', () => {
    const ev = base();
    ev.stepStatus = 'failed';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: holdCase.expect });
    const f = find(s, 'coherence.step_completed');
    expect(f.ok).toBe(false);
    expect(f.detail).toContain('failed');
  });

  test('fails when multiple lines dispatch to different agents but the text names only one', () => {
    const ev = base();
    ev.createdTodoRows = [row('t1', 'a-ops'), row('t2', 'a-doc')];
    ev.assistantText = '两件事都交给铁手了。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    const f = find(s, 'coherence.narrative_covers_all_rows');
    expect(f.ok).toBe(false);
    expect(f.detail).toContain('阿岚');
  });

  test('passes when the text names all assignees', () => {
    const ev = base();
    ev.createdTodoRows = [row('t1', 'a-ops'), row('t2', 'a-doc')];
    ev.assistantText = '运维交给铁手，文档交给阿岚。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    expect(find(s, 'coherence.narrative_covers_all_rows').ok).toBe(true);
  });
});

describe('alternatives.hold_honest', () => {
  test('passes when a scenario that should hold got no dispatch but has body text', () => {
    const ev = base();
    ev.toolCalls = [{ name: 'todos', arguments: {} }];
    ev.assistantText = '当前没有在跑的任务。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: holdCase.expect });
    expect(find(s, 'alternatives.hold_honest').ok).toBe(true);
  });

  test('fails when a scenario that should hold got dispatched (premature commitment)', () => {
    const ev = base();
    ev.toolCalls = [{ name: 'run_builds', arguments: {} }];
    ev.createdTodoRows = [row('t1', 'a-ops')];
    ev.assistantText = '已派给铁手。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: holdCase.expect });
    expect(find(s, 'alternatives.hold_honest').ok).toBe(false);
  });

  test('is unobserved for an empty turn on a should-hold scenario, neither pass nor fail', () => {
    const ev = base();
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: holdCase.expect });
    expect(find(s, 'alternatives.hold_honest').ok).toBeNull();
  });
});

describe('aggregation and coverage declaration', () => {
  test('byDimension counts pass/fail/unobserved separately', () => {
    const ev = base();
    ev.createdTodoRows = [row('t1', 'a-front')];
    ev.assistantText = '由铁手承接。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: dispatchCase('ops').expect });
    const t = s.byDimension.tools;
    expect(t.fail).toBe(1);
    expect(t.pass).toBe(1);
    expect(t.unobserved).toBe(0);
  });

  test('semantic dimensions (quality of alternatives argumentation, scope) are explicitly unobserved, no fake coverage', () => {
    const ev = base();
    ev.assistantText = '好的。';
    const s = scoreTrace({ evidence: ev, roster, agentIds, expect: holdCase.expect });
    expect(find(s, 'alternatives.argument_quality').ok).toBeNull();
    expect(find(s, 'scope.limits_stated').ok).toBeNull();
  });

  test('records unobserved with an ambiguity note when display names collide in the roster, no guessing', () => {
    const dup: RosterAgent[] = [
      ...roster,
      { key: 'dup', displayName: '铁手', modelId: 'glm-5.3', description: '同名' },
    ];
    const dupIds: Record<string, string> = { ...agentIds, dup: 'a-dup' };
    const ev = base();
    ev.createdTodoRows = [row('t1', 'a-ops')];
    ev.assistantText = '由铁手承接。';
    const s = scoreTrace({
      evidence: ev,
      roster: dup,
      agentIds: dupIds,
      expect: dispatchCase('ops').expect,
    });
    const f = find(s, 'tools.attribution_consistent');
    expect(f.ok).toBeNull();
    expect(f.detail).toContain('歧义');
  });
});
