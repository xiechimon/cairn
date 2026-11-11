import type { PrPanelRow, TasksQuery, TodoSection } from '@cairn/shared';
import { toDisplayTodo } from '../api/mappers.js';
import type { GlyphKind } from '../components/status-glyph.js';
import type { ChiefStreamItem, TodoRecord } from '../fixtures/records.js';
import { pendingQuestions } from './needs-you.js';
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

function prWhat(pr: PrPanelRow): Phrase {
  const { passed, failed, running, total } = pr.checks;
  if (failed > 0) return { key: 'PR #{n} 有 {f} 项检查没过', params: { n: pr.number, f: failed } };
  if (running > 0 || total === 0) return { key: 'PR #{n} 检查还在跑', params: { n: pr.number } };
  return { key: 'PR #{n} 检查 {p}/{t} 通过', params: { n: pr.number, p: passed, t: total } };
}

function openPr(pr: PrPanelRow | undefined): PrPanelRow | undefined {
  return pr !== undefined && (pr.state === 'open' || pr.state === 'draft') ? pr : undefined;
}

export function taskRowCopy(entry: TaskEntry, pr?: PrPanelRow): TaskRowCopy {
  const { todo, section } = entry;
  const base = { waiting: isWaiting(section), running: false };
  switch (section) {
    case 'ready_for_review': {
      const live = openPr(pr);
      if (live !== undefined)
        return { ...base, word: '待审阅', what: prWhat(live), where: '到 PR 卡合并' };
      return { ...base, word: '待审阅', what: { key: '改动写好了' }, where: '到任务里看改动' };
    }
    case 'needs_input':
      if (todo.phase === 'confirm')
        return { ...base, word: '待回答', what: { key: '计划写好了' }, where: '到任务里批准计划' };
      return { ...base, word: '待回答', what: { key: '在问你一个问题' }, where: '到任务里回答' };
    case 'working': {
      const running = todo.phase === 'planning' || todo.phase === 'building';
      const what: Phrase =
        todo.owner === 'coordinator'
          ? { key: 'Coordinator 在跟进' }
          : todo.phase === 'failed'
            ? { key: '失败了，等自动重试' }
            : { key: threadCopy(todo).reason };
      return { ...base, running, word: '进行中', what, where: null };
    }
    case 'resolved': {
      const word = todo.phase === 'closed' ? '已关闭' : '已完成';
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
      return { ...base, word: '待开始', what: { key: '还没开始' }, where: null };
  }
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
      return 'ring';
  }
}

export function questionRowCopy(): TaskRowCopy {
  return {
    word: '待回答',
    what: { key: 'Coordinator 建任务前先问你' },
    where: '在问题卡里选',
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

export const NO_TASKS: TasksView = { entries: [], questions: [] };

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
  | { kind: 'focus'; at: number }
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
    const at = pending
      .filter(
        (question) =>
          !view.dismissing(question.requestId) &&
          (view.shown == null || view.shown.has(question.requestId)),
      )
      .findIndex((question) => question.requestId === target.requestId);
    return at < 0 ? { kind: 'missing' } : { kind: 'focus', at };
  }
  if (!view.hasEarlier || view.failedEarlier) return { kind: 'missing' };
  return view.loadingEarlier ? { kind: 'wait' } : { kind: 'load-earlier' };
}
