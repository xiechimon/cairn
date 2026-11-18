import type { ThreadReportContent } from '@cairn/shared';
import type { ChiefStreamItem } from '../fixtures/records.js';

export interface StreamRow {
  item: ChiefStreamItem;
  i: number;
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
  item: ChiefStreamItem | ChannelMirror;
  i: number;
}

export function groupThreadEvents(rows: readonly StreamRow[]): GroupedRow[] {
  return rows.flatMap((row): GroupedRow[] => {
    const { item } = row;
    if (item.kind === 'report-ack' || item.kind === 'thread-message') return [];
    if (item.kind === 'thread-report') {
      if (item.fromThreadId === undefined) return [];
      const { id, todoId, title, phase, fromThreadId } = item;
      return [
        { item: { kind: 'channel-mirror', id, todoId, title, phase, fromThreadId }, i: row.i },
      ];
    }
    return [row];
  });
}
