import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { FormStack } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import { DeviceCode } from '../resources/mcp-github-device-dialog.js';

type Translate = (text: string, vars?: Record<string, string | number>) => string;

function ended(t: Translate, reason: 'expired' | 'denied' | 'failed' | 'start'): Step {
  if (reason === 'expired')
    return { kind: 'ended', title: t('代码已过期'), body: t('重新开始拿一个新代码。') };
  if (reason === 'denied')
    return {
      kind: 'ended',
      title: t('已取消授权'),
      body: t('你在 GitHub 上取消了授权，这次什么都没有保存。'),
    };
  if (reason === 'start')
    return {
      kind: 'ended',
      title: t('没能开始连接 GitHub'),
      body: t('暂时连不上 GitHub，稍后再试。'),
    };
  return {
    kind: 'ended',
    title: t('连接失败'),
    body: t('GitHub 没有完成授权，稍后重新开始一次。'),
  };
}

type Step =
  | { kind: 'starting' }
  | {
      kind: 'code';
      attemptId: string;
      userCode: string;
      verificationUri: string;
      intervalSeconds: number;
    }
  | { kind: 'ended'; title: string; body: string }
  | { kind: 'install'; opened: boolean };

export function GithubConnectionDeviceDialog({
  teamId,
  installUrl,
  onClose,
  onConnected,
}: {
  teamId: string | undefined;
  installUrl: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const start = mutations.startGithubConnectionDevice.mutateAsync;
  const poll = mutations.pollGithubConnectionDevice.mutateAsync;
  const cancel = mutations.cancelGithubConnectionDevice.mutate;
  const [step, setStep] = useState<Step>({ kind: 'starting' });
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (step.kind !== 'starting') return;
    let cancelled = false;
    start()
      .then((started) => {
        if (!cancelled) setStep({ kind: 'code', ...started });
      })
      .catch(() => {
        if (!cancelled) setStep(ended(t, 'start'));
      });
    return () => {
      cancelled = true;
    };
  }, [step.kind, start, t]);

  useEffect(() => {
    if (step.kind !== 'code') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      poll(step.attemptId)
        .then((result) => {
          if (cancelled) return;
          if (result.status === 'pending')
            setStep({ ...step, intervalSeconds: result.intervalSeconds });
          else if (result.status === 'complete') setStep({ kind: 'install', opened: false });
          else setStep(ended(t, result.status));
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setStep(
            ended(t, error instanceof ApiError && error.status === 404 ? 'expired' : 'failed'),
          );
        });
    }, step.intervalSeconds * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, poll, t]);

  const close = () => {
    if (step.kind === 'code') cancel(step.attemptId);
    onClose();
  };
  const openGithub = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  let title = t('在 GitHub 上授权 Cairn');
  let body: ReactNode;
  let hint: string | undefined;
  let primary: { label: string; onClick: () => void; disabled?: boolean };
  let secondary: { label: string; onClick: () => void } | undefined;
  if (step.kind === 'starting') {
    body = (
      <p className="m-0 text-ui text-content-secondary">{t('正在向 GitHub 要一个授权代码…')}</p>
    );
    primary = { label: t('打开 GitHub'), onClick: () => {}, disabled: true };
  } else if (step.kind === 'code') {
    body = (
      <>
        <p className="m-0 text-pretty text-ui text-foreground">
          {t('打开 GitHub，输入下面的代码，然后点授权。')}
        </p>
        <DeviceCode code={step.userCode} />
      </>
    );
    hint = t('授权后自动继续');
    primary = { label: t('打开 GitHub'), onClick: () => openGithub(step.verificationUri) };
  } else if (step.kind === 'ended') {
    title = step.title;
    body = <p className="m-0 text-pretty text-ui text-foreground">{step.body}</p>;
    primary = { label: t('重新开始'), onClick: () => setStep({ kind: 'starting' }) };
  } else {
    title = t('选择 Cairn 能用的仓库');
    body = (
      <p className="m-0 text-pretty text-ui text-foreground">
        {t('在 GitHub 上选好 Agent 能读写的仓库。')}
      </p>
    );
    const choose = {
      label: t('选择仓库'),
      onClick: () => {
        setStep({ kind: 'install', opened: true });
        openGithub(installUrl);
      },
    };
    const done = { label: t('完成'), onClick: onConnected };
    primary = step.opened ? done : choose;
    secondary = step.opened ? choose : done;
  }

  return (
    <DialogShell
      title={title}
      subtitle={t('连接 GitHub')}
      size="s"
      stacked
      initialFocus={primaryRef}
      onClose={step.kind === 'install' ? onConnected : close}
      footer={
        <div className="flex w-full items-center gap-2">
          {hint !== undefined && (
            <span className="min-w-0 text-meta text-content-tertiary">{hint}</span>
          )}
          <span className="flex-1" />
          {secondary !== undefined && (
            <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
          {step.kind !== 'install' && (
            <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={close}>
              {step.kind === 'ended' ? t('关闭') : t('取消')}
            </Button>
          )}
          <Button
            ref={primaryRef}
            data-testid="github-connection-device-primary"
            className={DIALOG_PRIMARY_BUTTON}
            onClick={primary.onClick}
            disabled={primary.disabled}
          >
            {primary.label}
          </Button>
        </div>
      }
    >
      <FormStack className="max-w-none">{body}</FormStack>
    </DialogShell>
  );
}
