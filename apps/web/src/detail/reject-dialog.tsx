import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Label } from '../components/ui/label.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';

interface RejectDialogProps {
  open?: boolean;
  onClose: () => void;
  onConfirm?: (feedback: string) => void;
  rejectReason?: string | null;
}

export function RejectDialog({ open, onClose, onConfirm, rejectReason }: RejectDialogProps) {
  const { t } = useI18n();
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    if (open) setFeedback('');
  }, [open]);
  const trimmed = feedback.trim();
  const label = t('需要修改什么？打回后任务回到规划中，按反馈重新出方案。');
  return (
    <DialogShell
      title={t('请求修改')}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            disabled={trimmed === ''}
            onClick={() => onConfirm?.(trimmed)}
          >
            {t('请求修改')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <Label className="text-ui leading-tight font-medium text-foreground">{label}</Label>
        <Textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          rows={3}
          className="text-ui md:text-ui"
          placeholder={label}
        />
      </div>
      {rejectReason != null && (
        <p className="text-meta text-(--destructive)" role="alert">
          {rejectReason}
        </p>
      )}
    </DialogShell>
  );
}
