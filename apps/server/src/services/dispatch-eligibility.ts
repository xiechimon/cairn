import {
  type ClaudeCodeReport,
  capabilityMissingLabels,
  confinementDispatchReady,
  isBackendRuntimeId,
  type MachineCapabilities,
  type MachineHardware,
  type RequiredCapabilities,
  type RunnerOs,
  runnerOsOf,
  type StepKind,
} from '@cairn/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, step, todo } from '../db/schema.js';

export function stepRuntimeFor(
  agentProvider: string | null | undefined,
): 'pi' | 'claude-code' | 'gemini' {
  if (agentProvider === 'gemini') return 'gemini';
  return isBackendRuntimeId(agentProvider) ? 'claude-code' : 'pi';
}

export function runtimeGatePasses(
  machineRow: { enabledRuntimes: readonly string[] },
  agentProvider: string | null | undefined,
): boolean {
  return machineRow.enabledRuntimes.includes(stepRuntimeFor(agentProvider));
}

export interface MachineCapabilityFacts {
  capabilities: MachineCapabilities | null;
  claudeCodeReport: { models: { id: string }[] } | null;
}

export function missingCapabilityItems(
  machineRow: MachineCapabilityFacts,
  required: RequiredCapabilities | null | undefined,
): { mcpServers: string[]; models: string[]; executor?: 'orb'; os?: RunnerOs } {
  if (required == null) return { mcpServers: [], models: [] };
  const reportedMcp = machineRow.capabilities?.mcpServers;
  const reportedModels = machineRow.claudeCodeReport?.models;
  const executorMissing =
    required.executor === 'orb' && machineRow.capabilities?.executor !== 'orb';
  const osMissing =
    required.os !== undefined && runnerOsOf(machineRow.capabilities) !== required.os;
  return {
    ...(executorMissing ? { executor: 'orb' as const } : {}),
    ...(osMissing ? { os: required.os } : {}),
    mcpServers: (required.mcpServers ?? [])
      .map((slug) => slug.toLowerCase())
      .filter((slug) => !(reportedMcp ?? []).includes(slug)),
    models: (required.models ?? []).filter(
      (id) => !(reportedModels ?? []).some((m) => m.id === id),
    ),
  };
}

export function missingCapabilities(
  machineRow: MachineCapabilityFacts,
  agentRow: { requiredCapabilities: RequiredCapabilities | null | undefined },
): string[] {
  return capabilityMissingLabels(missingCapabilityItems(machineRow, agentRow.requiredCapabilities));
}

export function capabilityGatePasses(
  machineRow: MachineCapabilityFacts,
  agentRow: { requiredCapabilities: RequiredCapabilities | null | undefined },
): boolean {
  return missingCapabilities(machineRow, agentRow).length === 0;
}

export function declaredMcpGaps(
  machineRow: { capabilities: MachineCapabilities | null },
  agentRow: { mcpServers: string[] },
): string[] | null {
  if (machineRow.capabilities === null) return null;
  const installed = machineRow.capabilities.mcpServers;
  return agentRow.mcpServers
    .map((slug) => slug.toLowerCase())
    .filter((slug) => !installed.includes(slug));
}

export function unassignedStepReason(kind: StepKind): string {
  const use = kind === 'review' ? 'review' : 'session';
  return `${kind} step has no ${use} routing rule: add a \`${use}\` routing rule in routing settings, then rerun the task.`;
}

export function machineRunningCount(db: Db, machineId: string): number {
  return db
    .select({ id: step.id })
    .from(step)
    .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed')))
    .all().length;
}

export function projectRunningCount(db: Pick<Db, 'select'>, projectId: string): number {
  return db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'claimed'), ne(step.kind, 'chief'), eq(todo.projectId, projectId)))
    .all().length;
}

export function homeMachineRejectReason(
  machineRow: {
    name: string;
    enabledRuntimes: string[];
    claudeCodeReport: ClaudeCodeReport | null;
  },
  agentRow: { provider: string | null | undefined; modelId: string | null | undefined },
  catalog?: ReadonlyArray<{ id: string; liveness?: 'alive' | 'dead' | 'unknown' }>,
): string | null {
  const runtime = stepRuntimeFor(agentRow.provider);
  if (!machineRow.enabledRuntimes.includes(runtime)) {
    return `机器 ${machineRow.name} 未启用 ${runtime} runtime（在机器页开启后再试）。`;
  }
  if (runtime === 'claude-code' && agentRow.modelId != null && agentRow.modelId !== '') {
    const report = machineRow.claudeCodeReport;
    const catalogEntry = catalog?.find((m) => m.id === agentRow.modelId);
    if (catalogEntry !== undefined && catalogEntry.liveness === 'dead') {
      return `机器 ${machineRow.name} 的模型 ${agentRow.modelId} 已被上游下架（/v1/messages 404）。换一个活模型，或联系上游恢复上架。`;
    }
    if (catalogEntry !== undefined) {
      return null;
    }
    if (report == null) {
      return `机器 ${machineRow.name} 尚未上报模型清单（daemon 版本过旧或未上线），无法校验模型 ${agentRow.modelId}。`;
    }
    if (!report.installed || !report.models.some((m) => m.id === agentRow.modelId)) {
      return `机器 ${machineRow.name} 未配置模型 ${agentRow.modelId}（在该机 ~/.claude/settings.json 配上，或在路由规则里换模型）。`;
    }
  }
  return null;
}

export interface EligibilityInput {
  machine: {
    id: string;
    name: string;
    enabledRuntimes: string[];
    claudeCodeReport: ClaudeCodeReport | null;
    capabilities: MachineCapabilities | null;
  };
  agent: {
    machineId: string | null;
    requiredCapabilities: RequiredCapabilities | null | undefined;
  };
  model: { provider: string | null | undefined; modelId: string | null | undefined };
  catalog: ReadonlyArray<{ id: string; liveness?: 'alive' | 'dead' | 'unknown' }>;
  localProject: boolean;
  claudeRateBlocked: boolean;
  claudeLoginBlocked: boolean;
  claudeUsageRefused: boolean;
}

export type MachineIneligibility =
  | {
      kind:
        | 'confinement'
        | 'runtime'
        | 'local-path'
        | 'claude-blocked'
        | 'claude-login'
        | 'claude-usage';
    }
  | { kind: 'model'; reason: string }
  | { kind: 'capability'; missing: string[] };

export function machineEligibility(input: EligibilityInput): MachineIneligibility | null {
  const { machine: machineRow, agent: agentRow, model } = input;
  const runtime = stepRuntimeFor(model.provider);
  if (!machineRow.enabledRuntimes.includes(runtime)) return { kind: 'runtime' };
  const modelReject =
    agentRow.machineId === machineRow.id
      ? null
      : homeMachineRejectReason(machineRow, model, input.catalog);
  if (modelReject !== null) return { kind: 'model', reason: modelReject };
  const missing = capabilityMissingLabels(
    missingCapabilityItems(machineRow, agentRow.requiredCapabilities),
  );
  if (missing.length > 0) return { kind: 'capability', missing };
  if (input.localProject && agentRow.machineId !== null && agentRow.machineId !== machineRow.id) {
    return { kind: 'local-path' };
  }
  if (runtime === 'claude-code' && input.claudeRateBlocked) return { kind: 'claude-blocked' };
  if (runtime === 'claude-code' && input.claudeLoginBlocked) return { kind: 'claude-login' };
  if (input.claudeUsageRefused) return { kind: 'claude-usage' };
  if (!confinementDispatchReady(machineRow.capabilities)) return { kind: 'confinement' };
  return null;
}

export const CONCURRENCY_FLOOR = 1;
export const CONCURRENCY_CEILING = 16;
export const MEMORY_GB_PER_SLOT = 2;
export const RANGE_MEMORY_GB_PER_SLOT = 1;
export const CONSERVATIVE_CONCURRENCY = 3;
export const FALLBACK_CONCURRENCY_MAX = 8;
export interface ConcurrencyRange {
  min: number;
  max: number;
}
export interface ConcurrencyRecommendation {
  value: number;
  source: 'measured' | 'estimate';
  range: ConcurrencyRange;
}

export function recommendMachineConcurrency(
  hardware: MachineHardware | null | undefined,
): ConcurrencyRecommendation {
  if (
    hardware == null ||
    !Number.isInteger(hardware.cpuCores) ||
    hardware.cpuCores < 1 ||
    hardware.memoryTotalMb === undefined ||
    !Number.isInteger(hardware.memoryTotalMb) ||
    hardware.memoryTotalMb < 0
  ) {
    return {
      value: CONSERVATIVE_CONCURRENCY,
      source: 'estimate',
      range: { min: CONCURRENCY_FLOOR, max: FALLBACK_CONCURRENCY_MAX },
    };
  }
  const memoryTotalMb = hardware.memoryTotalMb;
  const slots = (gbPerSlot: number) => Math.round(memoryTotalMb / (1024 * gbPerSlot));
  const clamp = (n: number) => Math.min(CONCURRENCY_CEILING, Math.max(CONCURRENCY_FLOOR, n));
  const value = clamp(Math.min(hardware.cpuCores, slots(MEMORY_GB_PER_SLOT)));
  const max = clamp(slots(RANGE_MEMORY_GB_PER_SLOT));
  return { value, source: 'measured', range: { min: CONCURRENCY_FLOOR, max } };
}
