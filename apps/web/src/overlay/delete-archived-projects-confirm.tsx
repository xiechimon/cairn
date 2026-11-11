import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface DeleteArchivedProjectsConfirmProps {
  count: number;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteArchivedProjectsConfirm({
  count,
  open,
  onClose,
  onConfirm,
}: DeleteArchivedProjectsConfirmProps) {
  const { t } = useI18n();
  return (
    <AlertDialogShell
      title={t('删除 {n} 个已归档的项目？', { n: count })}
      ariaLabel={t('全部删除')}
      open={open}
      onClose={onClose}
      footer={
        <AlertDialogActions
          cancelLabel={t('取消')}
          confirmLabel={t('全部删除')}
          onCancel={onClose}
          onConfirm={onConfirm}
        />
      }
    >
      <p className="m-0 text-ui text-foreground">
        {t('它们的对话、任务和仍在进行的工作会一起删除，无法恢复。')}
      </p>
    </AlertDialogShell>
  );
}
