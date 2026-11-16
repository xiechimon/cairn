import type { ThreadReportContent } from '@cairn/shared';
import type { TodoGlance } from '../detail/segments.js';
import type { ChiefStreamItem } from '../fixtures/records.js';

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

export interface ChannelMirror {
  kind: 'channel-mirror';
  id: string;
  todoId: string;
  title: string;
  phase: ThreadReportContent['phase'];
  fromThreadId: string;
}

export interface GroupedRow {
  item: ChiefStreamItem | ThreadActivity | ChannelMirror;
  i: number;
}

export function subThreadRowIds(
  stream: readonly ChiefStreamItem[],
  glances: ReadonlyMap<string, TodoGlance>,
): ReadonlySet<string> {
  const shown = new Set(stream.flatMap((item) => (item.kind === 'task-card' ? [item.todoId] : [])));
  const delivered = new Set(
    stream.flatMap((item) => {
      if (item.kind === 'report-ack') return [`${item.todoId}\0${item.buildId}`];
      if (item.kind === 'robot' && item.report !== undefined)
        return [`${item.report.todoId}\0${item.report.buildId}`];
      return [];
    }),
  );
  const kept = new Set<string>();
  for (const item of stream) {
    if (item.kind !== 'thread-report' && item.kind !== 'thread-message') continue;
    if (item.kind === 'thread-report' && item.fromThreadId !== undefined) continue;
    if (item.kind === 'thread-report' && delivered.has(`${item.todoId}\0${item.buildId}`)) continue;
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
    if (item.kind === 'report-ack') return [];
    if (item.kind !== 'thread-report' && item.kind !== 'thread-message') return [row];
    if (item.kind === 'thread-report' && item.fromThreadId !== undefined) {
      const { id, todoId, title, phase, fromThreadId } = item;
      return [
        { item: { kind: 'channel-mirror', id, todoId, title, phase, fromThreadId }, i: row.i },
      ];
    }
    if (!kept.has(item.id)) return [];
    return [
      {
        item: { kind: 'thread-activity', id: item.id, todoId: item.todoId, title: item.title },
        i: row.i,
      },
    ];
  });
}
