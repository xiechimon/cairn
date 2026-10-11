// 认领资格判定原语（#881 单源）：步的 Agent 解析 + runtime 闸判。
//
// 为什么单列叶子：tryClaim（machines.ts，claim 面）与失联扫尾（builds.ts /
// chief.ts 的 sweep 面）要用**同一份判据**回答「这台机器开没开这条步的
// runtime」。#864 把「钉选机在线但 runtime 闸挡」登记为已知缝，原因正是
// 判定藏在 machines.ts 里、sweep 侧值 import 会成环（machines → builds/
// chief 是既有正向边）。下沉到本叶子（只依赖 db schema 与 shared，不 import
// 任何 service），claim 面与 sweep 面共用一份事实——两处判定一旦漂移，后果
// 是 sweep 误杀 claim 能领的步，或放过 claim 永远领不了的步（后者即无期
// pending 的缝本身）。

import {
  type Assignment,
  isBackendRuntimeId,
  parseReviewPromptMeta,
  type StepKind,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, type todo } from '../db/schema.js';

/** #682 enabledRuntimes 真闸——步的 runtime 判定（与 daemon runner 的
 *  backendFor 同律：agent provider ∈ BACKEND_RUNTIME_IDS → claude-code，
 *  其余（含 BYOK 自定义 provider）→ pi）。判定单源在此；claim 侧与 sweep
 *  侧（#881 钉选在线被挡判据）共同消费，机器侧开关 = machine.enabledRuntimes
 *  （PATCH 热写，秒级生效）。 */
export function stepRuntimeFor(agentProvider: string | null | undefined): 'pi' | 'claude-code' {
  return isBackendRuntimeId(agentProvider) ? 'claude-code' : 'pi';
}

/** 机器未开步所需的 runtime = 不可领该步（步留 pending 给能跑的机器——
 *  spec 11 A8「我可以决定本机跑 pi 还是 Claude Code 任务」的兑现位）。 */
export function runtimeGatePasses(
  machineRow: { enabledRuntimes: string[] },
  agentProvider: string | null | undefined,
): boolean {
  return machineRow.enabledRuntimes.includes(stepRuntimeFor(agentProvider));
}

/** 步的 Agent id 解析（槽位单源，无 DB 查询）：agentForStep 的解析半边
 *  （agent 表存在性查询留在那半边）。#1138 起计数面（agent 在跑计数）单独
 *  消费本原语——归账只要槽位指向，不需要行存在（指向已删 Agent 的在跑步
 *  恒不会被任何候选命中，存在性检查对计数无增益）。 */
export function agentIdForStep(
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  prompt: string | null = null,
): string | null {
  // review 步：agentId 经 prompt meta header 透出（r8 §3.1：模态选 Agent
  // 入队，不走 assignment 槽——执行/规划 Agent 不一定适合审核）。
  if (kind === 'review') {
    return parseReviewPromptMeta(prompt)?.agentId ?? null;
  }
  return planSlotFor(todoRow, kind, prompt)?.agentId ?? null;
}

/** 步的 Agent 解析（claim 载荷组装与 #881 sweep 判据共用）：
 *  - review 步：agentId 在 prompt meta header 里（M7 #330，step 表无 agentId
 *    列；测试已钉此口径，apps/server/test/review.test.ts）；
 *  - 其它步类：assignment 双槽按步类取（02 §4.2/r5 §5）——规划步 → plan 槽；
 *    执行/合并步 → build 槽（合并轮复用执行轮会话，同 Agent）。
 *  - 规划步的返工回落（#1204）：带续轮指令的规划步（revision 打回 / #330
 *    自动回流 / 失败重启轮 / #113 补写轮——prompt 非空即此族）plan 槽空时
 *    回落 build 槽（持有全部施工上下文，本就是最合适的 replan 者）；两槽
 *    皆空才无主。首轮规划步（prompt 空）不回落——#1104 B 的失败收尾是
 *    chief 400 自纠回路的既有语义，首跑行为是回归红线。
 *  无 Agent（槽空 / 槽指向已删 Agent / review meta 无 agentId）= null：claim
 *  面按失败收尾该步（#1104 B：applyStepFailure 落 build.errorMessage + todo
 *  → failed 终态，不再静默跳过候选）；sweep 面无从计算 runtime（不进闸挡判）。 */
export function agentForStep(
  db: Db,
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  /** review 步的 prompt（meta header 解析用）；规划步的返工判别（#1204：
   *  prompt 非空 = 带续轮指令的返工步，plan 槽空回落 build 槽）。 */
  prompt: string | null = null,
): typeof agent.$inferSelect | null {
  const agentId = agentIdForStep(todoRow, kind, prompt);
  if (agentId === null) return null;
  return db.select().from(agent).where(eq(agent.id, agentId)).get() ?? null;
}

/** 规划步的槽位解析（agentForStep 与 unassignedStepReason 同一映射，本文件
 *  单源）：返工步（prompt 非空）plan 槽空 → 回落 build 槽；首轮步与执行/
 *  合并步按步类直取。 */
function planSlotFor(
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  prompt: string | null,
): Assignment['plan'] | Assignment['build'] {
  if (kind !== 'plan') return todoRow.assignment?.build ?? null;
  if (todoRow.assignment?.plan != null) return todoRow.assignment.plan;
  return prompt !== null ? (todoRow.assignment?.build ?? null) : null;
}

/** #1104 B 无主步失败文案（agentForStep 返 null 的三族分类）：assignment 槽
 * 空 / 槽指向已删 Agent / review meta 缺 agentId。与 agentForStep 同文件同
 * 槽位映射（planSlotFor 单源），各族点名各自的补法，落 build.errorMessage
 * （看板失败终态可见），claim 面失败收尾时消费。#1204：规划步返工族文案
 * 按回落后的事实点名——两槽皆空说两槽（回落已试），首轮步维持 plan 槽单点。 */
export function unassignedStepReason(
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  prompt: string | null,
): string {
  if (kind === 'review') {
    return 'review 步无 Agent：审核 prompt meta 未携带 agentId，无人可领。';
  }
  if (kind !== 'plan') {
    const slot = todoRow.assignment?.build;
    if (slot?.agentId == null) {
      return `build 步无指派 Agent：assignment 的 build 槽为空，无人可领。指派 Agent 后重新运行任务。`;
    }
    return `build 步指派的 Agent 不存在（agentId ${slot.agentId} 已删除或不在本团队），无人可领。改派 Agent 后重新运行任务。`;
  }
  // 规划步：返工族（prompt 非空）回落后仍无主 = 两槽皆空；首轮族 = plan 槽空。
  if (todoRow.assignment?.plan?.agentId != null) {
    return `plan 步指派的 Agent 不存在（agentId ${todoRow.assignment.plan.agentId} 已删除或不在本团队），无人可领。改派 Agent 后重新运行任务。`;
  }
  if (prompt !== null) {
    return `plan 步无指派 Agent：assignment 的 plan 槽与 build 槽均为空（返工步已尝试回落 build 槽），无人可领。指派 Agent 后重新运行任务。`;
  }
  return `plan 步无指派 Agent：assignment 的 plan 槽为空，无人可领。指派 Agent 后重新运行任务。`;
}
