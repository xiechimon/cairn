import type { TodoGlance } from '../detail/segments.js';
import type { ChiefSegment } from '../fixtures/records.js';
import { parseMentionSegments } from '../overlay/mention-token.js';

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

export function taskRefsOf(source: RefSource, glances: ReadonlyMap<string, TodoGlance>): TaskRef[] {
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
  return [...found.values()].slice(0, MAX_TASK_REFS);
}
