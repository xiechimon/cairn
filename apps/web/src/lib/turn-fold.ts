import type { ChiefStreamItem, TranscriptItem } from '../fixtures/records.js';

export type TurnStatus = 'done' | 'failed';

export interface TurnRow<T> {
  item: T;
  index: number;
}

export interface Turn<T> {
  id: string;
  purpose: string;
  status: TurnStatus;
  seconds: number | null;
  rows: TurnRow<T>[];
}

export type TurnSegment<T> = { kind: 'row'; row: TurnRow<T> } | { kind: 'turn'; turn: Turn<T> };

export interface TurnAdapter<T> {
  startsTurn(item: T): boolean;
  closesTurn(item: T): boolean;
  live(item: T): boolean;
  terminal(item: T): boolean;
  failed(item: T): boolean;
  purpose(item: T): string;
  at(item: T): number | undefined;
  id(item: T): string | undefined;
}

export const PURPOSE_MAX_LENGTH = 80;

export function purposeOf(text: string): string {
  const line = text
    .split('\n')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find((part) => part !== '');
  if (line === undefined) return '';
  return line.length > PURPOSE_MAX_LENGTH
    ? `${line.slice(0, PURPOSE_MAX_LENGTH - 1).trimEnd()}…`
    : line;
}

function durationOf(times: number[]): number | null {
  if (times.length < 2) return null;
  return Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
}

function closeTurn<T>(rows: TurnRow<T>[], adapter: TurnAdapter<T>, out: TurnSegment<T>[]): void {
  const head = rows[0];
  if (head === undefined) return;
  const purpose = adapter.purpose(head.item);
  const live = rows.some((row) => adapter.live(row.item));
  const finished = rows.some((row) => adapter.terminal(row.item));
  if (purpose === '' || live || !finished) {
    for (const row of rows) out.push({ kind: 'row', row });
    return;
  }
  const failed = rows.some((row) => adapter.failed(row.item));
  const times = rows.flatMap((row) => {
    const at = adapter.at(row.item);
    return at === undefined ? [] : [at];
  });
  out.push({
    kind: 'turn',
    turn: {
      id: adapter.id(head.item) ?? `turn-${head.index}`,
      purpose,
      status: failed ? 'failed' : 'done',
      seconds: durationOf(times),
      rows,
    },
  });
}

export function groupTurns<T>(items: readonly T[], adapter: TurnAdapter<T>): TurnSegment<T>[] {
  const out: TurnSegment<T>[] = [];
  let current: TurnRow<T>[] = [];
  items.forEach((item, index) => {
    const row = { item, index };
    if (adapter.startsTurn(item)) {
      closeTurn(current, adapter, out);
      current = [row];
    } else if (adapter.closesTurn(item)) {
      closeTurn(current, adapter, out);
      current = [];
      out.push({ kind: 'row', row });
    } else if (current.length > 0) current.push(row);
    else out.push({ kind: 'row', row });
  });
  closeTurn(current, adapter, out);
  return out;
}

export function latestOpenTurnId<T>(
  segments: readonly TurnSegment<T>[],
  adapter: TurnAdapter<T>,
): string | null {
  const last = segments.at(-1);
  if (last?.kind === 'turn') return last.turn.id;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    if (segment.kind === 'turn') return segment.turn.id;
    if (adapter.startsTurn(segment.row.item)) return null;
  }
  return null;
}

export function isTurnOpen(
  id: string,
  defaultOpenId: string | null,
  flipped: ReadonlySet<string>,
): boolean {
  return (id === defaultOpenId) !== flipped.has(id);
}

const TRANSCRIPT_BOUNDARIES: ReadonlySet<TranscriptItem['kind']> = new Set([
  'run',
  'chief',
  'scheduled',
  'scheduled-turn',
  'automation-completed',
  'injected-skills',
]);

const TRANSCRIPT_TERMINALS: ReadonlySet<TranscriptItem['kind']> = new Set([
  'robot',
  'fail',
  'review',
  'verify',
  'report',
  'plan',
]);

export const transcriptTurns: TurnAdapter<TranscriptItem> = {
  startsTurn: (item) => item.kind === 'user',
  closesTurn: (item) => TRANSCRIPT_BOUNDARIES.has(item.kind),
  live: (item) => item.kind === 'streaming' || item.kind === 'agent-todo',
  terminal: (item) => TRANSCRIPT_TERMINALS.has(item.kind),
  failed: (item) => item.kind === 'fail',
  purpose: (item) => (item.kind === 'user' ? purposeOf(item.markdown ?? item.text) : ''),
  at: (item) =>
    item.kind === 'user' || item.kind === 'robot' || item.kind === 'work'
      ? item.createdAt
      : undefined,
  id: (item) => (item.kind === 'user' ? item.id : undefined),
};

const CHIEF_BOUNDARIES: ReadonlySet<ChiefStreamItem['kind']> = new Set([
  'note',
  'thread-report',
  'thread-message',
  'digest',
  'daily-report',
]);

export interface ChiefRow {
  item: ChiefStreamItem;
  i: number;
}

export const chiefTurns: TurnAdapter<ChiefRow> = {
  startsTurn: ({ item }) => item.kind === 'user',
  closesTurn: ({ item }) => CHIEF_BOUNDARIES.has(item.kind),
  live: ({ item }) =>
    item.kind === 'streaming' ||
    (item.kind === 'robot' && item.typing === true) ||
    (item.kind === 'question' && item.status === 'pending'),
  terminal: ({ item }) =>
    (item.kind === 'robot' && item.typing !== true) ||
    item.kind === 'error' ||
    item.kind === 'stopped',
  failed: ({ item }) => item.kind === 'error',
  purpose: ({ item }) => (item.kind === 'user' ? purposeOf(item.markdown ?? item.text) : ''),
  at: ({ item }) =>
    item.kind === 'user' || item.kind === 'robot' || item.kind === 'error'
      ? item.createdAt
      : undefined,
  id: ({ item }) => (item.kind === 'user' ? item.id : undefined),
};
