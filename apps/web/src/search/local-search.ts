import type {
  ParsedSearchQuery,
  SearchFilterCondition,
  SearchFilterResult,
  SearchIsState,
} from '@cairn/shared';
import { isWaitingPhase } from '@cairn/shared';
import { usageCostKnown } from '../api/mappers.js';
import type { TodoRecord } from '../fixtures/records.js';

const IS_PHASES: Record<SearchIsState, (todo: TodoRecord) => boolean> = {
  failed: (todo) => todo.phase === 'failed',
  waiting: (todo) => isWaitingPhase(todo.phase),
  review: (todo) => todo.phase === 'review',
  running: (todo) => ['queued', 'planning', 'building'].includes(todo.phase),
  done: (todo) => todo.phase === 'done' || todo.phase === 'closed',
  snoozed: (todo) => todo.snoozeMode != null,
};

function matchesCondition(
  condition: SearchFilterCondition,
  todo: TodoRecord,
  projectName: string | undefined,
): boolean {
  switch (condition.key) {
    case 'is':
      return IS_PHASES[condition.state](todo);
    case 'project':
      return projectName?.toLowerCase() === condition.name.toLowerCase();
    case 'pr':
      return false;
    case 'by':
      return (todo.agent?.displayName ?? '').toLowerCase().includes(condition.name.toLowerCase());
    case 'after':
      return todo.phaseAt >= condition.sinceMs;
    case 'cost': {
      const cost =
        todo.usageCost !== undefined && usageCostKnown(todo.usageCost)
          ? todo.usageCost.total
          : null;
      if (cost === null) return false;
      return condition.op === '>' ? cost > condition.dollars : cost < condition.dollars;
    }
  }
}

export interface LocalSearch {
  todos: TodoRecord[];
  filters: SearchFilterResult[];
}

export function searchTodosLocally(
  todos: readonly TodoRecord[],
  projectName: (projectId: string) => string | undefined,
  parsed: ParsedSearchQuery,
): LocalSearch {
  const projectNames = new Set(todos.map((todo) => projectName(todo.projectId)?.toLowerCase()));
  const resolved = parsed.filters.map((filter) => {
    const condition = filter.condition;
    let reason: SearchFilterResult['reason'] = filter.problem ?? undefined;
    if (condition?.key === 'project' && !projectNames.has(condition.name.toLowerCase())) {
      reason = 'unknown_project';
    }
    return { filter, condition: reason === undefined ? condition : null, reason };
  });
  const filters: SearchFilterResult[] = resolved.map(({ filter, reason }) => ({
    key: filter.key,
    raw: filter.raw,
    value: filter.value,
    negated: filter.negated,
    valid: reason === undefined,
    ...(reason === undefined ? {} : { reason }),
  }));
  if (resolved.some(({ condition, filter }) => condition === null && !filter.negated)) {
    return { todos: [], filters };
  }
  const usable = resolved.flatMap(({ condition, filter }) =>
    condition === null ? [] : [{ condition, negated: filter.negated }],
  );
  const matched = todos.filter((todo) => {
    const name = projectName(todo.projectId);
    const positive = new Map<string, boolean>();
    for (const { condition, negated } of usable) {
      const hit = matchesCondition(condition, todo, name);
      if (negated) {
        if (hit) return false;
      } else {
        positive.set(condition.key, (positive.get(condition.key) ?? false) || hit);
      }
    }
    if ([...positive.values()].some((hit) => !hit)) return false;
    return parsed.words.every((word) => {
      const contains = todo.title.toLowerCase().includes(word.text.toLowerCase());
      return word.negated ? !contains : contains;
    });
  });
  return { todos: matched, filters };
}
