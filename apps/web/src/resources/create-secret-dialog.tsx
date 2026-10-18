// 添加密钥 dialog (wayfinder #173, r2 §242 field authority): rides
// DialogShell (#68 family law — X / Esc / backdrop). Field set verbatim:
// 名称（环境变量名）/ 描述（可选）/ 值 textarea + the encrypted-storage
// note + 添加密钥 submit. Live submit = mutations.createSecret (POST
// /api/teams/:id/secrets, 02 §8 值只写不读 — the value never echoes back);
// fixture follows the accept-dialog 律 (#148: close on submit).
//
// Paper 表单（DESIGN.md 页面模式 · 表单）：FormStack / FormField，32px 带框
// 控件，footer = FormActions（取消 + 添加密钥，不是整宽提交条）。label 的
// htmlFor/id 配对是 getByLabel 一级载体依赖的语义资产。

import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { FORM_TEXTAREA_CLS } from './parts.js';

interface CreateSecretDialogProps {
  /** #73 retained-mount open flag. */
  open?: boolean;
  onClose: () => void;
  /** M5 live 面：添加 = POST secrets；缺省 = fixture 律（提交即关）。 */
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
      <FormStack className="py-1">
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
