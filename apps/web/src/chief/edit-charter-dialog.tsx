import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';

interface EditCharterDialogProps {
  open?: boolean;
  onClose: () => void;
  charter?: string;
  onSave?: (charter: string) => void;
}

export function EditCharterDialog({ open, onClose, charter, onSave }: EditCharterDialogProps) {
  const { t } = useI18n();
  const [text, setText] = useState(charter ?? '');
  useEffect(() => {
    if (open) setText(charter ?? '');
  }, [open, charter]);
  const save = () => {
    if (onSave != null) onSave(text);
    else onClose();
  };
  return (
    <DialogShell
      title={t('编辑章程')}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button className={DIALOG_PRIMARY_BUTTON} onClick={save}>
            {t('保存章程')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea
          className="min-h-30 text-ui md:text-ui"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('长期指令：模型路由规则（何种任务使用何种模型）、优先级、偏好…')}
        />
      </div>
    </DialogShell>
  );
}
