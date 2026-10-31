import { useState } from 'react';
import { FORM_CONTROL_CLS, FormField } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';
import { localInputValue } from './snooze-presets.js';

const DEFAULT_LEAD_MS = 60 * 60 * 1000;

interface SnoozeConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function SnoozeConfirmDialog({ open, onClose, onConfirm }: SnoozeConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={t('暂停，直到需要我')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            data-testid="snooze-confirm"
            className={DIALOG_PRIMARY_BUTTON}
            onClick={onConfirm}
          >
            {t('暂停')}
          </Button>
        </>
      }
    >
      <p className="px-5 pt-3 pb-4 text-ui text-content-secondary">
        {t('这个线程会移出列表，并且不再推送。智能体需要你时，它会自动回来。')}
      </p>
    </DialogShell>
  );
}

interface SnoozePickDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (at: number) => void;
}

export function SnoozePickDialog({ open, onClose, onConfirm }: SnoozePickDialogProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(() => localInputValue(Date.now() + DEFAULT_LEAD_MS));
  const at = value === '' ? Number.NaN : new Date(value).getTime();
  const valid = Number.isFinite(at) && at > Date.now();
  return (
    <DialogShell
      title={t('选择唤醒时间')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            data-testid="snooze-pick-confirm"
            className={DIALOG_PRIMARY_BUTTON}
            disabled={!valid}
            onClick={() => onConfirm(at)}
          >
            {t('暂停')}
          </Button>
        </>
      }
    >
      <div className="px-5 pt-3 pb-4">
        <FormField
          label={t('唤醒时间')}
          htmlFor="snooze-pick-input"
          help={valid ? undefined : t('请选择一个未来的时间。')}
        >
          <Input
            className={FORM_CONTROL_CLS}
            id="snooze-pick-input"
            data-testid="snooze-pick-input"
            type="datetime-local"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </FormField>
      </div>
    </DialogShell>
  );
}
