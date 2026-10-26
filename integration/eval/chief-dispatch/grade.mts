import type { TurnEvidence } from './stack.mts';

export interface RosterAgent {
  key: string;
  displayName: string;
  modelId: string;
  description: string;
}

export interface Case {
  id: string;
  tags: string[];
  prompt: string;
  expect: { kind: 'dispatch' | 'hold'; agent?: string; why?: string };
}

export interface GradedRun {
  evidence: TurnEvidence;
  agentIds: Record<string, string>;
}

export function gradeCase(
  input: Case,
  run: GradedRun,
  roster: RosterAgent[],
): {
  grade: Record<string, number>;
  explanation: Record<string, string>;
} {
  const ev = run.evidence;
  const rosterByKey = new Map(roster.map((r) => [r.key, r]));
  const keyOfId = new Map(Object.entries(run.agentIds).map(([k, v]) => [v, k]));

  const dispatched = ev.toolCalls.some((c) => c.name === 'run_builds');
  const pickedKeys = new Set(
    ev.createdTodoRows
      .map((t) => (t.buildAgentId !== null ? (keyOfId.get(t.buildAgentId) ?? null) : null))
      .filter((k): k is string => k !== null),
  );

  const pickedIds = ev.createdTodoRows
    .map((t) => t.buildAgentId)
    .filter((x): x is string => x !== null);

  const expectedKey = input.expect.agent;
  let decision: number;
  let why: string;
  if (input.expect.kind === 'dispatch') {
    const ok = dispatched && expectedKey != null && pickedKeys.has(expectedKey);
    decision = ok ? 1 : 0;
    why = ok
      ? `派给 ${expectedKey}（${rosterByKey.get(expectedKey)?.displayName}）id=${[...pickedIds].join(',')}`
      : `期望 ${expectedKey}，实际 dispatched=${dispatched} picked=[${[...pickedKeys].join(',') || '无'}] ids=[${pickedIds.join(',') || '无'}]`;
  } else {
    const replied = ev.assistantText !== '' && ev.stepStatus === 'done';
    decision = !dispatched && replied ? 1 : 0;
    why = !dispatched
      ? replied
        ? '未派工且有正文回复'
        : '未派工但无正文（空回合不算通过）'
      : '不该派工却调了 run_builds';
  }

  let receipt: number;
  if (input.expect.kind === 'dispatch') {
    const names = [...pickedKeys].map((k) => rosterByKey.get(k)?.displayName ?? k);
    receipt = names.length > 0 && names.some((n) => ev.assistantText.includes(n)) ? 1 : 0;
  } else {
    receipt = ev.assistantText !== '' ? 1 : 0;
  }

  return {
    grade: { decision_ok: decision, receipt_ok: receipt },
    explanation: { decision_ok: why },
  };
}
