#!/usr/bin/env -S pnpm exec tsx
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Case, gradeCase, type RosterAgent } from './grade.mts';
import type { TurnEvidence } from './stack.mts';

function referenceContext(roster: RosterAgent[]) {
  const agentIds: Record<string, string> = Object.fromEntries(
    roster.map((r) => [r.key, `agent-${r.key}`]),
  );
  const nameByKey = new Map(roster.map((r) => [r.key, r.displayName]));

  function pick(key: string): string {
    const id = agentIds[key];
    if (id === undefined) throw new Error(`Unknown roster key ${key}`);
    return id;
  }

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

  function oracle(c: Case): TurnEvidence {
    const ev = base();
    if (c.expect.kind === 'dispatch') {
      const key = c.expect.agent;
      if (key === undefined) throw new Error(`${c.id} declares dispatch without an agent`);
      ev.toolCalls = [
        { name: 'create_todo', arguments: {} },
        {
          name: 'run_builds',
          arguments: { todoIds: ['t1'], assignment: { build: { agentId: agentIds[key] } } },
        },
      ];
      ev.runBuildsArgs = [{ todoIds: ['t1'] }];
      ev.createdTodoIds = ['t1'];
      ev.createdTodoRows = [
        {
          id: 't1',
          title: 'x',
          spec: 'Original request: complete task a',
          buildAgentId: pick(key),
          projectId: 'p1',
          planAgentId: null,
          phase: 'queued',
        },
      ];
      ev.buildRows = [{ id: 'b1', todoId: 't1', withPlan: false, triggerSource: 'chief' }];
      ev.assistantText = `Task created for ${nameByKey.get(key)}.`;
    } else {
      ev.toolCalls = [{ name: 'todos', arguments: {} }];
      ev.assistantText = 'No active tasks.';
    }
    return ev;
  }

  function nullRun(): TurnEvidence {
    return base();
  }

  function misroute(c: Case): TurnEvidence {
    const ev = oracle(c);
    if (c.expect.kind !== 'dispatch') return ev;
    const other = roster.find((r) => r.key !== c.expect.agent);
    const row = ev.createdTodoRows[0];
    if (other === undefined || row === undefined)
      throw new Error('Misroute control requires another roster agent');
    row.buildAgentId = pick(other.key);
    ev.assistantText = `Task created for ${other.displayName}.`;
    return ev;
  }

  return { agentIds, oracle, nullRun, misroute };
}

export function checkOracleCase(input: Case, roster: RosterAgent[]): boolean {
  try {
    if (!input.expect || !['dispatch', 'hold'].includes(input.expect.kind)) return false;
    if (new Set(roster.map((agent) => agent.key)).size !== roster.length) return false;
    const { agentIds, oracle, nullRun, misroute } = referenceContext(roster);
    const decision = (evidence: TurnEvidence): number | undefined =>
      gradeCase(input, { evidence, agentIds }, roster).grade.decision_ok;
    return (
      decision(oracle(input)) === 1 &&
      decision(nullRun()) === 0 &&
      (input.expect.kind !== 'dispatch' || decision(misroute(input)) === 0)
    );
  } catch {
    return false;
  }
}

function runOracle(FLOW: string): void {
  const d = JSON.parse(readFileSync(join(FLOW, 'cases.json'), 'utf8')) as {
    roster: RosterAgent[];
    cases: Case[];
  };
  const roster = d.roster;
  const { agentIds, oracle, nullRun, misroute } = referenceContext(roster);
  interface Tally {
    n: number;
    decision: number;
    receipt: number;
  }
  const tally = (
    label: string,
    mk: (c: Case) => TurnEvidence,
    only?: (c: Case) => boolean,
  ): Tally => {
    let decision = 0;
    let receipt = 0;
    const bad: string[] = [];
    const scope = d.cases.filter((c) => only?.(c) ?? true);
    for (const c of scope) {
      const g = gradeCase(c, { evidence: mk(c), agentIds }, roster).grade;
      decision += g.decision_ok ?? 0;
      receipt += g.receipt_ok ?? 0;
      if (g.decision_ok !== 1) bad.push(`${c.id}(${g.decision_ok})`);
    }
    const t = { n: scope.length, decision, receipt };
    const pct = ((decision / t.n) * 100).toFixed(0);
    const pctR = ((receipt / t.n) * 100).toFixed(0);
    console.log(
      `${label.padEnd(10)} decision_ok ${decision}/${t.n} (${pct}%)  receipt_ok ${receipt}/${t.n} (${pctR}%)` +
        (bad.length ? `  failed: ${bad.slice(0, 8).join(' ')}${bad.length > 8 ? ' …' : ''}` : ''),
    );
    return t;
  };

  console.log(`flow=${FLOW}  ${d.cases.length} cases\n`);
  const o = tally('oracle', oracle);
  const n = tally('null', () => nullRun());
  const m = tally('misroute', misroute, (c) => c.expect.kind === 'dispatch');

  let exit = 0;
  if (o.decision !== o.n) {
    console.error(
      `\noracle below 100% (${o.decision}/${o.n}); fix the grader before spending a model run`,
    );
    exit = 1;
  }
  if (n.decision !== 0) {
    console.error(`\nnull control accepted (${n.decision}/${n.n}); an empty turn must fail`);
    exit = 1;
  }
  if (m.decision !== 0) {
    console.error(
      `\nmisroute control accepted (${m.decision}/${m.n}); wrong-agent dispatch must fail`,
    );
    exit = 1;
  }
  if (exit === 0) console.log('\noracle 100% / null 0% / misroute 0%; grader controls passed');
  process.exitCode = exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runOracle(process.argv[2] ?? '.claude/hillclimb/chief-dispatch');
  } catch (error) {
    console.error(`oracle-check: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
