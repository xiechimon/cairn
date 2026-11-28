import { RUN_PROBLEM_STATUSES, type RunListRow } from '@cairn/shared';
import { dateTimeFormat } from '../lib/date-format.js';

export function oneLine(value: unknown): string {
  return fullText(value).replace(/\s+/g, ' ').trim();
}

export function fullText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((part) => typeof part?.text === 'string'))
    return value.map((part) => part.text as string).join('\n');
  return JSON.stringify(value, null, 2);
}

export type TraceScope =
  | { kind: 'coordinator'; threadId: string | null }
  | { kind: 'task'; todoId: string };
export function toolTarget(name: string, args: unknown): string {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return name;
  const fields = args as Record<string, unknown>;
  const hint = ['command', 'path', 'query', 'url', 'pattern', 'file_path', 'title', 'message']
    .map((key) => fields[key])
    .find((value): value is string => typeof value === 'string' && value.trim() !== '');
  return hint === undefined ? name : `${name} ${oneLine(hint).slice(0, 60)}`;
}

export function durationText(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export type LedgerFilter = 'all' | 'sent' | 'wake' | 'problems';

export function formatRunHeader(at: number, locale: string): string {
  return dateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: locale === 'zh' ? 'numeric' : 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

export function selectLedgerRuns(
  rows: readonly RunListRow[],
  scope: TraceScope,
  filter: LedgerFilter,
  search: string,
): RunListRow[] {
  const needle = search.trim().toLocaleLowerCase();
  return rows
    .filter(
      (row) =>
        (scope.kind === 'coordinator'
          ? scope.threadId !== null && row.kind === 'coordinator' && row.threadId === scope.threadId
          : row.kind === 'task') &&
        (filter === 'all' ||
          (filter === 'problems'
            ? RUN_PROBLEM_STATUSES.includes(row.status)
            : filter === 'wake'
              ? row.woke
              : !row.woke)) &&
        (!needle || row.firstLine.toLocaleLowerCase().includes(needle)),
    )
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
export function scopedRunId(
  rows: readonly RunListRow[],
  scope: TraceScope,
  id: string | null,
): string | null {
  return id !== null && selectLedgerRuns(rows, scope, 'all', '').some((row) => row.id === id)
    ? id
    : null;
}
