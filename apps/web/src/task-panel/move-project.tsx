import { canMoveTodoProject } from '@cairn/shared';
import { useApiMutations, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ProjectMenu } from '../chief/project-menu.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export function MoveProjectLine({ todo }: { todo: TodoRecord }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const mutations = useApiMutations(teamId);
  const projects = (projectsQ.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));
  if (!live || projects.length < 2 || !canMoveTodoProject(todo)) return null;
  return (
    <div data-testid="task-panel-move" className="mt-1 text-meta text-content-tertiary">
      {t('还没开始，放错了可以')}
      <ProjectMenu
        title="挪到哪个项目"
        projects={projects}
        value={todo.projectId}
        withAuto={false}
        onPick={(projectId) => {
          if (projectId == null || projectId === todo.projectId) return;
          mutations.patchTodo.mutate(
            { id: todo.id, body: { projectId } },
            { onError: (e) => toastError(t('换项目失败，请重试。'), e) },
          );
        }}
        trigger={
          <Button variant="link" size="xs" className="h-auto px-1 text-meta underline-offset-2" />
        }
      >
        {t('换项目')}
      </ProjectMenu>
    </div>
  );
}
