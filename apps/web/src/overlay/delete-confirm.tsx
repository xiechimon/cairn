import type { ReactNode } from 'react';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface DeleteConfirmProps {
  title: string;
  summary: ReactNode;
  ariaLabel: string;
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
