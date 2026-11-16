import {
  type ClaudeCodeReport,
  capabilityMissingLabels,
  claudeLoginBlocksClaim,
  confinementDispatchReady,
  isBackendRuntimeId,
  MACHINE_RUNTIMES,
  type MachineCapabilities,
  type MachineHardware,
  type MachineRuntime,
  MODEL_SOURCE_RUNTIME_LABELS,
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

export interface MachineRuntimeFacts {
  claudeCodeReport: Pick<ClaudeCodeReport, 'installed'> | null;
  capabilities: Pick<MachineCapabilities, 'executor'> | null;
}

export function machineRuntimeAvailable(
  machineRow: MachineRuntimeFacts,
  runtime: 'pi' | 'claude-code' | 'gemini',
): boolean {
  if (runtime === 'pi') return true;
  if (runtime === 'gemini') return false;
  return (
    machineRow.claudeCodeReport?.installed === true || machineRow.capabilities?.executor === 'orb'
  );
}

export function availableRuntimes(machineRow: MachineRuntimeFacts): MachineRuntime[] {
  return MACHINE_RUNTIMES.filter((runtime) => machineRuntimeAvailable(machineRow, runtime));
}

export function runtimeGatePasses(
  machineRow: MachineRuntimeFacts,
  agentProvider: string | null | undefined,
): boolean {
  return machineRuntimeAvailable(machineRow, stepRuntimeFor(agentProvider));
}

export function claudeCodeLoginBlocked(
  report: Pick<ClaudeCodeReport, 'auth' | 'login'> | null | undefined,
  hasSubscription: boolean,
  now: number,
): boolean {
  if (hasSubscription) return false;
  return report?.auth?.state === 'not-logged-in' || claudeLoginBlocksClaim(report?.login, now);
}

function runtimeMissingReason(name: string, runtime: 'pi' | 'claude-code' | 'gemini'): string {
  return runtime === 'gemini'
    ? `执行机 ${name} 不能运行 Gemini：它的权限请求还没接入命令闸。`
    : `执行机 ${name} 上没有检测到 ${MODEL_SOURCE_RUNTIME_LABELS[runtime]}：装好后重启执行机。`;
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

export function unassignedStepReason(kind: StepKind): string {
  if (kind === 'review') {
    return 'review step has no review routing rule: add a `review` routing rule in routing settings, then rerun the task.';
  }
  return `${kind} step has nothing to run it: add a model provider, or a Runner with Claude Code, in settings, then rerun the task.`;
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
    claudeCodeReport: ClaudeCodeReport | null;
    capabilities: MachineCapabilities | null;
  },
  agentRow: { provider: string | null | undefined; modelId: string | null | undefined },
  catalog?: ReadonlyArray<{ id: string; liveness?: 'alive' | 'dead' | 'unknown' }>,
): string | null {
  const runtime = stepRuntimeFor(agentRow.provider);
  if (!machineRuntimeAvailable(machineRow, runtime)) {
    return runtimeMissingReason(machineRow.name, runtime);
  }
  if (
    runtime === 'claude-code' &&
    machineRow.capabilities?.executor !== 'orb' &&
    agentRow.modelId != null &&
    agentRow.modelId !== ''
  ) {
    const report = machineRow.claudeCodeReport;
    const catalogEntry = catalog?.find((m) => m.id === agentRow.modelId);
    if (catalogEntry !== undefined && catalogEntry.liveness === 'dead') {
      return `执行机 ${machineRow.name} 的模型 ${agentRow.modelId} 已被上游下架（/v1/messages 404）。换一个活模型，或联系上游恢复上架。`;
    }
    if (catalogEntry !== undefined) {
      return null;
    }
    if (report == null) {
      return `执行机 ${machineRow.name} 尚未上报模型清单（后台服务版本过旧或未上线），无法校验模型 ${agentRow.modelId}。`;
    }
    if (!report.installed || !report.models.some((m) => m.id === agentRow.modelId)) {
      return `执行机 ${machineRow.name} 未配置模型 ${agentRow.modelId}（在该执行机的 ~/.claude/settings.json 配上，或在路由规则里换模型）。`;
    }
  }
  return null;
}

export interface EligibilityInput {
  machine: {
    id: string;
    name: string;
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
}

export type MachineIneligibility =
  | {
      kind: 'confinement' | 'runtime' | 'local-path' | 'claude-blocked' | 'claude-login';
    }
  | { kind: 'model'; reason: string }
  | { kind: 'capability'; missing: string[] };

export function machineEligibility(input: EligibilityInput): MachineIneligibility | null {
  const { machine: machineRow, agent: agentRow, model } = input;
  const runtime = stepRuntimeFor(model.provider);
  if (!machineRuntimeAvailable(machineRow, runtime)) return { kind: 'runtime' };
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
