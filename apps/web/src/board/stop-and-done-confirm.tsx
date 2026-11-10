import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

export function StopAndDoneConfirm({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialogShell
      title={t('停止并标记完成？')}
      ariaLabel={t('停止并标记完成')}
      open={open}
      onClose={onClose}
      footer={
        <AlertDialogActions
          cancelLabel={t('取消')}
          confirmLabel={t('停止并完成')}
          onCancel={onClose}
          onConfirm={onConfirm}
        />
      }
    >
      <p className="m-0 text-ui text-foreground">
        {t('正在运行的工作会被停止，任务随即标记为完成。')}
      </p>
    </AlertDialogShell>
  );
}
