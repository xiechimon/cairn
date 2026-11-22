import { isCredentialSecretName, SECRET_NAME_PATTERN, type SecretListEntry } from '@cairn/shared';
import { useRef, useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { Checkbox } from '../components/ui/checkbox.js';
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

export interface SecretDraft {
  name: string;
  value: string;
  secret: boolean;
  projectId?: string;
}

interface SecretDialogProps {
  open?: boolean;
  onClose: () => void;
  onSave?: (draft: SecretDraft) => void;
  editing?: SecretListEntry | null;
  startSecret?: boolean;
  projects?: readonly { id: string; name: string }[];
  defaultProjectId?: string | null;
}

export function SecretDialog({
  open,
  onClose,
  onSave,
  editing = null,
  startSecret = false,
  projects = [],
  defaultProjectId = null,
}: SecretDialogProps) {
  const { t } = useI18n();
  const wasSecret = editing !== null && editing.kind !== 'env';
  const [name, setName] = useState(editing?.name ?? '');
  const [value, setValue] = useState(editing?.kind === 'env' ? (editing.value ?? '') : '');
  const [secretChoice, setSecretChoice] = useState<boolean | null>(
    wasSecret || startSecret ? true : editing === null ? null : false,
  );
  const [scope, setScope] = useState(defaultProjectId ?? '');
  const [valueTouched, setValueTouched] = useState(false);
  const valueRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = name.trim();
  const secret = secretChoice ?? isCredentialSecretName(trimmed);
  const nameChecked = editing === null || trimmed !== editing.name;
  const nameInvalid = nameChecked && trimmed !== '' && !SECRET_NAME_PATTERN.test(trimmed);
  const valueMissing = secret && value === '' && !wasSecret;
  const showValueError = valueMissing && valueTouched;
  const canSave = trimmed !== '' && !nameInvalid && !valueMissing;
  const converting = editing !== null && !wasSecret && secret;
  const problem = nameInvalid
    ? t('名称要符合环境变量格式（例如 MY_VAR）')
    : showValueError
      ? t('机密的值不能为空')
      : null;
  const submit = () => {
    if (!canSave) return;
    if (onSave === undefined) {
      onClose();
      return;
    }
    onSave({
      name: trimmed,
      value,
      secret,
      ...(scope !== '' && editing === null ? { projectId: scope } : {}),
    });
  };
  const title =
    editing === null ? t('添加密钥或环境变量') : t('编辑 {name}', { name: editing.name });
  return (
    <DialogShell
      title={title}
      open={open}
      onClose={onClose}
      size="s"
      initialFocus={startSecret ? valueRef : undefined}
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: editing === null ? t('添加') : converting ? t('保存并转为机密') : t('保存'),
            onClick: submit,
            disabled: !canSave,
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        <FormField label={t('名称')} htmlFor="dlg-secret-name">
          <Input
            id="dlg-secret-name"
            className={`${FORM_CONTROL_CLS} font-mono placeholder:text-content-tertiary`}
            value={name}
            aria-invalid={nameInvalid}
            aria-describedby={nameInvalid ? 'dlg-secret-problem' : undefined}
            onChange={(event) => setName(event.target.value)}
            placeholder="MY_VAR"
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
        {projects.length > 0 && editing === null && (
          <FormField
            label={t('范围')}
            htmlFor="dlg-secret-scope"
            help={t('项目里的条目只发给该项目的对话，同名时优先于团队条目。')}
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
        <FormField
          label={t('值')}
          htmlFor="dlg-secret-value"
          help={
            wasSecret
              ? t('原值已隐藏。留空则保持原值，填写则替换。')
              : t('加密保存在 Cairn 服务器上。')
          }
        >
          <Textarea
            id="dlg-secret-value"
            ref={valueRef}
            className={`${FORM_TEXTAREA_CLS} resize-none font-mono`}
            value={value}
            aria-invalid={showValueError}
            aria-describedby={showValueError ? 'dlg-secret-problem' : undefined}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setValueTouched(true)}
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
        <label htmlFor="dlg-secret-kind" className="flex items-start gap-3">
          <Checkbox
            id="dlg-secret-kind"
            data-testid="secret-kind"
            className="mt-0.5 data-disabled:cursor-not-allowed data-disabled:opacity-50"
            checked={secret}
            disabled={wasSecret}
            onCheckedChange={(next) => setSecretChoice(next === true)}
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-ui text-foreground">{t('机密')}</span>
            <span className="text-meta text-pretty break-keep text-content-tertiary">
              {wasSecret
                ? t('机密不能转回环境变量。')
                : converting
                  ? t('保存后转为机密，值不再显示，也不能转回环境变量。')
                  : t('机密的值保存后隐藏，不能为空；环境变量的值在这里一直可见。')}
            </span>
          </span>
        </label>
        {problem !== null && (
          <p id="dlg-secret-problem" role="alert" className="m-0 text-meta text-destructive">
            {problem}
          </p>
        )}
      </FormStack>
    </DialogShell>
  );
}
