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
  for (const row of rows) {
    const reply = kept.at(-1)?.item;
    if (row.item.kind === 'task-card' && reply?.kind === 'robot' && glances.has(row.item.todoId)) {
      started.set(reply, [...(started.get(reply) ?? []), row.item.todoId]);
      continue;
    }
    kept.push(row);
  }
  return {
    rows: kept,
    startedBy: new Map([...started].map(([reply, ids]) => [reply, stableList(reply, ids)])),
  };
}
