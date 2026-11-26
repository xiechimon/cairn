import { isInfoOutput, RESEARCH_STUCK_SOURCE_KIND } from '@cairn/shared';
import type { TodoGlance } from '../detail/segments.js';
import type { GroupedRow } from './thread-activity.js';

interface GlanceSource {
  phase: string;
  seqNum?: number;
  title: string;
  sourceKind?: string | null;
  sourceRef?: string | null;
  blockedBy?: readonly string[] | null;
  output?: string;
  latestBuildId?: string | null;
  projectId?: string;
}

export function todoGlanceOf(todo: GlanceSource): TodoGlance {
  return {
    phase: todo.phase as TodoGlance['phase'],
    ...(todo.seqNum !== undefined ? { seq: todo.seqNum } : {}),
    title: todo.title,
    ...(todo.sourceKind === RESEARCH_STUCK_SOURCE_KIND ? { internal: true } : {}),
    ...(todo.blockedBy != null && todo.blockedBy.length > 0 ? { blockedBy: todo.blockedBy } : {}),
    ...(isInfoOutput(todo.output) ? { report: true } : {}),
    ...(todo.latestBuildId != null ? { buildId: todo.latestBuildId } : {}),
    ...(todo.projectId !== undefined ? { projectId: todo.projectId } : {}),
  };
}

export interface FoldedTaskCards {
  rows: GroupedRow[];
  startedBy: ReadonlyMap<GroupedRow['item'], readonly string[]>;
}

const startedLists = new WeakMap<object, readonly string[]>();

function stableList(owner: object, next: readonly string[]): readonly string[] {
  const previous = startedLists.get(owner);
  if (
    previous !== undefined &&
    previous.length === next.length &&
    previous.every((id, n) => id === next[n])
  )
    return previous;
  startedLists.set(owner, next);
  return next;
}

export function isLiveRow(item: GroupedRow['item']): boolean {
  return item.kind === 'streaming' || (item.kind === 'robot' && item.typing === true);
}

function liveRowAfter(rows: readonly GroupedRow[], from: number): GroupedRow['item'] | undefined {
  for (const { item } of rows.slice(from + 1)) {
    if (item.kind === 'user') return undefined;
    if (isLiveRow(item)) return item;
  }
  return undefined;
}

export function foldTaskCards(
  rows: readonly GroupedRow[],
  glances: ReadonlyMap<string, TodoGlance>,
): FoldedTaskCards {
  const kept: GroupedRow[] = [];
  const started = new Map<GroupedRow['item'], string[]>();
  let reply: GroupedRow['item'] | undefined;
  rows.forEach((row, n) => {
    if (row.item.kind === 'task-card') {
      const owner = (glances.has(row.item.todoId) && liveRowAfter(rows, n)) || reply;
      if (owner !== undefined && glances.has(row.item.todoId)) {
        started.set(owner, [...(started.get(owner) ?? []), row.item.todoId]);
      } else {
        kept.push(row);
      }
      return;
    }
    reply = row.item.kind === 'robot' ? row.item : undefined;
    kept.push(row);
  });
  return {
    rows: kept,
    startedBy: new Map([...started].map(([reply, ids]) => [reply, stableList(reply, ids)])),
  };
}

const placedReports = new WeakMap<object, readonly string[]>();

export function placeReportCards(
  rows: readonly GroupedRow[],
  startedBy: ReadonlyMap<GroupedRow['item'], readonly string[]>,
  glances: ReadonlyMap<string, TodoGlance>,
  seen: Set<string>,
): ReadonlyMap<GroupedRow['item'], readonly string[]> {
  const deliveredIn = (item: GroupedRow['item']) =>
    item.kind === 'robot' &&
    item.report !== undefined &&
    glances.get(item.report.todoId)?.buildId === item.report.buildId
      ? [item.report.todoId]
      : [];
  const noticed = new Set(rows.flatMap(({ item }) => deliveredIn(item)));
  const placed = new Map<GroupedRow['item'], readonly string[]>();
  for (const { item } of rows) {
    if (item.kind !== 'robot' || item.typing === true) continue;
    const started = (startedBy.get(item) ?? []).filter((id) => !noticed.has(id));
    const ids = [...new Set([...deliveredIn(item), ...started])].filter(
      (id) =>
        glances.get(id)?.report === true && glances.get(id)?.internal !== true && !seen.has(id),
    );
    for (const id of ids) seen.add(id);
    if (ids.length === 0) continue;
    const previous = placedReports.get(item);
    const stable =
      previous !== undefined && previous.join('\n') === ids.join('\n') ? previous : ids;
    placedReports.set(item, stable);
    placed.set(item, stable);
  }
  return placed;
}
