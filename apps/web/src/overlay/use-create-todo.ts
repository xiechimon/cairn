import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useApiMutations, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';

export function useCreateTodo(onFixtureSave?: (spec: string) => void) {
  const { live, teamId } = useLiveData();
  const { t } = useI18n();
  const navigate = useNavigate();
  const projectsQ = useProjects(teamId, live);
  const mutations = useApiMutations(teamId);

  const targetProject = useCallback(
    async (chosen: string | null): Promise<string> => {
      const known = chosen ?? projectsQ.data?.[0]?.id;
      if (known !== undefined) return known;
      if (projectsQ.data === undefined) throw new Error(t('项目列表还没加载'));
      try {
        const created = await mutations.createProject.mutateAsync({
          name: t('默认项目'),
          repoKind: 'hosted',
        });
        return created.id;
      } catch (error) {
        toastError(t('创建项目失败，请重试。'), error);
        throw error;
      }
    },
    [projectsQ.data, mutations.createProject, t],
  );

  return useCallback(
    async (spec: string, projectId: string | null): Promise<void> => {
      if (!live) {
        if (blockDemoWrite()) throw new Error('demo');
        onFixtureSave?.(spec);
        toastSuccess(t('已存为草稿'));
        return;
      }
      const target = await targetProject(projectId).catch((error: unknown) => {
        if (projectsQ.data === undefined) toastError(t('新建任务失败，请重试。'), error);
        throw error;
      });
      try {
        const created = await mutations.createTodo.mutateAsync({ projectId: target, spec });
        toastSuccess(t('已存为草稿'), {
          label: t('打开'),
          onClick: () => navigate(`/app/todo/${created.id}`),
        });
      } catch (error) {
        toastError(t('新建任务失败，请重试。'), error);
        throw error;
      }
    },
    [live, onFixtureSave, mutations.createTodo, targetProject, projectsQ.data, navigate, t],
  );
}
