import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { attachFile } from '../api/attachments.js';
import { useApiMutations, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useOrchestrateStart } from '../chief/use-orchestrate-start.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { attachmentFailureTitle } from './attachment-paste.js';
import type { NewTaskDialogProps } from './new-task-dialog.js';

export interface NewTaskSurfaceOpts {
  onFixtureSave?: (spec: string) => void;
  anchorProjectId?: string;
}

export interface NewTaskSurface {
  openDialog: () => void;
  dialogProps: NewTaskDialogProps;
}

export function useNewTaskSurface(fixture: FixtureSet, opts: NewTaskSurfaceOpts = {}) {
  const { onFixtureSave, anchorProjectId } = opts;
  const { live, teamId } = useLiveData();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const openDialog = useCallback(() => setOpen(true), []);
  const closeDialog = useCallback(() => setOpen(false), []);
  const projectsQ = useProjects(teamId, live);
  const mutations = useApiMutations(teamId);

  const [liveSpec, setLiveSpec] = useState('');

  const { orchestrate } = useOrchestrateStart();

  const resolveProjectId = useCallback(
    (selectedProjectId?: string) => selectedProjectId ?? anchorProjectId ?? projectsQ.data?.[0]?.id,
    [anchorProjectId, projectsQ.data],
  );
  const createTodo = useCallback(
    (spec: string, selectedProjectId?: string) => {
      setOpen(false);
      setLiveSpec('');
      if (live) {
        const projectId = resolveProjectId(selectedProjectId);
        if (projectId) {
          mutations.createTodo.mutate(
            { projectId, spec },
            { onError: (error) => toastError(t('新建任务失败，请重试。'), error) },
          );
          return;
        }
        if (projectsQ.data === undefined) {
          toastError(t('新建任务失败，请重试。'), null);
          return;
        }
        mutations.createProject.mutate(
          { name: t('默认项目'), repoKind: 'hosted' },
          {
            onSuccess: (p) =>
              mutations.createTodo.mutate(
                { projectId: p.id, spec },
                { onError: (error) => toastError(t('新建任务失败，请重试。'), error) },
              ),
            onError: (error) => toastError(t('创建项目失败，请重试。'), error),
          },
        );
        return;
      }
      if (blockDemoWrite()) return;
      onFixtureSave?.(spec);
    },
    [
      live,
      resolveProjectId,
      projectsQ.data,
      mutations.createTodo,
      mutations.createProject,
      onFixtureSave,
      t,
    ],
  );

  const createAndStart = useCallback(
    (spec: string, selectedProjectId?: string) => {
      setOpen(false);
      setLiveSpec('');
      if (!live) {
        createTodo(spec, selectedProjectId);
        return;
      }
      const start = (projectId: string) =>
        mutations.createTodo.mutate(
          { projectId, spec },
          {
            onSuccess: (created) =>
              orchestrate(
                { id: created.id, seqNum: created.seqNum },
                { savedTitle: t('已保存，交给总管编排') },
              ),
            onError: (error) => toastError(t('新建任务失败，请重试。'), error),
          },
        );
      const projectId = resolveProjectId(selectedProjectId);
      if (projectId) start(projectId);
      else if (projectsQ.data === undefined) toastError(t('新建任务失败，请重试。'), null);
      else
        mutations.createProject.mutate(
          { name: t('默认项目'), repoKind: 'hosted' },
          {
            onSuccess: (p) => start(p.id),
            onError: (error) => toastError(t('创建项目失败，请重试。'), error),
          },
        );
    },
    [
      live,
      createTodo,
      mutations.createTodo,
      mutations.createProject,
      resolveProjectId,
      projectsQ.data,
      orchestrate,
      t,
    ],
  );

  const onAttachment = useCallback(
    async (files: File[]) => {
      const tokens: string[] = [];
      for (const file of files) {
        try {
          const r = await attachFile({ file, scope: 'spec' });
          tokens.push(r.token);
        } catch (err) {
          console.error('attachment failed', file.name, err);
          toast.error(t(attachmentFailureTitle(err)), { description: file.name });
        }
      }
      return tokens;
    },
    [t],
  );

  const projectRows = useMemo(() => {
    let rows: { id: string; name: string }[] | undefined;
    if (live) {
      rows = (projectsQ.data ?? []).map((p) => ({ id: p.id, name: p.name }));
    } else if (fixture.projectNames != null) {
      rows = Object.entries(fixture.projectNames).map(([id, name]) => ({ id, name }));
    }
    if (rows !== undefined && anchorProjectId !== undefined) {
      rows = [
        ...rows.filter((row) => row.id === anchorProjectId),
        ...rows.filter((row) => row.id !== anchorProjectId),
      ];
    }
    return rows;
  }, [live, projectsQ.data, fixture.projectNames, anchorProjectId]);

  const dialogProps: NewTaskDialogProps = {
    open,
    onClose: closeDialog,
    onSave: createTodo,
    onSaveAndStart: live ? createAndStart : undefined,
    projects: projectRows,
    ...(anchorProjectId === undefined ? { rememberProject: true } : {}),
    ...(live ? { spec: liveSpec, onSpecChange: setLiveSpec, onAttachment } : {}),
  };
  return { openDialog, dialogProps };
}
