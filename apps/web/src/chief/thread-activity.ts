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

export interface ThinkingGroup {
  kind: 'thinking-group';
  id?: string;
  texts: readonly string[];
}

export interface GroupedRow {
  item: ChiefStreamItem | ChannelMirror | ThinkingGroup;
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

export function collapseThinkingRuns(rows: readonly GroupedRow[]): GroupedRow[] {
  const collapsed: GroupedRow[] = [];
  let run: GroupedRow[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const first = run[0];
    if (first === undefined) return;
    if (run.length === 1) {
      collapsed.push(first);
    } else {
      const texts = run.flatMap(({ item }) => (item.kind === 'thinking' ? [item.text] : []));
      const id = first.item.kind === 'thinking' ? first.item.id : undefined;
      collapsed.push({
        item: { kind: 'thinking-group', ...(id !== undefined ? { id } : {}), texts },
        i: first.i,
      });
    }
    run = [];
  };
  for (const row of rows) {
    if (row.item.kind === 'thinking') {
      run.push(row);
    } else {
      flush();
      collapsed.push(row);
    }
  }
  flush();
  return collapsed;
}
