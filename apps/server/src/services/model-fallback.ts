import {
  classifyStepFailure,
  isBackendRuntimeId,
  isProviderAuthFailure,
  type MachineDoneBody,
  type ModelRef,
  type StepKind,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type agent, machine, type StepFallbackRow, type step } from '../db/schema.js';
import { runtimeGatePasses } from './dispatch-eligibility.js';
import { getModelLiveness } from './model-liveness.js';
import { providerHealth } from './provider-health.js';

type AgentRow = typeof agent.$inferSelect;
type StepRow = typeof step.$inferSelect;

export const FALLBACK_STEP_KINDS: readonly StepKind[] = ['plan', 'build'];

const MODEL_FALLBACK_STEP_KINDS: readonly StepKind[] = [...FALLBACK_STEP_KINDS, 'chief'];

export type FallbackTrigger = 'quota' | 'model_unavailable' | 'auth';

const TRIGGER_TEXT: Record<FallbackTrigger, string> = {
  quota: '额度用完',
  model_unavailable: '模型不可用',
  auth: '认证失败',
};

export function modelKey(m: ModelRef): string {
  return `${m.provider}/${m.modelId}`;
}

export function effectiveModel(
  agentRow: Pick<AgentRow, 'provider' | 'modelId'>,
  stepRow: Pick<StepRow, 'fallback'>,
): { provider: string | null; modelId: string | null } {
  return stepRow.fallback?.model ?? { provider: agentRow.provider, modelId: agentRow.modelId };
}

export function fallbackTriggerOf(outcome: MachineDoneBody): FallbackTrigger | null {
  if (outcome.status !== 'failed') return null;
  if (outcome.quotaBlock !== undefined) return outcome.quotaBlock.kind === 'quota' ? 'quota' : null;
  const msg = outcome.errorMessage ?? '';
  const kind = classifyStepFailure(msg);
  if (kind === 'quota') return 'quota';
  if (kind === 'model_unavailable') return 'model_unavailable';
  if (kind === 'other' && isProviderAuthFailure(msg)) return 'auth';
  return null;
}

export function isProviderFailure(outcome: MachineDoneBody): boolean {
  if (outcome.status !== 'failed') return false;
  if (outcome.quotaBlock !== undefined) return true;
  const msg = outcome.errorMessage ?? '';
  const kind = classifyStepFailure(msg);
  return (
    kind === 'quota' || kind === 'capacity' || (kind === 'other' && isProviderAuthFailure(msg))
  );
}

export function recordProviderOutcome(
  provider: string | null,
  outcome: MachineDoneBody,
  silent: boolean,
): void {
  if (provider === null) return;
  if (outcome.status === 'success' && !silent) providerHealth.recordSuccess(provider);
  else if (isProviderFailure(outcome)) providerHealth.recordFailure(provider);
  else providerHealth.releaseProbe(provider);
}

export interface FallbackPlan {
  trigger: FallbackTrigger;
  from: ModelRef;
  to: ModelRef;
  row: StepFallbackRow;
  note: string;
}

export function planModelFallback(
  db: Db,
  stepRow: StepRow,
  agentRow: AgentRow | null,
  outcome: MachineDoneBody,
): FallbackPlan | null {
  if (!MODEL_FALLBACK_STEP_KINDS.includes(stepRow.kind)) return null;
  const trigger = fallbackTriggerOf(outcome);
  if (trigger === null) return null;
  const chain = agentRow?.fallbackModels ?? [];
  if (agentRow === null || chain.length === 0) return null;
  if (!agentRow.provider || !agentRow.modelId || agentRow.machineId === null) return null;
  const machineRow = db.select().from(machine).where(eq(machine.id, agentRow.machineId)).get();
  if (machineRow === undefined) return null;
  const primary: ModelRef = { provider: agentRow.provider, modelId: agentRow.modelId };
  const from = stepRow.fallback?.model ?? primary;
  const tried = new Set(stepRow.fallback?.tried ?? [modelKey(primary)]);
  tried.add(modelKey(from));
  const sameRuntime = (m: ModelRef) =>
    stepRow.kind !== 'chief' ||
    isBackendRuntimeId(m.provider) === isBackendRuntimeId(primary.provider);
  const to = chain.find(
    (m) =>
      !tried.has(modelKey(m)) &&
      sameRuntime(m) &&
      runtimeGatePasses(machineRow, m.provider) &&
      getModelLiveness(m.provider, m.modelId) !== 'dead' &&
      providerHealth.tryAcquire(m.provider),
  );
  if (to === undefined) return null;
  return {
    trigger,
    from,
    to,
    note: `已换备用模型：${modelKey(from)} ${TRIGGER_TEXT[trigger]}，改用 ${modelKey(to)} 接着跑。换了 provider 不续旧会话，任务说明会重新带上。`,
    row: {
      model: { provider: to.provider, modelId: to.modelId },
      tried: [...tried, modelKey(to)],
      zeroUsageRetried: stepRow.fallback?.zeroUsageRetried ?? false,
    },
  };
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
