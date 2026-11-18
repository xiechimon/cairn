import { RESEARCH_BEFORE_PLAN_SOURCE_KIND, RESEARCH_STUCK_SOURCE_KIND } from '@cairn/shared';
import { glyphOf, isWaiting, type TaskEntry, type TasksView } from '../board/tasks-sections.js';
import { threadHref } from '../board/thread-copy.js';
import type { GlyphKind } from '../components/status-glyph.js';

export const TRAY_MAX_ROWS = 6;

const PLUMBING_KINDS: ReadonlySet<string> = new Set([
  RESEARCH_BEFORE_PLAN_SOURCE_KIND,
  RESEARCH_STUCK_SOURCE_KIND,
]);

export interface TrayRow {
  key: string;
  title: string;
  glyph: GlyphKind;
  at: number;
  path: string;
}

export interface TrayGroup {
  key: string;
  label: string;
  rows: TrayRow[];
}

function channelPath(projectId: string | null): string {
  return projectId === null ? '/app' : `/app?project=${projectId}&chat=1`;
}

function taskRow(entry: TaskEntry): TrayRow {
  return {
    key: entry.todo.id,
    title: entry.todo.title,
    glyph: glyphOf(entry),
    at: entry.todo.phaseAt,
    path: threadHref(entry.todo.id, ''),
  };
}

const newest = (a: TrayRow, b: TrayRow) => b.at - a.at;

export function trayGroups(view: TasksView): TrayGroup[] {
  const shown = view.entries.filter((entry) => !PLUMBING_KINDS.has(entry.todo.sourceKind ?? ''));
  const waiting = [
    ...view.questions.map((question) => ({
      key: question.requestId,
      title: question.header,
      glyph: 'attention' as const,
      at: question.createdAt,
      path: channelPath(question.projectId),
    })),
    ...shown.filter((entry) => isWaiting(entry.section)).map(taskRow),
  ]
    .sort(newest)
    .slice(0, TRAY_MAX_ROWS);
  const working = shown
    .filter((entry) => entry.section === 'working')
    .map(taskRow)
    .sort(newest)
    .slice(0, TRAY_MAX_ROWS - waiting.length);
  return [
    { key: 'waiting', label: '等你', rows: waiting },
    { key: 'working', label: '进行中', rows: working },
  ].filter((group) => group.rows.length > 0);
}
