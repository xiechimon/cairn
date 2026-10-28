import type { ClaudeCodeReport, MachineCapabilities, RequiredCapabilities } from '@cairn/shared';
import {
  homeMachineRejectReason,
  missingCapabilities as missingMachineCapabilities,
} from './dispatch-eligibility.js';
import { pathHitsProtectedCategory } from './merge-gate/paths.js';

export interface SplitCheckerSubtodo {
  title: string;
  spec: string;
  agentId: string;
  blockedBy?: number[];
}

export interface SplitCheckerMachine {
  name: string;
  online: boolean;
  enabledRuntimes: readonly string[];
  capabilities: MachineCapabilities | null;
  claudeCodeReport: ClaudeCodeReport | null;
}

export interface SplitCheckerAgent {
  id: string;
  status: string;
  provider: string | null;
  modelId: string | null;
  requiredCapabilities: RequiredCapabilities | null;
  machine: SplitCheckerMachine | null;
}

export interface SplitCheckerInput {
  subtodos: SplitCheckerSubtodo[];
  agents: SplitCheckerAgent[];
  maxChildren?: number;
  autonomyPaused?: boolean;
  modelCatalog?: ReadonlyArray<{ id: string; liveness?: 'alive' | 'dead' | 'unknown' }>;
}

export interface SplitCheckerResult {
  ok: boolean;
  reasons: string[];
}

export function checkSplitPlan(input: SplitCheckerInput): SplitCheckerResult {
  const { subtodos } = input;
  const reasons: string[] = [];
  if (input.autonomyPaused === true) reasons.push('team autonomy is paused');
  const edges = new Map<number, number[]>();
  for (let index = 0; index < subtodos.length; index += 1) {
    for (const blockedBy of subtodos[index]?.blockedBy ?? []) {
      if (!Number.isInteger(blockedBy) || blockedBy < 1 || blockedBy > subtodos.length) {
        reasons.push(`blockedBy index out of range: ${blockedBy}`);
        continue;
      }
      if (blockedBy === index + 1) {
        reasons.push(`child ${index + 1} blockedBy cannot reference itself`);
        continue;
      }
      edges.set(blockedBy - 1, [...(edges.get(blockedBy - 1) ?? []), index]);
    }
  }
  if (hasSplitDependencyCycle(edges, subtodos.length))
    reasons.push('blockedBy dependencies form a cycle');
  const maxChildren = input.maxChildren ?? 6;
  if (subtodos.length > maxChildren)
    reasons.push(`child count exceeds the limit of ${maxChildren}`);
  const agents = new Map(input.agents.map((item) => [item.id, item]));
  for (const [index, subtodo] of subtodos.entries()) {
    const agent = agents.get(subtodo.agentId);
    if (agent === undefined) {
      reasons.push(`agent ${subtodo.agentId} does not exist`);
      continue;
    }
    if (agent.status !== 'active') reasons.push(`agent ${subtodo.agentId} is not active`);
    if (agent.machine === null) {
      reasons.push(`agent ${subtodo.agentId} has no machine`);
    } else {
      if (!agent.machine.online) reasons.push(`agent ${subtodo.agentId} machine is offline`);
      const homeRejection = homeMachineRejectReason(
        { ...agent.machine, enabledRuntimes: [...agent.machine.enabledRuntimes] },
        agent,
        input.modelCatalog,
      );
      if (homeRejection !== null) reasons.push(`agent ${subtodo.agentId}: ${homeRejection}`);
      const missing = missingMachineCapabilities(agent.machine, agent);
      if (missing.length > 0)
        reasons.push(`agent ${subtodo.agentId} missing capabilities: ${missing.join(', ')}`);
    }
    const tokens = [
      ...subtodo.spec.matchAll(/`([^`]+)`|"([^"]+)"|'([^']+)'|([^\s`"'()[\]{},;!?]+)/gu),
    ];
    const specPaths = tokens
      .map((match) =>
        (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '')
          .replace(/[.:]+$/u, '')
          .replace(/^(?:\.\/)+/u, ''),
      )
      .filter((path) => path.includes('/') || path.includes('\\') || path.includes('.'));
    for (let tokenIndex = 0; tokenIndex + 1 < tokens.length; tokenIndex += 1) {
      const current = tokens[tokenIndex];
      const next = tokens[tokenIndex + 1];
      if (current?.[4] === undefined || next?.[4] === undefined) continue;
      const gap = subtodo.spec.slice(current.index + current[0].length, next.index);
      if (/[\\/]/u.test(current[4]) && /[.\\/]/u.test(next[4]) && /^\s+$/u.test(gap)) {
        specPaths.push(`${current[4]}${gap}${next[4]}`);
      }
    }
    const protectedPath =
      specPaths.find(
        (path) =>
          path.startsWith('/') || path.split('/').includes('..') || pathHitsProtectedCategory(path),
      ) ?? null;
    if (protectedPath !== null)
      reasons.push(`child ${index + 1} hits a protected path ${protectedPath}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function hasSplitDependencyCycle(
  edges: ReadonlyMap<number, readonly number[]>,
  nodeCount: number,
): boolean {
  const states = new Uint8Array(nodeCount);
  for (let root = 0; root < nodeCount; root += 1) {
    if (states[root] !== 0) continue;
    states[root] = 1;
    const stack = [{ node: root, edge: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const next = edges.get(frame.node)?.[frame.edge];
      if (next === undefined) {
        states[frame.node] = 2;
        stack.pop();
        continue;
      }
      frame.edge += 1;
      if (states[next] === 1) return true;
      if (states[next] === 0) {
        states[next] = 1;
        stack.push({ node: next, edge: 0 });
      }
    }
  }
  return false;
}
