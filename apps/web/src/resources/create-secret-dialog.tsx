import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { FORM_TEXTAREA_CLS } from './parts.js';

interface CreateSecretDialogProps {
  open?: boolean;
  onClose: () => void;
  onCreate?: (input: {
    name: string;
    description?: string;
    value: string;
    projectId?: string;
  }) => void;
  projects?: readonly { id: string; name: string }[];
  defaultProjectId?: string | null;
}

export function CreateSecretDialog({
  open,
  onClose,
  onCreate,
  projects = [],
  defaultProjectId = null,
}: CreateSecretDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState(defaultProjectId ?? '');
  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === '' || value === '') return;
    if (onCreate != null) {
      onCreate({
        name: trimmed,
        description: description.trim() || undefined,
        value,
        ...(scope !== '' ? { projectId: scope } : {}),
      });
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
        {projects.length > 0 && (
          <FormField
            label={t('范围')}
            htmlFor="dlg-secret-scope"
            help={t('项目密钥只发给该项目的 thread，同名时优先于团队密钥。')}
          >
            <Select
              items={[
                { value: '', label: t('全团队') },
                ...projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
              value={scope}
              onValueChange={(next) => setScope(next ?? '')}
            >
              <SelectTrigger
                id="dlg-secret-scope"
                data-testid="secret-scope"
                className={FORM_CONTROL_CLS}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="">{t('全团队')}</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormField>
        )}
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
