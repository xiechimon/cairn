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
    <AlertDialogShell title={title} ariaLabel={ariaLabel} open={open} onClose={onClose}>
      {/* #948 per-face 清零：summary 行规则迁 utility（16px 侧距/8px gap/单行
          截断，Paper 4px 网格）；.delete-confirm-seq 的 tertiary 墨随消费点
          （schedules-page / todo-detail-page）各自的 utility 走。 */}
      <div className="delete-confirm-summary mx-4 mt-4 flex h-4 items-center gap-2 overflow-hidden text-ui leading-4 whitespace-nowrap text-foreground">
        {summary}
      </div>
      <AlertDialogActions
        cancelLabel={t('取消')}
        confirmLabel={t('删除')}
        onCancel={onClose}
        onConfirm={onConfirm}
      />
    </AlertDialogShell>
  );
}
