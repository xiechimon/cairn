import { IN_PROGRESS_PHASES } from '@cairn/shared';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { AcceptTaskDialog } from './accept-task-dialog.js';
import { StopAndDoneConfirm } from './stop-and-done-confirm.js';

const UNFINISHABLE_PHASES: readonly string[] = ['done', 'closed', 'failed'];

export function canMarkDone(todo: TodoRecord): boolean {
  return todo.archivedAt == null && !UNFINISHABLE_PHASES.includes(todo.phase);
}

function stopAndDoneErrorCopy(error: unknown, t: TFunc): string {
  if (error instanceof ApiError && error.status === 404) return t('这个任务已经不存在。');
  if (error instanceof ApiError && error.status === 409)
    return t('任务状态刚刚变了，请刷新后再试。');
  return t('标记完成没有成功，请重试。');
}

export function useMarkDone(todo: TodoRecord): { markDone: () => void; dialogs: ReactNode } {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [dialog, setDialog] = useState<'accept' | 'stop' | null>(null);
  const stopAndDone = () => {
    setDialog(null);
    if (!live) {
      blockDemoWrite();
      return;
    }
    mutations.stopAndDoneTodo.mutate(todo.id, {
      onSuccess: (result) =>
        toastSuccess(
          result.state === 'stopping'
            ? t('已通知停止，执行端确认后任务会标记为完成。')
            : t('任务已标记完成。'),
        ),
      onError: (error) => toastError(stopAndDoneErrorCopy(error, t), null),
    });
  };
  const markDone = () => {
    if (todo.phase === 'review') setDialog('accept');
    else if ((IN_PROGRESS_PHASES as readonly string[]).includes(todo.phase)) setDialog('stop');
    else stopAndDone();
  };
  const dialogs = (
    <>
      {dialog === 'accept' && (
        <AcceptTaskDialog
          todo={todo}
          buildId={todo.latestBuildId}
          open
          onClose={() => setDialog(null)}
          substantiveChanges={null}
          infoOutput={todo.output === 'info'}
          mergeLocked={false}
          guardDemoWrites
        />
      )}
      <StopAndDoneConfirm
        open={dialog === 'stop'}
        onClose={() => setDialog(null)}
        onConfirm={stopAndDone}
      />
    </>
  );
  return { markDone, dialogs };
}
