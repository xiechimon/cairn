// 模型降级链（#1493）：主模型额度用完 / 模型 404 / 认证失败时，plan 与 build
// 步换到 agent.fallbackModels 里下一个健康的备选，同一步回 pending 重跑（换了
// provider 不续旧会话：claim 的会话续接只认同一 provider 跑出的会话）。口径定稿见 #1493 评论「实现口径」，要点：
//  - 只有 plan / build 步可换。review / verify / merge 步的结论是合并就绪闸
//    的输入（ADR 0021），换成弱模型等于让弱模型放行——只等不换；chief 步
//    靠会话续接，换模型 = 丢对话，也不换。
//  - 限流（quotaBlock kind=capacity）不换：一两分钟就恢复，换模型要丢上下文。
//  - 备选要过 agent 归属机的 runtime 闸、不是 dead 模型、provider 熔断器放行
//    （provider-health.ts）。同一步不重复试同一模型，链走完回落原有漏斗
//    （额度 → quota-wait；404 / 认证 → 失败漏斗），不回绕主模型。
//  - agent 没配 fallbackModels = 永不换（「显式指定的模型不降级」）。
//
// 分层：本模块只做判定（纯读 + 熔断器探测位），落库 / 会话行 / 通知 / 事件
// 由 machines.ts finishStep 执行（upsertMessage 等写面在那边，避免反向 import）。

import {
  classifyStepFailure,
  isProviderAuthFailure,
  type MachineDoneBody,
  type ModelRef,
  type StepKind,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type agent, machine, type StepFallbackRow, type step } from '../db/schema.js';
import { runtimeGatePasses } from './dispatch-eligibility.js';
import { getModelLiveness } from './model-liveness.js';
import { providerHealth } from './provider-health.js';

type AgentRow = typeof agent.$inferSelect;
type StepRow = typeof step.$inferSelect;

/** 允许降级的步类。 */
export const FALLBACK_STEP_KINDS: readonly StepKind[] = ['plan', 'build'];

export type FallbackTrigger = 'quota' | 'model_unavailable' | 'auth';

const TRIGGER_TEXT: Record<FallbackTrigger, string> = {
  quota: '额度用完',
  model_unavailable: '模型不可用',
  auth: '认证失败',
};

export function modelKey(m: ModelRef): string {
  return `${m.provider}/${m.modelId}`;
}

/** 本步实际跑的模型：降级后 = 备选，否则 = agent 主模型。 */
export function effectiveModel(
  agentRow: Pick<AgentRow, 'provider' | 'modelId'>,
  stepRow: Pick<StepRow, 'fallback'>,
): { provider: string | null; modelId: string | null } {
  return stepRow.fallback?.model ?? { provider: agentRow.provider, modelId: agentRow.modelId };
}

/** done(failed) → 降级触发类别；null = 不触发。结构化 quotaBlock 优先，缺席
 * （旧 daemon）走文本分类兜底。 */
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

/** provider 面的失败（熔断器连败计数）：额度空 / 限流 / 认证失败。模型 404
 * 是单个模型的事（model-liveness dead 标注），不算 provider 连败。 */
export function isProviderFailure(outcome: MachineDoneBody): boolean {
  if (outcome.status !== 'failed') return false;
  if (outcome.quotaBlock !== undefined) return true;
  const msg = outcome.errorMessage ?? '';
  const kind = classifyStepFailure(msg);
  return (
    kind === 'quota' || kind === 'capacity' || (kind === 'other' && isProviderAuthFailure(msg))
  );
}

/** 熔断器记账：成功清零，provider 面失败计一次。其余结局（停止、模型 404、
 * 普通失败、静默成功）不改状态，只释放可能占着的半开探测位。 */
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
  /** 写回 step.fallback 的新值。 */
  row: StepFallbackRow;
  /** 会话流 system 行 / 通知 snippet 文案。 */
  note: string;
}

/** 选下一个备选。null = 不降级（步类不许 / 不是触发类错误 / 没配备选 /
 * 链已走完）——调用方走原有漏斗。命中 half_open 的 provider 时占用其探测位。 */
export function planModelFallback(
  db: Db,
  stepRow: StepRow,
  agentRow: AgentRow | null,
  outcome: MachineDoneBody,
): FallbackPlan | null {
  if (!FALLBACK_STEP_KINDS.includes(stepRow.kind)) return null;
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
  // 判定序：便宜的纯判在前，熔断器探测位（有副作用）在最后——只有真被选中
  // 的那个备选会占探测位。
  const to = chain.find(
    (m) =>
      !tried.has(modelKey(m)) &&
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

// —— 0 token 静默失败 ——————————————————————————————————————————————————————

/** 静默成功判定：plan / build 步报成功、daemon 明说没有任何 assistant 输出
 * （noOutput）、所有 usage 行 input+output 都是 0、无变更。只看 usage 会误判：
 * pi 对不回 usage 的 relay 也报 0 token 行。旧 daemon 不带 noOutput = 不判。 */
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
