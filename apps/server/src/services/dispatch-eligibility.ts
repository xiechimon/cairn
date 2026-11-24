import {
  type ClaudeCodeReport,
  capabilityMissingLabels,
  confinementDispatchReady,
  isBackendRuntimeId,
  MACHINE_RUNTIMES,
  type MachineCapabilities,
  type MachineRuntime,
  MODEL_SOURCE_RUNTIME_LABELS,
  type RequiredCapabilities,
  type RunnerOs,
  runnerOsOf,
  type StepKind,
} from '@cairn/shared';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { CODEX_PROVIDER_ID } from '../coordinator/codex-login.js';
import type { Db } from '../db/client.js';
import { build, machine, provider, step, todo } from '../db/schema.js';
import {
  activeAntigravitySubscriptionMode,
  antigravitySubscriptionRunsOn,
} from './antigravity-subscriptions.js';
import { hasActiveClaudeSubscription } from './claude-subscriptions.js';
import { hasActiveDevinSubscription } from './devin-subscriptions.js';

export function stepRuntimeFor(
  agentProvider: string | null | undefined,
): 'pi' | 'claude-code' | 'gemini' | 'devin' | 'antigravity' {
  if (agentProvider === 'gemini') return 'gemini';
  if (agentProvider === 'devin') return 'devin';
  if (agentProvider === 'antigravity') return 'antigravity';
  return isBackendRuntimeId(agentProvider) ? 'claude-code' : 'pi';
}

export interface MachineRuntimeFacts {
  claudeCodeReport: Pick<ClaudeCodeReport, 'installed'> | null;
  capabilities: Pick<MachineCapabilities, 'executor' | 'devin' | 'antigravity'> | null;
}

export function machineRuntimeAvailable(
  machineRow: MachineRuntimeFacts,
  runtime: MachineRuntime,
): boolean {
  if (runtime === 'pi') return true;
  if (runtime === 'gemini') return false;
  if (runtime === 'devin') return machineRow.capabilities?.devin?.installed === true;
  if (runtime === 'antigravity') return machineRow.capabilities?.antigravity?.installed === true;
  return (
    machineRow.claudeCodeReport?.installed === true || machineRow.capabilities?.executor === 'orb'
  );
}

export function machineRuntimeClaimable(
  machineRow: MachineRuntimeFacts,
  runtime: MachineRuntime,
): boolean {
  return runtime === 'gemini' || machineRuntimeAvailable(machineRow, runtime);
}

export function availableRuntimes(machineRow: MachineRuntimeFacts): MachineRuntime[] {
  return MACHINE_RUNTIMES.filter((runtime) => machineRuntimeAvailable(machineRow, runtime));
}

export function runtimeGatePasses(
  machineRow: MachineRuntimeFacts,
  agentProvider: string | null | undefined,
): boolean {
  return machineRuntimeClaimable(machineRow, stepRuntimeFor(agentProvider));
}

export function claudeCodeUsable(db: Pick<Db, 'select'>, teamId: string): boolean {
  if (!hasActiveClaudeSubscription({ db }, teamId)) return false;
  return db
    .select({ claudeCodeReport: machine.claudeCodeReport, capabilities: machine.capabilities })
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all()
    .some((row) => machineRuntimeAvailable(row, 'claude-code'));
}

export function devinUsable(db: Pick<Db, 'select'>, teamId: string): boolean {
  if (!hasActiveDevinSubscription({ db }, teamId)) return false;
  return db
    .select({ claudeCodeReport: machine.claudeCodeReport, capabilities: machine.capabilities })
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.online, true)))
    .all()
    .some((row) => machineRuntimeAvailable(row, 'devin'));
}

export function antigravityUsable(db: Pick<Db, 'select'>, teamId: string): boolean {
  const mode = activeAntigravitySubscriptionMode({ db }, teamId);
  if (mode === 'none') return false;
  return db
    .select({ claudeCodeReport: machine.claudeCodeReport, capabilities: machine.capabilities })
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.online, true)))
    .all()
    .some(
      (row) =>
        machineRuntimeAvailable(row, 'antigravity') &&
        antigravitySubscriptionRunsOn(mode, row.capabilities),
    );
}

export function codexProviderKeyed(db: Pick<Db, 'select'>, teamId: string): boolean {
  return (
    db
      .select({ id: provider.id })
      .from(provider)
      .where(
        and(
          eq(provider.teamId, teamId),
          eq(provider.providerId, CODEX_PROVIDER_ID),
          isNotNull(provider.apiKeyCipher),
        ),
      )
      .get() !== undefined
  );
}

function runtimeMissingReason(name: string, runtime: MachineRuntime): string {
  if (runtime === 'devin') {
    return `执行机 ${name} 尚未安装 Devin（托管下载失败或未上线）：等它上线或重启执行机。`;
  }
  if (runtime === 'antigravity') {
    return `执行机 ${name} 尚未安装 Antigravity（agy 未检测到且托管下载失败或未上线）：请安装 agy 或重启执行机。`;
  }
  return `执行机 ${name} 上没有检测到 ${MODEL_SOURCE_RUNTIME_LABELS[runtime]}：安装后重启执行机。`;
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
  return `${kind} step has nothing to run it: add a model provider, a Claude subscription and a Runner with Claude Code, or a Devin subscription and a Runner with Devin, in settings, then rerun the task.`;
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
  if (!machineRuntimeClaimable(machineRow, runtime)) {
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
  claudeSubscriptionMissing: boolean;
  devinSubscriptionMissing: boolean;
  antigravitySubscriptionMissing?: boolean;
}

export type MachineIneligibility =
  | {
      kind:
        | 'confinement'
        | 'runtime'
        | 'local-path'
        | 'claude-blocked'
        | 'claude-login'
        | 'devin-subscription'
        | 'antigravity-subscription';
    }
  | { kind: 'model'; reason: string }
  | { kind: 'capability'; missing: string[] };

export function machineEligibility(input: EligibilityInput): MachineIneligibility | null {
  const { machine: machineRow, agent: agentRow, model } = input;
  const runtime = stepRuntimeFor(model.provider);
  if (!machineRuntimeClaimable(machineRow, runtime)) return { kind: 'runtime' };
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
  if (runtime === 'claude-code' && input.claudeSubscriptionMissing) return { kind: 'claude-login' };
  if (runtime === 'devin' && input.devinSubscriptionMissing) {
    return { kind: 'devin-subscription' };
  }
  if (runtime === 'antigravity' && input.antigravitySubscriptionMissing === true) {
    return { kind: 'antigravity-subscription' };
  }
  if (!confinementDispatchReady(machineRow.capabilities)) return { kind: 'confinement' };
  return null;
}
