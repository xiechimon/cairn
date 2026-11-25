import type { TasksQuery, TodoRecord as WireTodo } from '@cairn/shared';
import { QueryClient } from '@tanstack/react-query';
import type { KeyboardEvent } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { applyTeamStreamEvent, onTodoDeleted } from '../src/api/team-stream-cache.js';
import { canShowFullFile } from '../src/board/side-chat.js';
import { deleteTaskDetailKey } from '../src/board/task-row-menu.js';
import { taskRowCopy } from '../src/board/tasks-sections.js';
import * as threadActions from '../src/board/thread-actions.js';
import * as threadCopyModule from '../src/board/thread-copy.js';
import { replyRouteOf } from '../src/board/use-thread-chat.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { useComposerWire } from '../src/overlay/composer-wire.js';
import { todo } from './helpers.js';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useId: () => 'test-id',
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useState: (value: unknown) => [value, vi.fn()],
  };
});
vi.mock('../src/i18n/provider.js', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function keyboard(key: string, modifiers: Partial<KeyboardEvent<HTMLTextAreaElement>> = {}) {
  return {
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    nativeEvent: { isComposing: false },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...modifiers,
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

describe('C12 task lifecycle safety (web)', () => {
  test('P1-1: stopped task replies route to message endpoint instead of queue/continue', () => {
    expect(replyRouteOf('stopped', [{ status: 'stopped' }])).toBe('message');
    expect(replyRouteOf('stopped', [])).toBe('message');
  });

  test('P1-2: confirm phase menu Done action completes the task instead of approving the plan', () => {
    const completeMenuIntent = (
      threadActions as { completeMenuIntent?: (phase: TodoRecord['phase']) => string }
    ).completeMenuIntent;
    expect(completeMenuIntent).toBeTypeOf('function');
    expect(completeMenuIntent?.('confirm')).toBe('stop-and-done');
    expect(completeMenuIntent?.('review')).toBe('complete');
    expect(completeMenuIntent?.('building')).toBe('stop-and-done');
  });

  test('P1-3: review phase exposes explicit review actions and warns that replying requests revisions', () => {
    const ownerReview: TodoRecord = { ...todo(1, 'review'), owner: 'owner', section: 'ready_for_review' };
    const coordinatorReview: TodoRecord = { ...todo(2, 'review'), owner: 'coordinator', section: 'working' };
    expect(threadActions.threadActionOf(ownerReview, false)).toBe('review');
    expect(threadActions.threadActionOf(coordinatorReview, false)).toBeNull();
    expect(threadActions.threadActionOf(ownerReview, true)).toBeNull();

    const composerPlaceholderOf = (
      threadCopyModule as {
        composerPlaceholderOf?: (record: TodoRecord, started: boolean) => string;
      }
    ).composerPlaceholderOf;
    expect(composerPlaceholderOf).toBeTypeOf('function');
    expect(composerPlaceholderOf?.(ownerReview, true)).toBe('需要修改？回复返工意见…');
    expect(composerPlaceholderOf?.(coordinatorReview, true)).toBe('回复这个任务');
    expect(composerPlaceholderOf?.(todo(3, 'todo'), false)).toBe('开始后才能回复');
  });

  test('P1-4: task composer Escape never silently stops a running task or submits an unfinished draft', () => {
    const onSend = vi.fn();
    const onQueue = vi.fn();
    const onDraftChange = vi.fn();
    const wire = useComposerWire({
      editable: true,
      draft: 'Unfinished thought',
      onDraftChange,
      onSend,
      onQueue,
    });
    wire.handleKeyDown(keyboard('Escape'));
    wire.handleKeyDown(keyboard('Escape'));
    expect(onSend).not.toHaveBeenCalled();
    expect(onQueue).not.toHaveBeenCalled();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  test('P1-6: archived done task renders archived label instead of done label', () => {
    const archivedDone: TodoRecord = { ...todo(1, 'done'), archivedAt: 1_700_000_000_000 };
    expect(taskRowCopy({ todo: archivedDone, section: 'resolved' }).word).toBe('已归档');
  });

  test('P1-7: todo_deleted SSE event removes the task from todos and tasks caches', () => {
    const qc = new QueryClient();
    const teamId = 'team-1';
    const wire = {
      ...todo(1, 'building'),
      id: 'todo-del-1',
      teamId,
      projectId: 'proj-1',
      ownerId: null,
      createdBy: null,
      sourceBuildId: null,
      sourceKind: null,
      sourceRef: null,
      output: 'code',
      owner: null,
      section: 'working',
    } as unknown as WireTodo;
    qc.setQueryData<WireTodo[]>(['todos', teamId], [wire]);
    qc.setQueryData<WireTodo>(['todo', wire.id], wire);
    qc.setQueryData<TasksQuery>(['tasks', teamId], {
      entries: [{ kind: 'todo', ...wire, section: 'working' }],
    });

    const deleted: string[] = [];
    const unsubscribe = onTodoDeleted((id) => deleted.push(id));
    try {
      applyTeamStreamEvent(qc, teamId, {
        type: 'todo_deleted',
        todoId: wire.id,
        projectId: 'proj-1',
      });
    } finally {
      unsubscribe();
    }

    expect(deleted).toEqual([wire.id]);
    expect(qc.getQueryData<WireTodo[]>(['todos', teamId])).toEqual([]);
    expect(qc.getQueryData<TasksQuery>(['tasks', teamId])?.entries).toEqual([]);
    expect(qc.getQueryData<WireTodo>(['todo', wire.id])).toBeUndefined();
  });

  test('P1-5: full file toggle hides for unsupported github/unbound live projects and shows for hosted/local', () => {
    expect(canShowFullFile(true, 'hosted', false)).toBe(true);
    expect(canShowFullFile(true, 'local', false)).toBe(true);
    expect(canShowFullFile(true, 'github', false)).toBe(false);
    expect(canShowFullFile(true, undefined, false)).toBe(false);
    expect(canShowFullFile(false, undefined, true)).toBe(true);
    expect(canShowFullFile(false, undefined, false)).toBe(false);
  });

  test('P1-7: delete confirmation detail warns about running state and linked schedules', () => {
    expect(deleteTaskDetailKey(todo(1, 'building'), true)).toContain('正在运行中');
    expect(deleteTaskDetailKey(todo(1, 'building'), true)).toContain('定时任务');
    expect(deleteTaskDetailKey(todo(1, 'building'), false)).toContain('正在运行中');
    expect(deleteTaskDetailKey(todo(1, 'review'), true)).toContain('定时任务');
    expect(deleteTaskDetailKey(todo(1, 'review'), false)).toBeNull();
  });
});
