import { type PairingCodeResponse, pairingLink } from '@cairn/shared';
import { Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { signOutSession } from '../api/auth.js';
import {
  useClerkAuthConfig,
  usePairingGrants,
  usePairingRequests,
  useRemoteDevices,
  useRemoteMutations,
  useRemoteRoutes,
  useSetTailnetAccess,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { joinMeta, relativeTime } from '../board/rel-time.js';
import { EmptyState } from '../components/empty-state.js';
import { QrCode } from '../components/qr-code.js';
import { SettingsCard, SettingsRow } from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { loadClerkScript } from '../lib/clerk-loader.js';
import { copyTextWithFeedback } from '../lib/clipboard.js';
import {
  type PairingCandidate,
  pairingCandidateLabel,
  pairingCandidates,
} from '../lib/pairing-origin.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { pairRequestSourceLabel } from '../overlay/pairing-request-banner.js';
import { PageShell } from '../pages/shell.js';
import { ResourceList, ResourceRow, RowDesc, RowText, RowTitle } from '../resources/parts.js';

export const REMOTE_ACCESS_ROUTE = 'remote-access';

function displayPairCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function selectedCandidateLabel(
  candidates: PairingCandidate[],
  origin: string,
  t: (key: string) => string,
): string {
  const found = candidates.find((candidate) => candidate.origin === origin);
  return found === undefined ? origin : pairingCandidateLabel(candidates, found, t);
}

function PairingDialog({
  pairing,
  candidates,
  environmentId,
  onClose,
}: {
  pairing: PairingCodeResponse;
  candidates: PairingCandidate[];
  environmentId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [chosen, setChosen] = useState<string>(candidates[0]?.origin ?? '');
  const [copied, setCopied] = useState(false);
  const origin = candidates.some((candidate) => candidate.origin === chosen)
    ? chosen
    : (candidates[0]?.origin ?? '');
  const link = pairingLink({ origin, code: pairing.code, environmentId });
  return (
    <DialogShell
      title={t('配对新设备')}
      subtitle={t('用手机扫描二维码，5 分钟内有效，只能用一次。')}
      onClose={onClose}
      footer={
        <Button
          variant="outline"
          className={DIALOG_PRIMARY_BUTTON}
          onClick={() =>
            copyTextWithFeedback(
              link,
              () => {
                setCopied(true);
                toastSuccess(t('已复制链接'));
              },
              (error) => toastError(t('复制失败，请重试。'), error),
            )
          }
        >
          {copied ? t('已复制') : t('复制链接')}
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <QrCode text={link} label={t('配对二维码')} />
        {candidates.length > 1 && (
          <Select
            value={origin}
            onValueChange={(next) => {
              setChosen(next ?? origin);
              setCopied(false);
            }}
          >
            <SelectTrigger className="w-full max-w-72" data-testid="pairing-route-select">
              <SelectValue>{selectedCandidateLabel(candidates, origin, t)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.origin} value={candidate.origin}>
                  {pairingCandidateLabel(candidates, candidate, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="m-0 max-w-full text-center text-meta break-all text-content-tertiary">
          {t('手机将连接到 {origin}', { origin })}
        </p>
      </div>
    </DialogShell>
  );
}

export function RemoteAccessPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live } = useLiveData();
  const routesQ = useRemoteRoutes(live);
  const clerkConfigQ = useClerkAuthConfig(live);
  const devicesQ = useRemoteDevices(live);
  const grantsQ = usePairingGrants(live);
  const requestsQ = usePairingRequests(live);
  const mutations = useRemoteMutations();
  const setTailnet = useSetTailnetAccess();
  const [pairing, setPairing] = useState<PairingCodeResponse | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [loginCopied, setLoginCopied] = useState(false);
  const loginCopyTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (loginCopyTimerRef.current !== null) window.clearTimeout(loginCopyTimerRef.current);
    },
    [],
  );
  const routesFailed = live && routesQ.isError && routesQ.data === undefined;
  const routes = routesQ.data?.routes ?? [];
  const candidates =
    routesQ.data === undefined ? [] : pairingCandidates(routes, window.location.origin);
  const pairingBlocked = live && routesQ.data !== undefined && candidates.length === 0;
  const tailnet = routesQ.data?.tailnet;
  const tailnetOn = tailnet?.enabled === true;
  const tailnetState = tailnetOn ? tailnet.state : 'off';
  const tailnetFailed = tailnetOn && tailnetState === 'failed';
  const loginUrl = tailnetOn && tailnetState === 'needs-login' ? tailnet.authUrl : null;
  const tailnetAddress =
    tailnetOn && tailnetState === 'ready' && tailnet.dnsName !== null
      ? `https://${tailnet.dnsName}`
      : null;
  const tailnetHint: ReactNode = (() => {
    if (routesFailed) {
      return <span data-testid="remote-routes-error">{t('远程访问状态加载失败，请重试')}</span>;
    }
    if (!tailnetOn) return null;
    if (tailnetFailed) {
      const kind = tailnet?.error;
      if (kind === 'missing-binary') return t('这个安装没有附带远程访问组件');
      if (kind === 'auth-off') return t('远程访问需要开启访问认证');
      return t('远程访问启动失败，请关闭后重新打开');
    }
    if (loginUrl !== null) return t('需要登录 Tailscale：用下面的链接或二维码登录，成功后自动开启');
    if (tailnetAddress !== null)
      return (
        <>
          {t('远程访问已开启')}
          <br />
          <span className="font-mono">{tailnetAddress}</span>
        </>
      );
    return t('正在启动远程访问…');
  })();
  const awaitingTailnetLogin = loginUrl !== null;
  const devices = devicesQ.data ?? [];
  const grants = grantsQ.data ?? [];
  const requests = requestsQ.data ?? [];
  const [revokingDevice, setRevokingDevice] = useState<{ id: string; name: string } | null>(null);
  const startPairing = () =>
    mutations.createPairingCode.mutate(undefined, {
      onSuccess: setPairing,
      onError: (error) => toastError(t('生成配对码失败，请重试。'), error),
    });
  const decideRequest = (id: string, decision: 'approve' | 'deny') =>
    mutations.decidePairRequest.mutate(
      { id, decision },
      {
        onError: (error) =>
          toastError(
            decision === 'approve' ? t('批准失败，请重试。') : t('拒绝失败，请重试。'),
            error,
          ),
      },
    );
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    const clerkConfig = clerkConfigQ.data;
    if (
      clerkConfig?.enabled === true &&
      clerkConfig.issuer !== null &&
      clerkConfig.publishableKey !== null
    ) {
      try {
        const clerk =
          window.Clerk ?? (await loadClerkScript(clerkConfig.issuer, clerkConfig.publishableKey));
        await clerk.load();
        await clerk.signOut();
      } catch (error) {
        setSigningOut(false);
        toastError(t('退出登录失败，请重试。'), error);
        return;
      }
    }
    try {
      await signOutSession();
      window.location.reload();
    } catch (error) {
      setSigningOut(false);
      toastError(t('退出登录失败，请重试。'), error);
    }
  };

  return (
    <PageShell
      route={REMOTE_ACCESS_ROUTE}
      fixture={fixture}
      selected="none"
      title={t('远程访问')}
      actions={
        live ? (
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            disabled={mutations.createPairingCode.isPending || candidates.length === 0}
            onClick={startPairing}
            data-testid="pair-new-device"
          >
            {t('配对新设备')}
          </Button>
        ) : null
      }
    >
      {requests.map((request) => (
        <Card key={request.id} className="mt-3 gap-2 p-4" data-testid="pair-request">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="m-0 text-ui font-medium">{t('新设备请求配对')}</p>
            <p className="m-0 text-meta text-content-tertiary">
              {joinMeta([
                request.name,
                request.detail,
                pairRequestSourceLabel(request.source, t),
                relativeTime(request.createdAt, Date.now(), t),
              ])}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-2xl font-semibold text-foreground tabular-nums select-none">
              {displayPairCode(request.code)}
            </span>
            <span className="flex-1" />
            <Button
              variant="ghost"
              className={DIALOG_PRIMARY_BUTTON}
              disabled={mutations.decidePairRequest.isPending}
              onClick={() => decideRequest(request.id, 'deny')}
            >
              {t('拒绝')}
            </Button>
            <Button
              variant="outline"
              className={DIALOG_PRIMARY_BUTTON}
              disabled={mutations.decidePairRequest.isPending}
              onClick={() => decideRequest(request.id, 'approve')}
            >
              {t('批准')}
            </Button>
          </div>
          <p className="m-0 text-meta text-content-tertiary">
            {t('先确认这个码和那台电脑屏幕上的一样，再批准。')}
          </p>
        </Card>
      ))}
      {live && clerkConfigQ.data?.enabled === true && (
        <SettingsCard className="mt-3" data-testid="clerk-account-card">
          <SettingsRow label={t('账号登录')}>
            <Button
              size="sm"
              variant="ghost"
              className="pointer-coarse:h-11"
              disabled={signingOut}
              data-testid="clerk-signout-btn"
              onClick={() => void handleSignOut()}
            >
              {signingOut ? t('正在退出…') : t('退出登录')}
            </Button>
          </SettingsRow>
        </SettingsCard>
      )}
      {(live || routesQ.data !== undefined) && (
        <SettingsCard className="mt-3">
          <SettingsRow
            label={t('远程访问')}
            status={tailnetHint ?? ''}
            className="[&>span:first-child]:w-3/5 [&>span:first-child]:flex-none"
            statusClassName={
              tailnetFailed || routesFailed
                ? 'min-h-16 sm:min-h-10 text-destructive'
                : 'min-h-16 sm:min-h-10'
            }
          >
            {routesFailed && (
              <Button
                size="sm"
                variant="outline"
                className={DIALOG_PRIMARY_BUTTON}
                data-testid="remote-routes-retry"
                disabled={routesQ.isFetching}
                onClick={() => void routesQ.refetch()}
              >
                {t('重试')}
              </Button>
            )}
            <ToggleSwitch
              checked={tailnetOn}
              disabled={!live || routesQ.data === undefined || setTailnet.isPending}
              aria-label={t('远程访问')}
              data-testid="remote-access-switch"
              onCheckedChange={(checked) => {
                setTailnet.reset();
                setTailnet.mutate(checked, {
                  onError: (error) => toastError(t('远程访问未能打开，请重试'), error),
                });
              }}
            />
          </SettingsRow>
          {loginUrl !== null && (
            <div className="flex flex-col items-center gap-3 px-4 py-4" data-testid="tailnet-login">
              <QrCode text={loginUrl} label={t('Tailscale 登录二维码')} />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className={DIALOG_PRIMARY_BUTTON}
                  render={<a href={loginUrl} target="_blank" rel="noreferrer" />}
                >
                  {t('打开 Tailscale 登录')}
                </Button>
                <Button
                  variant="outline"
                  className={DIALOG_PRIMARY_BUTTON}
                  onClick={() => {
                    copyTextWithFeedback(
                      loginUrl,
                      () => {
                        setLoginCopied(true);
                        toastSuccess(t('已复制链接'));
                        if (loginCopyTimerRef.current !== null) {
                          window.clearTimeout(loginCopyTimerRef.current);
                        }
                        loginCopyTimerRef.current = window.setTimeout(() => {
                          loginCopyTimerRef.current = null;
                          setLoginCopied(false);
                        }, 2_000);
                      },
                      (error) => toastError(t('复制失败，请重试。'), error),
                    );
                  }}
                >
                  {loginCopied ? t('已复制') : t('复制链接')}
                </Button>
              </div>
            </div>
          )}
        </SettingsCard>
      )}
      {pairingBlocked &&
        !awaitingTailnetLogin &&
        requestsQ.data !== undefined &&
        requests.length === 0 && (
          <p
            className="m-0 mt-3 min-h-16 sm:min-h-10 text-meta text-content-secondary"
            data-testid="pairing-blocked"
          >
            {tailnetOn
              ? t(
                  '配对已关闭：当前页面的地址只在这台电脑上有效，手机扫码后会连到它自己。请用局域网或 Tailscale 地址打开本页。',
                )
              : t(
                  '配对已关闭：当前页面的地址只在这台电脑上有效，手机扫码后会连到它自己。请打开上面的远程访问开关，或用局域网或 Tailscale 地址打开本页。',
                )}
          </p>
        )}
      {live && routesQ.data === undefined ? null : pairingBlocked && !awaitingTailnetLogin ? (
        (!live || devicesQ.data !== undefined) &&
        devices.length === 0 && (
          <p className="m-0 mt-3 text-meta text-content-tertiary" data-testid="remote-routes-empty">
            {t('暂无已配对的设备')}
          </p>
        )
      ) : routes.length === 0 ? (
        <EmptyState
          testId="remote-routes-empty"
          className="mt-6"
          icon={Smartphone}
          title={t('手机尚无法连接这台电脑')}
          description={awaitingTailnetLogin ? t('请先登录 Tailscale。') : undefined}
        />
      ) : (
        <ResourceList>
          {routes.map((route) => (
            <ResourceRow key={route.url}>
              <RowText>
                <RowTitle className="font-mono">{route.url}</RowTitle>
                <RowDesc>{route.kind === 'tailnet' ? t('Tailscale') : t('局域网')}</RowDesc>
              </RowText>
            </ResourceRow>
          ))}
        </ResourceList>
      )}
      {grants.length > 0 && (
        <ResourceList>
          {grants.map((grant) => (
            <ResourceRow key={grant.id}>
              <RowText>
                <RowTitle>{t('未使用的配对码')}</RowTitle>
                <RowDesc>
                  {t('有效期至 {time}', {
                    time: new Date(grant.expiresAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  })}
                </RowDesc>
              </RowText>
              <Button
                variant="ghost"
                className={DIALOG_PRIMARY_BUTTON}
                disabled={mutations.revokePairingCode.isPending}
                onClick={() =>
                  mutations.revokePairingCode.mutate(grant.id, {
                    onError: (error) => toastError(t('作废配对码失败，请重试。'), error),
                  })
                }
              >
                {t('作废配对码')}
              </Button>
            </ResourceRow>
          ))}
        </ResourceList>
      )}
      {devices.length > 0 && (
        <ResourceList>
          {devices.map((device) => (
            <ResourceRow key={device.id}>
              <RowText>
                <RowTitle>{device.name}</RowTitle>
                <RowDesc>{device.masked}</RowDesc>
              </RowText>
              <Button
                variant="ghost"
                className={DIALOG_PRIMARY_BUTTON}
                disabled={mutations.revokeDevice.isPending}
                onClick={() => setRevokingDevice({ id: device.id, name: device.name })}
              >
                {t('撤销设备')}
              </Button>
            </ResourceRow>
          ))}
        </ResourceList>
      )}
      {pairing !== null && routesQ.data !== undefined && candidates.length > 0 && (
        <PairingDialog
          pairing={pairing}
          candidates={candidates}
          environmentId={routesQ.data.environmentId}
          onClose={() => setPairing(null)}
        />
      )}
      <DeleteConfirm
        open={revokingDevice !== null}
        title={t('撤销后，这台已配对设备需要重新扫码配对才能访问')}
        summary={revokingDevice?.name ?? ''}
        ariaLabel={t('撤销设备')}
        onClose={() => setRevokingDevice(null)}
        onConfirm={() => {
          if (revokingDevice === null) return;
          const target = revokingDevice;
          setRevokingDevice(null);
          mutations.revokeDevice.mutate(target.id, {
            onError: (error) => toastError(t('撤销设备失败，请重试。'), error),
          });
        }}
      />
    </PageShell>
  );
}
