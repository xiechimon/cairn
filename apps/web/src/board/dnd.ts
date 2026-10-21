// Board drag & drop commit core (issue #73, re-cut by #616). The gesture
// itself rides the locked stack (01-stack-v2 §4.1: @dnd-kit/core); what a
// settled drop DOES to phase/order is pure here so it stays testable
// without a DOM.
//
// Drop semantics (#616, todos.dev live 实测; matrix re-cut by #753): the
// drag is a pure cross-column phase vehicle — 「在桌面端可将卡片直接拖拽至目标
// 列」= manual phase change, landing at the END of the target column's view.
// The reference has no in-column reordering at all (siblings never shift
// mid-gesture; a same-column drop commits nothing), so the #73/#403 reorder
// index math and its filter-view anchor translation retired — moveTodo now
// answers same-column calls with the identity. `orderIndex` write-back
// stays: every column's committed view order is re-sequenced so the manual
// order remains the persisted truth (02 §6.2). #753（2026-10-03/04 重测，推翻
// #351「待处理不作落点」）: 合法边 = columns.ts canDropOnColumn 的 per-source
// 矩阵单源——待处理 吃 已完成(有变更) 的重开落位（写 review），failed→已完成
// 收（#1247，确认闸在 needsDoneGate），执行中 只吃 待开始。执行中 does not route through here at
// all — its drop hands the todo to the start path (board.tsx onStartIntent,
// #640 直发编排；2026-10-04 实测参考站该落位开 开始任务 dialog，差异归后续
// 票，本仓载体不动).
import type { TodoRecord } from '../fixtures/records.js';
import { COLUMNS, canDropOnColumn, needsResetGate } from './columns.js';

/** Pointer travel needed to tell a drag from a card click (CSS px) — the
 *  PointerSensor activation constraint; clicks keep navigating (r2 §4.2). */
export const DRAG_THRESHOLD_PX = 5;

/**
 * Commit a cross-column drop: rewrite the phase to the target column's
 * canon (BoardColumnDef.dropPhase) with a fresh phaseAt. The done column
 * view sorts that timestamp descending (#1247), so the fresh card is the
 * top row. Identity returns: unknown todo/column, and every pair
 * canDropOnColumn rejects (#753 per-source matrix — same-column,
 * 待开始→待处理, →执行中 from 待处理/已完成, 无变更 done→待处理).
 * Every column's view order is written back as sequential `orderIndex`.
 */
export function moveTodo(
  todos: TodoRecord[],
  todoId: string,
  columnId: string,
  now: number,
  /** #1247：已完成列可落 done 或 closed（canceled）。缺省 = 列 dropPhase。 */
  phaseOverride?: 'done' | 'closed',
): TodoRecord[] {
  const moved = todos.find((t) => t.id === todoId);
  if (moved == null) return todos;
  const column = COLUMNS.find((c) => c.id === columnId);
  if (column == null) return todos;
  // #753：合法边单源 canDropOnColumn（同列/非法对 = 恒等，不写相位不动序）
  if (!canDropOnColumn(moved, columnId)) return todos;
  if (phaseOverride != null && columnId !== 'done') return todos;
  const dropPhase = phaseOverride ?? column.dropPhase;
  const placed = { ...moved, phase: dropPhase, phaseAt: now };
  const rest = todos.filter((t) => t.id !== todoId);
  const view = rest.filter((t) => column.accepts(t));
  const last = view[view.length - 1];
  let next: TodoRecord[];
  if (last != null) {
    const at = rest.indexOf(last);
    next = [...rest.slice(0, at + 1), placed, ...rest.slice(at + 1)];
  } else {
    next = [...rest, placed];
  }
  // 列内 orderIndex 排序 (01 §4.1): the committed view order IS the index
  next = next.map((t) => ({ ...t }));
  for (const col of COLUMNS) {
    next
      .filter((t) => col.accepts(t))
      .forEach((t, i) => {
        t.orderIndex = i;
      });
  }
  return next;
}

/**
 * 本地重置（#755 fixture 面：无后端可调，dialog 确认的本地投影）——先经
 * moveTodo 落待开始列尾，再清空产物位（hasPlan/hasChanges/latestBuildId/
 * lastRunAt），与 server resetTodo 的 todo 写面逐位对齐。非 started 卡或
 * 非待开始落点 = 恒等（调用方本不该调）。
 */
export function resetTodoLocal(todos: TodoRecord[], todoId: string, now: number): TodoRecord[] {
  const moved = todos.find((t) => t.id === todoId);
  if (moved == null || !needsResetGate(moved)) return todos;
  // 同列（带构建历史的 todo 卡本就住待开始列）：只清产物位，不动位次。
  if (moved.phase === 'todo') {
    return todos.map((t) =>
      t.id === todoId
        ? {
            ...t,
            phase: 'todo',
            phaseAt: now,
            hasPlan: false,
            hasChanges: false,
            latestBuildId: null,
            lastRunAt: null,
          }
        : t,
    );
  }
  const next = moveTodo(todos, todoId, 'todo', now);
  if (next === todos) return todos;
  return next.map((t) =>
    t.id === todoId
      ? { ...t, hasPlan: false, hasChanges: false, latestBuildId: null, lastRunAt: null }
      : t,
  );
}
