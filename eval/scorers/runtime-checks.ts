import type { CheckResult, RuntimeTask, TurnRecord } from '../harness/types.js';

const ok = (name: string, gate = true): CheckResult => ({ name, value: 1, gate });
const fail = (name: string, comment: string, gate = true): CheckResult => ({
  name,
  value: 0,
  comment,
  gate,
});

export function scoreRuntime(task: RuntimeTask, record: TurnRecord): CheckResult[] {
  const expected = task.expected;
  const gate = task.gate;
  const results: CheckResult[] = [];
  if (record.incomplete !== undefined)
    return [{ name: 'incomplete', value: 0, comment: record.incomplete, gate }];
  results.push(
    record.stepStatus === 'done'
      ? ok('turn.completed', gate)
      : fail('turn.completed', `step=${record.stepStatus}`, gate),
  );
  if (expected.decision !== 'any') {
    results.push(
      record.decision === expected.decision
        ? ok('turn.decision_ok', gate)
        : fail('turn.decision_ok', `${record.decision} != ${expected.decision}`, gate),
    );
  }
  if (expected.projects !== undefined) {
    const actual = [...new Set((record.todos ?? []).map((t) => t.project))].sort();
    const want = [...expected.projects].sort();
    results.push(
      JSON.stringify(actual) === JSON.stringify(want)
        ? ok('route.projects_ok', gate)
        : fail('route.projects_ok', `${JSON.stringify(actual)} != ${JSON.stringify(want)}`, gate),
    );
  }
  if (expected.parts !== undefined) {
    const n = record.todos?.length ?? 0;
    results.push(
      n === expected.parts
        ? ok('route.split_ok', gate)
        : fail('route.split_ok', `${n} != ${expected.parts}`, gate),
    );
  }
  if (expected.ask !== undefined) {
    results.push(
      (record.asked ?? false) === expected.ask
        ? ok('ask.ok', gate)
        : fail('ask.ok', `asked=${record.asked} != ${expected.ask}`, gate),
    );
  }
  if (expected.askCandidates !== undefined) {
    const missing = expected.askCandidates.filter((c) => !(record.askCandidates ?? []).includes(c));
    results.push(
      missing.length === 0
        ? ok('ask.candidates_ok', gate)
        : fail('ask.candidates_ok', `missing ${missing.join(', ')}`, gate),
    );
  }
  const invalid = (record.toolCalls ?? []).filter((call) => !call.argsValid);
  results.push(
    invalid.length === 0
      ? ok('turn.tool_contract', gate)
      : fail('turn.tool_contract', `${invalid.length} invalid calls`, gate),
  );
  if (expected.boundModel !== undefined) {
    results.push(
      (record.boundModels ?? []).includes(expected.boundModel)
        ? ok('turn.model_bound', gate)
        : fail('turn.model_bound', `bound=${JSON.stringify(record.boundModels)}`, gate),
    );
  }
  if (expected.promptContains.length > 0 || expected.promptExcludes.length > 0) {
    const system = (record.promptSystem ?? []).join('\n');
    const missing = expected.promptContains.filter((needle) => !system.includes(needle));
    const leaked = expected.promptExcludes.filter((needle) => system.includes(needle));
    results.push(
      missing.length === 0 && leaked.length === 0
        ? ok('turn.prompt_contract', gate)
        : fail(
            'turn.prompt_contract',
            [...missing.map((m) => `missing:${m}`), ...leaked.map((l) => `leaked:${l}`)].join('; '),
            gate,
          ),
    );
  }
  return results;
}

export function scoreCanary(record: TurnRecord): CheckResult[] {
  if (record.incomplete !== undefined)
    return [{ name: 'incomplete', value: 0, comment: record.incomplete, gate: true }];
  return record.stepStatus === 'done'
    ? [ok('canary.completed')]
    : [fail('canary.completed', `step=${record.stepStatus}`)];
}
