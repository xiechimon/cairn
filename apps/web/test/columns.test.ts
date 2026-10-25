import { BOARD_DROP_PHASES, canOrchestrate, PHASE_VALUES } from '@cairn/shared';
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

describe('manual phase-change face single source (#160 / #753)', () => {
  test('the dropPhase set with landing columns = shared BOARD_DROP_PHASES', () => {
    const drops = COLUMNS.map((c) => c.dropPhase);
    expect(drops.sort()).toEqual([...BOARD_DROP_PHASES].sort());
  });

  test('`待处理` landing renamed review = reopening returns through the review gate (#753 [design])', () => {
    expect(col('pending').dropPhase).toBe('review');
  });
});

describe('canDropOnColumn (#753 per-source matrix)', () => {
  const withChanges = (t: TodoRecord) => ({ ...t, hasChanges: true });

  test('`待开始` source: `执行中` ✓ `已完成` ✓; `待处理` ✗ (measured always-bare face); source column ✗', () => {
    const t = todo(1, 'todo');
    expect(canDropOnColumn(t, 'building')).toBe(true);
    expect(canDropOnColumn(t, 'done')).toBe(true);
    expect(canDropOnColumn(t, 'pending')).toBe(false);
    expect(canDropOnColumn(t, 'todo')).toBe(false);
  });

  test('queued source (started, waiting for a machine): `待开始` ✓ (reset gate) `已完成` ✓; `执行中` ✗ (source column); `待处理` ✗', () => {
    const t = todo(1, 'queued');
    expect(canDropOnColumn(t, 'todo')).toBe(true);
    expect(canDropOnColumn(t, 'done')).toBe(true);
    expect(canDropOnColumn(t, 'building')).toBe(false);
    expect(canDropOnColumn(t, 'pending')).toBe(false);
  });

  test('card face: queued walks the `执行中` bottom bar, todo floats `开始` (#1447)', () => {
    expect(cardFace(todo(1, 'queued'))).toEqual({ kind: 'running' });
    expect(cardFace(todo(2, 'todo'))).toEqual({ kind: 'todo', action: '开始' });
  });

  test('queued lives in the `执行中` column, not the `待开始` column (#1447)', () => {
    const t = todo(1, 'queued');
    expect(col('building').accepts(t)).toBe(true);
    expect(col('todo').accepts(t)).toBe(false);
    expect(needsResetGate(t)).toBe(true);
  });

  test('`执行中` landing per phase: only not-yet-started todo may enter (#1434)', () => {
    for (const phase of PHASE_VALUES) {
      expect(canDropOnColumn(todo(1, phase), 'building'), phase).toBe(phase === 'todo');
    }
  });

  test('`执行中` landing ⊆ shared canOrchestrate (#1457)', () => {
    for (const phase of PHASE_VALUES) {
      for (const hasChanges of [false, true]) {
        if (canDropOnColumn({ ...todo(1, phase), hasChanges }, 'building')) {
          expect(canOrchestrate(phase), phase).toBe(true);
        }
      }
    }
  });

  test('`待处理` source (confirm/review/awaitingReply): `待开始` ✓ `已完成` ✓; `执行中` ✗', () => {
    for (const t of [todo(1, 'confirm'), todo(2, 'review'), todo(3, 'review', true)]) {
      expect(canDropOnColumn(t, 'todo'), t.phase).toBe(true);
      expect(canDropOnColumn(t, 'done'), t.phase).toBe(true);
      expect(canDropOnColumn(t, 'building'), t.phase).toBe(false);
      expect(canDropOnColumn(t, 'pending'), t.phase).toBe(false);
    }
  });

  test('failed source: `待开始` ✓ `已完成` ✓ (#1247 manual close edge, ignores hasChanges)', () => {
    const plain = todo(1, 'failed');
    const rich = { ...plain, hasChanges: true };
    for (const t of [plain, rich]) {
      expect(canDropOnColumn(t, 'todo')).toBe(true);
      expect(canDropOnColumn(t, 'done')).toBe(true);
      expect(canDropOnColumn(t, 'building')).toBe(false);
    }
  });

  test('`已完成` source: with changes → `待处理` ✓ (reopen); without changes → `待处理` ✗ (measured 2026-10-04)', () => {
    const rich = withChanges(todo(1, 'done'));
    const plain = todo(2, 'done');
    expect(canDropOnColumn(rich, 'pending')).toBe(true);
    expect(canDropOnColumn(rich, 'todo')).toBe(true);
    expect(canDropOnColumn(rich, 'building')).toBe(false);
    expect(canDropOnColumn(rich, 'done')).toBe(false);
    expect(canDropOnColumn(plain, 'pending')).toBe(false);
    expect(canDropOnColumn(plain, 'todo')).toBe(true);
  });

  test('`执行中` source (untested rows [design]): `待开始` ✓ `已完成` ✓; `待处理` ✗', () => {
    for (const t of [todo(1, 'planning'), todo(2, 'building')]) {
      expect(canDropOnColumn(t, 'todo'), t.phase).toBe(true);
      expect(canDropOnColumn(t, 'done'), t.phase).toBe(true);
      expect(canDropOnColumn(t, 'pending'), t.phase).toBe(false);
      expect(canDropOnColumn(t, 'building'), t.phase).toBe(false);
    }
  });

  test('closed in the `已完成` column: draggable back to `待开始`; without changes does not enter `待处理`; unknown column is false', () => {
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

describe('`待处理` column collection (confirm ∪ review ∪ failed, #351)', () => {
  test('accepts: confirm / review (incl. awaitingReply) / failed enter the column', () => {
    for (const t of [
      todo(1, 'confirm'),
      todo(2, 'review'),
      todo(3, 'review', true),
      todo(4, 'failed'),
    ]) {
      expect(pending.accepts(t), `${t.phase} awaiting=${t.awaitingReply}`).toBe(true);
    }
  });

  test('accepts: todo/queued/planning/building/done/closed do not enter `待处理`', () => {
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

  test('`已完成` column holds done and closed (#1247 canceled)', () => {
    const done = col('done');
    expect(done.accepts(todo(1, 'done'))).toBe(true);
    expect(done.accepts(todo(2, 'closed'))).toBe(true);
    expect(done.accepts(todo(3, 'failed'))).toBe(false);
  });

  test('sidebar badge = `待处理` column count (same accepts predicate, single source)', () => {
    const set = [
      todo(1, 'todo'),
      todo(2, 'planning'),
      todo(3, 'confirm'),
      todo(4, 'building'),
      todo(5, 'review', true),
      todo(6, 'review'),
      todo(7, 'failed'),
      todo(8, 'done'),
      todo(9, 'closed'),
    ];
    expect(set.filter(pending.accepts)).toHaveLength(4);
    expect(attentionCount(set)).toBe(set.filter(pending.accepts).length);
  });
});

describe('sortColumnTodos (pinned group on top, rest keep order)', () => {
  test('`待处理`: failed and review+awaitingReply pinned on top, internal order kept', () => {
    const confirm = todo(1, 'confirm');
    const failed = todo(2, 'failed');
    const waiting = todo(3, 'review', true);
    const confirm2 = todo(4, 'confirm');
    const sorted = sortColumnTodos(pending, [confirm, failed, waiting, confirm2]);
    expect(sorted.map((t) => t.id)).toEqual([failed.id, waiting.id, confirm.id, confirm2.id]);
  });

  test('non-pinned columns = original order passthrough', () => {
    const backlog = col('todo');
    const a = todo(1, 'todo');
    const b = todo(2, 'queued');
    expect(sortColumnTodos(backlog, [a, b]).map((t) => t.id)).toEqual([a.id, b.id]);
  });

  test('`执行中` has no pinned group: planning/building original order passthrough', () => {
    const running = col('building');
    const a = todo(1, 'planning');
    const b = todo(2, 'building');
    expect(sortColumnTodos(running, [a, b]).map((t) => t.id)).toEqual([a.id, b.id]);
  });
});

describe('sortColumnTodos (orderIndex = manual order, 01 §4.1)', () => {
  test('within a column sort by orderIndex, array order only as a tiebreaker', () => {
    const backlog = col('todo');
    const a = { ...todo(1, 'todo'), orderIndex: 1 };
    const b = { ...todo(2, 'queued'), orderIndex: 0 };
    expect(sortColumnTodos(backlog, [a, b]).map((t) => t.id)).toEqual([b.id, a.id]);
  });

  test('`待处理`: the pinned group always comes before orderIndex', () => {
    const review = { ...todo(1, 'review'), orderIndex: 0 };
    const failed = { ...todo(2, 'failed'), orderIndex: 5 };
    const sorted = sortColumnTodos(pending, [review, failed]);
    expect(sorted.map((t) => t.id)).toEqual([failed.id, review.id]);
  });

  test('`已完成`: phaseAt descending, same instant then by orderIndex (#1247)', () => {
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

describe('needsResetGate (#755 drag-back-to-`待开始` confirm gate)', () => {
  const fresh = (t: TodoRecord): TodoRecord => ({
    ...t,
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
  });

  test('in-progress phases (queued/planning/building) always need the gate', () => {
    for (const phase of ['queued', 'planning', 'building'] as const) {
      expect(needsResetGate(fresh(todo(1, phase))), phase).toBe(true);
    }
  });

  test('any of the four history bits present → needs the gate (phase-independent)', () => {
    const base = fresh(todo(1, 'done'));
    expect(needsResetGate({ ...base, latestBuildId: 'b1' })).toBe(true);
    expect(needsResetGate({ ...base, lastRunAt: NOW - 1 })).toBe(true);
    expect(needsResetGate({ ...base, hasChanges: true })).toBe(true);
    expect(needsResetGate({ ...base, hasPlan: true })).toBe(true);
  });

  test('zero-history confirm/review/failed/done = silent phase change (nothing to interrupt, nothing to clear)', () => {
    for (const phase of ['confirm', 'review', 'failed', 'done'] as const) {
      expect(needsResetGate(fresh(todo(1, phase))), phase).toBe(false);
    }
  });

  test('a brand-new todo card = silent (same-column rules guard separately, the criterion itself is false)', () => {
    expect(needsResetGate(fresh(todo(1, 'todo')))).toBe(false);
  });
});

describe('needsDoneGate (#1247 `待处理`/in-flight dragged toward `已完成`)', () => {
  test('confirm/review/failed need confirmation, independent of hasChanges', () => {
    for (const phase of ['confirm', 'review', 'failed'] as const) {
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: true }), `${phase} rich`).toBe(true);
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: false }), `${phase} plain`).toBe(
        true,
      );
    }
  });

  test('`执行中` (queued/planning/building) needs confirmation (stop-then-done)', () => {
    for (const phase of ['queued', 'planning', 'building'] as const) {
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: true }), phase).toBe(true);
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: false }), phase).toBe(true);
    }
  });

  test('`待开始` and `已完成` dragged toward `已完成` stay silent', () => {
    for (const phase of ['todo', 'done'] as const) {
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: true }), phase).toBe(false);
      expect(needsDoneGate({ ...todo(1, phase), hasChanges: false }), phase).toBe(false);
    }
  });
});
