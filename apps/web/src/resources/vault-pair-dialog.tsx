import { SECRET_NAME_PATTERN, type SecretListEntry } from '@cairn/shared';
import { useRef, useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

export interface PairDraft {
  name: string;
  site: string;
  username: string;
  password: string;
}

function siteHost(site: string): string | null {
  const trimmed = site.trim();
  if (trimmed === '') return null;
  const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(candidate)) return null;
  const host = new URL(candidate).hostname.replace(/^www\./, '');
  return host === '' ? null : host;
}

function deriveName(site: string): string {
  const base = (siteHost(site) ?? site.trim())
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const name = /^[0-9]/.test(base) ? `LOGIN_${base}` : base;
  return SECRET_NAME_PATTERN.test(name) ? name : 'LOGIN';
}

export function normalizedSite(site: string): string {
  return siteHost(site) ?? site.trim();
}

interface VaultPairDialogProps {
  open?: boolean;
  onClose: () => void;
  onSave?: (draft: PairDraft) => void;
  editing?: SecretListEntry | null;
}

export function VaultPairDialog({ open, onClose, onSave, editing = null }: VaultPairDialogProps) {
  const { t } = useI18n();
  const [site, setSite] = useState(editing?.description ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [nameTouched, setNameTouched] = useState(editing !== null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const siteRef = useRef<HTMLInputElement>(null);
  const trimmedSite = site.trim();
  const trimmedName = name.trim();
  const nameChecked = editing === null || trimmedName !== editing.name;
  const nameInvalid = nameChecked && trimmedName !== '' && !SECRET_NAME_PATTERN.test(trimmedName);
  const canSave =
    trimmedSite !== '' &&
    trimmedName !== '' &&
    !nameInvalid &&
    (editing !== null || (username.trim() !== '' && password !== ''));
  const submit = () => {
    if (!canSave) return;
    if (onSave === undefined) {
      onClose();
      return;
    }
    onSave({
      name: trimmedName,
      site: normalizedSite(site),
      username: username.trim(),
      password,
    });
  };
  const title = editing === null ? t('添加网站登录') : t('编辑 {name}', { name: editing.name });
  return (
    <DialogShell
      title={title}
      open={open}
      onClose={onClose}
      size="s"
      initialFocus={siteRef}
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: editing === null ? t('添加') : t('保存'),
            onClick: submit,
            disabled: !canSave,
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        <FormField
          label={t('网站')}
          htmlFor="dlg-pair-site"
          help={t('标记这条登录用在哪个网站，代填前仍会请你批准网站。')}
        >
          <Input
            id="dlg-pair-site"
            ref={siteRef}
            data-testid="pair-site"
            className={`${FORM_CONTROL_CLS} font-mono placeholder:text-content-tertiary`}
            value={site}
            onChange={(event) => {
              const next = event.target.value;
              setSite(next);
              if (!nameTouched) setName(deriveName(next));
            }}
            placeholder="github.com"
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
        <FormField
          label={t('名称')}
          htmlFor="dlg-pair-name"
          help={t('Coordinator 用这个名字找到这条登录。')}
        >
          <Input
            id="dlg-pair-name"
            data-testid="pair-name"
            className={`${FORM_CONTROL_CLS} font-mono placeholder:text-content-tertiary`}
            value={name}
            aria-invalid={nameInvalid}
            aria-describedby={nameInvalid ? 'dlg-pair-problem' : undefined}
            onChange={(event) => {
              setNameTouched(true);
              setName(event.target.value);
            }}
            placeholder="GITHUB_COM"
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
        <FormField
          label={t('用户名')}
          htmlFor="dlg-pair-username"
          help={editing !== null ? t('原用户名已隐藏。留空保持不变，填写则替换。') : undefined}
        >
          <Input
            id="dlg-pair-username"
            data-testid="pair-username"
            className={`${FORM_CONTROL_CLS} placeholder:text-content-tertiary`}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="alice@example.com"
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
        <FormField
          label={t('密码')}
          htmlFor="dlg-pair-password"
          help={
            editing !== null
              ? t('原密码已隐藏。留空保持不变，填写则替换。')
              : t('加密保存，保存后不再显示，也不会进入对话。')
          }
        >
          <Input
            id="dlg-pair-password"
            data-testid="pair-password"
            type="password"
            className={`${FORM_CONTROL_CLS} placeholder:text-content-tertiary`}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
          />
        </FormField>
        {nameInvalid && (
          <p id="dlg-pair-problem" role="alert" className="m-0 text-meta text-destructive">
            {t('名称要符合环境变量格式（例如 MY_VAR）')}
          </p>
        )}
      </FormStack>
    </DialogShell>
  );
}
