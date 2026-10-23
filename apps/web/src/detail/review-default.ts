// AI 审核默认选人（#509）：审核人经 {action:"review", agentId} 一次性确定，
// 本模块只决定**打开审核模态时默认选中谁**，以及**当前选中是否构成跨厂商独立
// 复核**。服务端不参与判定——用户显式传入的 agentId 一律照收（选人偏好不进
// 服务端策略，见 apps/server/test/review.test.ts 的两条受理测试）。
//
// 为什么要有这条偏好：同一家模型写方案、同一家模型审方案，是错误同源——模型
// 产出某个判断是因为它有某个具体误解，让它再审自己的产出，它会用同一个误解
// 读，于是读出「没问题」。换厂商才会在那处停下来问。
//
// 三态而非布尔：票面把「是否跨厂商」与「是否需声明同源」并列，但「不跨厂商」
// 有两种事实——**确证同源**（选中行与产出行的 provider 相同）与**无法判定**
// （产出侧或选中行没配 provider，或产出 Agent 不在可见候选集里）。后者说成
// 「同源」是编造一个没配过的厂商；两种都出声、都不声称独立（票面「不静默降
// 级」），措辞分档由呈现层落。
//
// 「产出步 Agent」判据复用服务端既有的那条确定性解析链：执行侧槽优先、规划槽
// 回退（apps/server/src/services/credentials.ts 的 `build ?? plan`）——不为审核
// 场景另发明一条。

import type { Assignment } from '@cairn/shared';

/** 审核候选行 = members 读面 memberType:"agent" 行的投影（含 provider）。 */
export interface ReviewCandidate {
  id: string;
  name: string;
  model: string;
  /** 服务商归属（members 读面 actor.provider）；null = 未配置。 */
  provider: string | null;
}

/** 独立性三态：跨厂商 / 确证同源 / 无法判定。 */
export type ReviewIndependence = 'cross-vendor' | 'same-vendor' | 'undetermined';

export interface ReviewDefault {
  /** 默认选中的候选 id；候选集为空时为 null。 */
  defaultAgentId: string | null;
  /** 产出步 Agent 的 provider（无基准时为 null）——呈现层拿它给「用户改选后」
   *  的每一次选中重新判定，与本模块的默认值判定共用同一条比较规则。 */
  producerProvider: string | null;
  /** 默认选中项的独立性。 */
  independence: ReviewIndependence;
}

/** 产出步 Agent id：执行侧槽优先、规划槽回退（与服务端 per-step 凭据解析
 *  同一条链）。两槽都空、或任务无指派 → null（无基准）。 */
function producerAgentIdOf(assignment: Assignment | null): string | null {
  return assignment?.build?.agentId ?? assignment?.plan?.agentId ?? null;
}

/** 单个候选相对产出侧的独立性。缺任一侧 provider 都判「无法判定」——未配置
 *  不等于跨厂商，也不等于同源。 */
export function classifyReviewChoice(
  candidate: ReviewCandidate,
  producerProvider: string | null,
): ReviewIndependence {
  if (producerProvider == null || candidate.provider == null) return 'undetermined';
  return candidate.provider === producerProvider ? 'same-vendor' : 'cross-vendor';
}

/** 稳定取首：按 id 字典序。票面示例给的是「成员列表既有顺序」，但成员读面
 *  的次序不是契约（票面 story 9 要的正是抗序抖），故改用与输入序无关的 id 序
 *  ——同一候选集无论怎么排都得到同一个默认值。 */
function stableFirst(rows: readonly ReviewCandidate[]): ReviewCandidate | null {
  let best: ReviewCandidate | null = null;
  for (const row of rows) {
    if (best === null || row.id < best.id) best = row;
  }
  return best;
}

/** 审核模态的默认选中值。候选集为空 → 无默认（呈现层按钮禁用）。
 *  #1250（ADR 0018 层 1）：assignment.review 槽（「默认谁审」的指派位）优先
 *  于 #509 的跨厂商偏好——用户显式指派压过启发式。 */
export function resolveReviewDefault(input: {
  candidates: readonly ReviewCandidate[];
  assignment: Assignment | null;
}): ReviewDefault {
  const { candidates, assignment } = input;
  const producerAgentId = producerAgentIdOf(assignment);
  const producerProvider =
    producerAgentId === null
      ? null
      : (candidates.find((row) => row.id === producerAgentId)?.provider ?? null);

  // review 槽指派在候选集内 → 直接选它（不在集内 = 指向已删 agent，回落
  // 既有偏好链）。
  const reviewSlotAgentId = assignment?.review?.agentId ?? null;
  const reviewSlotHit =
    reviewSlotAgentId !== null
      ? (candidates.find((row) => row.id === reviewSlotAgentId) ?? null)
      : null;
  if (reviewSlotHit !== null) {
    return {
      defaultAgentId: reviewSlotHit.id,
      producerProvider,
      independence: classifyReviewChoice(reviewSlotHit, producerProvider),
    };
  }

  const crossVendor = candidates.filter(
    (row) => classifyReviewChoice(row, producerProvider) === 'cross-vendor',
  );
  // 有跨厂商候选 → 只在其中取；没有 → 退到全集（降级，但呈现层会出声）。
  const picked = stableFirst(crossVendor.length > 0 ? crossVendor : candidates);
  if (picked === null) {
    return { defaultAgentId: null, producerProvider, independence: 'undetermined' };
  }
  return {
    defaultAgentId: picked.id,
    producerProvider,
    independence: classifyReviewChoice(picked, producerProvider),
  };
}
