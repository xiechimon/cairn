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

interface RenameThreadDialogProps {
  initialTitle: string;
  onClose: () => void;
  onSave: (title: string) => void;
}

export function RenameThreadDialog({ initialTitle, onClose, onSave }: RenameThreadDialogProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialTitle);
  const title = value.trim();
  const save = () => {
    if (title !== '') onSave(title);
  };
  return (
    <DialogShell
      title={t('重命名线程')}
      onClose={onClose}
      size="s"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            data-testid="thread-rename-confirm"
            className={DIALOG_PRIMARY_BUTTON}
            disabled={title === ''}
            onClick={save}
          >
            {t('保存')}
          </Button>
        </>
      }
    >
      <div className="px-5 pt-3 pb-4">
        <FormField label={t('标题')} htmlFor="thread-rename-input">
          <Input
            className={FORM_CONTROL_CLS}
            id="thread-rename-input"
            data-testid="thread-rename-input"
            value={value}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }}
          />
        </FormField>
      </div>
    </DialogShell>
  );
}
