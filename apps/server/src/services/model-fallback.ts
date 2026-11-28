import {
  type ChiefModelFallbackReason,
  classifyStepFailure,
  claudeCodeUpdateRequired,
  claudeRateBlock,
  isProviderAuthFailure,
  isProviderOutage,
  type MachineDoneBody,
  type ModelRef,
  type StepKind,
  tierFallbackOrder,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type CommitEffects, runAfterCommit } from '../db/commit-effects.js';
import {
  machine,
  provider,
  type routingRule,
  type StepFallbackRow,
  type step,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { antigravitySubscriptionAllowsRunner } from './antigravity-subscriptions.js';
import { hasActiveClaudeSubscription } from './claude-subscriptions.js';
import { hasActiveDevinSubscription } from './devin-subscriptions.js';
import {
  antigravityUsesHostLogin,
  homeMachineRejectReason,
  runtimeGatePasses,
  stepRuntimeFor,
} from './dispatch-eligibility.js';
import { doubaoSubscriptionAllowsRunner } from './doubao-subscriptions.js';
import { getModelLiveness, mergedCatalogModels } from './model-liveness.js';
import { providerHealth } from './provider-health.js';
import {
  antigravityQuotaExhausted,
  isKeylessEndpoint,
  listConnectedTierSources,
  tierFallbackChain,
} from './source-tiers.js';
import type { StepQuota } from './step-groups/quota.js';

export interface FallbackAgentRow {
  teamId: string;
  machineId: string | null;
  provider: string | null;
  modelId: string | null;
  fallbackModels: (typeof routingRule.$inferSelect)['fallbackModels'];
}
type AgentRow = FallbackAgentRow;
type StepRow = typeof step.$inferSelect & Pick<StepQuota, 'fallback' | 'ranModel'>;

export const FALLBACK_STEP_KINDS: readonly StepKind[] = ['plan', 'build', 'session'];

const MODEL_FALLBACK_STEP_KINDS: readonly StepKind[] = [
  ...FALLBACK_STEP_KINDS,
  'chief',
  'review',
  'verify',
];

export type FallbackTrigger = ChiefModelFallbackReason;

const TRIGGER_TEXT: Record<FallbackTrigger, string> = {
  quota: '额度用完',
  model_unavailable: '模型不可用',
  auth: '认证失败',
  capacity: '限流',
  provider_outage: '服务暂时不可用',
  network: 'network connection failed',
};

const PROVIDER_WIDE_TRIGGERS: readonly FallbackTrigger[] = ['quota', 'auth', 'provider_outage'];

export function modelKey(m: ModelRef): string {
  return `${m.provider}/${m.modelId}`;
}

const GIT_FAILURE_PREFIX_RE = /^git [a-z-]+ failed \(/;

export function isGitFailure(message: string): boolean {
  return GIT_FAILURE_PREFIX_RE.test(message.trim());
}

export function effectiveModel(
  agentRow: Pick<AgentRow, 'provider' | 'modelId'>,
  stepRow: Pick<StepRow, 'fallback'>,
): { provider: string | null; modelId: string | null } {
  return stepRow.fallback?.model ?? { provider: agentRow.provider, modelId: agentRow.modelId };
}

export function ranModel(
  agentRow: Pick<AgentRow, 'provider' | 'modelId'> | null | undefined,
  stepRow: Pick<StepRow, 'ranModel' | 'fallback'>,
): { provider: string | null; modelId: string | null } {
  return (
    stepRow.ranModel ??
    stepRow.fallback?.model ?? {
      provider: agentRow?.provider ?? null,
      modelId: agentRow?.modelId ?? null,
    }
  );
}

export function fallbackTriggerOf(outcome: MachineDoneBody): FallbackTrigger | null {
  if (outcome.status !== 'failed') return null;
  if (outcome.quotaBlock !== undefined) {
    return outcome.quotaBlock.kind === 'quota' ? 'quota' : 'capacity';
  }
  const msg = outcome.errorMessage ?? '';
  if (isGitFailure(msg)) return null;
  const kind = classifyStepFailure(msg);
  if (kind === 'quota') return 'quota';
  if (kind === 'model_unavailable') return 'model_unavailable';
  if (kind === 'capacity') return 'capacity';
  if (kind === 'network') return 'network';
  if (kind === 'other' && isProviderAuthFailure(msg)) return 'auth';
  if (isProviderOutage(msg)) return 'provider_outage';
  return null;
}

export function isProviderFailure(outcome: MachineDoneBody): boolean {
  if (outcome.status !== 'failed') return false;
  if (outcome.quotaBlock !== undefined) return true;
  const msg = outcome.errorMessage ?? '';
  if (isGitFailure(msg)) return false;
  const kind = classifyStepFailure(msg);
  return (
    kind === 'quota' ||
    kind === 'capacity' ||
    kind === 'network' ||
    (kind === 'other' && (isProviderAuthFailure(msg) || isProviderOutage(msg)))
  );
}

export function recordProviderOutcome(
  teamId: string | null,
  provider: string | null,
  outcome: MachineDoneBody,
  silent: boolean,
): void {
  if (teamId === null || provider === null) return;
  const key = `${teamId}/${provider}`;
  if (outcome.status === 'success' && !silent) providerHealth.recordSuccess(key);
  else if (isProviderFailure(outcome)) providerHealth.recordFailure(key);
  else providerHealth.releaseProbe(key);
}

export interface FallbackPlan {
  trigger: FallbackTrigger;
  from: ModelRef;
  to: ModelRef;
  row: StepFallbackRow;
  note: string;
}

export function planModelFallback(
  deps: CommitEffects & { db: Db },
  stepRow: StepRow,
  agentRow: AgentRow | null,
  outcome: MachineDoneBody,
): FallbackPlan | null {
  if (!MODEL_FALLBACK_STEP_KINDS.includes(stepRow.kind)) return null;
  const trigger = fallbackTriggerOf(outcome);
  if (trigger === null) return null;
  const chain = agentRow?.fallbackModels ?? [];
  if (agentRow === null || chain.length === 0) return null;
  if (!agentRow.provider || !agentRow.modelId) return null;
  const hosts = deps.db
    .select()
    .from(machine)
    .where(
      agentRow.machineId === null
        ? eq(machine.teamId, agentRow.teamId)
        : eq(machine.id, agentRow.machineId),
    )
    .all();
  if (hosts.length === 0) return null;
  const primary: ModelRef = { provider: agentRow.provider, modelId: agentRow.modelId };
  const from = stepRow.ranModel ?? stepRow.fallback?.model ?? primary;
  const tried = new Set(stepRow.fallback?.tried ?? [modelKey(primary)]);
  tried.add(modelKey(from));
  const antigravityHostLogin = antigravityUsesHostLogin(deps.db, agentRow.teamId);
  const now = nowMs();
  const catalog = mergedCatalogModels(agentRow.teamId);
  const claudeSubOk = hasActiveClaudeSubscription({ db: deps.db }, agentRow.teamId);
  const devinSubOk = hasActiveDevinSubscription({ db: deps.db }, agentRow.teamId);
  const antigravityBlocked = antigravityQuotaExhausted(deps.db, agentRow.teamId, now);
  const providerWide = PROVIDER_WIDE_TRIGGERS.includes(trigger);
  const piProviders = new Map(
    deps.db
      .select({
        providerId: provider.providerId,
        models: provider.models,
        keyed: sql<number>`${provider.apiKeyCipher} is not null`,
      })
      .from(provider)
      .where(eq(provider.teamId, agentRow.teamId))
      .all()
      .map((row) => [row.providerId, row] as const),
  );
  const canHostRun = (host: (typeof hosts)[number], m: ModelRef) => {
    if (!runtimeGatePasses(host, m.provider, antigravityHostLogin)) return false;
    const runtime = stepRuntimeFor(m.provider);
    if (runtime === 'claude-code') {
      return (
        claudeSubOk &&
        claudeRateBlock(host.claudeRateLimits ?? [], now) === null &&
        claudeCodeUpdateRequired(m.modelId, host.claudeCodeReport?.bin?.version) === null &&
        (agentRow.machineId === host.id || homeMachineRejectReason(host, m, catalog) === null)
      );
    }
    if (runtime === 'antigravity') {
      return (
        !antigravityBlocked &&
        antigravitySubscriptionAllowsRunner(deps.db, agentRow.teamId, host.id, host.capabilities)
      );
    }
    if (runtime === 'devin') return devinSubOk;
    if (runtime === 'doubao') {
      return doubaoSubscriptionAllowsRunner(deps.db, agentRow.teamId, host.id, host.capabilities);
    }
    if (runtime === 'pi') {
      const pRow = piProviders.get(m.provider);
      return pRow !== undefined && (pRow.keyed === 1 || isKeylessEndpoint(m.provider));
    }
    return true;
  };
  const to = chain.find(
    (m) =>
      !tried.has(modelKey(m)) &&
      !(providerWide && m.provider === from.provider) &&
      hosts.some((host) => canHostRun(host, m)) &&
      getModelLiveness(agentRow.teamId, m.provider, m.modelId) !== 'dead' &&
      providerHealth.canAcquire(`${agentRow.teamId}/${m.provider}`),
  );
  if (to === undefined) return null;
  runAfterCommit(deps, 'reserveProviderProbe', () => {
    providerHealth.tryAcquire(`${agentRow.teamId}/${to.provider}`);
  });
  return {
    trigger,
    from,
    to,
    note: `已换备用模型：${modelKey(from)} ${TRIGGER_TEXT[trigger]}，改用 ${modelKey(to)} 继续运行。换了服务商不续旧会话，任务说明会重新带上。`,
    row: {
      model: { provider: to.provider, modelId: to.modelId },
      tried: [...tried, modelKey(to)],
      zeroUsageRetried: stepRow.fallback?.zeroUsageRetried ?? false,
    },
  };
}

export function withBackupChain<T extends FallbackAgentRow>(db: Db, agentRow: T): T {
  if (agentRow.fallbackModels !== null) return agentRow;
  const { provider, modelId } = agentRow;
  if (provider === null || modelId === null) return agentRow;
  const sources = listConnectedTierSources(db, agentRow.teamId, provider, modelId);
  const chain =
    sources[0]?.provider === provider
      ? tierFallbackChain(sources, 'standard', null)
      : sources.flatMap((source) =>
          tierFallbackOrder(source.tiers, 'standard').map((id) => ({
            provider: source.provider,
            modelId: id,
          })),
        );
  return { ...agentRow, fallbackModels: chain };
}

export function isZeroUsageSilentSuccess(kind: StepKind, outcome: MachineDoneBody): boolean {
  if (!FALLBACK_STEP_KINDS.includes(kind)) return false;
  if (outcome.status !== 'success' || outcome.hasChanges === true) return false;
  if (outcome.noOutput !== true) return false;
  return (outcome.usage ?? []).every((u) => u.input + u.output === 0);
}

export const ZERO_USAGE_RETRY_NOTE =
  '模型返回成功但用了 0 token、没有任何输出，按静默失败处理：同一模型重试一次。';
export const ZERO_USAGE_FAILURE =
  '模型连续两次返回成功但用了 0 token、没有任何输出（静默失败），步按失败收尾。';
