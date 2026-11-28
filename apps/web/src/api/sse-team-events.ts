import {
  type BuildRecord,
  IN_PROGRESS_PHASES,
  isChiefConversationId,
  isWaitingPhase,
  type ParsedSearchQuery,
  parseSearchQuery,
  type SearchResponse,
  type TodoRecord,
} from '@cairn/shared';
import type { QueryKey } from '@tanstack/react-query';

export type StreamQueryEvent =
  | { type: 'todo'; teamId: string; doc: TodoRecord; previous?: TodoRecord | undefined }
  | {
      type: 'build';
      teamId: string;
      doc: BuildRecord;
      projectId?: string | undefined;
      parent?: TodoRecord | undefined;
    }
  | {
      type: 'notification' | 'machine_presence' | 'computer.state' | 'chief.updated';
      teamId: string;
    }
  | {
      type: 'message';
      teamId: string;
      conversationId: string;
      targetId: string;
      deliveredFromId?: string | undefined;
      todoId?: string | undefined;
    }
  | {
      type: 'step';
      teamId: string;
      conversationId: string;
      todoId?: string | undefined;
      status: string;
    }
  | {
      type: 'doubao.login';
      teamId: string;
      machineId: string;
      status: string;
    }
  | { type: 'reconnect' }
  | { type: 'reconcile'; teamId: string };

export type QueryEffect = 'cancel' | 'stale' | 'ignore';

const reconciled = new Set([
  'projects',
  'todos',
  'todo',
  'tasks',
  'schedules',
  'build',
  'steps',
  'notifications',
  'chiefThreads',
  'chief',
  'machines',
  'messages',
  'plans',
  'changes',
  'usage',
  'design',
  'doubao-subscriptions',
  'doubao-login',
  'projectBuilds',
  'search',
  'model-routing',
  'frequent-models',
]);

function containsLike(title: string, word: string): boolean {
  const fold = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return fold(title).includes(fold(word));
}

function searchMembership(
  term: string,
  parsed: ParsedSearchQuery,
  todo: TodoRecord,
  build?: BuildRecord,
): boolean | undefined {
  if (parsed.filters.length === 0) return containsLike(todo.title, term);
  if (parsed.words.some(({ text, negated }) => containsLike(todo.title, text) === negated))
    return false;

  const positive = new Map<string, (boolean | undefined)[]>();
  let uncertain = false;
  for (const { key, condition, negated, value } of parsed.filters) {
    if (condition === null) {
      if (!negated) return false;
      continue;
    }
    let matches: boolean | undefined;
    switch (condition.key) {
      case 'is':
        switch (condition.state) {
          case 'waiting':
            matches = isWaitingPhase(todo.phase);
            break;
          case 'running':
            matches = IN_PROGRESS_PHASES.some((phase) => phase === todo.phase);
            break;
          case 'done':
            matches = todo.phase === 'done' || todo.phase === 'closed';
            break;
          default:
            matches = todo.phase === condition.state;
        }
        break;
      case 'after':
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) matches = todo.phaseAt >= condition.sinceMs;
        break;
      case 'pr':
        if (
          build?.prNumber != null &&
          (condition.number === 'any' || condition.number === build.prNumber)
        )
          matches = true;
        break;
    }
    if (negated) {
      if (matches === true) return false;
      if (matches === undefined) uncertain = true;
    } else {
      const group = positive.get(key) ?? [];
      group.push(matches);
      positive.set(key, group);
    }
  }
  for (const group of positive.values()) {
    if (group.includes(true)) continue;
    if (!group.includes(undefined)) return false;
    uncertain = true;
  }
  return uncertain ? undefined : true;
}

function searchEffect(
  event: Extract<StreamQueryEvent, { type: 'todo' | 'build' }>,
  term: unknown,
  data: unknown,
): QueryEffect {
  if (typeof term !== 'string' || term.trim() === '') return 'ignore';
  const parsed = parseSearchQuery(term, 0);
  if (parsed.filters.some(({ condition, negated }) => condition === null && !negated))
    return 'ignore';
  const wasListed = (id: string) =>
    (data as SearchResponse | undefined)?.todos?.some((row) => row.id === id) === true;
  if (event.type === 'build') {
    if (
      !parsed.filters.some(({ condition }) => condition?.key === 'pr' || condition?.key === 'cost')
    )
      return 'ignore';
    if (wasListed(event.doc.todoId)) return 'cancel';
    if (event.parent === undefined) return 'stale';
    if (searchMembership(term, parsed, event.parent, event.doc) === true) return 'cancel';
    return searchMembership(term, parsed, event.parent) === false ? 'ignore' : 'stale';
  }
  const current = searchMembership(term, parsed, event.doc);
  if (wasListed(event.doc.id) || current === true) return 'cancel';
  if (event.previous === undefined)
    return event.doc.v === 1 && current === false ? 'ignore' : 'stale';
  if (Math.abs(event.doc.v - event.previous.v) > 1) return 'stale';
  const previous = searchMembership(term, parsed, event.previous);
  if (previous === true) return 'cancel';
  return previous === false && current === false ? 'ignore' : 'stale';
}

export function streamEventQueryEffect(
  event: StreamQueryEvent,
  [kind, id, third]: QueryKey,
  data?: unknown,
): QueryEffect {
  switch (event.type) {
    case 'reconnect':
      return 'cancel';
    case 'reconcile':
      return (typeof kind === 'string' && reconciled.has(kind)) ||
        (kind === 'computers' && id === event.teamId)
        ? 'cancel'
        : 'ignore';
    case 'todo': {
      const { doc, previous, teamId } = event;
      if (kind === 'search') return searchEffect(event, id, data);
      if (kind === 'projectBuilds') {
        const hasBuilds = (todo: TodoRecord) =>
          todo.latestBuildId !== null || todo.buildHistory.length > 0;
        return (id === doc.projectId && hasBuilds(doc)) ||
          (previous !== undefined && id === previous.projectId && hasBuilds(previous))
          ? 'cancel'
          : 'ignore';
      }
      if (kind === 'steps' || kind === 'messages') {
        return typeof id === 'string' &&
          (id === doc.latestBuildId || id === previous?.latestBuildId)
          ? 'cancel'
          : 'ignore';
      }
      return ((kind === 'todos' || kind === 'tasks') && id === teamId) ||
        ((kind === 'todo' || kind === 'design') && id === doc.id) ||
        kind === 'schedules' ||
        kind === 'plans'
        ? 'cancel'
        : 'ignore';
    }
    case 'build': {
      const { doc, teamId } = event;
      if (kind === 'search') return searchEffect(event, id, data);
      if (kind === 'projectBuilds' && typeof id === 'string') {
        const owner = event.projectId ?? event.parent?.projectId;
        if (owner !== undefined) return id === owner ? 'cancel' : 'ignore';
        return (data as BuildRecord[] | undefined)?.some((row) => row.todoId === doc.todoId)
          ? 'cancel'
          : 'stale';
      }
      return ((kind === 'todos' || kind === 'tasks') && id === teamId) ||
        ((kind === 'todo' || kind === 'design') && id === doc.todoId) ||
        ((kind === 'build' || kind === 'steps' || kind === 'plans' || kind === 'changes') &&
          id === doc.id) ||
        (kind === 'messages' && id === doc.id && doc.reportAttachmentId != null)
        ? 'cancel'
        : 'ignore';
    }
    case 'notification':
      return id === event.teamId &&
        (kind === 'notifications' || kind === 'chiefThreads' || kind === 'chief')
        ? 'cancel'
        : 'ignore';
    case 'machine_presence':
      return id === event.teamId &&
        (kind === 'machines' ||
          kind === 'antigravity-subscriptions' ||
          kind === 'doubao-subscriptions' ||
          kind === 'model-sources' ||
          kind === 'computers' ||
          kind === 'model-routing')
        ? 'cancel'
        : 'ignore';
    case 'doubao.login':
      if (kind === 'doubao-login') {
        return id === event.teamId && third === event.machineId ? 'cancel' : 'ignore';
      }
      if (event.status === 'succeeded') {
        return id === event.teamId &&
          (kind === 'doubao-subscriptions' ||
            kind === 'machines' ||
            kind === 'model-sources' ||
            kind === 'model-routing' ||
            kind === 'todos' ||
            kind === 'tasks')
          ? 'cancel'
          : 'ignore';
      }
      return 'ignore';
    case 'computer.state':
      return kind === 'computers' && id === event.teamId ? 'cancel' : 'ignore';
    case 'chief.updated':
      return id === event.teamId &&
        (kind === 'chief' || kind === 'chiefThreads' || kind === 'routing-settings')
        ? 'cancel'
        : 'ignore';
    case 'message':
      return (kind === 'messages' &&
        (id === event.conversationId ||
          id === event.targetId ||
          (event.deliveredFromId !== undefined && id === event.deliveredFromId))) ||
        kind === 'plans' ||
        (kind === 'todo' && event.todoId !== undefined && id === event.todoId) ||
        (kind === 'tasks' && isChiefConversationId(event.conversationId))
        ? 'cancel'
        : 'ignore';
    case 'step': {
      const terminal = ['done', 'failed', 'stopped'].includes(event.status);
      const chief = isChiefConversationId(event.conversationId);
      return (id === event.conversationId &&
        ((typeof kind === 'string' && ['build', 'steps', 'changes', 'usage'].includes(kind)) ||
          (kind === 'messages' && (terminal || (chief && event.status === 'claimed'))))) ||
        (kind === 'doubao-subscriptions' &&
          id === event.teamId &&
          (terminal || event.status === 'claimed')) ||
        kind === 'plans' ||
        (kind === 'todo' && event.todoId !== undefined && id === event.todoId) ||
        (chief && (kind === 'chiefThreads' || (kind === 'chief' && terminal)))
        ? 'cancel'
        : 'ignore';
    }
  }
}
