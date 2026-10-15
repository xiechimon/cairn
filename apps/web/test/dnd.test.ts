// Board drag & drop commit core (issue #73, re-cut by #616). The gesture
// rides the locked @dnd-kit stack (01-stack-v2 §4.1); every decision a
// settled drop makes — phase rewrite, end-of-column landing, orderIndex
// re-sequence — lives in dnd.ts so it stays testable without a DOM.
// #616 (todos.dev live 实测): 拖拽 = 纯跨列改相载体——同列落位无操作（参考
// 站无列内重排），落点 = 目标列视图末尾。#753（2026-10-03/04 重测，推翻
// #351「待处理不作落点」）: 合法边 = columns.ts canDropOnColumn 的 per-source
// 矩阵——待处理 吃 已完成(有变更) 的重开落位（写 review），failed→已完成 与
// 待开始→待处理 与 →执行中(非待开始源) 恒等；执行中 不经此路（startGate →
// #640 直发编排，本地不写相位）。
import { describe, expect, test } from 'vitest';
import { moveTodo, resetTodoLocal } from '../src/board/dnd.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

describe('moveTodo（#616：跨列 = 改相 + 落目标列尾）', () => {
  const a = todo(1, 'todo');
  const b = todo(2, 'todo');
  const c = todo(3, 'todo');

  test('跨列：phase 取目标列正名 + phaseAt 刷新，落在目标列视图末尾', () => {
    const run = todo(6, 'building');
    const next = moveTodo([a, b, run], a.id, 'building', NOW);
    const moved = next.find((t) => t.id === a.id);
    expect(moved?.phase).toBe('building');
    expect(moved?.phaseAt).toBe(NOW);
    // 目标列既有卡之后 = 末尾
    expect(next.filter((t) => t.phase === 'building').map((t) => t.id)).toEqual([run.id, a.id]);
  });

  test('跨列到空目标列：卡落全集尾，列视图只有它', () => {
    const next = moveTodo([a, b, c], a.id, 'done', NOW);
    expect(next.find((t) => t.id === a.id)?.phase).toBe('done');
    expect(next.filter((t) => t.phase === 'done').map((t) => t.id)).toEqual([a.id]);
    expect(next.map((t) => t.id)).toEqual([b.id, c.id, a.id]);
  });

  test('同列落位 = 恒等（#616：参考站无列内重排语义）', () => {
    const input = [a, b, c];
    expect(moveTodo(input, b.id, 'todo', NOW)).toBe(input);
  });

  test('待开始→待处理 = 非法对（#753 实测恒素面）：原样返回，不改相不动序', () => {
    const input = [a, b, c];
    const next = moveTodo(input, a.id, 'pending', NOW);
    expect(next).toBe(input);
    expect(next.find((t) => t.id === a.id)?.phase).toBe('todo');
  });

  test('orderIndex 回写 = 各列视图序（01 §4.1 列内 orderIndex 排序）', () => {
    const next = moveTodo([a, b, c], c.id, 'done', NOW);
    expect(next.filter((t) => t.phase === 'todo').map((t) => t.orderIndex)).toEqual([0, 1]);
    expect(next.find((t) => t.id === c.id)?.orderIndex).toBe(0);
  });

  test('不 mutate 入参（page state 直接持有 fixture 记录）', () => {
    const before = JSON.stringify([a, b, c]);
    moveTodo([a, b, c], a.id, 'done', NOW);
    expect(JSON.stringify([a, b, c])).toBe(before);
  });

  test('未知 todo / 未知列 = 恒等（防御）', () => {
    expect(moveTodo([a, b], 'nope', 'done', NOW).map((t) => t.id)).toEqual([a.id, b.id]);
    expect(moveTodo([a, b], a.id, 'nope', NOW).map((t) => t.id)).toEqual([a.id, b.id]);
  });
});

describe('moveTodo（#753：per-source 矩阵的新合法对与恒等对）', () => {
  const doneRich: TodoRecord = { ...todo(10, 'done'), hasChanges: true };
  const donePlain = todo(11, 'done'); // localTodo 底 hasChanges=false
  const failed: TodoRecord = { ...todo(12, 'failed'), hasChanges: true };
  const confirm = todo(13, 'confirm');
  const reviewWait = todo(14, 'review', true);

  test('已完成(有变更)→待处理 = 重开落位：写 review + phaseAt 刷新', () => {
    const next = moveTodo([doneRich, confirm], doneRich.id, 'pending', NOW);
    const moved = next.find((t) => t.id === doneRich.id);
    expect(moved?.phase).toBe('review');
    expect(moved?.phaseAt).toBe(NOW);
  });

  test('重开卡落 待处理 非钉顶组尾部：钉顶组（failed/review+awaitingReply）仍在前', () => {
    const next = moveTodo([failed, reviewWait, confirm, doneRich], doneRich.id, 'pending', NOW);
    // 视图序 = pinned 先（数组序稳定）→ 非钉顶按 orderIndex；重开卡写 review
    // 无 awaitingReply = 非钉顶，落尾。
    const view = next
      .filter((t) => t.phase === 'confirm' || t.phase === 'review' || t.phase === 'failed')
      .sort(
        (x, y) =>
          Number(y.phase === 'failed' || (y.phase === 'review' && y.awaitingReply === true)) -
            Number(x.phase === 'failed' || (x.phase === 'review' && x.awaitingReply === true)) ||
          x.orderIndex - y.orderIndex,
      );
    expect(view.map((t) => t.id)).toEqual([failed.id, reviewWait.id, confirm.id, doneRich.id]);
    expect(view[view.length - 1]?.phase).toBe('review');
  });

  test('已完成(无变更)→待处理 = 恒等（2026-10-04 实测：待处理恒素面）', () => {
    const input = [donePlain, confirm];
    expect(moveTodo(input, donePlain.id, 'pending', NOW)).toBe(input);
  });

  test('failed→已完成 writes done and refreshes phaseAt (#1247)', () => {
    const next = moveTodo([failed, confirm], failed.id, 'done', NOW);
    const moved = next.find((t) => t.id === failed.id);
    expect(moved?.phase).toBe('done');
    expect(moved?.phaseAt).toBe(NOW);
  });

  test('待处理(confirm)→已完成 / →待开始 = 改相提交', () => {
    const toDone = moveTodo([confirm, donePlain], confirm.id, 'done', NOW);
    expect(toDone.find((t) => t.id === confirm.id)?.phase).toBe('done');
    const toTodo = moveTodo([confirm, donePlain], confirm.id, 'todo', NOW);
    expect(toTodo.find((t) => t.id === confirm.id)?.phase).toBe('todo');
  });

  test('待处理/已完成→执行中 = 恒等（实测：执行中只吃待开始源）', () => {
    for (const t of [confirm, reviewWait, failed, doneRich, donePlain]) {
      const input = [t];
      expect(moveTodo(input, t.id, 'building', NOW), t.phase).toBe(input);
    }
  });
});

describe('resetTodoLocal（#755 fixture 面重置投影）', () => {
  test('started 卡：落待开始列尾 + 产物位清空（与 server resetTodo 写面对齐）', () => {
    const a = todo(1, 'todo');
    const run = { ...todo(2, 'building'), hasPlan: true, hasChanges: true, lastRunAt: NOW - 1 };
    const next = resetTodoLocal([a, run], run.id, NOW);
    const moved = next.find((t) => t.id === run.id)!;
    expect(moved.phase).toBe('todo');
    expect(moved.phaseAt).toBe(NOW);
    expect(moved.hasPlan).toBe(false);
    expect(moved.hasChanges).toBe(false);
    expect(moved.latestBuildId).toBeNull();
    expect(moved.lastRunAt).toBeNull();
    expect(next.filter((t) => t.phase === 'todo').map((t) => t.id)).toEqual([a.id, run.id]);
  });

  test('非 started 卡 = 恒等（静默改相走 moveTodo，不经此路）', () => {
    const done = {
      ...todo(1, 'done'),
      latestBuildId: null,
      lastRunAt: null,
      hasChanges: false,
      hasPlan: false,
    };
    const input = [todo(2, 'todo'), done];
    expect(resetTodoLocal(input, done.id, NOW)).toBe(input);
  });

  test('未知 id = 恒等', () => {
    const input = [todo(1, 'todo')];
    expect(resetTodoLocal(input, 'nope', NOW)).toBe(input);
  });
});
