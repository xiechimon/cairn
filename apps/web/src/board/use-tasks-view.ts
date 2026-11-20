import { useMemo } from 'react';
import { useTasks } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { withoutClosed } from '../fixtures/deletions.js';
import type { FixtureSet } from '../fixtures/records.js';
import { type TasksView, tasksFromFixture, tasksFromQuery } from './tasks-sections.js';

export function useTasksView(fixture: FixtureSet): TasksView {
  const { live, teamId } = useLiveData();
  const tasksQ = useTasks(teamId, live);
  return useMemo(
    () =>
      live
        ? tasksFromQuery(tasksQ.data)
        : tasksFromFixture(withoutClosed(fixture.todos), fixture.chief?.stream ?? []),
    [live, tasksQ.data, fixture],
  );
}
