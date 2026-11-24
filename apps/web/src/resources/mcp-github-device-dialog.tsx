import type { McpConnectorRecord } from '@cairn/shared';
import { cn } from 'cn';
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
import { toastSuccess } from '../components/ui/toaster.js';
import type { GithubDeviceFixtureStep } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { copyTextWithFeedback, hasClipboard } from '../lib/clipboard.js';
import { ConnectorStatus, DIALOG_FORM_CLS, PALE_DISABLED } from './mcp-connector-dialog.js';

type Step =
  | { kind: 'starting' }
  | {
      kind: 'code';
      attemptId: string;
      userCode: string;
      verificationUri: string;
      intervalSeconds: number;
      expiresInSeconds: number;
    }
  | { kind: 'ended'; title: string; body: string }
  | { kind: 'repos'; connector: McpConnectorRecord; opened: boolean; missing: boolean };

type Translate = (text: string, vars?: Record<string, string | number>) => string;

const SAMPLE_CODE = {
  attemptId: 'fixture',
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://github.com/login/device',
  intervalSeconds: 5,
  expiresInSeconds: 900,
};

function fixtureStep(
  t: Translate,
  step: GithubDeviceFixtureStep,
  connector: McpConnectorRecord | undefined,
): Step {
  if (step === 'code' || step === 'reconnect') return { kind: 'code', ...SAMPLE_CODE };
  if (step === 'denied') return endedStep(t, 'denied');
  if (step === 'expired') return endedStep(t, 'expired');
  if (connector === undefined) return { kind: 'starting' };
  return {
    kind: 'repos',
    connector,
    opened: step === 'repos-missing',
    missing: step === 'repos-missing',
  };
}

function endedStep(t: Translate, reason: 'expired' | 'denied' | 'failed' | 'conflict'): Step {
  if (reason === 'expired')
    return {
      kind: 'ended',
      title: t('代码已过期'),
      body: t('重新开始拿一个新代码。'),
    };
  if (reason === 'denied')
    return {
      kind: 'ended',
      title: t('已取消授权'),
      body: t('你在 GitHub 上取消了授权，这次什么都没有保存。'),
    };
  if (reason === 'conflict')
    return {
      kind: 'ended',
      title: t('连接失败'),
      body: t('授权期间这个连接有了变动，这次授权没有保存，重新开始一次。'),
    };
  return {
    kind: 'ended',
    title: t('连接失败'),
    body: t('GitHub 没有完成授权，稍后重新开始一次。'),
  };
}

function startFailure(t: Translate, error: unknown): Step {
  const status = error instanceof ApiError ? error.status : null;
  return {
    kind: 'ended',
    title: t('未能开始连接 GitHub'),
    body:
      status === 400
        ? t('这台服务器尚未设置 GitHub 登录，请改用令牌连接。')
        : status === 409
          ? t('GitHub 连接的名字都被占用了，先删掉一个旧的连接。')
          : t('暂时无法连接 GitHub，请稍后重试。'),
  };
}

export function GithubDeviceDialog({
  live,
  teamId,
  connectorId,
  boundConnector,
  installUrl,
  fixture,
  fixtureConnector,
  onClose,
  onRestart,
}: {
  live: boolean;
  teamId: string | undefined;
  connectorId?: string;
  boundConnector?: McpConnectorRecord;
  installUrl: string | null;
  fixture?: GithubDeviceFixtureStep;
  fixtureConnector?: McpConnectorRecord;
  onClose: () => void;
  onRestart: () => void;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const { startGithubDevice, pollGithubDevice, cancelGithubDevice, githubInstallations } =
    mutations;
  const [step, setStep] = useState<Step>(() =>
    boundConnector !== undefined
      ? { kind: 'repos', connector: boundConnector, opened: false, missing: false }
      : fixture === undefined
        ? { kind: 'starting' }
        : fixtureStep(t, fixture, fixtureConnector),
  );
  const primaryRef = useRef<HTMLButtonElement>(null);
  const reconnect = connectorId !== undefined || fixture === 'reconnect';

  useEffect(() => {
    if (!live || boundConnector !== undefined) return;
    let cancelled = false;
    startGithubDevice
      .mutateAsync(connectorId)
      .then((started) => {
        if (!cancelled) setStep({ kind: 'code', ...started });
      })
      .catch((error: unknown) => {
        if (!cancelled) setStep(startFailure(t, error));
      });
    return () => {
      cancelled = true;
    };
  }, [live, connectorId, boundConnector, startGithubDevice.mutateAsync, t]);

  useEffect(() => {
    if (!live || step.kind !== 'code') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      pollGithubDevice
        .mutateAsync(step.attemptId)
        .then((result) => {
          if (cancelled) return;
          if (result.status === 'pending')
            setStep({ ...step, intervalSeconds: result.intervalSeconds });
          else if (result.status === 'complete')
            setStep({ kind: 'repos', connector: result.connector, opened: false, missing: false });
          else setStep(endedStep(t, result.status));
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const status = error instanceof ApiError ? error.status : null;
          setStep(
            endedStep(t, status === 404 ? 'expired' : status === 409 ? 'conflict' : 'failed'),
          );
        });
    }, step.intervalSeconds * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [live, step, pollGithubDevice.mutateAsync, t]);

  const close = () => {
    if (live && step.kind === 'code') cancelGithubDevice.mutate(step.attemptId);
    onClose();
  };
  const openGithub = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const finish = () => {
    if (step.kind !== 'repos') return onClose();
    if (!live || step.missing) return onClose();

    githubInstallations.mutate(step.connector.id, {
      onSuccess: ({ installed }) =>
        installed ? onClose() : setStep({ ...step, opened: true, missing: true }),
      onError: onClose,
    });
  };

  const subtitle = reconnect ? t('重新连接 GitHub') : t('连接 GitHub');
  let title: string;
  let body: ReactNode;
  let primary: { label: string; onClick: () => void; disabled?: boolean };
  let secondary: { label: string; onClick: () => void; disabled?: boolean } | undefined;
  let hint: string | undefined;
  if (step.kind === 'starting') {
    title = t('在 GitHub 上授权 Cairn');
    body = (
      <p className="m-0 text-ui text-content-secondary">{t('正在向 GitHub 要一个授权代码…')}</p>
    );
    primary = { label: t('打开 GitHub'), onClick: () => {}, disabled: true };
  } else if (step.kind === 'code') {
    title = t('在 GitHub 上授权 Cairn');
    body = (
      <>
        <p className="m-0 text-ui text-foreground">
          {t('打开 GitHub，输入下面的代码，然后点授权。')}
        </p>
        <DeviceCode code={step.userCode} />
      </>
    );
    hint = t('授权后自动继续');
    primary = { label: t('打开 GitHub'), onClick: () => openGithub(step.verificationUri) };
  } else if (step.kind === 'ended') {
    title = step.title;
    body = <p className="m-0 text-ui text-foreground">{step.body}</p>;
    primary = {
      label: t('重新开始'),
      onClick: () => {
        if (live) onRestart();
      },
    };
  } else {
    title = t('选择 Cairn 能用的仓库');
    const choose =
      installUrl === null
        ? undefined
        : {
            label: t('选择仓库'),
            onClick: () => {
              setStep({ ...step, opened: true, missing: false });
              openGithub(installUrl);
            },
          };
    const done = {
      label: step.missing ? t('仍然完成') : t('完成'),
      onClick: finish,
      disabled: githubInstallations.isPending,
    };
    body = (
      <>
        {step.missing ? (
          <p role="status" className="m-0 text-ui text-foreground">
            {t('尚未选择仓库；组织仓库可能需要组织管理员批准。')}
          </p>
        ) : (
          <ConnectorStatus record={step.connector} />
        )}
        <p className="m-0 text-ui text-foreground">
          {t('在 GitHub 上选好 Agent 能读写的仓库，以后也能改。')}
        </p>
      </>
    );
    if (choose !== undefined && (!step.opened || step.missing)) {
      primary = choose;
      secondary = done;
    } else {
      primary = done;
      secondary = choose;
    }
  }

  return (
    <DialogShell
      title={title}
      subtitle={subtitle}
      size="s"
      initialFocus={primaryRef}
      onClose={step.kind === 'repos' ? onClose : close}
      footer={
        <div className="flex w-full items-center gap-2">
          {hint !== undefined && (
            <span
              data-testid="mcp-github-waiting"
              className="min-w-0 text-meta text-content-tertiary"
            >
              {hint}
            </span>
          )}
          <span className="flex-1" />
          {secondary !== undefined && (
            <Button
              variant="ghost"
              className={DIALOG_TEXT_BUTTON}
              onClick={secondary.onClick}
              disabled={secondary.disabled}
            >
              {secondary.label}
            </Button>
          )}
          {step.kind !== 'repos' && (
            <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={close}>
              {step.kind === 'ended' ? t('关闭') : t('取消')}
            </Button>
          )}
          <Button
            ref={primaryRef}
            data-testid="mcp-github-primary"
            className={cn(DIALOG_PRIMARY_BUTTON, PALE_DISABLED)}
            onClick={primary.onClick}
            disabled={primary.disabled}
          >
            {primary.label}
          </Button>
        </div>
      }
    >
      <FormStack className={DIALOG_FORM_CLS}>{body}</FormStack>
    </DialogShell>
  );
}

export function DeviceCode({
  code,
  cells = false,
  expired = false,
}: {
  code: string;
  cells?: boolean;
  expired?: boolean;
}) {
  const { t } = useI18n();
  if (cells) {
    return (
      <div
        data-testid="mcp-github-code"
        className={cn('flex items-center justify-center gap-1.5', expired && 'opacity-40')}
      >
        <span className="sr-only">{code}</span>
        {code.split('').map((char, i) =>
          /[A-Za-z0-9]/.test(char) ? (
            <span
              key={i}
              aria-hidden="true"
              className={cn(
                'flex h-12 w-9 items-center justify-center rounded-(--radius-control) border border-input bg-card font-mono text-brand text-foreground',
                expired && 'line-through',
              )}
            >
              {char}
            </span>
          ) : (
            <span
              key={i}
              aria-hidden="true"
              className="flex h-12 w-2 items-center justify-center font-mono text-heading text-content-tertiary"
            >
              {char}
            </span>
          ),
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-(--radius-control) bg-muted px-4 py-3">
      <code
        data-testid="mcp-github-code"
        className="min-w-0 flex-1 font-mono text-heading text-foreground"
      >
        {code}
      </code>
      {hasClipboard() && (
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 px-2.5 pointer-coarse:h-11 pointer-coarse:px-3.5"
          onClick={() => copyTextWithFeedback(code, () => toastSuccess(t('已复制')))}
        >
          {t('复制')}
        </Button>
      )}
    </div>
  );
}
