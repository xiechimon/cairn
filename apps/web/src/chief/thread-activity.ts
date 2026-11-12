import { reportStatusWord, type StatusWord } from '../board/status-words.js';
import type { ChiefStreamItem } from '../fixtures/records.js';

export type ThreadEventItem = Extract<
  ChiefStreamItem,
  { kind: 'thread-report' | 'thread-message' }
>;

export interface StreamRow {
  item: ChiefStreamItem;
  i: number;
}

export interface ThreadActivity {
  kind: 'thread-activity';
  id: string;
  todoId: string;
  title: string;
  events: ThreadEventItem[];
}

export interface GroupedRow {
  item: ChiefStreamItem | ThreadActivity;
  i: number;
}

export interface ActivitySummary {
  title: string;
  messages: number;
  status: StatusWord | null;
}

function isThreadEvent(item: ChiefStreamItem): item is ThreadEventItem {
  return item.kind === 'thread-report' || item.kind === 'thread-message';
}

function reportKey(item: Extract<ThreadEventItem, { kind: 'thread-report' }>): string {
  return `${reportStatusWord(item)}|${item.line ?? ''}`;
}

function appendEvent(events: ThreadEventItem[], item: ThreadEventItem): void {
  if (item.kind === 'thread-report') {
    const previous = events.findLast((event) => event.kind === 'thread-report');
    if (previous?.kind === 'thread-report' && reportKey(previous) === reportKey(item)) return;
  }
  events.push(item);
}

export function groupThreadEvents(
  rows: readonly StreamRow[],
  standalone: (item: ChiefStreamItem) => boolean,
): GroupedRow[] {
  const entries: GroupedRow[] = [];
  let open: { activity: ThreadActivity } | null = null;
  for (const row of rows) {
    const { item } = row;
    if (item.kind === 'thread-message' && item.by !== 'coordinator') continue;
    if (!isThreadEvent(item) || standalone(item)) {
      open = null;
      entries.push(row);
      continue;
    }
    if (open !== null && open.activity.todoId === item.todoId) {
      appendEvent(open.activity.events, item);
      continue;
    }
    const activity: ThreadActivity = {
      kind: 'thread-activity',
      id: item.id,
      todoId: item.todoId,
      title: item.title,
      events: [item],
    };
    open = { activity };
    entries.push({ item: activity, i: row.i });
  }
  return entries;
}

export function activitySummary(activity: ThreadActivity): ActivitySummary {
  const latestReport = activity.events.findLast((event) => event.kind === 'thread-report');
  return {
    title: activity.title,
    messages: activity.events.filter((event) => event.kind === 'thread-message').length,
    status: latestReport?.kind === 'thread-report' ? reportStatusWord(latestReport) : null,
  };
}
