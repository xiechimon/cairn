import { type PairingCodeResponse, pairingLink } from '@cairn/shared';
import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  usePairingGrants,
  useRemoteDevices,
  useRemoteMutations,
  useRemoteRoutes,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { QrCode } from '../components/qr-code.js';
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
  const [pairing, setPairing] = useState<PairingCodeResponse | null>(null);
  const routes = routesQ.data?.routes ?? [];
  const candidates =
    routesQ.data === undefined ? [] : pairingCandidates(routes, window.location.origin);
  const pairingBlocked = live && routesQ.data !== undefined && candidates.length === 0;
  const tailnet = routesQ.data?.tailnet;
  const awaitingTailnetLogin = tailnet?.state === 'needs-login' && tailnet.authUrl !== null;
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
      {pairingBlocked && (
        <p className="m-0 mt-3 text-meta text-content-secondary" data-testid="pairing-blocked">
          {t(
            '配对已关闭：当前页面的地址只在这台电脑上有效，手机扫码后会连到它自己。请设置 CAIRN_TSNET=1 后重启，或用局域网或 Tailscale 地址打开本页。',
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
          title={t('这台电脑暂时没有手机可用的线路')}
          description={
            awaitingTailnetLogin && tailnet?.authUrl
              ? t('请先登录 Tailscale：{url}', { url: tailnet.authUrl })
              : t('设置 CAIRN_TSNET=1 后重启，即可用 Tailscale 连接手机。')
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
