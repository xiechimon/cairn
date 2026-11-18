import { isInfoOutput, RESEARCH_STUCK_SOURCE_KIND } from '@cairn/shared';
import type { TodoGlance } from '../detail/segments.js';
import type { ChiefSegment } from '../fixtures/records.js';
import { parseMentionSegments } from '../overlay/mention-token.js';
import type { GroupedRow } from './thread-activity.js';

export interface TaskRef {
  todoId: string;
  seq: number | null;
  title: string | null;
  phase: TodoGlance['phase'];
}

export const MAX_TASK_REFS = 3;

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

interface RefSource {
  markdown?: string | undefined;
  paragraphs?: ChiefSegment[][] | undefined;
  bullets?: ChiefSegment[][] | undefined;
}

export function taskRefsOf(
  source: RefSource,
  glances: ReadonlyMap<string, TodoGlance>,
  started: readonly string[] = [],
): TaskRef[] {
  const found = new Map<string, TaskRef>();
  const add = (todoId: string) => {
    const glance = glances.get(todoId);
    if (glance === undefined || found.has(todoId)) return;
    found.set(todoId, {
      todoId,
      seq: glance.seq ?? null,
      title: glance.title ?? null,
      phase: glance.phase,
    });
  };
  if (source.markdown !== undefined) {
    for (const part of parseMentionSegments(source.markdown)) {
      if (part.kind === 'mention' && part.token.kind === 'todo') add(part.token.id);
    }
  }
  const seqs = new Set(
    [...(source.paragraphs ?? []), ...(source.bullets ?? [])]
      .flat()
      .flatMap((segment) => (segment.todo === undefined ? [] : [segment.todo])),
  );
  for (const [todoId, glance] of glances) {
    if (glance.seq !== undefined && seqs.has(glance.seq)) add(todoId);
  }
  const mentioned = [...found.values()].slice(0, MAX_TASK_REFS);
  const shown = new Set(mentioned.map((ref) => ref.todoId));
  found.clear();
  for (const todoId of started) if (!shown.has(todoId)) add(todoId);
  return [...mentioned, ...found.values()];
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

export function foldTaskCards(
  rows: readonly GroupedRow[],
  glances: ReadonlyMap<string, TodoGlance>,
): FoldedTaskCards {
  const kept: GroupedRow[] = [];
  const started = new Map<GroupedRow['item'], string[]>();
  let reply: GroupedRow['item'] | undefined;
  for (const row of rows) {
    if (row.item.kind === 'task-card') {
      if (reply !== undefined && glances.has(row.item.todoId)) {
        started.set(reply, [...(started.get(reply) ?? []), row.item.todoId]);
      } else {
        kept.push(row);
      }
      continue;
    }
    reply = row.item.kind === 'robot' ? row.item : undefined;
    kept.push(row);
  }
  return {
    rows: kept,
    startedBy: new Map([...started].map(([reply, ids]) => [reply, stableList(reply, ids)])),
  };
}

const placedLists = new WeakMap<object, { key: string; refs: readonly TaskRef[] }>();

function stableRefs(owner: object, refs: TaskRef[]): readonly TaskRef[] {
  const key = refs.map((ref) => `${ref.todoId}|${ref.phase}|${ref.title ?? ''}`).join('\n');
  const previous = placedLists.get(owner);
  if (previous !== undefined && previous.key === key) return previous.refs;
  placedLists.set(owner, { key, refs });
  return refs;
}

export function placeTaskRefs(
  rows: readonly GroupedRow[],
  startedBy: ReadonlyMap<GroupedRow['item'], readonly string[]>,
  glances: ReadonlyMap<string, TodoGlance>,
  seen: Set<string>,
): ReadonlyMap<GroupedRow['item'], readonly TaskRef[]> {
  const placed = new Map<GroupedRow['item'], readonly TaskRef[]>();
  for (const { item } of rows) {
    if (item.kind === 'task-card') seen.add(item.todoId);
    if (item.kind !== 'robot' || item.typing === true) continue;
    const refs = taskRefsOf({}, glances, startedBy.get(item) ?? []).filter(
      (ref) => !seen.has(ref.todoId) && glances.get(ref.todoId)?.internal !== true,
    );
    for (const ref of refs) seen.add(ref.todoId);
    if (refs.length > 0) placed.set(item, stableRefs(item, refs));
  }
  return placed;
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
