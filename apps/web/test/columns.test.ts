// Column view ordering (issue #73): failed / review-awaiting cards pin to
// the TOP of 待处理 (#351: the pinned group moved from 执行中 to the merged
// gate column); everything else keeps manual/fixture order.
import { BOARD_DROP_PHASES, canOrchestrate, PHASE_VALUES } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import {
  attentionCount,
  canDropOnColumn,
  cardFace,
  COLUMNS,
  needsDoneGate,
  needsResetGate,
  sortColumnTodos,
  type BoardColumnDef,
} from '../src/board/columns.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

// #160→#753 手动改相面落点集单源对拍：server canManualMovePhase 消费 shared
// canBoardDrop/BOARD_DROP_PHASES，web 列定义消费 COLUMNS[].dropPhase——四列
// 落点两表必须同集（#753：待处理 收 已完成 的重开落位，正名 review）。
describe('手动改相面单源（#160 / #753）', () => {
  test('持落点列的 dropPhase 集 = shared BOARD_DROP_PHASES', () => {
    const drops = COLUMNS.map((c) => c.dropPhase);
    expect(drops.sort()).toEqual([...BOARD_DROP_PHASES].sort());
  });

  test('待处理落点正名 review = 重开回审核关口（#753 [设计]）', () => {
    expect(col('pending').dropPhase).toBe('review');
  });
});

// #753 per-source 落位矩阵（todos.dev 2026-10-03/04 live 重测；执行中源行
// 未测 = 沿用既有语义 [设计]）。shared canBoardDrop 是相位级镜像，这里钉
// 卡面级（hasChanges 数据位参与判据）。
describe('canDropOnColumn（#753 per-source 矩阵）', () => {
  const withChanges = (t: TodoRecord) => ({ ...t, hasChanges: true });

  test('待开始 源：执行中 ✓ 已完成 ✓；待处理 ✗（实测恒素面）；源列 ✗', () => {
    const t = todo(1, 'todo');
    expect(canDropOnColumn(t, 'building')).toBe(true);
    expect(canDropOnColumn(t, 'done')).toBe(true);
    expect(canDropOnColumn(t, 'pending')).toBe(false);
    expect(canDropOnColumn(t, 'todo')).toBe(false);
  });

  // #1447：queued 已开始，住执行中（参考站：排队卡停在它将要跑的那一步）。
  // 拖回待开始 = 重置意图（#755 闸），已完成 = 在飞关闸，执行中是源列。
  test('queued 源（已开始、等机器）：待开始 ✓（重置闸）已完成 ✓；执行中 ✗（源列）；待处理 ✗', () => {
    const t = todo(1, 'queued');
    expect(canDropOnColumn(t, 'todo')).toBe(true);
    expect(canDropOnColumn(t, 'done')).toBe(true);
    expect(canDropOnColumn(t, 'building')).toBe(false);
    expect(canDropOnColumn(t, 'pending')).toBe(false);
  });

  test('卡面：queued 走执行中底栏，todo 才浮开始（#1447）', () => {
    expect(cardFace(todo(1, 'queued'))).toEqual({ kind: 'running' });
    expect(cardFace(todo(2, 'todo'))).toEqual({ kind: 'todo', action: '开始' });
  });

  test('queued 住执行中列、不住待开始列（#1447）', () => {
    const t = todo(1, 'queued');
    expect(col('building').accepts(t)).toBe(true);
    expect(col('todo').accepts(t)).toBe(false);
    expect(needsResetGate(t)).toBe(true);
  });

  test('执行中 落点逐相位：只有未开始的 todo 可进（#1434）', () => {
    for (const phase of PHASE_VALUES) {
      expect(canDropOnColumn(todo(1, phase), 'building'), phase).toBe(phase === 'todo');
    }
  });

  // #1457：落进执行中 = 开始门 → POST /api/todos/:id/orchestrate。看板放行的
  // 相位必须是服务端 orchestrate 收的相位，否则拖得进去、服务端 409（#1434）。
  test('执行中 落点 ⊆ shared canOrchestrate（#1457）', () => {
    for (const phase of PHASE_VALUES) {
      for (const hasChanges of [false, true]) {
        if (canDropOnColumn({ ...todo(1, phase), hasChanges }, 'building')) {
          expect(canOrchestrate(phase), phase).toBe(true);
        }
      }
    }
  });

  test('待处理 源（confirm/review/awaitingReply）：待开始 ✓ 已完成 ✓；执行中 ✗', () => {
    for (const t of [todo(1, 'confirm'), todo(2, 'review'), todo(3, 'review', true)]) {
      expect(canDropOnColumn(t, 'todo'), t.phase).toBe(true);
      expect(canDropOnColumn(t, 'done'), t.phase).toBe(true);
      expect(canDropOnColumn(t, 'building'), t.phase).toBe(false);
      expect(canDropOnColumn(t, 'pending'), t.phase).toBe(false);
    }
  });

  test('failed 源：待开始 ✓ 已完成 ✓（#1247 手动关边，不看 hasChanges）', () => {
    const plain = todo(1, 'failed');
    const rich = { ...plain, hasChanges: true };
    for (const t of [plain, rich]) {
      expect(canDropOnColumn(t, 'todo')).toBe(true);
      expect(canDropOnColumn(t, 'done')).toBe(true);
      expect(canDropOnColumn(t, 'building')).toBe(false);
    }
  });

  test('已完成 源：有变更 → 待处理 ✓（重开）；无变更 → 待处理 ✗（2026-10-04 实测）', () => {
    const rich = withChanges(todo(1, 'done'));
    const plain = todo(2, 'done'); // localTodo 底 hasChanges=false
    expect(canDropOnColumn(rich, 'pending')).toBe(true);
    expect(canDropOnColumn(rich, 'todo')).toBe(true);
    expect(canDropOnColumn(rich, 'building')).toBe(false);
    expect(canDropOnColumn(rich, 'done')).toBe(false);
    expect(canDropOnColumn(plain, 'pending')).toBe(false);
    expect(canDropOnColumn(plain, 'todo')).toBe(true);
  });

  test('执行中 源（未测行 [设计]）：待开始 ✓ 已完成 ✓；待处理 ✗', () => {
    for (const t of [todo(1, 'planning'), todo(2, 'building')]) {
      expect(canDropOnColumn(t, 'todo'), t.phase).toBe(true);
      expect(canDropOnColumn(t, 'done'), t.phase).toBe(true);
      expect(canDropOnColumn(t, 'pending'), t.phase).toBe(false);
      expect(canDropOnColumn(t, 'building'), t.phase).toBe(false);
    }
  });

  test('closed 在已完成列：可拖回待开始；无变更不进待处理；未知列假', () => {
    const t = todo(1, 'closed');
    expect(canDropOnColumn(t, 'todo')).toBe(true);
    expect(canDropOnColumn(t, 'pending')).toBe(false);
    expect(canDropOnColumn(t, 'building')).toBe(false);
    expect(canDropOnColumn(t, 'done')).toBe(false);
    expect(canDropOnColumn({ ...t, hasChanges: true }, 'pending')).toBe(true);
    expect(canDropOnColumn(todo(2, 'todo'), 'nope')).toBe(false);
  });
});

function col(id: string): BoardColumnDef {
  const found = COLUMNS.find((c) => c.id === id);
  if (found == null) throw new Error(`no column ${id}`);
  return found;
}

const pending = col('pending');

describe('待处理列收纳（confirm ∪ review ∪ failed，#351）', () => {
  test('accepts：confirm / review（含 awaitingReply）/ failed 入列', () => {
    for (const t of [
      todo(1, 'confirm'),
      todo(2, 'review'),
      todo(3, 'review', true),
      todo(4, 'failed'),
    ]) {
      expect(pending.accepts(t), `${t.phase} awaiting=${t.awaitingReply}`).toBe(true);
    }
  });

  test('accepts：todo/queued/planning/building/done/closed 不入待处理', () => {
    for (const t of [
      todo(1, 'todo'),
      todo(2, 'queued'),
      todo(3, 'planning'),
      todo(4, 'building'),
      todo(5, 'done'),
      todo(6, 'closed'),
    ]) {
      expect(pending.accepts(t), t.phase).toBe(false);
    }
  });

  test('已完成列收 done 与 closed（#1247 canceled）', () => {
    const done = col('done');
    expect(done.accepts(todo(1, 'done'))).toBe(true);
    expect(done.accepts(todo(2, 'closed'))).toBe(true);
    expect(done.accepts(todo(3, 'failed'))).toBe(false);
  });

  test('侧栏 badge = 待处理列计数（同一 accepts 谓词单源）', () => {
    const set = [
      todo(1, 'todo'),
      todo(2, 'planning'),
      todo(3, 'confirm'),
      todo(4, 'building'),
      todo(5, 'review', true), // awaitingReply 也计数（与列计数同源）
      todo(6, 'review'),
      todo(7, 'failed'),
      todo(8, 'done'),
      todo(9, 'closed'),
    ];
    expect(set.filter(pending.accepts)).toHaveLength(4);
    expect(attentionCount(set)).toBe(set.filter(pending.accepts).length);
  });
});

describe('sortColumnTodos（pinned 组置顶，余者保序）', () => {
  test('待处理：failed 与 review+awaitingReply 置顶且内部保序', () => {
    const confirm = todo(1, 'confirm');
    const failed = todo(2, 'failed');
    const waiting = todo(3, 'review', true);
    const confirm2 = todo(4, 'confirm');
    const sorted = sortColumnTodos(pending, [confirm, failed, waiting, confirm2]);
    expect(sorted.map((t) => t.id)).toEqual([failed.id, waiting.id, confirm.id, confirm2.id]);
  });

  test('非 pinned 列 = 原序透传', () => {
    const backlog = col('todo');
    const a = todo(1, 'todo');
    const b = todo(2, 'queued');
    expect(sortColumnTodos(backlog, [a, b]).map((t) => t.id)).toEqual([a.id, b.id]);
  });

  test('执行中无 pinned 组：planning/building 原序透传', () => {
    const running = col('building');
    const a = todo(1, 'planning');
    const b = todo(2, 'building');
    expect(sortColumnTodos(running, [a, b]).map((t) => t.id)).toEqual([a.id, b.id]);
  });
});

describe('sortColumnTodos（orderIndex = 手动序，01 §4.1）', () => {
  test('列内按 orderIndex 排，数组序仅作平局兜底', () => {
    const backlog = col('todo');
    const a = { ...todo(1, 'todo'), orderIndex: 1 };
    const b = { ...todo(2, 'queued'), orderIndex: 0 };
    expect(sortColumnTodos(backlog, [a, b]).map((t) => t.id)).toEqual([b.id, a.id]);
  });

  test('待处理：pinned 组恒在 orderIndex 之前', () => {
    const review = { ...todo(1, 'review'), orderIndex: 0 };
    const failed = { ...todo(2, 'failed'), orderIndex: 5 };
    const sorted = sortColumnTodos(pending, [review, failed]);
    expect(sorted.map((t) => t.id)).toEqual([failed.id, review.id]);
  });

  test('已完成：phaseAt 倒序，同刻再按 orderIndex（#1247）', () => {
    const done = col('done');
    const older = { ...todo(1, 'done'), phaseAt: 100, orderIndex: 0 };
    const newer = { ...todo(2, 'done'), phaseAt: 200, orderIndex: 9 };
    const tie = { ...todo(3, 'done'), phaseAt: 200, orderIndex: 1 };
    expect(sortColumnTodos(done, [older, newer, tie]).map((t) => t.id)).toEqual([
      tie.id,
      newer.id,
      older.id,
    ]);
  });
});

// #755 重置闸 started 判据（与 server isStartedTodoRow 同表：进行中相位或
// 任一历史位在位；confirm/review/failed/done 但零历史 = 静默改相）。
describe('needsResetGate（#755 拖回待开始确认闸）', () => {
  const fresh = (t: TodoRecord): TodoRecord => ({
    ...t,
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
  });

  test('进行中相位（queued/planning/building）恒需闸', () => {
    for (const phase of ['queued', 'planning', 'building'] as const) {
      expect(needsResetGate(fresh(todo(1, phase))), phase).toBe(true);
    }
  });

  test('历史四位任一在位即需闸（相位无关）', () => {
    const base = fresh(todo(1, 'done'));
    expect(needsResetGate({ ...base, latestBuildId: 'b1' })).toBe(true);
    expect(needsResetGate({ ...base, lastRunAt: NOW - 1 })).toBe(true);
    expect(needsResetGate({ ...base, hasChanges: true })).toBe(true);
    expect(needsResetGate({ ...base, hasPlan: true })).toBe(true);
  });

  test('零历史 confirm/review/failed/done = 静默改相（无可中断、无可清空）', () => {
    for (const phase of ['confirm', 'review', 'failed', 'done'] as const) {
      expect(needsResetGate(fresh(todo(1, phase))), phase).toBe(false);
    }
  });

  test('全新 todo 卡 = 静默（同列规则另保，判据本身 false）', () => {
    expect(needsResetGate(fresh(todo(1, 'todo')))).toBe(false);
  });
});

describe('needsDoneGate（#1247 待处理/在飞拖向已完成）', () => {
  test('confirm/review/failed 要确认，与 hasChanges 无关', () => {
    for (const phase of ['confirm', 'review', 'failed'] as const) {
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: true }), `${phase} rich`).toBe(true);
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: false }), `${phase} plain`).toBe(
        true,
      );
    }
  });

  test('执行中（queued/planning/building）要确认（stop-then-done）', () => {
    for (const phase of ['queued', 'planning', 'building'] as const) {
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: true }), phase).toBe(true);
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: false }), phase).toBe(true);
    }
  });

  test('待开始与已完成拖向已完成仍静默', () => {
    for (const phase of ['todo', 'done'] as const) {
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: true }), phase).toBe(false);
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: false }), phase).toBe(false);
    }
  });
});
