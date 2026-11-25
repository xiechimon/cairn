import { type FormEvent, useEffect, useId, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { Field, FieldError, FieldGroup, FieldLabel } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import type { DesktopHostBridge } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import { addAndSwitchRemoteHost, parseRemoteHostOrigin } from './remote-host.js';

interface ConnectRemoteHostDialogProps {
  open: boolean;
  onClose: () => void;
  bridge: DesktopHostBridge;
}

export function ConnectRemoteHostDialog({ open, onClose, bridge }: ConnectRemoteHostDialogProps) {
  const { t } = useI18n();
  const formId = useId();
  const urlId = useId();
  const nameId = useId();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (parseRemoteHostOrigin(url) === null) {
      setError(t('请输入以 http:// 或 https:// 开头的完整主机地址。'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addAndSwitchRemoteHost(bridge, { url, name });
    } catch {
      setError(t('连接远程主机失败，请检查地址后重试。'));
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t('连接已有 Cairn 主机')}
      info={t('连接到另一台运行中的 Cairn 主机，登录后本机自动注册为执行机。')}
      size="m"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="rounded-md text-ui pointer-coarse:h-11"
            disabled={busy}
            onClick={onClose}
          >
            {t('取消')}
          </Button>
          <Button
            type="submit"
            form={formId}
            className={DIALOG_PRIMARY_BUTTON}
            disabled={busy}
            data-testid="connect-remote-host-submit"
          >
            {busy ? t('正在连接…') : t('连接并重启')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-4"
      >
        <p className="m-0 text-ui text-content-secondary">
          {t('保存后应用会重启并打开该主机。完成登录后，这台电脑会自动作为执行机接入。')}
        </p>
        <FieldGroup>
          <Field data-invalid={error !== null ? 'true' : undefined}>
            <FieldLabel htmlFor={urlId}>{t('主机地址')}</FieldLabel>
            <Input
              id={urlId}
              data-testid="connect-remote-host-url"
              type="url"
              autoComplete="url"
              spellCheck={false}
              value={url}
              disabled={busy}
              aria-invalid={error !== null}
              placeholder={t('主机地址，例如 https://studio-mac.tail4c2a.ts.net')}
              onChange={(event) => {
                setUrl(event.target.value);
                if (error !== null) setError(null);
              }}
            />
            <FieldError>{error}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor={nameId}>{t('主机名称（可选）')}</FieldLabel>
            <Input
              id={nameId}
              data-testid="connect-remote-host-name"
              autoComplete="off"
              value={name}
              disabled={busy}
              placeholder={t('留空时自动使用地址中的主机名')}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </form>
    </DialogShell>
  );
}
