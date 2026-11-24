import { useState } from 'react';
import { useSubmitFeedback } from '../api/hooks.js';
import { useI18n } from '../i18n/provider.js';
import { Button } from './ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from './ui/dialog-shell.js';
import { Textarea } from './ui/textarea.js';
import { toastError, toastSuccess } from './ui/toaster.js';

export function FeedbackDialog({
  open,
  onClose,
  route,
  errorSummary,
}: {
  open: boolean;
  onClose: () => void;
  route?: string;
  errorSummary?: string;
}) {
  const { t } = useI18n();
  const submit = useSubmitFeedback();
  const [message, setMessage] = useState(errorSummary ?? '');

  if (!open) return null;

  const handleSubmit = () => {
    const trimmed = message.trim();
    if (trimmed === '') return;
    submit.mutate(
      {
        message: trimmed,
        ...(route !== undefined ? { route } : {}),
        ...(errorSummary !== undefined ? { errorSummary } : {}),
      },
      {
        onSuccess: (res) => {
          toastSuccess(t('已收到反馈（编号 {id}）', { id: res.id }));
          setMessage('');
          onClose();
        },
        onError: (err) => toastError(t('提交反馈失败，请重试'), err),
      },
    );
  };

  return (
    <DialogShell
      title={t('反馈问题')}
      subtitle={t('自动附带系统平台、当前页面与脱敏状态，不会上传密钥或代码。')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            disabled={submit.isPending || message.trim() === ''}
            onClick={handleSubmit}
            data-testid="feedback-submit"
          >
            {t('提交反馈')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {errorSummary !== undefined && (
          <p className="m-0 rounded-md bg-surface-muted px-3 py-2 text-meta text-content-secondary">
            {errorSummary}
          </p>
        )}
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t('简单描述遇到了什么问题…')}
          rows={4}
          data-testid="feedback-textarea"
          className="resize-none"
        />
      </div>
    </DialogShell>
  );
}
