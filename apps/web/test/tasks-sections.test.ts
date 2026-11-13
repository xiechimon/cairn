import type { PrPanelRow } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  ACTIVE_SECTIONS,
  bySection,
  needsYouBadge,
  questionOpenStep,
  questionRowCopy,
  scopeTasks,
  tasksFromQuery,
  type TaskEntry,
  type TaskSection,
  taskRowCopy,
} from '../src/board/tasks-sections.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { todo } from './helpers.js';

const entry = (
  seq: number,
  phase: TodoRecord['phase'],
  section: TaskSection,
  extra: Partial<TodoRecord> = {},
): TaskEntry => ({ todo: { ...todo(seq, phase), ...extra }, section });

const pr = (
  over: Omit<Partial<PrPanelRow>, 'checks'> & { checks?: Partial<PrPanelRow['checks']> },
): PrPanelRow => ({
  buildId: 'b1',
  threadId: 't1',
  projectId: null,
  repo: 'xiechimon/cairn',
  number: 3558,
  title: 'PR',
  url: 'https://github.com/xiechimon/cairn/pull/3558',
  state: 'open',
  mergeState: 'clean',
  additions: 1,
  deletions: 1,
  branch: 'b',
  base: 'main',
  head: 'abc',
  checksReadFor: 'abc',
  verdict: null,
  autoFix: true,
  mergeWhenReady: false,
  autoArchive: true,
  dismissed: false,
  blockedSince: null,
  wakeRounds: 0,
  lastReadAt: 0,
  ...over,
  checks: { passed: 41, failed: 0, running: 0, total: 41, failedNames: [], ...over.checks },
});

describe('a needs-you row says what is waiting and where to act', () => {
  test('a review with a green PR names the PR, its checks and the PR card', () => {
    const copy = taskRowCopy(entry(1, 'review', 'ready_for_review'), pr({}));
    expect(copy).toMatchObject({
      word: '待审阅',
      what: { key: 'PR #{n} 检查 {p}/{t} 通过', params: { n: 3558, p: 41, t: 41 } },
      where: '到 PR 卡合并',
      waiting: true,
    });
  });

  test('a review whose PR has failing checks says how many failed', () => {
    const copy = taskRowCopy(
      entry(1, 'review', 'ready_for_review'),
      pr({ checks: { passed: 37, failed: 1, total: 38 } }),
    );
    expect(copy.what).toEqual({ key: 'PR #{n} 有 {f} 项检查没过', params: { n: 3558, f: 1 } });
  });


  test('a review without a PR points at the changes in the task', () => {
    expect(taskRowCopy(entry(1, 'review', 'ready_for_review')).where).toBe('到任务里看改动');
  });

  test('a plan waiting for approval says so and where to approve it', () => {
    expect(taskRowCopy(entry(1, 'confirm', 'needs_input'))).toMatchObject({
      word: '待回答',
      what: { key: '计划写好了' },
      where: '到任务里批准计划',
    });
  });

  test('a question from the task points at the task', () => {
    expect(taskRowCopy(entry(1, 'needs_input', 'needs_input')).where).toBe('到任务里回答');
  });

  test('a standalone Coordinator question points at the question card', () => {
    expect(questionRowCopy()).toMatchObject({ waiting: true, where: '在对话里回答' });
  });

  test('no row says the old "ready, waiting for your review" line', () => {
    const copies = [
      taskRowCopy(entry(1, 'review', 'ready_for_review')),
      taskRowCopy(entry(2, 'confirm', 'needs_input')),
      taskRowCopy(entry(3, 'needs_input', 'needs_input')),
    ];
    for (const copy of copies) {
      expect(copy.what.key).not.toContain('等你审阅');
      expect(copy.where).not.toBeNull();
    }
  });
});

describe('rows that do not wait on the owner', () => {
  test('working rows have no action and carry the running dot only while a run is active', () => {
    expect(taskRowCopy(entry(1, 'building', 'working'))).toMatchObject({
      waiting: false,
      running: true,
      where: null,
      what: { key: '正在动手。' },
    });
    expect(taskRowCopy(entry(2, 'queued', 'working')).running).toBe(false);
  });

  test('a task the Coordinator owns says the Coordinator is on it', () => {
    const copy = taskRowCopy(entry(1, 'failed', 'working', { owner: 'coordinator' }));
    expect(copy.what.key).toBe('Coordinator 在跟进');
    expect(copy.waiting).toBe(false);
  });

  test('a failed task nobody owns yet waits for its automatic retry, not for the owner', () => {
    const copy = taskRowCopy(entry(1, 'failed', 'working'));
    expect(copy.what.key).toBe('失败了，等自动重试');
    expect(copy.where).toBeNull();
  });

  test('resolved rows name the phase and a merged PR', () => {
    expect(taskRowCopy(entry(1, 'done', 'resolved'), pr({ state: 'merged' }))).toMatchObject({
      word: '已完成',
      what: { key: 'PR #{n} 已合并', params: { n: 3558 } },
    });
    expect(taskRowCopy(entry(2, 'closed', 'resolved')).word).toBe('已关闭');
  });
});

describe('sections and the badge come from the server section, not the phase', () => {
  test('the active tab lists review, input and working only; resolved and up next have their own tabs', () => {
    expect(ACTIVE_SECTIONS).toEqual(['ready_for_review', 'needs_input', 'working']);
  });

  test('rows group by their section, newest first, whatever their phase says', () => {
    const groups = bySection([
      { ...entry(1, 'review', 'working'), todo: { ...todo(1, 'review'), phaseAt: 1 } },
      { ...entry(2, 'building', 'working'), todo: { ...todo(2, 'building'), phaseAt: 2 } },
      entry(3, 'confirm', 'needs_input'),
      entry(4, 'todo', 'up_next'),
    ]);
    expect(groups.working.map((row) => row.todo.seqNum)).toEqual([2, 1]);
    expect(groups.needs_input).toHaveLength(1);
    expect(groups.up_next).toHaveLength(1);
    expect(groups.ready_for_review).toHaveLength(0);
  });

  test('the badge counts needs-input and ready-for-review rows plus standalone questions', () => {
    const entries = [
      entry(1, 'review', 'ready_for_review'),
      entry(2, 'confirm', 'needs_input'),
      entry(3, 'review', 'working'),
      entry(4, 'done', 'resolved'),
    ];
    expect(needsYouBadge(entries, [{ requestId: 'q', threadId: null, header: 'h', createdAt: 0, projectId: null }])).toBe(3);
  });
});

describe('the panel reads the one Tasks query as the server sent it', () => {
  test('rows with a null section are dropped and questions keep their own list', () => {
    const wire = (seq: number, section: TaskSection | null) => ({
      ...todo(seq, 'review'),
      ownerId: null,
      createdBy: null,
      sourceBuildId: null,
      sourceKind: null,
      sourceRef: null,
      output: 'code' as const,
      owner: 'owner' as const,
      kind: 'todo' as const,
      section,
    });
    const view = tasksFromQuery({
      entries: [
        wire(1, 'ready_for_review'),
        wire(2, null),
        {
          kind: 'question',
          requestId: 'r1',
          threadId: 'th',
          projectId: 'p1',
          title: 'Remove Feishu entirely?',
          section: 'needs_input',
          createdAt: 5,
          content: { kind: 'ask_user_question', requestId: 'r1', status: 'pending', questions: [] },
        },
      ],
    } as unknown as Parameters<typeof tasksFromQuery>[0]);
    expect(view.entries.map((row) => [row.todo.seqNum, row.section])).toEqual([[1, 'ready_for_review']]);
    expect(view.questions).toEqual([
      {
        requestId: 'r1',
        threadId: 'th',
        header: 'Remove Feishu entirely?',
        createdAt: 5,
        projectId: 'p1',
      },
    ]);
  });

  test('a project lens keeps only that project, questions included', () => {
    const view = scopeTasks(
      {
        entries: [
          { ...entry(1, 'review', 'ready_for_review'), todo: { ...todo(1, 'review'), projectId: 'a' } },
          { ...entry(2, 'review', 'ready_for_review'), todo: { ...todo(2, 'review'), projectId: 'b' } },
        ],
        questions: [
          { requestId: 'x', threadId: null, header: 'h', createdAt: 0, projectId: 'a' },
          { requestId: 'y', threadId: null, header: 'h', createdAt: 0, projectId: null },
        ],
      },
      'a',
    );
    expect(view.entries.map((row) => row.todo.seqNum)).toEqual([1]);
    expect(view.questions.map((q) => q.requestId)).toEqual(['x']);
  });
});

describe('a question row opens the question in the Coordinator thread that asked it', () => {
  const pending = (requestId: string) => ({
    kind: 'question' as const,
    requestId,
    status: 'pending' as const,
    questions: [],
    answers: null,
  });
  const view = (over: Partial<Parameters<typeof questionOpenStep>[1]> = {}) => ({
    threadId: 'chief-a',
    stream: [pending('r0'), pending('r1')],
    hasEarlier: false,
    loadingEarlier: false,
    failedEarlier: false,
    dismissing: () => false,
    ...over,
  });

  test('a question in the open thread focuses its card', () => {
    expect(questionOpenStep({ requestId: 'r1', threadId: 'chief-a' }, view())).toEqual({
      kind: 'focus',
      at: 1,
    });
  });

  test('focus counts only the questions the project view shows', () => {
    const stream = [pending('a1'), pending('b1'), pending('b2')];
    const shown = new Set(['b1', 'b2']);
    expect(
      questionOpenStep({ requestId: 'b1', threadId: 'chief-a' }, view({ stream, shown })),
    ).toEqual({ kind: 'focus', at: 0 });
    expect(
      questionOpenStep({ requestId: 'b2', threadId: 'chief-a' }, view({ stream, shown })),
    ).toEqual({ kind: 'focus', at: 1 });
    expect(questionOpenStep({ requestId: 'b1', threadId: 'chief-a' }, view({ stream }))).toEqual({
      kind: 'focus',
      at: 1,
    });
  });

  test('a question from another thread opens that thread first', () => {
    expect(questionOpenStep({ requestId: 'r9', threadId: 'chief-b' }, view())).toEqual({
      kind: 'open-thread',
      threadId: 'chief-b',
    });
  });

  test('a question on an earlier page loads earlier messages until it appears', () => {
    const target = { requestId: 'r9', threadId: 'chief-a' };
    expect(questionOpenStep(target, view({ hasEarlier: true }))).toEqual({ kind: 'load-earlier' });
    expect(questionOpenStep(target, view({ hasEarlier: true, loadingEarlier: true }))).toEqual({
      kind: 'wait',
    });
  });

  test('a question that is gone, or whose pages fail to load, stops the search', () => {
    const target = { requestId: 'r9', threadId: 'chief-a' };
    expect(questionOpenStep(target, view())).toEqual({ kind: 'missing' });
    expect(questionOpenStep(target, view({ hasEarlier: true, failedEarlier: true }))).toEqual({
      kind: 'missing',
    });
  });

  test('a card in its dismiss-undo window is not counted, so the next row focuses its own card', () => {
    const shown = view({ stream: [pending('r0'), pending('r1'), pending('r2')], dismissing: (id) => id === 'r0' });
    expect(questionOpenStep({ requestId: 'r2', threadId: 'chief-a' }, shown)).toEqual({
      kind: 'focus',
      at: 1,
    });
  });

  test('the row of a question being dismissed selects no other card', () => {
    const shown = view({ hasEarlier: true, dismissing: (id) => id === 'r0' });
    expect(questionOpenStep({ requestId: 'r0', threadId: 'chief-a' }, shown)).toEqual({
      kind: 'missing',
    });
  });

  test('a fixture question without a thread belongs to the open conversation', () => {
    expect(questionOpenStep({ requestId: 'r0', threadId: null }, view({ threadId: null }))).toEqual({
      kind: 'focus',
      at: 0,
    });
  });
});
