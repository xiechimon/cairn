import { canOrchestrate, IN_PROGRESS_PHASES, type Phase } from '@cairn/shared';
import type { TodoRecord } from '../fixtures/records.js';
import { PHASE_UI } from '../phase.js';

export interface BoardColumnDef {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'attention' | 'done';
  label?: string;
  dropPhase: Phase;
  startGate?: boolean;
  accepts: (todo: TodoRecord) => boolean;
}

export function isPinnedBuilding(todo: TodoRecord): boolean {
  return todo.phase === 'failed' || (todo.phase === 'review' && todo.awaitingReply === true);
}

export function sortColumnTodos(column: BoardColumnDef, todos: TodoRecord[]): TodoRecord[] {
  if (column.id === 'done') {
    return [...todos].sort((x, y) => y.phaseAt - x.phaseAt || x.orderIndex - y.orderIndex);
  }
  const pinnedRank = (t: TodoRecord) => (column.id === 'pending' && isPinnedBuilding(t) ? 0 : 1);
  return [...todos].sort((x, y) => pinnedRank(x) - pinnedRank(y) || x.orderIndex - y.orderIndex);
}

export const COLUMNS: BoardColumnDef[] = [
  {
    id: 'todo',
    dropPhase: 'todo',
    name: '待开始',
    status: 'idle',
    accepts: (t) => t.phase === 'todo',
  },
  {
    id: 'building',
    dropPhase: 'building',
    startGate: true,
    name: '执行中',
    status: 'running',
    accepts: (t) => (IN_PROGRESS_PHASES as readonly string[]).includes(t.phase),
  },
  {
    id: 'pending',
    dropPhase: 'review',
    name: '待处理',
    status: 'attention',
    accepts: (t) => t.phase === 'confirm' || t.phase === 'review' || t.phase === 'failed',
  },
  {
    id: 'done',
    dropPhase: 'done',
    name: '已完成',
    status: 'done',
    label: '最近 7 天',
    accepts: (t) => t.phase === 'done' || t.phase === 'closed',
  },
];

export function canDropOnColumn(todo: TodoRecord, columnId: string): boolean {
  const src = COLUMNS.find((c) => c.accepts(todo));
  const dst = COLUMNS.find((c) => c.id === columnId);
  if (src == null || dst == null || src.id === dst.id) return false;
  switch (dst.id) {
    case 'todo':
      return true;
    case 'building':
      return src.id === 'todo' && canOrchestrate(todo.phase);
    case 'pending':
      return src.id === 'done' && todo.hasChanges === true;
    case 'done':
      return true;
    default:
      return false;
  }
}

export function needsResetGate(todo: TodoRecord): boolean {
  if ((IN_PROGRESS_PHASES as readonly string[]).includes(todo.phase)) return true;
  return todo.latestBuildId != null || todo.lastRunAt != null || todo.hasChanges || todo.hasPlan;
}

export function needsDoneGate(todo: TodoRecord): boolean {
  return (
    todo.phase === 'confirm' ||
    todo.phase === 'review' ||
    todo.phase === 'failed' ||
    (IN_PROGRESS_PHASES as readonly string[]).includes(todo.phase)
  );
}

export function isInflightDoneGate(todo: TodoRecord): boolean {
  return (IN_PROGRESS_PHASES as readonly string[]).includes(todo.phase);
}

export type CardFace =
  | { kind: 'todo'; action: string | null }
  | { kind: 'running' }
  | { kind: 'attention'; need: 'failed' | 'confirm' | 'review' | 'reply' }
  | { kind: 'done'; canceled: boolean };

export function cardFace(todo: TodoRecord): CardFace {
  if (todo.awaitingReply === true) return { kind: 'attention', need: 'reply' };
  switch (todo.phase) {
    case 'todo':
      return { kind: 'todo', action: PHASE_UI.todo.action };
    case 'queued':
    case 'planning':
    case 'building':
      return { kind: 'running' };
    case 'failed':
    case 'confirm':
    case 'review':
      return { kind: 'attention', need: todo.phase };
    case 'done':
      return { kind: 'done', canceled: false };
    case 'closed':
      return { kind: 'done', canceled: true };
  }
}

export function attentionCount(todos: TodoRecord[]): number {
  return countInColumn(todos, 'pending');
}

export function countInColumn(todos: TodoRecord[], columnId: string): number {
  const column = COLUMNS.find((c) => c.id === columnId);
  return column == null ? 0 : todos.filter(column.accepts).length;
}

export function openCountByProject(todos: TodoRecord[]): Map<string, number> {
  const done = COLUMNS.find((c) => c.id === 'done');
  const counts = new Map<string, number>();
  for (const todo of todos) {
    if (done?.accepts(todo)) continue;
    counts.set(todo.projectId, (counts.get(todo.projectId) ?? 0) + 1);
  }
  return counts;
}

export const COLUMN_PARAM = 'column';

export function parseColumnParam(raw: string | null): string | null {
  return raw != null && COLUMNS.some((c) => c.id === raw) ? raw : null;
}

export function withColumnParam(search: string, column: string | null): string {
  const parts = search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part !== '' && !part.startsWith(`${COLUMN_PARAM}=`));
  if (column != null) parts.push(`${COLUMN_PARAM}=${column}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}
