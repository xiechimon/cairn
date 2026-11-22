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
  titlesNeedingProject,
} from '../src/board/tasks-sections.js';
import { threadCopy } from '../src/board/thread-copy.js';
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

describe('a task waiting on another task reads as waiting on it, not on a Runner', () => {
  const blocker = entry(1, 'building', 'working', { title: 'Build the forecast API' }).todo;
  const waiting = entry(2, 'queued', 'up_next', { blockedBy: [blocker.id], section: 'up_next' });
  const lookup = (id: string) => (id === blocker.id ? blocker : undefined);

  test('the up-next row names the task it waits for', () => {
    expect(taskRowCopy(waiting, undefined, lookup)).toMatchObject({
      word: '待开始',
      what: { key: '等「{title}」', params: { title: 'Build the forecast API' } },
    });
  });

  test('a blocker the panel does not list is counted, not named', () => {
    expect(taskRowCopy(waiting, undefined, () => undefined).what).toEqual({
      key: '等 {n} 个任务',
      params: { n: 1 },
    });
  });

  test('its status line no longer says it waits for a Runner', () => {
    expect(taskRowCopy(waiting, undefined, lookup).what.key).not.toMatch(/排队/);
    expect(threadCopy(waiting.todo).reason).toBe('等前置任务完成。');
  });
});

describe('a needs-you row says what is waiting and where to act', () => {
  test('a report awaiting acceptance does not suggest merging its linked PR', () => {
    const copy = taskRowCopy(entry(1, 'review', 'ready_for_review'), pr({}));
    expect(copy).toMatchObject({
      word: '待审阅',
      what: { key: '已就绪，等你审阅。' },
      where: null,
      waiting: true,
    });
  });

  test('linked PR failures do not change report acceptance copy', () => {
    const copy = taskRowCopy(
      entry(1, 'review', 'ready_for_review'),
      pr({ checks: { passed: 37, failed: 1, total: 38 } }),
    );
    expect(copy.what).toEqual({ key: '已就绪，等你审阅。' });
  });


  test('a report without a PR has no merge direction', () => {
    expect(taskRowCopy(entry(1, 'review', 'ready_for_review')).where).toBeNull();
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

  test('a failed task handed to the owner says it failed and where to handle it', () => {
    expect(taskRowCopy(entry(1, 'failed', 'needs_input'))).toMatchObject({
      word: '待处理',
      what: { key: '失败了，打开它重试。' },
      where: '到任务里处理',
      waiting: true,
    });
  });

  test('a blocked task handed to the owner says it is blocked', () => {
    expect(
      taskRowCopy(entry(1, 'building', 'needs_input', { blockedBy: ['todo-blocker'] })),
    ).toMatchObject({
      word: '待处理',
      what: { key: '已阻塞，等待你处理。' },
      where: '到任务里处理',
    });
  });

  test('a standalone Coordinator question points at the question card', () => {
    expect(questionRowCopy()).toMatchObject({ waiting: true, where: '在对话里回答' });
  });

  test('no waiting row asks the user to decide whether to merge', () => {
    const copies = [
      taskRowCopy(entry(1, 'review', 'ready_for_review')),
      taskRowCopy(entry(2, 'confirm', 'needs_input')),
      taskRowCopy(entry(3, 'needs_input', 'needs_input')),
    ];
    for (const copy of copies) {
      expect(copy.what.key).not.toContain('合并');
      expect(copy.where ?? '').not.toContain('合并');
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
    expect(taskRowCopy(entry(2, 'closed', 'resolved')).word).toBe('已归档');
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

describe('C10 the all-projects view names a project only where it tells two tasks apart', () => {
  test('a title one project owns needs no project; a title two projects share does', () => {
    const rows = [
      entry(1, 'queued', 'working', { title: 'Fix the login loop', projectId: 'pay' }),
      entry(2, 'queued', 'working', { title: 'Update the README', projectId: 'web' }),
      entry(3, 'todo', 'up_next', { title: 'Update the README', projectId: 'docs' }),
      entry(4, 'todo', 'up_next', { title: 'Fix the login loop', projectId: 'pay' }),
    ];
    expect([...titlesNeedingProject(rows)]).toEqual(['Update the README']);
  });
});
