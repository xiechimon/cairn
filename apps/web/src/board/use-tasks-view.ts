import { useMemo } from 'react';
import { useTasks } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { withoutClosed } from '../fixtures/deletions.js';
import type { FixtureSet } from '../fixtures/records.js';
import { useArchivedProjectIds } from './project-archive.js';
import { type TasksView, tasksFromFixture, tasksFromQuery } from './tasks-sections.js';

export function useTasksView(fixture: FixtureSet): TasksView {
  const { live, teamId } = useLiveData();
  const tasksQ = useTasks(teamId, live);
  const archived = useArchivedProjectIds(fixture);
  return useMemo(() => {
    const tasks = live
      ? tasksFromQuery(tasksQ.data)
      : tasksFromFixture(withoutClosed(fixture.todos), fixture.chief?.stream ?? []);
    return {
      entries: tasks.entries.filter(({ todo }) => !archived.has(todo.projectId)),
      questions: tasks.questions.filter(
        ({ projectId }) => projectId === null || !archived.has(projectId),
      ),
    };
  }, [live, tasksQ.data, fixture, archived]);
}
