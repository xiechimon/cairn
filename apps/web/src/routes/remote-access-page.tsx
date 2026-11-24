import { type PairingCodeResponse, type PairRequestSource, pairingLink } from '@cairn/shared';
import { Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  usePairingGrants,
  usePairingRequests,
  useRemoteDevices,
  useRemoteDirectory,
  useRemoteMutations,
  useRemoteRoutes,
  useSetTailnetAccess,
  useSetTunnelAccess,
  useShareRelayDevice,
  useSignOutRelayAccount,
  useStartRelayOAuth,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { joinMeta, relativeTime } from '../board/rel-time.js';
import { EmptyState } from '../components/empty-state.js';
import { FeedbackDialog } from '../components/feedback-dialog.js';
import { QrCode } from '../components/qr-code.js';
import { SettingsCard, SettingsRow } from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
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
import { type PairingCandidate, pairingCandidates } from '../lib/pairing-origin.js';
import { PageShell } from '../pages/shell.js';
import { ResourceList, ResourceRow, RowDesc, RowText, RowTitle } from '../resources/parts.js';

export const REMOTE_ACCESS_ROUTE = 'remote-access';

function sourceName(source: PairingCandidate['source'], t: (key: string) => string): string {
  if (source === 'page') return t('当前页面地址');
  if (source === 'tunnel') return t('公网隧道');
  return source === 'tailnet' ? t('Tailscale') : t('局域网');
}

function pairRequestSourceName(source: PairRequestSource, t: (key: string) => string): string {
  switch (source) {
    case 'loopback':
      return t('这台电脑');
    case 'lan':
      return t('局域网');
    case 'tailnet':
      return t('Tailscale');
    case 'public':
      return t('外部网络');
    default:
      return t('不明');
  }
}

function displayPairCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
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
  const requestsQ = usePairingRequests(live);
  const mutations = useRemoteMutations();
  const setTailnet = useSetTailnetAccess();
  const setTunnel = useSetTunnelAccess();
  const startOAuth = useStartRelayOAuth();
  const signOutAccount = useSignOutRelayAccount();
  const shareDevice = useShareRelayDevice();
  const [pairing, setPairing] = useState<PairingCodeResponse | null>(null);
  const [toggleFailed, setToggleFailed] = useState(false);
  const [tunnelToggleFailed, setTunnelToggleFailed] = useState(false);
  const [relayDraft, setRelayDraft] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [tunnelCopied, setTunnelCopied] = useState(false);
  const [loginCopied, setLoginCopied] = useState(false);
  const routes = routesQ.data?.routes ?? [];
  const candidates =
    routesQ.data === undefined ? [] : pairingCandidates(routes, window.location.origin);
  const pairingBlocked = live && routesQ.data !== undefined && candidates.length === 0;
  const tailnet = routesQ.data?.tailnet;
  const tunnel = routesQ.data?.tunnel;
  const relayAccount = tunnel?.account ?? null;
  const directoryQ = useRemoteDirectory(live && relayAccount !== null);
  const ownDevices = directoryQ.data?.ownDevices ?? [];
  const sharedDevices = directoryQ.data?.sharedDevices ?? [];
  const selfSubdomain = directoryQ.data?.selfSubdomain ?? null;
  const tunnelOn = tunnel?.enabled === true;
  const tunnelState = tunnelOn ? tunnel.state : 'off';
  const tunnelFailed = tunnelOn && (tunnelState === 'failed' || tunnelToggleFailed);
  const tunnelUrl = tunnelOn && tunnelState === 'ready' ? tunnel.url : null;
  const relayInputValue = relayDraft ?? tunnel?.relayUrl ?? '';
  const tunnelHint: ReactNode = (() => {
    if (!tunnelOn)
      return tunnelToggleFailed
        ? t('公网隧道未能打开，请检查中继地址后重试')
        : t('打开后，无需 Tailscale，手机和其他电脑也能通过加密中继隧道访问这台电脑');
    if (tunnelFailed) {
      const kind = tunnel?.error;
      if (kind === 'auth-off') return t('公网隧道需要开启访问认证');
      if (kind === 'invalid-relay') return t('中继地址无效，请填写完整的 https:// 地址');
      if (kind === 'rejected') return t('中继服务器拒绝了连接，请稍后重试');
      return t('无法连接到中继服务器，请检查网络或中继地址');
    }
    if (tunnelUrl !== null)
      return (
        <>
          {t('公网隧道已开启')}
          <br />
          <span className="font-mono">{tunnelUrl}</span>
        </>
      );
    return t('正在连接公网隧道…');
  })();
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
        ? t('远程访问未能打开，请重试')
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
  const requests = requestsQ.data ?? [];
  const startPairing = () =>
    mutations.createPairingCode.mutate(undefined, {
      onSuccess: setPairing,
      onError: (error) => toastError(t('生成配对码失败，请重试。'), error),
    });
  const decideRequest = (id: string, decision: 'approve' | 'deny') =>
    mutations.decidePairRequest.mutate(
      { id, decision },
      { onError: (error) => toastError(t('操作失败，请重试。'), error) },
    );
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
                pairRequestSourceName(request.source, t),
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
      {(live || routesQ.data !== undefined) && tunnel !== undefined && (
        <div className="mt-3 flex flex-col gap-3" data-testid="remote-account-connect">
          {tunnelFailed && (
            <Card className="gap-2 p-4" data-testid="remote-tunnel-error-banner">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 text-ui font-medium text-destructive">{t('公网隧道连接异常')}</p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTunnel.mutate({ enabled: true })}
                  >
                    {t('重试')}
                  </Button>
                  <Button
                    size="sm"
                    className={DIALOG_PRIMARY_BUTTON}
                    onClick={() => setFeedbackOpen(true)}
                    data-testid="remote-error-feedback"
                  >
                    {t('一键反馈此问题')}
                  </Button>
                </div>
              </div>
              <p className="m-0 text-meta text-content-tertiary">{tunnelHint}</p>
            </Card>
          )}
          {relayAccount === null ? (
            <Card className="gap-3 p-4" data-testid="remote-account-signin-card">
              <div>
                <p className="m-0 text-ui font-medium">{t('登录账号，多台电脑一键直连')}</p>
                <p className="m-0 mt-1 text-meta text-content-tertiary">
                  {t('在两台 Windows 或 Mac 上登录同一账号，自动发现彼此并直连，无需每次扫码。')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!tunnel.relayUrl && (
                  <Input
                    value={relayInputValue}
                    onChange={(event) => setRelayDraft(event.target.value)}
                    placeholder="https://relay.example.com"
                    aria-label={t('中继地址')}
                    data-testid="remote-tunnel-relay-input"
                    className="max-w-60 font-mono text-meta"
                  />
                )}
                <Button
                  size="sm"
                  className={DIALOG_PRIMARY_BUTTON}
                  disabled={startOAuth.isPending || relayInputValue.trim() === ''}
                  data-testid="remote-account-signin-btn"
                  onClick={() => {
                    const trimmedRelay = relayInputValue.trim();
                    startOAuth.mutate(trimmedRelay !== '' ? { relayUrl: trimmedRelay } : {}, {
                      onSuccess: ({ loginUrl: oauthUrl }) => {
                        window.location.href = oauthUrl;
                      },
                      onError: (err) => toastError(t('无法发起登录，请检查中继地址后重试'), err),
                    });
                  }}
                >
                  {startOAuth.isPending
                    ? t('正在跳转到 Clerk 登录…')
                    : t('使用 Clerk 登录（Google / GitHub）')}
                </Button>
              </div>
            </Card>
          ) : (
            <>
              <SettingsCard>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {relayAccount.avatarUrl ? (
                      <img
                        src={relayAccount.avatarUrl}
                        alt={relayAccount.displayName}
                        className="size-8 flex-none rounded-full object-cover"
                      />
                    ) : (
                      <span className="inline-flex size-8 flex-none items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background uppercase">
                        {relayAccount.displayName.slice(0, 1)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="m-0 truncate text-ui font-medium text-foreground">
                        {relayAccount.displayName}
                      </p>
                      <p className="m-0 truncate text-meta text-content-tertiary">
                        {relayAccount.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="remote-share-open"
                      onClick={() => setShareOpen(true)}
                    >
                      {t('授权给其他账号')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={signOutAccount.isPending}
                      onClick={() => signOutAccount.mutate()}
                    >
                      {t('退出')}
                    </Button>
                  </div>
                </div>
                {ownDevices.map((dev) => (
                  <SettingsRow
                    key={dev.subdomain}
                    label={dev.name}
                    hint={`${dev.os} · ${dev.online ? t('在线') : t('离线')}`}
                  >
                    {dev.subdomain === selfSubdomain ? (
                      <span className="text-meta text-content-tertiary">{t('本机已在线')}</span>
                    ) : dev.online ? (
                      <Button
                        size="sm"
                        className={DIALOG_PRIMARY_BUTTON}
                        render={<a href={`${dev.url}/app`} target="_blank" rel="noreferrer" />}
                      >
                        {t('点击连接')}
                      </Button>
                    ) : (
                      <span className="text-meta text-content-tertiary">{t('未开机')}</span>
                    )}
                  </SettingsRow>
                ))}
              </SettingsCard>
              {sharedDevices.length > 0 && (
                <SettingsCard>
                  {sharedDevices.map((dev) => (
                    <SettingsRow
                      key={dev.subdomain}
                      label={dev.name}
                      hint={`${dev.ownerEmail} · ${dev.online ? t('在线') : t('离线')}`}
                    >
                      {dev.online ? (
                        <Button
                          size="sm"
                          variant="outline"
                          render={<a href={`${dev.url}/app`} target="_blank" rel="noreferrer" />}
                        >
                          {t('点击连接')}
                        </Button>
                      ) : (
                        <span className="text-meta text-content-tertiary">{t('未开机')}</span>
                      )}
                    </SettingsRow>
                  ))}
                </SettingsCard>
              )}
              <div className="flex items-center justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFeedbackOpen(true)}
                  data-testid="remote-footer-feedback"
                >
                  {t('遇到连接问题？反馈 Bug')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <details className="mt-4" data-testid="remote-advanced-details">
        <summary className="cursor-pointer select-none text-meta text-content-tertiary hover:text-foreground">
          {t('高级：本地 Tailscale 与手动配对')}
        </summary>
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
              <div
                className="flex flex-col items-center gap-3 px-4 py-4"
                data-testid="tailnet-login"
              >
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
            {tunnel !== undefined && (
              <>
                <SettingsRow
                  label={t('公网隧道')}
                  hint={tunnelHint}
                  hintClassName={tunnelFailed ? 'text-destructive' : undefined}
                >
                  <div className="flex items-center gap-2">
                    {tunnelUrl !== null && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard?.writeText(tunnelUrl).then(() => {
                            setTunnelCopied(true);
                            setTimeout(() => setTunnelCopied(false), 2_000);
                          });
                        }}
                      >
                        {tunnelCopied ? t('已复制') : t('复制链接')}
                      </Button>
                    )}
                    <ToggleSwitch
                      checked={tunnelOn}
                      disabled={!live || setTunnel.isPending}
                      aria-label={t('公网隧道')}
                      data-testid="remote-tunnel-switch"
                      onCheckedChange={(checked) => {
                        setTunnelToggleFailed(false);
                        setTunnel.reset();
                        const trimmed = relayInputValue.trim();
                        setTunnel.mutate(
                          {
                            enabled: checked,
                            ...(checked && trimmed !== '' ? { relayUrl: trimmed } : {}),
                          },
                          { onError: () => setTunnelToggleFailed(true) },
                        );
                      }}
                    />
                  </div>
                </SettingsRow>
                {(!tunnelOn || tunnelFailed) && (
                  <div className="flex items-center gap-2 px-4 pb-3">
                    <Input
                      value={relayInputValue}
                      onChange={(event) => setRelayDraft(event.target.value)}
                      placeholder="https://relay.example.com"
                      aria-label={t('中继地址')}
                      data-testid="remote-tunnel-relay-input"
                      className="font-mono text-meta"
                    />
                  </div>
                )}
              </>
            )}
          </SettingsCard>
        )}
        {pairingBlocked && requestsQ.data !== undefined && requests.length === 0 && (
          <p className="m-0 mt-3 text-meta text-content-secondary" data-testid="pairing-blocked">
            {t(
              '配对已关闭：当前页面的地址只在这台电脑上有效，手机扫码后会连到它自己。请打开上面的远程访问开关，或用局域网或 Tailscale 地址打开本页。',
            )}
          </p>
        )}
        {live && routesQ.data === undefined ? null : pairingBlocked && !awaitingTailnetLogin ? (
          devices.length === 0 && (
            <p
              className="m-0 mt-3 text-meta text-content-tertiary"
              data-testid="remote-routes-empty"
            >
              {t('暂无已配对的设备')}
            </p>
          )
        ) : routes.length === 0 ? (
          <EmptyState
            testId="remote-routes-empty"
            className="mt-6"
            icon={Smartphone}
            title={t('手机尚无法连接这台电脑')}
            description={
              awaitingTailnetLogin
                ? t('请先登录 Tailscale。')
                : t('打开上方的开关，手机在外部网络也能连接这台电脑。')
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
      </details>
      {pairing !== null && routesQ.data !== undefined && candidates.length > 0 && (
        <PairingDialog
          pairing={pairing}
          candidates={candidates}
          environmentId={routesQ.data.environmentId}
          onClose={() => setPairing(null)}
        />
      )}
      {shareOpen && (
        <DialogShell
          title={t('授权给其他账号')}
          subtitle={t('对方使用自己的账号登录后，即可在远程访问列表里直接点击连接这台电脑。')}
          onClose={() => setShareOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setShareOpen(false)}>
                {t('取消')}
              </Button>
              <Button
                className={DIALOG_PRIMARY_BUTTON}
                disabled={shareDevice.isPending || !shareEmail.includes('@')}
                onClick={() => {
                  shareDevice.mutate(
                    { targetEmail: shareEmail.trim(), role: 'collaborator' },
                    {
                      onSuccess: () => {
                        toastSuccess(t('已授权给 {email}', { email: shareEmail.trim() }));
                        setShareEmail('');
                        setShareOpen(false);
                      },
                      onError: (err) => toastError(t('授权失败，请确认本机隧道已在线'), err),
                    },
                  );
                }}
              >
                {t('发送授权')}
              </Button>
            </>
          }
        >
          <Input
            value={shareEmail}
            onChange={(event) => setShareEmail(event.target.value)}
            placeholder="friend@example.com"
            aria-label={t('对方邮箱')}
          />
        </DialogShell>
      )}
      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        route="/app/settings/remote-access"
        errorSummary={tunnelFailed ? `tunnel:${tunnel?.error ?? 'failed'}` : undefined}
      />
    </PageShell>
  );
}
