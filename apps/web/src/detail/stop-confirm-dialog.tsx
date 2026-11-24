import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface StopConfirmDialogProps {
  open?: boolean;
  onClose: () => void;
  onConfirm: (discard: boolean) => void;
  queued?: boolean;
}

export function StopConfirmDialog({
  open = true,
  onClose,
  onConfirm,
  queued,
}: StopConfirmDialogProps) {
  const { t } = useI18n();
  const title = queued ? t('停止排队？') : t('丢弃本轮修改？');
  return (
    <AlertDialogShell
      title={title}
      ariaLabel={title}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <AlertDialogActions
          cancelLabel={t('取消')}
          confirmLabel={queued ? t('停止') : t('丢弃修改')}
          onCancel={onClose}
          onConfirm={() => onConfirm(!queued)}
        />
      }
    >
      <p className="m-0 text-ui text-foreground">
        {queued ? t('任务回到排队前的状态。') : t('丢弃本轮修改——方案和代码回到上一个版本')}
      </p>
    </AlertDialogShell>
  );
}
