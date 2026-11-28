import type { DoubaoLoginSession } from '@cairn/shared';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SubscriptionAccount } from '../api/claude-accounts.js';
import {
  useCancelDoubaoLogin,
  useDoubaoLoginSession,
  useStartDoubaoLogin,
} from '../api/doubao-subscriptions.js';
import { useMachines } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { machineDisplayName } from '../components/machine-label.js';
import { SettingsCard, SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { useI18n } from '../i18n/provider.js';
import { describeError } from '../lib/error-copy.js';

function terminalFailureText(
  session: DoubaoLoginSession,
  machineName: string,
  t: (source: string, vars?: Record<string, string | number>) => string,
): { summary: string; retryLabel: string; logoutFirst?: boolean; retryable: boolean } {
  if (session.status === 'expired') {
    return { summary: t('二维码已过期'), retryLabel: t('刷新二维码'), retryable: true };
  }
  if (session.status === 'refused') {
    return { summary: t('手机端已拒绝本次登录'), retryLabel: t('重新扫码'), retryable: true };
  }
  if (session.status === 'cancelled') {
    return { summary: t('已取消扫码登录'), retryLabel: t('重新扫码'), retryable: true };
  }
  switch (session.reason) {
    case 'offline':
      return {
        summary: t('执行机 {machine} 已离线，恢复在线后点击重试。', { machine: machineName }),
        retryLabel: t('重试'),
        retryable: true,
      };
    case 'keychain_locked':
      return {
        summary: t('{machine} 的登录钥匙串已锁定，请先在该电脑解锁钥匙串后重试。', {
          machine: machineName,
        }),
        retryLabel: t('重试'),
        retryable: true,
      };
    case 'unsupported_account':
      return {
        summary: t('当前扫码账号受限或需要额外验证，暂不支持用于 CLI 登录，请更换账号重试。'),
        retryLabel: t('更换账号重试'),
        logoutFirst: true,
        retryable: true,
      };
    case 'unsupported_platform':
      return {
        summary: t('{machine} 当前平台暂不支持豆包 CLI。', { machine: machineName }),
        retryLabel: t('重试'),
        retryable: false,
      };
    case 'install_failed':
      return {
        summary: t('未能在 {machine} 自动下载豆包组件，请检查网络后重试。', {
          machine: machineName,
        }),
        retryLabel: t('重试'),
        retryable: true,
      };
    default:
      return {
        summary: session.detail ?? t('登录未完成，请重试。'),
        retryLabel: t('重试'),
        retryable: true,
      };
  }
}

export function DoubaoQrLoginCard({
  teamId,
  machineId,
  machineName,
  autoStart = false,
  canManage = true,
  initialLogoutFirst = false,
  fixtureSession,
  onSucceeded,
  onCancel,
  onLater,
}: {
  teamId: string | undefined;
  machineId: string;
  machineName: string;
  autoStart?: boolean;
  canManage?: boolean;
  initialLogoutFirst?: boolean;
  fixtureSession?: DoubaoLoginSession | null;
  onSucceeded?: () => void;
  onCancel?: () => void;
  onLater?: () => void;
}) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const liveReady =
    live && teamId !== undefined && machineId !== '' && fixtureSession === undefined;
  const sessionQ = useDoubaoLoginSession(teamId, machineId, liveReady);
  const start = useStartDoubaoLogin(teamId, machineId);
  const cancel = useCancelDoubaoLogin(teamId, machineId);
  const session = fixtureSession !== undefined ? fixtureSession : (sessionQ.data?.session ?? null);
  const autoStartedRef = useRef(false);
  const succeededNotifiedRef = useRef<string | null>(null);
  const preSwitchLoginIdRef = useRef<string | null>(
    initialLogoutFirst && session?.status === 'succeeded' ? session.loginId : null,
  );

  if (initialLogoutFirst && !start.isSuccess && session?.status === 'succeeded') {
    preSwitchLoginIdRef.current = session.loginId;
  }

  useEffect(() => {
    autoStartedRef.current = false;
    preSwitchLoginIdRef.current =
      initialLogoutFirst && session?.status === 'succeeded' ? session.loginId : null;
  }, [machineId, initialLogoutFirst]);

  useEffect(() => {
    if (!liveReady || !canManage || !autoStart || autoStartedRef.current) return;
    if (!sessionQ.isSuccess || start.isPending) return;
    if (
      session === null ||
      initialLogoutFirst ||
      session.status === 'cancelled' ||
      session.status === 'expired' ||
      session.status === 'refused' ||
      session.status === 'failed'
    ) {
      autoStartedRef.current = true;
      start.mutate({
        ...(initialLogoutFirst ? { logoutFirst: true } : { force: session !== null }),
      });
    }
  }, [liveReady, canManage, autoStart, initialLogoutFirst, sessionQ.isSuccess, session, start]);

  const awaitingSwitchStart =
    initialLogoutFirst &&
    (!start.isSuccess ||
      (preSwitchLoginIdRef.current !== null && session?.loginId === preSwitchLoginIdRef.current));

  useEffect(() => {
    if (session?.status !== 'succeeded' || awaitingSwitchStart) return;
    if (succeededNotifiedRef.current === session.loginId) return;
    succeededNotifiedRef.current = session.loginId;
    onSucceeded?.();
  }, [session?.status, session?.loginId, awaitingSwitchStart, onSucceeded]);

  const activeBusy =
    session?.status === 'installing' ||
    session?.status === 'starting' ||
    session?.status === 'scanned' ||
    session?.status === 'verifying';

  const interrupted =
    liveReady &&
    sessionQ.isSuccess &&
    session === null &&
    !start.isPending &&
    !start.isError &&
    (!autoStart || autoStartedRef.current);

  if (!canManage) {
    return (
      <div
        data-testid="doubao-qr-login-card"
        data-machine-id={machineId}
        className="mt-2 rounded-lg border border-border bg-card px-3.5 py-3 text-ui text-content-secondary"
      >
        <p className="m-0">{t('需要管理员在 {machine} 扫码登录豆包', { machine: machineName })}</p>
        {activeBusy && (
          <p className="mt-1 m-0 flex items-center gap-2 text-meta text-content-tertiary">
            <RingSpinner className="size-3.5" />
            <span>
              {session.status === 'installing'
                ? t('正在 {machine} 自动安装豆包组件…', { machine: machineName })
                : session.status === 'scanned'
                  ? t('已扫码，请在手机豆包 App 确认登录…')
                  : t('手机已确认，正在验证账号…')}
            </span>
          </p>
        )}
      </div>
    );
  }

  const cancelButton = !(session?.status === 'succeeded' && !awaitingSwitchStart) && (
    <Button
      type="button"
      variant={onLater === undefined ? 'ghost' : 'outline'}
      size="sm"
      data-testid="doubao-qr-cancel"
      disabled={cancel.isPending}
      onClick={() => {
        if (liveReady && session !== null) {
          cancel.mutate(session.loginId, { onSuccess: () => onCancel?.() });
          return;
        }
        onCancel?.();
      }}
    >
      {t('取消')}
    </Button>
  );

  const content = (
    <div
      data-testid="doubao-qr-login-card"
      data-machine-id={machineId}
      className="mt-2 flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3.5 py-3 text-ui text-foreground"
    >
      {onLater === undefined && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-foreground">
            {t('{machine} 豆包扫码登录', { machine: machineName })}
          </span>
          {cancelButton}
        </div>
      )}

      {initialLogoutFirst && !(session?.status === 'succeeded' && !awaitingSwitchStart) && (
        <p data-testid="doubao-switch-notice" className="m-0 text-meta text-content-tertiary">
          {t('切换账号会先退出 {machine} 当前的豆包登录（含本机 CLI）。', { machine: machineName })}
        </p>
      )}

      {sessionQ.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 text-meta text-destructive"
        >
          <span>{describeError(sessionQ.error, t) ?? t('无法获取扫码状态，请重试。')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="doubao-qr-query-retry"
            disabled={sessionQ.isFetching}
            onClick={() => void sessionQ.refetch()}
          >
            {t('重试')}
          </Button>
        </div>
      )}

      {cancel.isError && (
        <p role="alert" className="m-0 text-meta text-destructive">
          {describeError(cancel.error, t) ?? t('取消失败，请重试。')}
        </p>
      )}

      {start.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 text-meta text-destructive"
        >
          <span>{describeError(start.error, t) ?? t('无法发起扫码登录，请重试。')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="doubao-qr-retry"
            disabled={start.isPending}
            onClick={() =>
              start.mutate({
                force: true,
                ...(initialLogoutFirst ? { logoutFirst: true } : {}),
              })
            }
          >
            {t('重试')}
          </Button>
        </div>
      )}

      {interrupted && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 text-meta text-content-secondary"
        >
          <span>{t('扫码会话已中断，请重新获取二维码。')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="doubao-qr-reconnect"
            disabled={start.isPending}
            onClick={() => start.mutate({ force: true })}
          >
            {t('重新获取二维码')}
          </Button>
        </div>
      )}

      {(start.isPending ||
        awaitingSwitchStart ||
        ((session === null || session.status === 'starting') &&
          !sessionQ.isError &&
          !interrupted)) &&
        !start.isError && (
          <div className="flex items-center gap-2 text-meta text-content-secondary">
            <RingSpinner className="size-4" />
            <span>{t('正在获取 {machine} 登录二维码…', { machine: machineName })}</span>
          </div>
        )}

      {session?.status === 'installing' && !awaitingSwitchStart && (
        <div className="flex items-center gap-2 text-meta text-content-secondary">
          <RingSpinner className="size-4" />
          <span>{t('正在 {machine} 自动安装豆包组件…', { machine: machineName })}</span>
        </div>
      )}

      {session?.status === 'qr' && session.qrPngBase64 !== undefined && (
        <div className="flex flex-wrap items-center gap-4">
          <div className="doubao-qr-frame inline-flex border border-border">
            <img
              data-testid="doubao-qr-image"
              src={`data:image/png;base64,${session.qrPngBase64}`}
              alt={t('{machine} 豆包登录二维码', { machine: machineName })}
              className="size-40 object-contain"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <p className="m-0 text-meta text-content-secondary">
              {t('用手机豆包 App 扫描二维码确认登录；无需在这台电脑打开终端。')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="doubao-qr-refresh"
              disabled={start.isPending}
              onClick={() => start.mutate({ force: true })}
            >
              <RefreshCw aria-hidden className="size-4" />
              {t('刷新二维码')}
            </Button>
          </div>
        </div>
      )}

      {session?.status === 'qr' && session.qrPngBase64 === undefined && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-meta text-content-secondary">
          <div className="flex items-center gap-2">
            <RingSpinner className="size-4" />
            <span>{t('正在加载二维码…')}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="doubao-qr-refresh"
            disabled={start.isPending}
            onClick={() => start.mutate({ force: true })}
          >
            <RefreshCw aria-hidden className="size-4" />
            {t('刷新二维码')}
          </Button>
        </div>
      )}

      {session?.status === 'scanned' && (
        <div className="flex items-center gap-2 text-meta text-content-secondary">
          <RingSpinner className="size-4" />
          <span>{t('已扫码，请在手机豆包 App 确认登录…')}</span>
        </div>
      )}

      {session?.status === 'verifying' && (
        <div className="flex items-center gap-2 text-meta text-content-secondary">
          <RingSpinner className="size-4" />
          <span>{t('手机已确认，正在验证账号…')}</span>
        </div>
      )}

      {session?.status === 'succeeded' && !awaitingSwitchStart && (
        <p data-testid="doubao-qr-succeeded" className="m-0 text-meta text-content-secondary">
          {t('{machine} 已登录豆包。', { machine: machineName })}
        </p>
      )}

      {(session?.status === 'expired' ||
        session?.status === 'refused' ||
        session?.status === 'cancelled' ||
        session?.status === 'failed') &&
        (() => {
          const failure = terminalFailureText(session, machineName, t);
          return (
            <div className="flex flex-wrap items-center justify-between gap-2 text-meta">
              <span
                className={
                  session.status === 'failed' ? 'text-destructive' : 'text-content-secondary'
                }
              >
                {failure.summary}
              </span>
              {failure.retryable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="doubao-qr-retry"
                  disabled={start.isPending}
                  onClick={() =>
                    start.mutate({
                      force: true,
                      ...(failure.logoutFirst === true ? { logoutFirst: true } : {}),
                    })
                  }
                >
                  {failure.retryLabel}
                </Button>
              )}
            </div>
          );
        })()}
    </div>
  );
  if (onLater === undefined) return content;
  return (
    <DialogShell
      title={t('{machine} 豆包扫码登录', { machine: machineName })}
      open
      onClose={onLater}
      size="s"
      footer={
        <>
          {cancelButton}
          <Button type="button" variant="outline" onClick={onLater}>
            {t('稍后扫码')}
          </Button>
        </>
      }
    >
      {content}
    </DialogShell>
  );
}

function runnerStateText(
  status: NonNullable<SubscriptionAccount['doubaoRunnerLogins']>[number]['status'],
  t: (source: string) => string,
): string {
  switch (status) {
    case 'ok':
      return t('已登录');
    case 'missing_local_login':
    case 'not_installed':
      return t('未登录');
    case 'unsupported_platform':
      return t('暂不支持');
    case 'unavailable':
      return t('离线');
  }
}

export function DoubaoRunnerLoginsSection({
  account,
  teamId,
  canManage,
  autoExpandQr = false,
}: {
  account: SubscriptionAccount;
  teamId: string | undefined;
  canManage: boolean;
  autoExpandQr?: boolean;
}) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const machines = useMachines(teamId, live);
  const logins = account.doubaoRunnerLogins ?? [];
  const defaultMissing = logins.find(
    (entry) => entry.status === 'missing_local_login' || entry.status === 'not_installed',
  );
  const [active, setActive] = useState<{
    runnerId: string;
    name: string;
    logoutFirst: boolean;
  } | null>(() =>
    autoExpandQr && defaultMissing !== undefined
      ? {
          runnerId: defaultMissing.runnerId,
          name: defaultMissing.name,
          logoutFirst: false,
        }
      : null,
  );

  if (logins.length === 0) return null;

  return (
    <SettingsSection title={t('各电脑登录状态')} testId="doubao-runner-logins">
      <SettingsCard>
        {logins.map((entry) => {
          const machine = machines.data?.find((row) => row.id === entry.runnerId);
          const machineName = machine === undefined ? entry.name : machineDisplayName(machine);
          const isOk = entry.status === 'ok';
          const canLogin =
            canManage &&
            entry.online !== false &&
            entry.platformSupported !== false &&
            entry.status !== 'unavailable' &&
            entry.status !== 'unsupported_platform';
          const isExpanded = active?.runnerId === entry.runnerId;
          return (
            <div
              key={entry.runnerId}
              data-testid={`doubao-runner-row-${entry.runnerId}`}
              className="py-2"
            >
              <div className="settings-row grid min-h-11 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 text-ui">
                <span className="truncate font-medium text-foreground">{machineName}</span>
                <span className="text-meta text-content-secondary tabular-nums">
                  {runnerStateText(entry.status, t)}
                </span>
                {canLogin && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={isOk ? 'doubao-runner-switch-account' : 'doubao-runner-qr-login'}
                    onClick={() =>
                      setActive(
                        isExpanded
                          ? null
                          : { runnerId: entry.runnerId, name: machineName, logoutFirst: isOk },
                      )
                    }
                  >
                    {isOk ? t('切换账号') : t('扫码登录')}
                  </Button>
                )}
              </div>
              {isExpanded && active !== null && (
                <DoubaoQrLoginCard
                  teamId={teamId}
                  machineId={entry.runnerId}
                  machineName={machineName}
                  autoStart
                  canManage={canManage}
                  initialLogoutFirst={active.logoutFirst}
                  onSucceeded={() => setActive(null)}
                  onCancel={() => setActive(null)}
                />
              )}
            </div>
          );
        })}
      </SettingsCard>
    </SettingsSection>
  );
}
