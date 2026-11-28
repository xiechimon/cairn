import {
  AGENT_TOOL_PUSH,
  type ClaudeCodeReport,
  capabilityMissingLabels,
  GITHUB_PUSH_REPORT_MAX_AGE_MS,
  isBackendRuntimeId,
  isBuildStepKind,
  isInfoOutput,
  MACHINE_RUNTIMES,
  type MachineCapabilities,
  type MachineRuntime,
  MIN_SUPPORTED_RUNNER_PROTOCOL,
  MODEL_SOURCE_RUNTIME_LABELS,
  parseLocalMergeInstruction,
  parseVerifyPromptMeta,
  type RequiredCapabilities,
  type RunnerOs,
  runnerOsOf,
  runnerOutOfWindow,
  runsLegacyMacSandbox,
  type StepKind,
} from '@cairn/shared';
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { CODEX_PROVIDER_ID } from '../coordinator/codex-login.js';
import type { Db } from '../db/client.js';
import { build, machine, type project, provider, step, todo } from '../db/schema.js';
import { activeAntigravitySource } from './antigravity-subscriptions.js';
import { hasActiveClaudeSubscription } from './claude-subscriptions.js';
import { hasActiveDevinSubscription } from './devin-subscriptions.js';
import { activeDoubaoSource } from './doubao-subscriptions.js';
import { githubRepoOfProject } from './git.js';
import { type MachineRuntimeFacts, machineRuntimeAvailable } from './runtime-availability.js';

export { type MachineRuntimeFacts, machineRuntimeAvailable } from './runtime-availability.js';

export function stepRuntimeFor(
  agentProvider: string | null | undefined,
): 'pi' | 'claude-code' | 'gemini' | 'devin' | 'antigravity' | 'doubao' {
  if (agentProvider === 'gemini') return 'gemini';
  if (agentProvider === 'devin') return 'devin';
  if (agentProvider === 'antigravity') return 'antigravity';
  if (agentProvider === 'doubao') return 'doubao';
  return isBackendRuntimeId(agentProvider) ? 'claude-code' : 'pi';
}

export function machineRuntimeClaimable(
  machineRow: MachineRuntimeFacts,
  runtime: MachineRuntime,
): boolean {
  if (runtime === 'gemini') return true;
  if (runtime === 'doubao') {
    return (
      machineRow.capabilities?.doubao !== undefined &&
      machineRow.capabilities.doubao.platformSupported !== false
    );
  }
  return machineRuntimeAvailable(machineRow, runtime);
}

export function availableRuntimes(machineRow: MachineRuntimeFacts): MachineRuntime[] {
  return MACHINE_RUNTIMES.filter((runtime) => machineRuntimeAvailable(machineRow, runtime));
}

export function runnerCannotConnect(
  capabilities: MachineRuntimeFacts['capabilities'],
  runtime: ReturnType<typeof stepRuntimeFor>,
  antigravityHostLogin: boolean,
): boolean {
  const sandboxBlocksTls =
    runtime === 'devin' || (runtime === 'antigravity' && !antigravityHostLogin);
  return sandboxBlocksTls && runsLegacyMacSandbox(capabilities);
}

export function antigravityUsesHostLogin(db: Pick<Db, 'select'>, teamId: string): boolean {
  return activeAntigravitySource(db, teamId).kind === 'host';
}

export function runtimeGatePasses(
  machineRow: MachineRuntimeFacts,
  agentProvider: string | null | undefined,
  antigravityHostLogin = false,
): boolean {
  const runtime = stepRuntimeFor(agentProvider);
  return (
    machineRuntimeClaimable(machineRow, runtime) &&
    !runnerCannotConnect(machineRow.capabilities, runtime, antigravityHostLogin)
  );
}

export function claudeCodeUsable(db: Pick<Db, 'select'>, teamId: string): boolean {
  if (!hasActiveClaudeSubscription({ db }, teamId)) return false;
  return db
    .select({ claudeCodeReport: machine.claudeCodeReport, capabilities: machine.capabilities })
    .from(machine)
    .where(and(eq(machine.teamId, teamId), isNull(machine.retiredAt)))
    .all()
    .some((row) => machineRuntimeAvailable(row, 'claude-code'));
}

export function devinUsable(db: Pick<Db, 'select'>, teamId: string): boolean {
  if (!hasActiveDevinSubscription({ db }, teamId)) return false;
  return db
    .select({ claudeCodeReport: machine.claudeCodeReport, capabilities: machine.capabilities })
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.online, true), isNull(machine.retiredAt)))
    .all()
    .some((row) => machineRuntimeAvailable(row, 'devin'));
}

export function antigravityUsable(db: Pick<Db, 'select'>, teamId: string): boolean {
  const source = activeAntigravitySource(db, teamId);
  if (source.kind === 'none') return false;
  if (source.kind === 'host') return source.login.status === 'ok';
  return db
    .select({ claudeCodeReport: machine.claudeCodeReport, capabilities: machine.capabilities })
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.online, true), isNull(machine.retiredAt)))
    .all()
    .some(
      (row) =>
        machineRuntimeAvailable(row, 'antigravity') &&
        (source.kind === 'token' || row.capabilities?.antigravityOAuthProfile === true),
    );
}

export function doubaoUsable(db: Pick<Db, 'select'>, teamId: string): boolean {
  const source = activeDoubaoSource(db, teamId);
  return source.kind === 'host' && source.login.status === 'ok';
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
  if (runtime === 'doubao') {
    return `执行机 ${name} 暂不支持豆包 CLI（需受支持平台且执行机已升级到支持豆包的版本）。`;
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
  const doubaoModels = machineRow.capabilities?.doubao?.models ?? [];
  if (
    runtime === 'doubao' &&
    agentRow.modelId != null &&
    agentRow.modelId !== '' &&
    machineRow.capabilities?.doubao?.authenticated === true &&
    doubaoModels.length > 0 &&
    !doubaoModels.some((m) => m.id === agentRow.modelId)
  ) {
    return `执行机 ${machineRow.name} 的豆包账号未提供模型 ${agentRow.modelId}。`;
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
  antigravityHostLogin?: boolean;
  doubaoSubscriptionMissing?: boolean;
  doubaoLoginRequired?: boolean;
  githubPushMissing?: boolean;
}

export function githubPushCapable(
  capabilities: Pick<MachineCapabilities, 'githubPush'> | null | undefined,
  repo: string,
  now: number,
): boolean {
  const report = capabilities?.githubPush;
  if (report === undefined) return true;
  if (now - report.checkedAt > GITHUB_PUSH_REPORT_MAX_AGE_MS) return true;
  if (report.login === 'unauthenticated') return false;
  if (report.login !== 'ok') return true;
  const target = repo.toLowerCase();
  const entry = report.repos.find((item) => item.repo.toLowerCase() === target);
  if (entry === undefined) return true;
  if (now - entry.checkedAt > GITHUB_PUSH_REPORT_MAX_AGE_MS) return true;
  return entry.state !== 'no-write' && entry.state !== 'unauthenticated';
}

export function requiredGithubPushRepoForStep(input: {
  project: Pick<typeof project.$inferSelect, 'repoKind' | 'githubRepo'> | undefined;
  step: Pick<typeof step.$inferSelect, 'kind' | 'prompt'>;
  todo: Pick<typeof todo.$inferSelect, 'output'>;
  agentTools: readonly string[];
}): string | null {
  if (isBuildStepKind(input.step.kind) && isInfoOutput(input.todo.output)) return null;
  const repoRef = githubRepoOfProject(input.project);
  if (repoRef === null) return null;
  if (!input.agentTools.includes(AGENT_TOOL_PUSH)) return null;
  const slug = `${repoRef.owner}/${repoRef.repo}`;
  if (
    input.step.kind === 'build' ||
    input.step.kind === 'session' ||
    (input.step.kind === 'merge' && parseLocalMergeInstruction(input.step.prompt) === null)
  ) {
    return slug;
  }
  if (
    input.step.kind === 'verify' &&
    parseVerifyPromptMeta(input.step.prompt)?.evidence !== 'attachments'
  ) {
    return slug;
  }
  return null;
}

export type MachineIneligibility =
  | {
      kind:
        | 'runner-outdated'
        | 'runtime'
        | 'local-path'
        | 'claude-blocked'
        | 'claude-login'
        | 'devin-subscription'
        | 'antigravity-subscription'
        | 'doubao-subscription'
        | 'doubao-login-required'
        | 'github-push';
    }
  | { kind: 'model'; reason: string }
  | { kind: 'capability'; missing: string[] };

export function machineEligibility(input: EligibilityInput): MachineIneligibility | null {
  const { machine: machineRow, agent: agentRow, model } = input;
  const runtime = stepRuntimeFor(model.provider);
  if (
    runnerOutOfWindow(machineRow.capabilities, MIN_SUPPORTED_RUNNER_PROTOCOL) ||
    runnerCannotConnect(machineRow.capabilities, runtime, input.antigravityHostLogin === true)
  ) {
    return { kind: 'runner-outdated' };
  }
  if (!machineRuntimeClaimable(machineRow, runtime)) return { kind: 'runtime' };
  const modelReject =
    agentRow.machineId === machineRow.id && runtime !== 'doubao'
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
  if (runtime === 'doubao' && input.doubaoSubscriptionMissing === true) {
    return { kind: 'doubao-subscription' };
  }
  if (runtime === 'doubao' && input.doubaoLoginRequired === true) {
    return { kind: 'doubao-login-required' };
  }
  if (input.githubPushMissing === true) {
    return { kind: 'github-push' };
  }
  return null;
}
