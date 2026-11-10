import { useEffect, useState } from 'react';
import { useApiMutations, useBuildGate, usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { AcceptDialog } from '../detail/accept-dialog.js';
import { mergePreselected, mergeRejectCopy } from '../detail/merge-gate.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

interface AcceptTaskDialogProps {
  todo: TodoRecord;
  buildId: string | null;
  open: boolean;
  onClose: () => void;
  substantiveChanges: boolean | null;
  infoOutput: boolean;
  mergeLocked: boolean;
  guardDemoWrites?: boolean;
}

export function AcceptTaskDialog({
  todo,
  buildId,
  open,
  onClose,
  substantiveChanges,
  infoOutput,
  mergeLocked,
  guardDemoWrites = false,
}: AcceptTaskDialogProps) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const pr = usePrs(teamId, todo.id, live).data?.[0];
  const gate = useBuildGate(buildId, live && open && pr !== undefined).data?.state;
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  useEffect(() => {
    if (open) setRejectReason(null);
  }, [open]);
  const confirm = (merge: boolean) => {
    if (buildId == null) {
      setRejectReason(t('任务数据未就绪，完成请求未送出。请刷新页面后重试。'));
      return;
    }
    if (!merge) {
      mutations.patchTodo.mutate(
        { id: todo.id, body: { phase: 'done' } },
        {
          onSuccess: () => {
            onClose();
            toastSuccess(t('任务已完成，改动保留在会话分支。'));
          },
          onError: (error) =>
            setRejectReason(mergeRejectCopy(error, t, t('完成请求未送出，请重试。'))),
        },
      );
      return;
    }
    mutations.mergeBuild.mutate(buildId, {
      onSuccess: () => {
        onClose();
        toastSuccess(t('已发起合并，合并完成后任务进入已完成。'));
      },
      onError: (error) => setRejectReason(mergeRejectCopy(error, t)),
    });
  };
  const blockedConfirm = () => {
    blockDemoWrite();
    onClose();
  };
  return (
    <AcceptDialog
      open={open}
      onClose={onClose}
      rejectReason={rejectReason}
      substantiveChanges={live ? substantiveChanges : null}
      mergeLocked={mergeLocked}
      mergeByDefault={!live || mergePreselected({ hasPr: pr !== undefined, gate: gate ?? null })}
      infoOutput={infoOutput}
      {...(pr !== undefined ? { pr: { number: pr.number, url: pr.url } } : {})}
      confirming={mutations.mergeBuild.isPending || mutations.patchTodo.isPending}
      {...(live ? { onConfirm: confirm } : guardDemoWrites ? { onConfirm: blockedConfirm } : {})}
    />
  );
}
