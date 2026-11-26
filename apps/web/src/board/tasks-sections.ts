import type { PrPanelRow, TasksQuery, TodoSection } from '@cairn/shared';
import { toDisplayTodo } from '../api/mappers.js';
import type { GlyphKind } from '../components/status-glyph.js';
import type { ChiefStreamItem, TodoRecord } from '../fixtures/records.js';
import { pendingQuestions } from './needs-you.js';
import { isWaitingToRetry, todoRetryPhrase } from './retry-copy.js';
import { threadCopy } from './thread-copy.js';

export type TaskSection = TodoSection;

const TASK_SECTIONS: readonly TaskSection[] = [
  'ready_for_review',
  'needs_input',
  'working',
  'resolved',
  'up_next',
];

export const ACTIVE_SECTIONS = ['ready_for_review', 'needs_input', 'working'] as const;

export type ActiveSection = (typeof ACTIVE_SECTIONS)[number];

export const SECTION_LABEL: Record<TaskSection, string> = {
  ready_for_review: '待你审阅',
  needs_input: '待你回答',
  working: '进行中',
  resolved: '已解决',
  up_next: '待开始',
};

export interface TaskEntry {
  todo: TodoRecord;
  section: TaskSection;
}

export interface StandaloneQuestion {
  requestId: string;
  threadId: string | null;
  header: string;
  createdAt: number;
  projectId: string | null;
}

export interface Phrase {
  key: string;
  params?: Record<string, string | number>;
}

export interface TaskRowCopy {
  word: string;
  what: Phrase;
  where: string | null;
  waiting: boolean;
  running: boolean;
}

const WAITING: ReadonlySet<TaskSection> = new Set(['ready_for_review', 'needs_input']);

export function isWaiting(section: TaskSection): boolean {
  return WAITING.has(section);
}

function waitsForPhrase(
  todo: TodoRecord,
  lookup: (id: string) => TodoRecord | undefined,
): Phrase | null {
  if (todo.phase === 'todo') return null;
  const open = (todo.blockedBy ?? []).filter((id) => lookup(id)?.phase !== 'done');
  if (open.length === 0) return null;
  const only = open.length === 1 ? lookup(open[0] ?? '') : undefined;
  return only === undefined
    ? { key: '等 {n} 个任务', params: { n: open.length } }
    : { key: '等「{title}」', params: { title: only.title } };
}

export function taskRowCopy(
  entry: TaskEntry,
  pr?: PrPanelRow,
  lookup: (id: string) => TodoRecord | undefined = () => undefined,
): TaskRowCopy {
  const { todo, section } = entry;
  const base = { waiting: isWaiting(section), running: false };
  const retryPhrase = todoRetryPhrase(todo);
  switch (section) {
    case 'ready_for_review':
      return {
        ...base,
        word: '待审阅',
        what: { key: threadCopy(todo).reason },
        where: null,
      };
    case 'needs_input': {
      if (todo.phase === 'confirm')
        return { ...base, word: '待回答', what: { key: '计划写好了' }, where: '到任务里批准计划' };
      if (todo.phase === 'needs_input')
        return { ...base, word: '待回答', what: { key: '在问你一个问题' }, where: '到任务里回答' };
      const what: Phrase =
        (todo.blockedBy?.length ?? 0) > 0
          ? { key: '已阻塞，等待你处理。' }
          : (retryPhrase ??
            (todo.phase === 'failed' && todo.missingCommand != null && todo.missingCommand !== ''
              ? { key: '缺少命令 {command}', params: { command: todo.missingCommand } }
              : { key: threadCopy(todo).reason }));
      return { ...base, word: '待处理', what, where: '到任务里处理' };
    }
    case 'working': {
      const running =
        (todo.phase === 'planning' || todo.phase === 'building') &&
        todo.quotaWait == null &&
        todo.waitingOn?.on !== 'quota';
      const what: Phrase =
        retryPhrase !== null
          ? retryPhrase
          : todo.owner === 'coordinator'
            ? { key: 'Coordinator 在跟进' }
            : todo.phase === 'failed'
              ? todo.missingCommand != null && todo.missingCommand !== ''
                ? { key: '缺少命令 {command}', params: { command: todo.missingCommand } }
                : { key: '即将自动重试（第 {attempt} 次）', params: { attempt: 1 } }
              : { key: threadCopy(todo).reason };
      return { ...base, running, word: '进行中', what, where: null };
    }
    case 'resolved': {
      const word = todo.phase === 'closed' ? '已归档' : '已完成';
      if (pr?.state === 'merged')
        return {
          ...base,
          word,
          what: { key: 'PR #{n} 已合并', params: { n: pr.number } },
          where: null,
        };
      return { ...base, word, what: { key: threadCopy(todo).reason }, where: null };
    }
    case 'up_next':
      return {
        ...base,
        word: '待开始',
        what: waitsForPhrase(todo, lookup) ?? { key: '尚未开始' },
        where: null,
      };
  }
}

export function titlesNeedingProject(entries: readonly TaskEntry[]): ReadonlySet<string> {
  const projectsOf = new Map<string, Set<string | null>>();
  for (const { todo } of entries) {
    const projects = projectsOf.get(todo.title) ?? new Set<string | null>();
    projects.add(todo.projectId ?? null);
    projectsOf.set(todo.title, projects);
  }
  return new Set(
    [...projectsOf].filter(([, projects]) => projects.size > 1).map(([title]) => title),
  );
}

export function unfinishableLead(todo: TaskEntry['todo']): { glyph: GlyphKind; why: string } {
  if (isWaitingToRetry(todo)) {
    return { glyph: 'queued', why: '等待自动重试，重新运行后才能完成' };
  }
  if (todo.phase === 'failed') return { glyph: 'failed', why: '运行失败，重新运行后才能完成' };
  if (todo.phase === 'stopped') return { glyph: 'failed', why: '已停止，重新运行后才能完成' };
  if (todo.phase === 'closed') return { glyph: 'closed', why: '已归档' };
  if (todo.phase === 'done') return { glyph: 'done', why: '已完成' };
  return { glyph: 'todo', why: '已归档，不能标记完成' };
}

export function glyphOf(entry: TaskEntry): GlyphKind {
  switch (entry.section) {
    case 'ready_for_review':
      return 'three-quarter';
    case 'needs_input':
      return 'half';
    case 'resolved':
      return entry.todo.phase === 'closed' ? 'closed' : 'done';
    case 'up_next':
      return 'todo';
    case 'working':
      return entry.todo.quotaWait != null ||
        entry.todo.waitingOn?.on === 'quota' ||
        isWaitingToRetry(entry.todo)
        ? 'queued'
        : 'ring';
  }
}

export function questionRowCopy(): TaskRowCopy {
  return {
    word: '待回答',
    what: { key: 'Coordinator 建任务前先问你' },
    where: '在对话里回答',
    waiting: true,
    running: false,
  };
}

export function bySection(entries: readonly TaskEntry[]): Record<TaskSection, TaskEntry[]> {
  const out: Record<TaskSection, TaskEntry[]> = {
    ready_for_review: [],
    needs_input: [],
    working: [],
    resolved: [],
    up_next: [],
  };
  for (const entry of entries) out[entry.section].push(entry);
  for (const section of TASK_SECTIONS) out[section].sort((a, b) => b.todo.phaseAt - a.todo.phaseAt);
  return out;
}

export function needsYouBadge(
  entries: readonly TaskEntry[],
  questions: readonly StandaloneQuestion[],
): number {
  return entries.filter((entry) => isWaiting(entry.section)).length + questions.length;
}

export interface TasksView {
  entries: TaskEntry[];
  questions: StandaloneQuestion[];
}

export function tasksFromQuery(query: TasksQuery | undefined): TasksView {
  const view: TasksView = { entries: [], questions: [] };
  for (const entry of query?.entries ?? []) {
    if (entry.kind === 'question') {
      view.questions.push({
        requestId: entry.requestId,
        threadId: entry.threadId,
        header: entry.title,
        createdAt: entry.createdAt,
        projectId: entry.projectId,
      });
    } else if (entry.section != null) {
      view.entries.push({ todo: toDisplayTodo(entry), section: entry.section });
    }
  }
  return view;
}

export function tasksFromFixture(
  todos: readonly TodoRecord[],
  stream: readonly ChiefStreamItem[],
): TasksView {
  return {
    entries: todos.flatMap((todo) =>
      todo.section == null ? [] : [{ todo, section: todo.section }],
    ),
    questions: pendingQuestions(stream).map((question) => ({
      requestId: question.requestId,
      threadId: null,
      header: question.questions[0]?.header ?? '',
      createdAt: 0,
      projectId: null,
    })),
  };
}

export function scopeTasks(view: TasksView, projectId: string | null): TasksView {
  if (projectId === null) return view;
  return {
    entries: view.entries.filter((entry) => entry.todo.projectId === projectId),
    questions: view.questions.filter((question) => question.projectId === projectId),
  };
}

export type QuestionTarget = Pick<StandaloneQuestion, 'requestId' | 'threadId'>;

export interface QuestionThreadView {
  threadId: string | null;
  stream: readonly ChiefStreamItem[];
  hasEarlier: boolean;
  loadingEarlier: boolean;
  failedEarlier: boolean;
  dismissing: (requestId: string) => boolean;
  shown?: ReadonlySet<string> | null;
}

export type QuestionOpenStep =
  | { kind: 'open-thread'; threadId: string }
  | { kind: 'focus'; requestId: string }
  | { kind: 'load-earlier' }
  | { kind: 'wait' }
  | { kind: 'missing' };

export function questionOpenStep(
  target: QuestionTarget,
  view: QuestionThreadView,
): QuestionOpenStep {
  if (target.threadId !== null && target.threadId !== view.threadId)
    return { kind: 'open-thread', threadId: target.threadId };
  const pending = pendingQuestions(view.stream);
  if (pending.some((question) => question.requestId === target.requestId)) {
    if (view.dismissing(target.requestId)) return { kind: 'missing' };
    if (view.shown != null && !view.shown.has(target.requestId)) return { kind: 'missing' };
    return { kind: 'focus', requestId: target.requestId };
  }
  if (!view.hasEarlier || view.failedEarlier) return { kind: 'missing' };
  return view.loadingEarlier ? { kind: 'wait' } : { kind: 'load-earlier' };
}
