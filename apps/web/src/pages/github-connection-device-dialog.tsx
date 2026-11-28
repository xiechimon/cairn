import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { FormStack } from '../components/form-layout.js';
import { DeviceCode } from '../components/sign-in-view.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { copyTextWithFeedback } from '../lib/clipboard.js';
import {
  githubDeviceEndedCopy,
  openGithubWindow,
  useGithubDevicePoll,
} from '../lib/github-device-flow.js';

function ended(
  t: TFunc,
  reason: 'expired' | 'denied' | 'failed' | 'start',
  userCode?: string,
): Step {
  return { kind: 'ended', ...githubDeviceEndedCopy(t, reason), userCode };
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
  | { kind: 'ended'; title: string; body: string; userCode?: string }
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
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    setCopied(false);
  }, [step]);

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

  useGithubDevicePoll({
    enabled: step.kind === 'code',
    attemptId: step.kind === 'code' ? step.attemptId : null,
    intervalSeconds: step.kind === 'code' ? step.intervalSeconds : 0,
    pollKey: step,
    poll,
    onResult: (result) => {
      if (step.kind !== 'code') return;
      if (result.status === 'pending')
        setStep({ ...step, intervalSeconds: result.intervalSeconds });
      else if (result.status === 'complete') setStep({ kind: 'install', opened: false });
      else setStep(ended(t, result.status, step.userCode));
    },
    onError: (error) => {
      if (step.kind !== 'code') return;
      setStep(
        ended(
          t,
          error instanceof ApiError && error.status === 404 ? 'expired' : 'failed',
          step.userCode,
        ),
      );
    },
  });

  const close = () => {
    if (step.kind === 'code') cancel(step.attemptId);
    onClose();
  };
  const copyCode = () => {
    if (step.kind !== 'code') return;
    copyTextWithFeedback(
      step.userCode,
      () => {
        setCopied(true);
        clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1600);
      },
      (error) => toastError(t('复制失败，请重试。'), error),
    );
  };

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
        <div className="grid grid-cols-[1.25fr_1fr] gap-2">
          <div className="rounded-(--radius-control) bg-card px-3 py-2.5">
            <div className="text-ui font-medium text-foreground">{t('1 · 打开')}</div>
            <div className="mt-0.5 break-all font-mono text-caption text-content-tertiary">
              {step.verificationUri.replace(/^https?:\/\//, '')}
            </div>
          </div>
          <div className="rounded-(--radius-control) bg-card px-3 py-2.5">
            <div className="text-ui font-medium text-foreground">{t('2 · 输入')}</div>
            <div className="mt-0.5 text-meta text-content-tertiary">{t('下面这个码')}</div>
          </div>
        </div>
        <DeviceCode code={step.userCode} cells />
        <p className="m-0 text-center text-meta text-content-tertiary">
          {t('授权后自动继续 · 代码 15 分钟内有效')}
        </p>
      </>
    );
    secondary = { label: copied ? t('已复制') : t('复制验证码'), onClick: copyCode };
    primary = { label: t('打开 GitHub'), onClick: () => openGithubWindow(step.verificationUri) };
  } else if (step.kind === 'ended') {
    title = step.title;
    body = (
      <>
        {step.userCode !== undefined && <DeviceCode code={step.userCode} cells expired />}
        <p className="m-0 text-pretty text-ui text-foreground">{step.body}</p>
      </>
    );
    primary = { label: t('重新开始'), onClick: () => setStep({ kind: 'starting' }) };
  } else {
    title = t('选择 Cairn 能用的仓库');
    body = (
      <p className="m-0 text-pretty text-ui text-foreground">
        {t('在 GitHub 上选好 Cairn 能读写的仓库。')}
      </p>
    );
    const choose = {
      label: t('选择仓库'),
      onClick: () => {
        setStep({ kind: 'install', opened: true });
        openGithubWindow(installUrl);
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
