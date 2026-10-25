import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
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
  const [discard, setDiscard] = useState(true);
  return (
    <DialogShell
      title={queued === true ? t('停止排队？') : t('停止当前这一轮？')}
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
            onClick={() => onConfirm(discard)}
          >
            {t('停止')}
          </Button>
        </>
      }
    >
      {queued === true ? (
        <p className="m-0 text-ui text-foreground">{t('任务回到排队前的状态。')}</p>
      ) : (
        <div className="flex items-center gap-2">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */}
          <label className="inline-flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={discard}
              onCheckedChange={setDiscard}
              aria-label={t('丢弃本轮修改——方案和代码回到上一个版本')}
            />
            <span className="text-ui text-foreground">
              {t('丢弃本轮修改——方案和代码回到上一个版本')}
            </span>
          </label>
        </div>
      )}
    </DialogShell>
  );
}
