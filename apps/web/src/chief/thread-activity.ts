import type { TodoGlance } from '../detail/segments.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { taskRefsOf } from './chief-task-refs.js';

export interface StreamRow {
  item: ChiefStreamItem;
  i: number;
}

export interface ThreadActivity {
  kind: 'thread-activity';
  id: string;
  todoId: string;
  title: string;
}

export interface GroupedRow {
  item: ChiefStreamItem | ThreadActivity;
  i: number;
}

export function subThreadRowIds(
  stream: readonly ChiefStreamItem[],
  glances: ReadonlyMap<string, TodoGlance>,
): ReadonlySet<string> {
  const shown = new Set(stream.flatMap((item) => (item.kind === 'task-card' ? [item.todoId] : [])));
  const kept = new Set<string>();
  for (const item of stream) {
    if (item.kind === 'robot' && item.typing !== true) {
      for (const ref of taskRefsOf(item, glances)) shown.add(ref.todoId);
      continue;
    }
    if (item.kind !== 'thread-report' && item.kind !== 'thread-message') continue;
    const parentId = glances.get(item.todoId)?.parentId;
    if (shown.has(item.todoId) || (parentId !== undefined && shown.has(parentId))) continue;
    shown.add(item.todoId);
    kept.add(item.id);
  }
  return kept;
}

export function groupThreadEvents(
  rows: readonly StreamRow[],
  kept: ReadonlySet<string>,
): GroupedRow[] {
  return rows.flatMap((row): GroupedRow[] => {
    const { item } = row;
    if (item.kind !== 'thread-report' && item.kind !== 'thread-message') return [row];
    if (!kept.has(item.id)) return [];
    return [
      {
        item: { kind: 'thread-activity', id: item.id, todoId: item.todoId, title: item.title },
        i: row.i,
      },
    ];
  });
}
