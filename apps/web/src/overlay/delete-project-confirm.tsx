import { useEffect, useState } from 'react';
import { FORM_CONTROL_CLS, FormField, FormStack } from '../components/form-layout.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

interface DeleteProjectConfirmProps {
  projectName: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteProjectConfirm({
  projectName,
  open,
  onClose,
  onConfirm,
}: DeleteProjectConfirmProps) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const prompt = t('输入 {name} 以确认删除', { name: projectName });
  return (
    <AlertDialogShell
      title={t('确定删除该项目？此操作不可撤销。')}
      ariaLabel={t('删除项目')}
      open={open}
      onClose={onClose}
      footer={
        <AlertDialogActions
          cancelLabel={t('取消')}
          confirmLabel={t('删除')}
          onCancel={onClose}
          onConfirm={onConfirm}
          confirmDisabled={typed !== projectName}
        />
      }
    >
      <FormStack className="max-w-none">
        <div className="delete-confirm-summary flex items-center gap-2 overflow-hidden text-ui whitespace-nowrap text-foreground">
          {projectName}
        </div>
        <FormField label={prompt} htmlFor="delete-project-confirm-input">
          <Input
            id="delete-project-confirm-input"
            className={FORM_CONTROL_CLS}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
      </FormStack>
    </AlertDialogShell>
  );
}
