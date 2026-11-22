import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { compare } from '../../../eval/compare.js';
import { laneTask, runtimeTask, suiteTask } from '../../../eval/harness/types.js';
import { scoreRuntime } from '../../../eval/scorers/runtime-checks.js';

const ROOT = join(import.meta.dirname, '../../..');
const EVAL = join(ROOT, 'eval');

function loadAll() {
  const tasks = [];
  for (const file of readdirSync(join(EVAL, 'tasks/runtime'))) {
    tasks.push(
      suiteTask.parse(JSON.parse(readFileSync(join(EVAL, 'tasks/runtime', file), 'utf8'))),
    );
  }
  for (const dir of readdirSync(join(EVAL, 'tasks/lane'), { withFileTypes: true })) {
    if (dir.isDirectory())
      tasks.push(
        suiteTask.parse(
          JSON.parse(readFileSync(join(EVAL, 'tasks/lane', dir.name, 'task.json'), 'utf8')),
        ),
      );
  }
  for (const file of readdirSync(join(EVAL, 'tasks/canary'))) {
    tasks.push(suiteTask.parse(JSON.parse(readFileSync(join(EVAL, 'tasks/canary', file), 'utf8'))));
  }
  return tasks;
}

describe('eval suite tasks', () => {
  const tasks = loadAll();
  const counts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.kind] = (acc[t.kind] ?? 0) + 1;
    return acc;
  }, {});

  test('counts match suite.json expectations and the 30-50 starter range', () => {
    const suite = JSON.parse(readFileSync(join(EVAL, 'suite.json'), 'utf8'));
    expect(counts).toEqual(suite.expectedCounts);
    expect(tasks.length).toBeGreaterThanOrEqual(30);
    expect(tasks.length).toBeLessThanOrEqual(50);
  });

  test('every task id is unique', () => {
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  });

  test('runtime tasks script at least one step and name real coordinator tools only when calling', () => {
    const allowed = new Set([
      'projects',
      'todos',
      'create_todo',
      'update_todo',
      'delete_todos',
      'ask_user',
      'post_note',
      'memories',
      'save_memory',
      'update_memory',
      'delete_memory',
      'models',
      'machines',
      'skills',
      'secrets',
      'mcp_servers',
      'schedules',
      'docs',
      'usage',
      'issues',
      'pull_requests',
      'workflow_runs',
      'attachment',
      'conversation',
      'search_history',
      'read_history',
      'channel_messages',
      'inspect_run',
      'nonexistent_tool',
    ]);
    for (const task of tasks.filter((t) => t.kind === 'runtime') as Extract<
      (typeof tasks)[number],
      { kind: 'runtime' }
    >[]) {
      expect(task.script.length).toBeGreaterThan(0);
      for (const step of task.script) {
        for (const call of step.toolCalls ?? []) expect(allowed.has(call.name)).toBe(true);
      }
    }
  });

  test('lane tasks declare an instruction and at least one file or command check', () => {
    for (const task of tasks.filter((t) => t.kind === 'lane')) {
      const lane = laneTask.parse(task);
      expect(lane.instruction.length).toBeGreaterThan(8);
      expect(lane.checks.files.length + lane.checks.commands.length).toBeGreaterThan(0);
    }
  });
});

describe('eval compare verdict', () => {
  const item = (
    caseId: string,
    value: number,
    extra: Partial<Parameters<typeof compare>[0]['items'][number]> = {},
  ) => ({
    caseId,
    kind: 'runtime',
    repeat: 0,
    scores: { 'turn.completed': value },
    comments: {},
    gate: true,
    ...extra,
  });

  test('pass when base and candidate agree', () => {
    const base = { arm: 'base', items: [item('a', 1), item('b', 0)] };
    const cand = { arm: 'cand', items: [item('a', 1), item('b', 0)] };
    expect(compare(base, cand).verdict).toBe('pass');
  });

  test('regression when a passing case flips to fail', () => {
    const base = { arm: 'base', items: [item('a', 1), item('a', 1, { repeat: 1 })] };
    const cand = { arm: 'cand', items: [item('a', 0), item('a', 0, { repeat: 1 })] };
    const out = compare(base, cand);
    expect(out.verdict).toBe('regression');
    expect(out.regressions.map((r) => r.caseId)).toEqual(['a']);
  });

  test('incomplete on a gated case fails closed, never as a score failure', () => {
    const base = { arm: 'base', items: [item('a', 1)] };
    const cand = { arm: 'cand', items: [item('a', 0, { incomplete: 'devin: ENOENT' })] };
    expect(compare(base, cand).verdict).toBe('incomplete');
  });

  test('improvement is not a regression', () => {
    const base = { arm: 'base', items: [item('a', 0)] };
    const cand = { arm: 'cand', items: [item('a', 1)] };
    expect(compare(base, cand).verdict).toBe('pass');
  });
});

describe('runtime scorer determinism', () => {
  const task = runtimeTask.parse({
    kind: 'runtime',
    id: 't',
    request: 'r',
    world: { projects: ['p'] },
    script: [{ text: 'ok' }],
    expected: { decision: 'route', projects: ['p'], boundModel: 'm' },
    gate: true,
  });
  const record = {
    caseId: 't',
    kind: 'runtime' as const,
    stepStatus: 'done',
    decision: 'route' as const,
    todos: [{ project: 'p', title: 'x' }],
    asked: false,
    askCandidates: [],
    toolCalls: [],
    text: 'ok',
    boundModels: ['m'],
    promptSystem: ['sys'],
    promptSha256: 'a'.repeat(64),
  };

  test('all checks pass on a clean record', () => {
    const checks = scoreRuntime(task, record);
    expect(checks.every((c) => c.value === 1)).toBe(true);
  });

  test('a flipped project fails route.projects_ok', () => {
    const checks = scoreRuntime(task, { ...record, todos: [{ project: 'q', title: 'x' }] });
    expect(checks.find((c) => c.name === 'route.projects_ok')?.value).toBe(0);
  });

  test('an incomplete record yields only the incomplete check', () => {
    const checks = scoreRuntime(task, { caseId: 't', kind: 'runtime', incomplete: 'boom' });
    expect(checks).toEqual([{ name: 'incomplete', value: 0, comment: 'boom', gate: true }]);
  });
});
