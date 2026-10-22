// phase 九值流转（02 §4.1 权威 + §4.2 主时序/确认回路/失败重跑；验收 =
// 「phase 九值流转按 02 §4.1（含看板列折叠映射）」）。
// 看板列折叠映射单源在 shared boardColumnFor（#351 起单键 4 列）——
// server 不重复实现，仅消费与测试对拍。
// 边集出处：start→queued（02 §4.2 POST builds 入队）、claim→planning/building
// （机器领规划步/直执行步）、planning→confirm（plan 卡就绪）、confirm→building
// （确认 {action:"confirm"}）、confirm→planning（驳回 {action:"revision"} 重规划，
// r5 §4）、building→review、review→done（合并落地）、failed→queued（重跑，r3
// §3.7 新 conv/新 build）、failed→review（#702 条件边：build 腿已交付的 failed
// 恢复审核关口，恢复闸在 builds.ts）、{confirm,review,done}→queued（定时重跑：02 §9.2
// 触发→新 build 全新重跑；r3 §9 done 复跑实测「看板 #1 从已完成回到执行中→
// 待验收」、r5 §8 停驻轮旧 build Cancelled + 新轮）、*→closed（右键 Close，
// r1 §443）、closed→todo（reopen，MCP reopen_todos r5 §3.1）。未直接观测的边
// 标 [推断]（04 §3 不判负）。

import { canBoardDrop, type Phase } from '@pacman/shared';

export const PHASE_TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  // #1250（ADR 0018 层 2）：todo→confirm = chief split_todo 的父卡停驻边——
  // 拆解方案（父卡 plan 文档）就绪等人工过闸，语义与单卡 plan 就绪同关。
  todo: ['queued', 'confirm', 'closed'],
  // 机器 claim：规划步→planning / 直执行步（withPlan=false）→building（02 §4.2）。
  queued: ['planning', 'building', 'failed', 'closed'],
  planning: ['confirm', 'failed', 'closed'],
  // 确认→building；驳回→重规划（02 §4.2 确认回路，r5 §4 实走）；定时轮顶替→queued（r5 §8）。
  confirm: ['building', 'planning', 'failed', 'queued', 'closed'],
  // #1250（ADR 0018 层 2）：building→done = 拆卡父的自动收口边——子卡全部
  // done 时父卡由本边落地（父卡无自己的合并步，合并闸在子卡各自身上）。
  // 只被 settleSplitOnDone 消费；普通卡的 done 落地路径不变（review→done）。
  building: ['review', 'failed', 'done', 'closed'],
  // 完成+合并落地→done（02 §4.2：merge 202 delegated → 机器合并步 → done）；
  // 定时轮顶替→queued（r5 §8）。
  // M7 #330：review → planning = blocking finding 自动修订回路（agent 落
  // verdict → emit review_verdict 消息 → enqueue plan 重规划步 → 回待确认；
  // 同 conv continue session；r8 §3.1 实测 62）。
  // #1403：ci-loop 的 PR 对账也走 review→done（PR 已在 GitHub 合并进默认分支）
  // 与 review→failed（PR 关闭未合并）。
  review: ['done', 'failed', 'queued', 'planning', 'closed'],
  // 定时重跑→queued（r3 §9 实测：done todo 到点全新重跑回到执行中→待验收）；
  // 其余出边（reopen 类）未观测 [推断]。
  done: ['queued'],
  // 重跑 = POST builds 新 conv/新分支/新 build（r3 §3.7）；或搁置。
  // #702（#519 B-C17）：failed→review = 条件边——审核步之死不再锁死已完成
  // build 的合并路（build 步 done 且产物在〔PR/分支在〕时恢复审核关口，merge
  // 与只重跑审核两出口共用）。合法性数据依赖，静态表不可表达：边表只记
  // 「这条流转在相位机上合法」，数据闸进服务端判定（builds.ts 恢复判据
  // assertDeliveredBuild = 唯一放行点，restoreFailedReview 与经 GitHub API 合并共用；
  // REST merge / steps action review / chief merge_builds 三生产者同摄）；手动 PATCH 面拒收 failed→review（todos.ts）。恢复 ≠ 审核通过。
  // 系统漏斗仍拒 failed→done。手动列迁移另走 canBoardDrop（#1247）。
  failed: ['queued', 'closed', 'review'],
  closed: ['todo'], // reopen [推断]（MCP reopen_todos 词表证据，wire 未采）
};

export function canTransitionPhase(from: Phase, to: Phase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

/** 手动改相面（#160 看板拖拽）：HTTP PATCH phase = 用户手动列迁移
 *  （onboarding P2 r3 §3.10「在桌面端可将卡片直接拖拽至目标列」）。
 *  边级判据单源 = shared canBoardDrop（#753 per-source 矩阵：执行中 只吃
 *  待开始、待处理 只吃 已完成〔review 落点正名〕、failed→done 在手动面放行
 *  〔#1247〕；旧 #351 平面白名单被 2026-10-03/04 参考站重测推翻）。系统流
 *  （setTodoPhase / MCP update_todo）仍走上方漏斗不变。[设计]——官方 PATCH
 *  wire 未抓（2026-10-04 实测参考站落位走 POST complete/uncomplete 语义
 *  端点），手动面语义为复刻裁定。 */
export function canManualMovePhase(from: Phase, to: Phase): boolean {
  return canBoardDrop(from, to);
}

/** 非法流转 = 409 语义（错误形状 {error}，r5 §1 实测族）。 */
export class PhaseTransitionError extends Error {
  constructor(
    readonly from: Phase,
    readonly to: Phase,
  ) {
    super(`illegal phase transition: ${from} -> ${to}`);
    this.name = 'PhaseTransitionError';
  }
}

export function assertPhaseTransition(from: Phase, to: Phase): void {
  if (!canTransitionPhase(from, to)) throw new PhaseTransitionError(from, to);
}
