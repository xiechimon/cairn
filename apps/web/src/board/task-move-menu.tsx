import { canMoveTodoProject } from '@cairn/shared';
import { FolderInput } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import {
  KeyedMenuRadioItem,
  KeyedMenuSubContent,
  KeyedMenuSubTrigger,
} from '../components/menu-keys.js';
import { DropdownMenuRadioGroup, DropdownMenuSub } from '../components/ui/dropdown-menu.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { TodoRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { splitProjectsByArchive } from './project-archive.js';

interface MoveTarget {
  id: string;
  name: string;
}

function useMoveTargets(): MoveTarget[] {
  const { live, teamId } = useLiveData();
  const [searchParams] = useSearchParams();
  const projects = useProjects(teamId, live);
  if (live) return splitProjectsByArchive(projects.data ?? []).active;
  return Object.entries(resolveScenario(searchParams).projectNames ?? {}).map(([id, name]) => ({
    id,
    name,
  }));
}

export function MoveToProjectSub({ todo }: { todo: TodoRecord }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const targets = useMoveTargets();
  if (!canMoveTodoProject(todo) || targets.length < 2) return null;
  const move = (projectId: string) => {
    if (projectId === todo.projectId) return;
    if (!live) {
      blockDemoWrite();
      return;
    }
    const name = targets.find((target) => target.id === projectId)?.name ?? '';
    mutations.patchTodo.mutate(
      { id: todo.id, body: { projectId } },
      {
        onSuccess: () => toastSuccess(t('任务已移到 {project}', { project: name })),
        onError: (error) => toastError(t('移动任务失败，请重试。'), error),
      },
    );
  };
  return (
    <DropdownMenuSub>
      <KeyedMenuSubTrigger shortcut="M" data-action="move">
        <FolderInput />
        {t('移到项目')}
      </KeyedMenuSubTrigger>
      <KeyedMenuSubContent
        aria-label={t('移到项目')}
        data-testid="task-move-projects"
        className="w-auto min-w-40"
      >
        <DropdownMenuRadioGroup value={todo.projectId} onValueChange={move}>
          {targets.map((target) => (
            <KeyedMenuRadioItem key={target.id} value={target.id} data-project={target.id}>
              {target.name}
            </KeyedMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </KeyedMenuSubContent>
    </DropdownMenuSub>
  );
}
