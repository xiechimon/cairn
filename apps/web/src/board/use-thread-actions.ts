import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { markArchived, markResolved, markUnarchived } from '../fixtures/deletions.js';
import type { TodoRecord } from '../fixtures/records.js';
import { setFixtureSnooze } from '../fixtures/snooze.js';
import { useI18n } from '../i18n/provider.js';
import { presetInstant, type SnoozeRequest } from './snooze-presets.js';

export interface ThreadActions {
  archive: (todos: readonly TodoRecord[]) => void;
  unarchive: (todos: readonly TodoRecord[]) => void;
  snooze: (todos: readonly TodoRecord[], request: SnoozeRequest) => void;
  unsnooze: (todos: readonly TodoRecord[]) => void;
  resolve: (todos: readonly TodoRecord[]) => void;
}

export function useThreadActions(): ThreadActions {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);

  const settle = (runs: Promise<unknown>[], done: () => void, failure: string) => {
    void Promise.allSettled(runs).then((results) => {
      const failed = results.find((r) => r.status === 'rejected');
      if (failed === undefined) done();
      else toastError(t(failure), (failed as PromiseRejectedResult).reason);
    });
  };

  const unarchive = (todos: readonly TodoRecord[]) => {
    if (!live) {
      if (blockDemoWrite()) return;
      for (const todo of todos) markUnarchived(todo.id);
      return;
    }
    settle(
      todos.map((todo) => mutations.setTodoArchived.mutateAsync({ id: todo.id, archived: false })),
      () => {},
      'Could not unarchive task.',
    );
  };

  const archive = (todos: readonly TodoRecord[]) => {
    const announce = () =>
      toastSuccess(
        todos.length === 1 ? t('Task archived') : t('已归档 {n} 个 thread', { n: todos.length }),
        {
          label: t('Undo'),
          onClick: () => unarchive(todos),
        },
      );
    if (!live) {
      if (blockDemoWrite()) return;
      for (const todo of todos) markArchived(todo.id);
      announce();
      return;
    }
    settle(
      todos.map((todo) => mutations.setTodoArchived.mutateAsync({ id: todo.id, archived: true })),
      announce,
      'Could not archive task.',
    );
  };

  const unsnooze = (todos: readonly TodoRecord[]) => {
    if (!live) {
      for (const todo of todos) setFixtureSnooze(todo.id, { snoozeMode: null, snoozedUntil: null });
      return;
    }
    settle(
      todos.map((todo) => mutations.unsnoozeTodo.mutateAsync(todo.id)),
      () => {},
      '无法取消暂停。',
    );
  };

  const snooze = (todos: readonly TodoRecord[], request: SnoozeRequest) => {
    const announce = () =>
      toastSuccess(
        todos.length === 1 ? t('线程已暂停') : t('已暂停 {n} 个 thread', { n: todos.length }),
        {
          label: t('撤销'),
          onClick: () => unsnooze(todos),
        },
      );
    if (!live) {
      if (blockDemoWrite()) return;
      const until =
        request === 'needed'
          ? null
          : typeof request === 'number'
            ? request
            : presetInstant(request, Date.now());
      for (const todo of todos) {
        setFixtureSnooze(todo.id, {
          snoozeMode: request === 'needed' ? 'needed' : 'until',
          snoozedUntil: until,
        });
      }
      announce();
      return;
    }
    settle(
      todos.map((todo) => mutations.snoozeTodo.mutateAsync({ id: todo.id, until: request })),
      announce,
      '无法暂停线程。',
    );
  };

  const resolve = (todos: readonly TodoRecord[]) => {
    const announce = () =>
      toastSuccess(
        todos.length === 1
          ? t('已解决 1 个 thread')
          : t('已解决 {n} 个 thread', { n: todos.length }),
      );
    if (!live) {
      if (blockDemoWrite()) return;
      for (const todo of todos) markResolved(todo.id);
      announce();
      return;
    }
    settle(
      todos.map((todo) => mutations.resolveTodo.mutateAsync(todo.id)),
      announce,
      '无法解决 thread，请重试。',
    );
  };

  return { archive, unarchive, snooze, unsnooze, resolve };
}
