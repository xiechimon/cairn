import {
  isBrowserLoopbackOrigin,
  normalizeBrowserSecretOrigin,
  SECRET_NAME_PATTERN,
  type SecretListEntry,
} from '@cairn/shared';
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
  browserOrigin?: string;
}

interface SecretDialogProps {
  open?: boolean;
  onClose: () => void;
  onSave?: (draft: SecretDraft) => void;
  editing?: SecretListEntry | null;
  startSecret?: boolean;
  projects?: readonly { id: string; name: string }[];
  defaultProjectId?: string | null;
  browserMachineName?: string;
  boundMachineName?: string;
}

export function SecretDialog({
  open,
  onClose,
  onSave,
  editing = null,
  startSecret = false,
  projects = [],
  defaultProjectId = null,
  browserMachineName,
  boundMachineName,
}: SecretDialogProps) {
  const { t } = useI18n();
  const wasSecret = editing !== null && editing.kind !== 'env';
  const [name, setName] = useState(editing?.name ?? '');
  const [value, setValue] = useState(editing?.kind === 'env' ? (editing.value ?? '') : '');
  const [secret, setSecret] = useState(wasSecret || startSecret);
  const [scope, setScope] = useState(defaultProjectId ?? '');
  const [browserOnly, setBrowserOnly] = useState(editing?.delivery === 'browser');
  const [origin, setOrigin] = useState(editing?.browserOrigin ?? '');
  const browser = secret && browserOnly;
  const normalizedOrigin = normalizeBrowserSecretOrigin(origin.trim());
  const loopback = normalizedOrigin !== null && isBrowserLoopbackOrigin(normalizedOrigin);
  const policyChanged =
    browser !== (editing?.delivery === 'browser') ||
    (browser && normalizedOrigin !== editing?.browserOrigin);
  const bindingMissing =
    browser && loopback && !browserMachineName && (policyChanged || value !== '');
  const bindingName = policyChanged || value !== '' ? browserMachineName : boundMachineName;
  const valueRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = name.trim();
  const nameChecked = editing === null || trimmed !== editing.name;
  const nameInvalid = nameChecked && trimmed !== '' && !SECRET_NAME_PATTERN.test(trimmed);
  const valueMissing = secret && value === '' && (!wasSecret || policyChanged);
  const originInvalid = browser && normalizedOrigin === null;
  const canSave =
    trimmed !== '' && !nameInvalid && !valueMissing && !originInvalid && !bindingMissing;
  const converting = editing !== null && !wasSecret && secret;
  const problem = nameInvalid
    ? t('名称要符合环境变量格式（例如 MY_VAR）')
    : valueMissing
      ? policyChanged && wasSecret
        ? t('更改浏览器用途或登录网站时，请重新填写密码。')
        : t('机密的值不能为空')
      : originInvalid && origin !== ''
        ? t('填写完整来源地址，不带路径；HTTP 仅限本机回环地址。')
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
      ...(scope !== '' && editing === null && !browser ? { projectId: scope } : {}),
      ...(browser && normalizedOrigin !== null ? { browserOrigin: normalizedOrigin } : {}),
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
          className="pt-0 [&_button:disabled]:bg-secondary/50 [&_button:disabled]:text-(--text-dim) [&_button:disabled]:opacity-100"
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
        {projects.length > 0 && editing === null && !browser && (
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
              ? policyChanged
                ? undefined
                : t('原值已隐藏。留空则保持原值，填写则替换。')
              : t('加密保存在 Cairn 服务器上。')
          }
        >
          {browser ? (
            <Input
              id="dlg-secret-value"
              type="password"
              className={`${FORM_CONTROL_CLS} font-mono`}
              value={value}
              aria-invalid={valueMissing}
              aria-describedby={valueMissing ? 'dlg-secret-problem' : undefined}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="new-password"
            />
          ) : (
            <Textarea
              id="dlg-secret-value"
              ref={valueRef}
              className={`${FORM_TEXTAREA_CLS} resize-none font-mono`}
              value={value}
              aria-invalid={valueMissing}
              aria-describedby={valueMissing ? 'dlg-secret-problem' : undefined}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          )}
          {valueMissing && (
            <p id="dlg-secret-problem" role="alert" className="m-0 text-meta text-destructive">
              {problem}
            </p>
          )}
        </FormField>
        <label htmlFor="dlg-secret-kind" className="flex items-start gap-3">
          <Checkbox
            id="dlg-secret-kind"
            data-testid="secret-kind"
            className="mt-0.5 data-disabled:cursor-not-allowed data-disabled:opacity-50"
            checked={secret}
            disabled={wasSecret}
            onCheckedChange={(next) => setSecret(next === true)}
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
        {secret && editing?.projectId == null && (
          <label htmlFor="dlg-secret-browser" className="flex items-start gap-3">
            <Checkbox
              id="dlg-secret-browser"
              className="mt-0.5"
              checked={browserOnly}
              onCheckedChange={(next) => setBrowserOnly(next === true)}
            />
            <span className="text-ui text-foreground">{t('只给浏览器用')}</span>
          </label>
        )}
        {browser && (
          <FormField
            label={t('登录网站')}
            htmlFor="dlg-secret-origin"
            help={
              loopback
                ? bindingName
                  ? t('绑定到 {name}', { name: bindingName })
                  : t('先打开 Coordinator 的浏览器，再保存本机网站的密码。')
                : t('仅在这个网站代填，不会把密码交给模型。')
            }
          >
            <Input
              id="dlg-secret-origin"
              className={`${FORM_CONTROL_CLS} font-mono`}
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              placeholder="https://example.com"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={originInvalid && origin !== ''}
              aria-describedby={originInvalid && origin !== '' ? 'dlg-secret-problem' : undefined}
            />
          </FormField>
        )}
        {problem !== null && !valueMissing && (
          <p id="dlg-secret-problem" role="alert" className="m-0 text-meta text-destructive">
            {problem}
          </p>
        )}
      </FormStack>
    </DialogShell>
  );
}
