import { describe, expect, test } from 'vitest';
import { moveTodo, resetTodoLocal } from '../src/board/dnd.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

describe('moveTodo (#616: cross-column = phase change + lands at the target column tail)', () => {
  const a = todo(1, 'todo');
  const b = todo(2, 'todo');
  const c = todo(3, 'todo');

  test('cross-column: phase takes the target column canon + phaseAt refreshed, lands at the target column view tail', () => {
    const run = todo(6, 'building');
    const next = moveTodo([a, b, run], a.id, 'building', NOW);
    const moved = next.find((t) => t.id === a.id);
    expect(moved?.phase).toBe('building');
    expect(moved?.phaseAt).toBe(NOW);

    expect(next.filter((t) => t.phase === 'building').map((t) => t.id)).toEqual([run.id, a.id]);
  });

  test('cross-column into an empty target column: the card lands at the full-set tail, the column view holds only it', () => {
    const next = moveTodo([a, b, c], a.id, 'done', NOW);
    expect(next.find((t) => t.id === a.id)?.phase).toBe('done');
    expect(next.filter((t) => t.phase === 'done').map((t) => t.id)).toEqual([a.id]);
    expect(next.map((t) => t.id)).toEqual([b.id, c.id, a.id]);
  });

  test('same-column drop = identity (#616: the reference site has no in-column reorder semantics)', () => {
    const input = [a, b, c];
    expect(moveTodo(input, b.id, 'todo', NOW)).toBe(input);
  });

  test('`待开始`→`待处理` = illegal pair (#753 measured always-bare face): returned unchanged, no phase change, no order change', () => {
    const input = [a, b, c];
    const next = moveTodo(input, a.id, 'pending', NOW);
    expect(next).toBe(input);
    expect(next.find((t) => t.id === a.id)?.phase).toBe('todo');
  });

  test('orderIndex write-back = each column view order (01 §4.1 in-column orderIndex sort)', () => {
    const next = moveTodo([a, b, c], c.id, 'done', NOW);
    expect(next.filter((t) => t.phase === 'todo').map((t) => t.orderIndex)).toEqual([0, 1]);
    expect(next.find((t) => t.id === c.id)?.orderIndex).toBe(0);
  });

  test('does not mutate inputs (page state holds fixture records directly)', () => {
    const before = JSON.stringify([a, b, c]);
    moveTodo([a, b, c], a.id, 'done', NOW);
    expect(JSON.stringify([a, b, c])).toBe(before);
  });

  test('unknown todo / unknown column = identity (defensive)', () => {
    expect(moveTodo([a, b], 'nope', 'done', NOW).map((t) => t.id)).toEqual([a.id, b.id]);
    expect(moveTodo([a, b], a.id, 'nope', NOW).map((t) => t.id)).toEqual([a.id, b.id]);
  });
});

describe('moveTodo (#753: new legal pairs and identity pairs of the per-source matrix)', () => {
  const doneRich: TodoRecord = { ...todo(10, 'done'), hasChanges: true };
  const donePlain = todo(11, 'done');
  const failed: TodoRecord = { ...todo(12, 'failed'), hasChanges: true };
  const confirm = todo(13, 'confirm');
  const reviewWait = todo(14, 'review', true);

  test('`已完成`(with changes)→`待处理` = reopen landing: writes review + phaseAt refreshed', () => {
    const next = moveTodo([doneRich, confirm], doneRich.id, 'pending', NOW);
    const moved = next.find((t) => t.id === doneRich.id);
    expect(moved?.phase).toBe('review');
    expect(moved?.phaseAt).toBe(NOW);
  });

  test('a reopened card lands in `待处理` after the non-pinned group: the pinned group (failed/review+awaitingReply) stays in front', () => {
    const next = moveTodo([failed, reviewWait, confirm, doneRich], doneRich.id, 'pending', NOW);

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

  test('`已完成`(no changes)→`待处理` = identity (measured 2026-10-04: `待处理` always bare)', () => {
    const input = [donePlain, confirm];
    expect(moveTodo(input, donePlain.id, 'pending', NOW)).toBe(input);
  });

  test('failed→`已完成` writes done and refreshes phaseAt (#1247)', () => {
    const next = moveTodo([failed, confirm], failed.id, 'done', NOW);
    const moved = next.find((t) => t.id === failed.id);
    expect(moved?.phase).toBe('done');
    expect(moved?.phaseAt).toBe(NOW);
  });

  test('`待处理`(confirm)→`已完成` / →`待开始` = phase-change commits', () => {
    const toDone = moveTodo([confirm, donePlain], confirm.id, 'done', NOW);
    expect(toDone.find((t) => t.id === confirm.id)?.phase).toBe('done');
    const toTodo = moveTodo([confirm, donePlain], confirm.id, 'todo', NOW);
    expect(toTodo.find((t) => t.id === confirm.id)?.phase).toBe('todo');
  });

  test('`待处理`/`已完成`→`执行中` = identity (measured: `执行中` only takes `待开始` sources)', () => {
    for (const t of [confirm, reviewWait, failed, doneRich, donePlain]) {
      const input = [t];
      expect(moveTodo(input, t.id, 'building', NOW), t.phase).toBe(input);
    }
  });
});

describe('resetTodoLocal (#755 fixture-face reset projection)', () => {
  test('started cards: land at the `待开始` column tail + product slots cleared (aligned with the server resetTodo write face)', () => {
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

  test('queued cards (living in `执行中`, #1447): land at the `待开始` column tail + product slots cleared', () => {
    const a = todo(1, 'todo');
    const queued = { ...todo(2, 'queued'), lastRunAt: NOW - 1 };
    const next = resetTodoLocal([a, queued], queued.id, NOW);
    const moved = next.find((t) => t.id === queued.id)!;
    expect(moved.phase).toBe('todo');
    expect(moved.latestBuildId).toBeNull();
    expect(moved.lastRunAt).toBeNull();
    expect(next.filter((t) => t.phase === 'todo').map((t) => t.id)).toEqual([a.id, queued.id]);
  });

  test('non-started cards = identity (silent phase changes go through moveTodo, not this path)', () => {
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

  test('unknown id = identity', () => {
    const input = [todo(1, 'todo')];
    expect(resetTodoLocal(input, 'nope', NOW)).toBe(input);
  });
});
