import type { ReactNode } from 'react';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface DeleteConfirmProps {
  /** Head title — the caller's canon copy (task: 确定删除该任务…). */
  title: string;
  /** Summary row: the doomed entity's label (task: #seq + title). */
  summary: ReactNode;
  /** Dialog aria-label (task: 删除任务). */
  ariaLabel: string;
  /** #73: retained-mount open flag — the exit fade outlives the close. */
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteConfirm({
  title,
  summary,
  ariaLabel,
  open,
  onClose,
  onConfirm,
}: DeleteConfirmProps) {
  const { t } = useI18n();
  return (
    <AlertDialogShell
      title={title}
      ariaLabel={ariaLabel}
      open={open}
      onClose={onClose}
      footer={
        <AlertDialogActions
          cancelLabel={t('取消')}
          confirmLabel={t('删除')}
          onCancel={onClose}
          onConfirm={onConfirm}
        />
      }
    >
      <div className="delete-confirm-summary flex items-center gap-2 overflow-hidden text-ui whitespace-nowrap text-foreground">
        {summary}
      </div>
    </AlertDialogShell>
  );
}
