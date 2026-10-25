import type { TodoRecord } from '../fixtures/records.js';
import { COLUMNS, canDropOnColumn, needsResetGate } from './columns.js';

export const DRAG_THRESHOLD_PX = 5;

export function moveTodo(
  todos: TodoRecord[],
  todoId: string,
  columnId: string,
  now: number,
  phaseOverride?: 'done' | 'closed',
): TodoRecord[] {
  const moved = todos.find((t) => t.id === todoId);
  if (moved == null) return todos;
  const column = COLUMNS.find((c) => c.id === columnId);
  if (column == null) return todos;
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

export function resetTodoLocal(todos: TodoRecord[], todoId: string, now: number): TodoRecord[] {
  const moved = todos.find((t) => t.id === todoId);
  if (moved == null || !needsResetGate(moved)) return todos;
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
