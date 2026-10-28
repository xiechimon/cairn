import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Textarea } from '../components/ui/textarea.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';
import { FORM_TEXTAREA_CLS } from './parts.js';

interface CreateSecretDialogProps {
  open?: boolean;
  onClose: () => void;
  onCreate?: (input: { name: string; description?: string; value: string }) => void;
}

export function CreateSecretDialog({ open, onClose, onCreate }: CreateSecretDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === '' || value === '') return;
    if (onCreate != null) {
      onCreate({ name: trimmed, description: description.trim() || undefined, value });
    } else {
      blockDemoWrite();
      onClose();
    }
    setName('');
    setDescription('');
    setValue('');
  };
  return (
    <DialogShell
      title={t('添加密钥')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: t('添加密钥'),
            onClick: submit,
            disabled: name.trim() === '' || value === '',
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        <FormField label={t('名称（环境变量名）')} htmlFor="dlg-secret-name">
          <Input
            id="dlg-secret-name"
            className={FORM_CONTROL_CLS}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="STRIPE_API_KEY"
          />
        </FormField>
        <FormField label={t('描述（可选）')} htmlFor="dlg-secret-desc">
          <Input
            id="dlg-secret-desc"
            className={FORM_CONTROL_CLS}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('该密钥的用途')}
          />
        </FormField>
        <FormField
          label={t('值')}
          htmlFor="dlg-secret-value"
          help={t('值将加密存储，保存后无法再次查看。')}
        >
          <Textarea
            id="dlg-secret-value"
            className={FORM_TEXTAREA_CLS}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t('粘贴密钥的值')}
          />
        </FormField>
      </FormStack>
    </DialogShell>
  );
}
