import { isCredentialSecretName, SECRET_NAME_PATTERN, type SetSecretBody } from '@cairn/shared';
import { useState } from 'react';
import { FormActions, FormField, FormStack } from '../components/form-layout.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Textarea } from '../components/ui/textarea.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { FORM_TEXTAREA_CLS } from './parts.js';

interface Assignment {
  name: string;
  value: string;
}

export function parseAssignments(text: string): { entries: Assignment[]; badLines: number[] } {
  const entries: Assignment[] = [];
  const badLines: number[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    const name = eq < 0 ? '' : line.slice(0, eq).trim();
    if (!SECRET_NAME_PATTERN.test(name)) {
      badLines.push(index + 1);
      return;
    }
    const rest = line.slice(eq + 1).trim();
    const quoted = rest.length >= 2 && /^(['"]).*\1$/.test(rest);
    entries.push({ name, value: quoted ? rest.slice(1, -1) : rest });
  });
  return { entries, badLines };
}

export function BulkSecretDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate?: (body: SetSecretBody) => Promise<void>;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [secret, setSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const { entries, badLines } = parseAssignments(text);
  const storesSecret = (name: string) => secret || isCredentialSecretName(name);
  const emptySecrets = entries.filter((entry) => storesSecret(entry.name) && entry.value === '');
  const canSubmit = entries.length > 0 && badLines.length === 0 && emptySecrets.length === 0;

  const close = () => {
    setText('');
    setSecret(false);
    onClose();
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    if (onCreate === undefined) {
      close();
      return;
    }
    setBusy(true);
    const failed: string[] = [];
    let lastError: unknown = null;
    for (const entry of entries) {
      try {
        await onCreate({ ...entry, kind: storesSecret(entry.name) ? 'secret' : 'env' });
      } catch (error) {
        failed.push(entry.name);
        lastError = error;
      }
    }
    setBusy(false);
    if (failed.length === 0) {
      close();
      return;
    }
    setText(
      text
        .split('\n')
        .filter((line) => failed.includes(parseAssignments(line).entries[0]?.name ?? ''))
        .join('\n'),
    );
    toastError(
      t('{names} 没能添加（可能已有同名条目），其余已添加。', { names: failed.join('、') }),
      lastError,
    );
  };

  return (
    <DialogShell
      title={t('批量添加密钥和环境变量')}
      subtitle={t('粘贴 NAME=VALUE，每行一条。')}
      open={open}
      onClose={close}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: entries.length > 1 ? t('添加 {n} 条', { n: entries.length }) : t('添加'),
            onClick: () => void submit(),
            disabled: !canSubmit || busy,
          }}
          secondary={{ label: t('取消'), onClick: close }}
        />
      }
    >
      <FormStack className="max-w-none">
        <FormField label={t('内容')} htmlFor="dlg-secret-bulk">
          <Textarea
            id="dlg-secret-bulk"
            className={`${FORM_TEXTAREA_CLS} min-h-36 resize-none font-mono placeholder:text-content-tertiary`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={"API_KEY='secret-value'\nNODE_ENV=development"}
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
        <label htmlFor="dlg-secret-bulk-kind" className="flex items-start gap-3">
          <Checkbox
            id="dlg-secret-bulk-kind"
            className="mt-0.5"
            checked={secret}
            onCheckedChange={(next) => setSecret(next === true)}
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-ui text-foreground">{t('都存为机密')}</span>
            <span className="text-meta text-pretty break-keep text-content-tertiary">
              {t('机密的值保存后隐藏，不能为空；环境变量的值在这里一直可见。')}
            </span>
          </span>
        </label>
        {badLines.length > 0 && (
          <p role="alert" className="m-0 text-meta text-destructive">
            {t('第 {lines} 行要写成 NAME=VALUE', { lines: badLines.join('、') })}
          </p>
        )}
        {badLines.length === 0 && emptySecrets.length > 0 && (
          <p role="alert" className="m-0 text-meta text-destructive">
            {t('机密的值不能为空：{names}', {
              names: emptySecrets.map((entry) => entry.name).join('、'),
            })}
          </p>
        )}
      </FormStack>
    </DialogShell>
  );
}
