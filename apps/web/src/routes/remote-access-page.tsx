import { type PairingCodeResponse, pairingLink } from '@cairn/shared';
import { Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  usePairingGrants,
  useRemoteDevices,
  useRemoteMutations,
  useRemoteRoutes,
  useSetTailnetAccess,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { QrCode } from '../components/qr-code.js';
import { SettingsCard, SettingsRow } from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { type PairingCandidate, pairingCandidates } from '../lib/pairing-origin.js';
import { PageShell } from '../pages/shell.js';
import { ResourceList, ResourceRow, RowDesc, RowText, RowTitle } from '../resources/parts.js';

export const REMOTE_ACCESS_ROUTE = 'remote-access';

function sourceName(source: PairingCandidate['source'], t: (key: string) => string): string {
  if (source === 'page') return t('当前页面地址');
  return source === 'tailnet' ? t('Tailscale') : t('局域网');
}

function sourceLabel(
  candidates: PairingCandidate[],
  origin: string,
  t: (key: string) => string,
): string {
  const found = candidates.find((candidate) => candidate.origin === origin);
  return found === undefined ? origin : sourceName(found.source, t);
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
          onClick={() => void navigator.clipboard?.writeText(link)}
        >
          {t('复制链接')}
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <QrCode text={link} label={t('配对二维码')} />
        {candidates.length > 1 && (
          <Select value={origin} onValueChange={(next) => setChosen(next ?? origin)}>
            <SelectTrigger className="w-full max-w-72" data-testid="pairing-route-select">
              <SelectValue>{sourceLabel(candidates, origin, t)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.origin} value={candidate.origin}>
                  {sourceName(candidate.source, t)}
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
  const devicesQ = useRemoteDevices(live);
  const grantsQ = usePairingGrants(live);
  const mutations = useRemoteMutations();
  const setTailnet = useSetTailnetAccess();
  const [pairing, setPairing] = useState<PairingCodeResponse | null>(null);
  const [toggleFailed, setToggleFailed] = useState(false);
  const [loginCopied, setLoginCopied] = useState(false);
  const routes = routesQ.data?.routes ?? [];
  const candidates =
    routesQ.data === undefined ? [] : pairingCandidates(routes, window.location.origin);
  const pairingBlocked = live && routesQ.data !== undefined && candidates.length === 0;
  const tailnet = routesQ.data?.tailnet;
  const tailnetOn = tailnet?.enabled === true;
  const tailnetState = tailnetOn ? tailnet.state : 'off';
  const tailnetFailed = tailnetOn && (tailnetState === 'failed' || toggleFailed);
  const loginUrl = tailnetOn && tailnetState === 'needs-login' ? tailnet.authUrl : null;
  const tailnetAddress =
    tailnetOn && tailnetState === 'ready' && tailnet.dnsName !== null
      ? `https://${tailnet.dnsName}`
      : null;
  const tailnetHint: ReactNode = (() => {
    if (!tailnetOn)
      return toggleFailed
        ? t('远程访问没有打开，请再试一次')
        : t('打开后，手机和其他电脑能通过你的 Tailscale 网络连到这台电脑');
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
  const startPairing = () =>
    mutations.createPairingCode.mutate(undefined, {
      onSuccess: setPairing,
      onError: (error) => toastError(t('生成配对码失败，请重试。'), error),
    });
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
      {(live || routesQ.data !== undefined) && (
        <SettingsCard className="mt-3">
          <SettingsRow
            label={t('远程访问')}
            hint={tailnetHint}
            hintClassName={tailnetFailed ? 'text-destructive' : undefined}
          >
            <ToggleSwitch
              checked={tailnetOn}
              disabled={!live || setTailnet.isPending}
              aria-label={t('远程访问')}
              data-testid="remote-access-switch"
              onCheckedChange={(checked) => {
                setToggleFailed(false);
                setTailnet.reset();
                setTailnet.mutate(checked, { onError: () => setToggleFailed(true) });
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
                    void navigator.clipboard?.writeText(loginUrl).then(() => {
                      setLoginCopied(true);
                      setTimeout(() => setLoginCopied(false), 2_000);
                    });
                  }}
                >
                  {loginCopied ? t('已复制') : t('复制链接')}
                </Button>
              </div>
            </div>
          )}
        </SettingsCard>
      )}
      {pairingBlocked && (
        <p className="m-0 mt-3 text-meta text-content-secondary" data-testid="pairing-blocked">
          {t(
            '配对已关闭：当前页面的地址只在这台电脑上有效，手机扫码后会连到它自己。请打开上面的远程访问开关，或用局域网或 Tailscale 地址打开本页。',
          )}
        </p>
      )}
      {live && routesQ.data === undefined ? null : pairingBlocked && !awaitingTailnetLogin ? (
        devices.length === 0 && (
          <p className="m-0 mt-3 text-meta text-content-tertiary" data-testid="remote-routes-empty">
            {t('还没有配对的设备')}
          </p>
        )
      ) : routes.length === 0 ? (
        <EmptyState
          testId="remote-routes-empty"
          className="mt-6"
          icon={Smartphone}
          title={t('手机还连不上这台电脑')}
          description={
            awaitingTailnetLogin
              ? t('请先登录 Tailscale。')
              : t('打开上面的开关，手机在外面也能连上这台电脑。')
          }
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
                <RowDesc>{new Date(grant.expiresAt).toISOString()}</RowDesc>
              </RowText>
              <Button
                variant="ghost"
                className={DIALOG_PRIMARY_BUTTON}
                disabled={mutations.revokePairingCode.isPending}
                onClick={() =>
                  mutations.revokePairingCode.mutate(grant.id, {
                    onError: (error) => toastError(t('撤销设备失败，请重试。'), error),
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
                onClick={() =>
                  mutations.revokeDevice.mutate(device.id, {
                    onError: (error) => toastError(t('撤销设备失败，请重试。'), error),
                  })
                }
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
    </PageShell>
  );
}
