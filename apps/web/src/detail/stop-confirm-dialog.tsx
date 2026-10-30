import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface StopConfirmDialogProps {
  open?: boolean;
  onClose: () => void;
  onConfirm: (discard: boolean) => void;
  queued?: boolean;
}

export function StopConfirmDialog({ open, onClose, onConfirm, queued }: StopConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={queued ? t('停止排队？') : t('丢弃本轮修改？')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            variant="destructive"
            className={DIALOG_PRIMARY_BUTTON}
            onClick={() => onConfirm(!queued)}
          >
            {queued ? t('停止') : t('丢弃修改')}
          </Button>
        </>
      }
    >
      <p className="m-0 text-ui text-foreground">
        {queued ? t('任务回到排队前的状态。') : t('丢弃本轮修改——方案和代码回到上一个版本')}
      </p>
    </DialogShell>
  );
}
