// Board column model (issues #54 / #351): the 4 kanban columns are the
// folded view of the nine-value phase enum (02-架构平价 §4.1; 6→4 收敛 #351).
// Column names are canon (r2 §4.1); header icons follow DESIGN.md 看板列.
// 待处理 merges the old 待确认/待验收 gate columns plus
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
  /** Header status icon (DESIGN.md 图标: dashed circle / activity / alert
   *  circle / circle check); `attention` paints it in the accent. */
  status: 'queued' | 'running' | 'attention' | 'done';
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

/** Column view order. 待处理 keeps the pinned group, then `orderIndex`.
 *  已完成 is completion time (`phaseAt` desc, #1247); `orderIndex` breaks ties.
 *  Other columns stay on `orderIndex` (01 §4.1). */
export function sortColumnTodos(column: BoardColumnDef, todos: TodoRecord[]): TodoRecord[] {
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
    status: 'queued',
    accepts: (t) => t.phase === 'todo',
  },
  {
    id: 'building',
    dropPhase: 'building',
    startGate: true,
    name: '执行中',
    status: 'running',
    // #1447：queued 已开始，停在它将要跑的那一步（参考站 2026-09-12）。
    // IN_FLIGHT_PHASES（静默对账闸门）仍只含 planning/building。
    accepts: (t) => t.phase === 'queued' || isInFlightPhase(t.phase),
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
    status: 'attention',
    accepts: (t) => t.phase === 'confirm' || t.phase === 'review' || t.phase === 'failed',
  },
  {
    id: 'done',
    dropPhase: 'done',
    name: '已完成',
    status: 'done',
    label: '最近 7 天',
    accepts: (t) => t.phase === 'done' || t.phase === 'closed',
  },
];

/** 落位合法矩阵（#753，todos.dev 2026-10-03/04 live 重测；shared canBoardDrop
 *  的卡面镜像——那边是相位级 raw PATCH 判据，这边吃整卡所以带数据位）：
 *  - 每张卡都可拖；源列恒素面（同列落位 = 无操作）；
 *  - 执行中 只吃 待开始（只住未开始的 todo 卡；拖入 = 开始意图，board.tsx
 *    startGate 路由，server orchestrate 只收 todo / failed）。queued 住执行中
 *    （#1447），对它是源列。待处理/已完成 源对它恒素面（实测）；
 *  - 待处理 只吃 已完成 且 hasChanges（2026-10-04 实测：无变更的 done 卡
 *    拖拽时 待处理 恒素面）；待开始→待处理 恒素面（实测，#351 该对保留）；
 *  - 已完成 吃 待开始/执行中/待处理，含 failed（#1247 手动关边，不看
 *    hasChanges）。系统漏斗仍拒 failed→done。落位前确认见 needsDoneGate。
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
 *  planning/building，那是「在飞、静默可疑」UI 谓词，不是开始谓词）或携带任何构建
 *  历史（latestBuildId / lastRunAt / hasPlan / hasChanges 任一位在位）。
 *  confirm/review/failed/done 但零历史 = 无可中断、无可清空，走静默改相。
 *  与 server isStartedTodoRow 同表（server test 与 columns.test 双面对拍）。 */
export function needsResetGate(todo: TodoRecord): boolean {
  if ((IN_PROGRESS_PHASES as readonly string[]).includes(todo.phase)) return true;
  return todo.latestBuildId != null || todo.lastRunAt != null || todo.hasChanges || todo.hasPlan;
}

/** Done-drop confirm (#1247). 待处理 (confirm / review / failed) 与执行中
 *  （queued / planning / building）拖向已完成都要确认。hasChanges 不参与。
 *  待开始（todo）仍静默直落。Cancel writes nothing. */
export function needsDoneGate(todo: TodoRecord): boolean {
  return (
    todo.phase === 'confirm' ||
    todo.phase === 'review' ||
    todo.phase === 'failed' ||
    (IN_PROGRESS_PHASES as readonly string[]).includes(todo.phase)
  );
}

/** In-flight done gate (#1247)：只给「先停构建再标完成 / 取消」两钮。 */
export function isInflightDoneGate(todo: TodoRecord): boolean {
  return (IN_PROGRESS_PHASES as readonly string[]).includes(todo.phase);
}

/** Which footer a board card carries (DESIGN.md 任务卡). Action copy:
 *  failed cards read `重试` while the detail header reads `重跑` (r8 §2.2
 *  vs §2.1, the CONTEXT.md two-word-list pattern). Done cards carry no
 *  action: 重开 lives only in the detail header (r7 §3.3). A queued card
 *  takes the running footer in its waiting form (#1447). */
export type CardFace =
  | { kind: 'todo'; action: string | null }
  | { kind: 'running' }
  | { kind: 'attention'; need: 'failed' | 'confirm' | 'review' | 'reply' }
  | { kind: 'done'; canceled: boolean };

export function cardFace(todo: TodoRecord): CardFace {
  if (todo.awaitingReply === true) return { kind: 'attention', need: 'reply' };
  switch (todo.phase) {
    case 'todo':
      return { kind: 'todo', action: PHASE_UI.todo.action };
    case 'queued':
    case 'planning':
    case 'building':
      return { kind: 'running' };
    case 'failed':
    case 'confirm':
    case 'review':
      return { kind: 'attention', need: todo.phase };
    case 'done':
      return { kind: 'done', canceled: false };
    case 'closed':
      return { kind: 'done', canceled: true };
  }
}

/** Todos waiting on the user — the 工作台 nav badge. #351: the badge IS the
 *  待处理 column count, same accepts() predicate as the single source (so
 *  review+awaitingReply cards count too — the old badge skipped them while
 *  the fold parked them in 执行中, r8 55/57). */
export function attentionCount(todos: TodoRecord[]): number {
  return countInColumn(todos, 'pending');
}

export function countInColumn(todos: TodoRecord[], columnId: string): number {
  const column = COLUMNS.find((c) => c.id === columnId);
  return column == null ? 0 : todos.filter(column.accepts).length;
}

/** Unfinished todos per project (sidebar project row counts). */
export function openCountByProject(todos: TodoRecord[]): Map<string, number> {
  const done = COLUMNS.find((c) => c.id === 'done');
  const counts = new Map<string, number>();
  for (const todo of todos) {
    if (done?.accepts(todo)) continue;
    counts.set(todo.projectId, (counts.get(todo.projectId) ?? 0) + 1);
  }
  return counts;
}

/** `?column=<id>` narrows the board to one column (sidebar 需要我处理 =
 *  `pending`). */
export const COLUMN_PARAM = 'column';

export function parseColumnParam(raw: string | null): string | null {
  return raw != null && COLUMNS.some((c) => c.id === raw) ? raw : null;
}

/** Sets or drops the column param on a raw search string, leaving every
 *  other segment byte-identical (the tags/projects params keep literal
 *  commas, which URLSearchParams would re-encode). */
export function withColumnParam(search: string, column: string | null): string {
  const parts = search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part !== '' && !part.startsWith(`${COLUMN_PARAM}=`));
  if (column != null) parts.push(`${COLUMN_PARAM}=${column}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}
