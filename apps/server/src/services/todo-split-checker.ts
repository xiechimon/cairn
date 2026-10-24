import type { MachineCapabilities, RequiredCapabilities } from '@cairn/shared';
import {
  missingCapabilities as missingMachineCapabilities,
  runtimeGatePasses,
} from './dispatch-eligibility.js';
import { pathHitsProtectedCategory } from './merge-gate/paths.js';

export interface SplitCheckerSubtodo {
  title: string;
  spec: string;
  agentId: string;
  blockedBy?: number[];
}

export interface SplitCheckerMachine {
  online: boolean;
  enabledRuntimes: readonly string[];
  capabilities: MachineCapabilities | null;
  claudeCodeReport: { models: { id: string }[] } | null;
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
}

export interface SplitCheckerResult {
  ok: boolean;
  reasons: string[];
}

export function checkSplitPlan(input: SplitCheckerInput): SplitCheckerResult {
  const { subtodos } = input;
  const reasons: string[] = [];
  const edges = new Map<number, number[]>();
  for (let index = 0; index < subtodos.length; index += 1) {
    for (const blockedBy of subtodos[index]?.blockedBy ?? []) {
      if (!Number.isInteger(blockedBy) || blockedBy < 1 || blockedBy > subtodos.length) {
        reasons.push(`blockedBy 序号超出范围：${blockedBy}`);
        continue;
      }
      if (blockedBy === index + 1) {
        reasons.push(`子卡 ${index + 1} 的 blockedBy 不能自指`);
        continue;
      }
      edges.set(blockedBy - 1, [...(edges.get(blockedBy - 1) ?? []), index]);
    }
  }
  const states = new Uint8Array(subtodos.length);
  const visit = (index: number): void => {
    if (states[index] === 1) {
      reasons.push('blockedBy 依赖成环');
      return;
    }
    if (states[index] === 2) return;
    states[index] = 1;
    for (const next of edges.get(index) ?? []) visit(next);
    states[index] = 2;
  };
  for (let index = 0; index < subtodos.length; index += 1) visit(index);
  const maxChildren = input.maxChildren ?? 6;
  if (subtodos.length > maxChildren) reasons.push(`子卡数量超过上限 ${maxChildren}`);
  const agents = new Map(input.agents.map((item) => [item.id, item]));
  for (const [index, subtodo] of subtodos.entries()) {
    const agent = agents.get(subtodo.agentId);
    if (agent === undefined) {
      reasons.push(`agent ${subtodo.agentId} 不存在`);
      continue;
    }
    if (agent.status !== 'active') reasons.push(`agent ${subtodo.agentId} 不可用`);
    if (agent.machine === null) {
      reasons.push(`agent ${subtodo.agentId} 没有归属机器`);
    } else {
      if (!agent.machine.online) reasons.push(`agent ${subtodo.agentId} 的机器离线`);
      if (!runtimeGatePasses(agent.machine, agent.provider)) {
        reasons.push(`agent ${subtodo.agentId} 的机器未启用所需 runtime`);
      }
      const missing = missingMachineCapabilities(agent.machine, agent);
      if (missing.length > 0)
        reasons.push(`agent ${subtodo.agentId} 缺少能力：${missing.join('、')}`);
    }
    const specPaths = subtodo.spec.match(/[A-Za-z0-9._/@+%-]+(?:\/[A-Za-z0-9._/@+%-]+)+/g) ?? [];
    const protectedPath = specPaths.find((path) => pathHitsProtectedCategory(path)) ?? null;
    if (protectedPath !== null) reasons.push(`子卡 ${index + 1} 命中保护路径 ${protectedPath}`);
  }
  return { ok: reasons.length === 0, reasons };
}
