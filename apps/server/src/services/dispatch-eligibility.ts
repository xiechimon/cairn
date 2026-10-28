import {
  type Assignment,
  CHIEF_DIGEST_THREAD_ID_PREFIX,
  type ClaudeCodeReport,
  capabilityMissingLabels,
  isBackendRuntimeId,
  isPlanFirstRoundWithLessons,
  type MachineCapabilities,
  type MachineHardware,
  parseReviewPromptMeta,
  type RequiredCapabilities,
  type StepKind,
} from '@cairn/shared';
import { and, eq, like, ne, not } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, build, chief, chiefThread, step, todo } from '../db/schema.js';

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
): { mcpServers: string[]; models: string[] } {
  if (required == null) return { mcpServers: [], models: [] };
  const reportedMcp = machineRow.capabilities?.mcpServers;
  const reportedModels = machineRow.claudeCodeReport?.models;
  return {
    mcpServers:
      reportedMcp === undefined
        ? []
        : (required.mcpServers ?? [])
            .map((slug) => slug.toLowerCase())
            .filter((slug) => !reportedMcp.includes(slug)),
    models:
      reportedModels === undefined
        ? []
        : (required.models ?? []).filter((id) => !reportedModels.some((m) => m.id === id)),
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

export function agentIdForStep(
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  prompt: string | null = null,
): string | null {
  if (kind === 'review') {
    return parseReviewPromptMeta(prompt)?.agentId ?? null;
  }
  if (kind === 'verify') {
    return todoRow.assignment?.verify?.agentId ?? null;
  }
  return planSlotFor(todoRow, kind, prompt)?.agentId ?? null;
}

export function agentForStep(
  db: Db,
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  prompt: string | null = null,
): typeof agent.$inferSelect | null {
  const agentId = agentIdForStep(todoRow, kind, prompt);
  if (agentId === null) return null;
  return db.select().from(agent).where(eq(agent.id, agentId)).get() ?? null;
}

function planSlotFor(
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  prompt: string | null,
): Assignment['plan'] | Assignment['build'] {
  if (kind !== 'plan') return todoRow.assignment?.build ?? null;
  if (todoRow.assignment?.plan != null) return todoRow.assignment.plan;
  return isReworkPlanPrompt(prompt) ? (todoRow.assignment?.build ?? null) : null;
}

function isReworkPlanPrompt(prompt: string | null): boolean {
  return prompt !== null && !isPlanFirstRoundWithLessons(prompt);
}

export function unassignedStepReason(
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  prompt: string | null,
): string {
  if (kind === 'review') {
    return 'review 步无 Agent：审核 prompt meta 未携带 agentId，无人可领。';
  }
  if (kind === 'verify') {
    const slot = todoRow.assignment?.verify;
    if (slot?.agentId == null) {
      return 'verify 步无指派 Agent：assignment 的 verify 槽为空，无人可领。指派 Verifier（assignment.verify 槽）后重新运行任务。';
    }
    return `verify 步指派的 Agent 不存在（agentId ${slot.agentId} 已删除或不在本团队），无人可领。改派 Verifier 后重新运行任务。`;
  }
  if (kind !== 'plan') {
    const slot = todoRow.assignment?.build;
    if (slot?.agentId == null) {
      return `build 步无指派 Agent：assignment 的 build 槽为空，无人可领。指派 Agent 后重新运行任务。`;
    }
    return `build 步指派的 Agent 不存在（agentId ${slot.agentId} 已删除或不在本团队），无人可领。改派 Agent 后重新运行任务。`;
  }
  if (todoRow.assignment?.plan?.agentId != null) {
    return `plan 步指派的 Agent 不存在（agentId ${todoRow.assignment.plan.agentId} 已删除或不在本团队），无人可领。改派 Agent 后重新运行任务。`;
  }
  if (isReworkPlanPrompt(prompt)) {
    return `plan 步无指派 Agent：assignment 的 plan 槽与 build 槽均为空（返工步已尝试回落 build 槽），无人可领。指派 Agent 后重新运行任务。`;
  }
  return `plan 步无指派 Agent：assignment 的 plan 槽为空，无人可领。指派 Agent 后重新运行任务。`;
}

export function machineRunningCount(db: Db, machineId: string): number {
  return db
    .select({ id: step.id })
    .from(step)
    .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed')))
    .all().length;
}

export function agentRunningCount(db: Db, agentId: string): number {
  const rows = db
    .select({ kind: step.kind, prompt: step.prompt, todoRow: todo })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'claimed'), ne(step.kind, 'chief')))
    .all();
  const workerCount = rows.filter(
    (r) => agentIdForStep(r.todoRow, r.kind, r.prompt) === agentId,
  ).length;
  const chiefCount = db
    .select({ id: step.id })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .innerJoin(chief, eq(chiefThread.chiefId, chief.id))
    .where(
      and(
        eq(step.status, 'claimed'),
        eq(step.kind, 'chief'),
        eq(chief.agentId, agentId),
        not(like(step.buildId, `${CHIEF_DIGEST_THREAD_ID_PREFIX}%`)),
      ),
    )
    .all().length;
  return workerCount + chiefCount;
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
      return `机器 ${machineRow.name} 未配置模型 ${agentRow.modelId}（在该机 ~/.claude/settings.json 配上，或为 agent 换模型）。`;
    }
  }
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
