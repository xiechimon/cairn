// Board column model (issues #54 / #351): the 4 kanban columns are the
// folded view of the nine-value phase enum (02-架构平价 §4.1; 6→4 收敛 #351).
// Column names, dot colors and empty-state copy are canon (r2 §4.1, colors
// re-sampled from r7); 待处理 merges the old 待确认/待验收 gate columns plus
// failed — 方案确认、变更验收、失败重试都是等用户处理的事. `review` +
// awaitingReply folds into 待处理 too (r5b §3.15 / r7 01 observed), and the
// pinned group (failed / review-awaiting) rides its top (changelog
// 2026-09-12 pinning, rebound to 待处理 by #351). Card order inside a column
// = manual order from drag drops (#73), pinned group first in 待处理.

import { IN_PROGRESS_PHASES, type Phase } from '@pacman/shared';
import type { TodoRecord } from '../fixtures/records.js';
import { isInFlightPhase, PHASE_UI } from '../phase.js';

export interface BoardColumnDef {
  id: string;
  name: string;
  /** CSS var for the header dot fill. */
  dot: string;
  /** Verbatim empty-state copy (r2 §4.1; 待处理 row = #351). */
  empty: string;
  /** Extra header label, 已完成 only. */
  label?: string;
  /** Phase a cross-column drop writes (issue #73 manual 改相). Every column
   *  carries one since #753 (待处理 = `review`, reopen-to-review [设计]) —
   *  WHICH sources may drop is the per-card matrix in canDropOnColumn, not
   *  this field. */
  dropPhase: Phase;
  /** #616（todos.dev 2026-10-02 实测）：落位不直接写 dropPhase，而是把
   *  todo 交给 开始任务 dialog（#318 统一面）——确认（先做规划/立即执行）
   *  才经 startBuilds 落相位，取消 = 零提交。执行中独有：进该列 = 起一次
   *  build，需要 agent/机器指派，不是静默改相能承载的。 */
  startGate?: boolean;
  /** Which todos land in this column. */
  accepts: (todo: TodoRecord) => boolean;
}

/** The pinned group (changelog 2026-09-12: failed / review-awaiting "stays
 *  pinned to the top") — single source for the 待处理 column's accepts()
 *  and its render order (#351: rebound from 执行中 to 待处理). */
export function isPinnedBuilding(todo: TodoRecord): boolean {
  return todo.phase === 'failed' || (todo.phase === 'review' && todo.awaitingReply === true);
}

/** Column view order: pinned group first in 待处理, then the committed
 *  manual order (`orderIndex`, 01 §4.1); Array.sort is stable, so the
 *  all-zero fixture indices keep capture order untouched.
 *  #1247: 已完成 = phaseAt 倒序（最近完成在上）。新落卡 moveTodo 写最新
 *  phaseAt，自然渲到列顶；orderIndex 写回保留（schema 零改动，其余列照旧），
 *  但不再是 done 列显示序真值。 */
export function sortColumnTodos(column: BoardColumnDef, todos: TodoRecord[]): TodoRecord[] {
  // #1247 done 列分支：phaseAt 平局回落 orderIndex 升序（Array.sort 稳定，
  // capture 序兜底）。
  if (column.id === 'done') {
    return [...todos].sort((x, y) => y.phaseAt - x.phaseAt || x.orderIndex - y.orderIndex);
  }
  const pinnedRank = (t: TodoRecord) => (column.id === 'pending' && isPinnedBuilding(t) ? 0 : 1);
  return [...todos].sort((x, y) => pinnedRank(x) - pinnedRank(y) || x.orderIndex - y.orderIndex);
}

export const COLUMNS: BoardColumnDef[] = [
  {
    id: 'todo',
    dropPhase: 'todo',
    name: '待开始',
    dot: 'var(--col-dot-idle)',
    empty: '没有等待开始的任务',
    accepts: (t) => t.phase === 'todo' || t.phase === 'queued',
  },
  {
    id: 'building',
    dropPhase: 'building',
    startGate: true,
    name: '执行中',
    dot: 'var(--col-dot-building)',
    empty: '没有执行中的任务',
    accepts: (t) => isInFlightPhase(t.phase),
  },
  {
    id: 'pending',
    // #753（todos.dev 2026-10-03/04 live 重测，推翻 #351「待处理不作落点」）：
    // 已完成（有变更产物）→ 待处理 合法，落点正名 review = 重开回审核关口
    // [设计]（参考站 wire 未采到：其机器离线；其 done(有变更) 卡拖拽时本列
    // 戴 5%/10% 染色，无变更的 done 卡恒素面——hasChanges 闸在
    // canDropOnColumn）。唯一合法源列 = 已完成。
    dropPhase: 'review',
    name: '待处理',
    dot: 'var(--col-dot-confirm)',
    empty: '没有等你处理的任务',
    accepts: (t) => t.phase === 'confirm' || t.phase === 'review' || t.phase === 'failed',
  },
  {
    id: 'done',
    dropPhase: 'done',
    name: '已完成',
    dot: 'var(--col-dot-done)',
    empty: '最近 7 天没有完成的任务',
    label: '最近 7 天',
    accepts: (t) => t.phase === 'done',
  },
];

/** 落位合法矩阵（#753，todos.dev 2026-10-03/04 live 重测；shared canBoardDrop
 *  的卡面镜像——那边是相位级 raw PATCH 判据，这边吃整卡所以带数据位）：
 *  - 每张卡都可拖；源列恒素面（同列落位 = 无操作）；
 *  - 执行中 只吃 待开始（拖入 = 开始意图，board.tsx startGate 路由）；
 *    待处理/已完成 源对它恒素面（实测）；
 *  - 待处理 只吃 已完成 且 hasChanges（2026-10-04 实测：无变更的 done 卡
 *    拖拽时 待处理 恒素面）；待开始→待处理 恒素面（实测，#351 该对保留）；
 *  - 已完成 吃 待开始/执行中/待处理 全源。#1247 推翻 #702 的 failed 源例外：
 *    failed→done 开放为手动关边（确认闸 needsDoneGate 三相一律咬，写面
 *    POST /api/todos/:id/complete）；confirm/review→done 沿用 #753 边；
 *  - 执行中 源行未测（参考站机器离线）：沿用本仓既有语义 [设计]。 */
export function canDropOnColumn(todo: TodoRecord, columnId: string): boolean {
  const src = COLUMNS.find((c) => c.accepts(todo));
  const dst = COLUMNS.find((c) => c.id === columnId);
  if (src == null || dst == null || src.id === dst.id) return false;
  switch (dst.id) {
    case 'todo':
      return true;
    case 'building':
      return src.id === 'todo';
    case 'pending':
      return src.id === 'done' && todo.hasChanges === true;
    case 'done':
      return true;
    default:
      return false;
  }
}

/** 重置闸的 started 判据（#755，todos.dev 看板指南「已开始的卡片拖回待开始
 *  会重置任务」）：进行中相位（shared IN_PROGRESS_PHASES =
 *  queued/planning/building——注意 web 本地 IN_FLIGHT_PHASES 只含
 *  planning/building，那是「无主按钮」UI 谓词，不是开始谓词）或携带任何构建
 *  历史（latestBuildId / lastRunAt / hasPlan / hasChanges 任一位在位）。
 *  confirm/review/failed/done 但零历史 = 无可中断、无可清空，走静默改相。
 *  与 server isStartedTodoRow 同表（server test 与 columns.test 双面对拍）。 */
export function needsResetGate(todo: TodoRecord): boolean {
  if ((IN_PROGRESS_PHASES as readonly string[]).includes(todo.phase)) return true;
  return todo.latestBuildId != null || todo.lastRunAt != null || todo.hasChanges || todo.hasPlan;
}

/** done 落位闸判据（#901 起，#1247 收窄为三相恒闸）：待处理三相
 *  （confirm/review/failed）的卡拖向 已完成 = 手动关边，一律要显式确认弹层
 *  （复用 #755 reset 闸形态）；取消 = 零提交。判据不挂 hasChanges：failed
 *  墓碑卡 hasChanges=false 也要能关，且「中断在飞构建」的警示与有无产物
 *  无关（review 卡合并步在飞时该位未必真）——#892 的「无变更 confirm 卡
 *  静默清理」路径收进闸（+1 次确认点击，票面重新定义整条边为
 *  dialog-gated）。其余源（todo/queued/planning/building/done）拖 done 不闸。
 *  server 审计行面更宽（闸相位 done 落地一律落行，todos.ts updateTodo
 *  #902）：弹层是 UI 位，行是审计位，两判据不共用。 */
export function needsDoneGate(todo: TodoRecord): boolean {
  return todo.phase === 'confirm' || todo.phase === 'review' || todo.phase === 'failed';
}

/** Phase → primary card action, copy from the shared PHASE_UI table.
 *  Waiting-on-user todos get the ghost 回复 button (r3 §3.0 引导 P2 词表 +
 *  r5b §3.15). Done cards carry no button: 重开 lives only in the detail
 *  header (r7 §3.3) — the 01b/05b board captures show zero indigo pixels
 *  in the 已完成 column, so PHASE_UI[done].action must not leak here.
 *  Failed cards read `重试` while the detail header reads `重跑` (r8 §2.2
 *  vs §2.1 — a new instance of the CONTEXT.md two-word-list pattern:
 *  board card copy ≠ detail chip copy). */
export function cardAction(todo: TodoRecord): { kind: 'primary' | 'ghost'; label: string } | null {
  if (todo.awaitingReply === true) return { kind: 'ghost', label: '回复' };
  if (todo.phase === 'done') return null;
  // r8 §2.2 prose reads the card chip as a ghost button, but the 55
  // bitmap samples a solid #4e47dd fill with white ink — pixels win (04 A1)
  if (todo.phase === 'failed') return { kind: 'primary', label: '重试' };
  const label = PHASE_UI[todo.phase].action;
  return label == null ? null : { kind: 'primary', label };
}

/** Todos waiting on the user — the 工作台 nav badge. #351: the badge IS the
 *  待处理 column count, same accepts() predicate as the single source (so
 *  review+awaitingReply cards count too — the old badge skipped them while
 *  the fold parked them in 执行中, r8 55/57). */
export function attentionCount(todos: TodoRecord[]): number {
  const pending = COLUMNS.find((c) => c.id === 'pending');
  return pending == null ? 0 : todos.filter(pending.accepts).length;
}
