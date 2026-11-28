import { BRAND, type CloudStatusResponse } from '@cairn/shared';
import {
  ArrowUpRight,
  CreditCard,
  ExternalLink,
  Laptop,
  LogIn,
  LogOut,
  Monitor,
  Settings,
  Upload,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useCloudAccountMutations, useCloudStatus } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Separator } from '../components/ui/separator.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { type DesktopHostStatus, desktopHost, isDesktopShell } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import { addAndSwitchRemoteHost } from '../resources/remote-host.js';

const ACCOUNT_AVATAR_CLS = 'size-5 flex-none';
const POPOVER_AVATAR_CLS = 'size-8 flex-none';
const MENU_ICON_CLS = 'size-4 flex-none text-muted-foreground';
const ACTIVE_POLL_WINDOW_MS = 180_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function validatedExternalUrl(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.username !== '' || parsed.password !== '') return null;
  if (parsed.protocol === 'https:') return parsed.toString();
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return parsed.toString();
  return null;
}

function openExternalTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function workspaceStatusText(
  status: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (status === 'ready') return t('云端工作区已就绪');
  if (status === 'provisioning') return t('云端工作区准备中');
  if (status === 'suspended') return t('云端工作区已暂停');
  return t('云端工作区异常');
}

function accountSubtitle(
  status: CloudStatusResponse | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!status?.linked) return t('本机模式');
  if (!status.cloudReachable) return t('云端离线');
  if (status.subscribed) return t('Cairn 云端 · 已订阅');
  return t('Cairn 云端 · 未订阅');
}

export interface AccountHostRow {
  id: string;
  label: string;
  active: boolean;
  local: boolean;
  switchable: boolean;
}

export interface SidebarAccountPanelProps {
  displayName: string;
  avatarSrc: string | null | undefined;
  cloud: CloudStatusResponse | undefined;
  linked: boolean;
  offerCloudSignIn: boolean;
  offerBillingPortal: boolean;
  workspaceUrl: string | null;
  onRemoteHost: boolean;
  desktopHostAvailable: boolean;
  hosts?: readonly AccountHostRow[];
  connectPending: boolean;
  checkoutPending: boolean;
  portalPending: boolean;
  switchingHost: boolean;
  disconnectPending: boolean;
  onSignIn: () => void;
  onAccountSettings: () => void;
  onSubscribe: () => void;
  onBillingPortal: () => void;
  onOpenWorkspace: () => void;
  onSwitchHost?: (id: string) => void;
  onSignOut: () => void;
}

export function SidebarAccountPanel(props: SidebarAccountPanelProps) {
  const { t } = useI18n();
  const {
    displayName,
    avatarSrc,
    cloud,
    linked,
    offerCloudSignIn,
    offerBillingPortal,
    workspaceUrl,
    onRemoteHost,
    desktopHostAvailable,
    hosts,
    connectPending,
    checkoutPending,
    portalPending,
    switchingHost,
    disconnectPending,
    onSignIn,
    onAccountSettings,
    onSubscribe,
    onBillingPortal,
    onOpenWorkspace,
    onSwitchHost,
    onSignOut,
  } = props;
  return (
    <>
      <div className="flex items-center gap-2.5 px-1.5 py-1.5">
        <SeededAvatar
          className={POPOVER_AVATAR_CLS}
          name={displayName}
          src={avatarSrc}
          fallback="/avatar-user.png"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-ui font-medium text-foreground">{displayName}</span>
            {linked && cloud?.subscribed && (
              <Badge variant="secondary" data-testid="cloud-subscribed-badge">
                {t('已订阅')}
              </Badge>
            )}
          </div>
          <p
            className="truncate text-xs text-muted-foreground"
            data-testid="cloud-account-subtitle"
          >
            {accountSubtitle(cloud, t)}
          </p>
        </div>
      </div>
      <Separator className="my-1.5" />
      {desktopHostAvailable && hosts !== undefined && hosts.length > 1 && (
        <>
          <div className="flex flex-col gap-1" data-testid="account-host-list">
            <div className="px-2 text-meta text-muted-foreground">{t('主机')}</div>
            {hosts.map((host) => (
              <Button
                key={host.id}
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 font-normal"
                data-testid="account-host-row"
                data-host-id={host.id}
                data-host-active={host.active ? 'true' : 'false'}
                aria-current={host.active ? 'true' : undefined}
                disabled={!host.switchable || switchingHost}
                onClick={() => onSwitchHost?.(host.id)}
              >
                {host.local ? (
                  <Laptop className={MENU_ICON_CLS} />
                ) : (
                  <Monitor className={MENU_ICON_CLS} />
                )}
                <span className="truncate">{host.label}</span>
                {host.active && (
                  <Badge variant="outline" className="ml-auto flex-none font-normal">
                    {t('当前')}
                  </Badge>
                )}
              </Button>
            ))}
            {onRemoteHost && (
              <p className="px-2 text-meta text-muted-foreground" data-testid="account-host-hint">
                {t('远程工作区只能切回本机')}
              </p>
            )}
          </div>
          <Separator className="my-1.5" />
        </>
      )}
      <div className="flex flex-col gap-1">
        {!linked ? (
          <>
            {offerCloudSignIn && (
              <Button
                size="sm"
                className="w-full justify-start gap-2"
                data-testid="cloud-sign-in"
                disabled={connectPending}
                onClick={onSignIn}
              >
                <LogIn className="size-4 flex-none" />
                {t('登录 Cairn 账号')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 font-normal"
              data-testid="cloud-account-settings"
              onClick={onAccountSettings}
            >
              <Settings className={MENU_ICON_CLS} />
              {t('账号设置')}
            </Button>
          </>
        ) : (
          <>
            {!cloud?.subscribed && (
              <Button
                size="sm"
                className="w-full justify-start gap-2"
                data-testid="cloud-subscribe"
                disabled={checkoutPending}
                onClick={onSubscribe}
              >
                <ArrowUpRight className="size-4 flex-none" />
                {t('开通 Cairn 云端 ($12/月)')}
              </Button>
            )}
            {offerBillingPortal && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 font-normal"
                data-testid="cloud-billing-portal"
                disabled={portalPending}
                onClick={onBillingPortal}
              >
                <CreditCard className={MENU_ICON_CLS} />
                {t('管理订阅与发票')}
              </Button>
            )}
            {cloud?.workspace !== null && cloud?.workspace !== undefined && (
              <div
                className="px-2 py-1 text-xs text-muted-foreground"
                data-testid="cloud-workspace-status"
              >
                {workspaceStatusText(cloud.workspace.status, t)}
              </div>
            )}
            {workspaceUrl !== null && !onRemoteHost && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 font-normal"
                data-testid="cloud-open-workspace"
                disabled={switchingHost}
                onClick={onOpenWorkspace}
              >
                <ExternalLink className={MENU_ICON_CLS} />
                {desktopHostAvailable ? t('切换到云端工作区') : t('打开云端工作区')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 font-normal"
              data-testid="cloud-migrate-data"
              onClick={onAccountSettings}
            >
              <Upload className={MENU_ICON_CLS} />
              {t('迁移本机数据')}
            </Button>
            <Separator className="my-1" />
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 font-normal text-muted-foreground hover:text-foreground"
              data-testid="cloud-sign-out"
              disabled={disconnectPending}
              onClick={onSignOut}
            >
              <LogOut className={MENU_ICON_CLS} />
              {t('退出 Cairn 账号')}
            </Button>
          </>
        )}
      </div>
    </>
  );
}

export function SidebarAccount() {
  const { t } = useI18n();
  const { live, user } = useLiveData();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pollUntilMs, setPollUntilMs] = useState(0);
  const [hostStatus, setHostStatus] = useState<DesktopHostStatus | null>(null);
  const [switchingHost, setSwitchingHost] = useState(false);

  const activePoll = pollUntilMs > Date.now();
  const cloudQuery = useCloudStatus(live, { activePoll });
  const mutations = useCloudAccountMutations();
  const cloud = cloudQuery.data;
  const linked = live && cloud?.linked === true && cloud.user !== null;
  const localName = user.displayName.trim() !== '' ? user.displayName : BRAND.manifestName;
  const displayName = linked
    ? cloud.user?.name?.trim() || cloud.user?.email?.trim() || localName
    : localName;
  const avatarSrc = linked ? cloud.user?.avatarUrl : user.avatarUrl;
  const desktop = isDesktopShell();
  const hostBridge = desktopHost();
  const workspaceUrl = validatedExternalUrl(cloud?.workspace?.url);
  const localConnection = hostStatus?.connections.find((conn) => conn.kind === 'local') ?? null;
  const onRemoteHost =
    hostStatus !== null && localConnection !== null && hostStatus.activeId !== localConnection.id;
  const hosts: AccountHostRow[] =
    hostStatus === null
      ? []
      : hostStatus.connections.map((conn) => ({
          id: conn.id,
          label: conn.kind === 'local' ? t('本机') : conn.name,
          active: conn.id === hostStatus.activeId,
          local: conn.kind === 'local',
          switchable:
            conn.id !== hostStatus.activeId && (onRemoteHost ? conn.kind === 'local' : true),
        }));

  useEffect(() => {
    if (!activePoll) return;
    const remaining = Math.max(0, pollUntilMs - Date.now());
    const timer = window.setTimeout(() => setPollUntilMs(0), remaining);
    return () => window.clearTimeout(timer);
  }, [activePoll, pollUntilMs]);

  useEffect(() => {
    const outcome = searchParams.get('cloud');
    if (outcome === null) return;
    if (outcome === 'connected') {
      toastSuccess(t('已登录 Cairn 账号'));
      void cloudQuery.refetch();
    } else if (outcome === 'error') {
      toastError(t('登录 Cairn 账号未完成，请重试。'), null);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('cloud');
    next.delete('reason');
    setSearchParams(next, { replace: true });
  }, [cloudQuery, searchParams, setSearchParams, t]);

  useEffect(() => {
    if (!open || hostBridge === null) return;
    let cancelled = false;
    void hostBridge.status().then(
      (next) => {
        if (!cancelled) setHostStatus(next);
      },
      () => {
        if (!cancelled) setHostStatus(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [hostBridge, open]);

  const navigateSettingsAccount = () => {
    setOpen(false);
    const scenario = searchParams.get('scenario');
    void navigate({
      pathname: '/app/settings/account',
      search: scenario ? `?scenario=${encodeURIComponent(scenario)}` : '',
    });
  };

  const handleSignIn = async () => {
    if (!live) {
      blockDemoWrite();
      return;
    }
    try {
      const returnTo = `${location.pathname}${location.search}`;
      const result = await mutations.startConnect.mutateAsync({
        returnTo: returnTo.startsWith('/app') ? returnTo : '/app',
        shell: desktop ? 'desktop' : 'browser',
      });
      const safeUrl = validatedExternalUrl(result.authorizationUrl);
      if (safeUrl === null) {
        toastError(t('登录地址无效，请稍后重试。'), null);
        return;
      }
      if (desktop) {
        setPollUntilMs(Date.now() + ACTIVE_POLL_WINDOW_MS);
        setOpen(false);
        openExternalTab(safeUrl);
        return;
      }
      window.location.assign(safeUrl);
    } catch (error) {
      toastError(t('无法启动 Cairn 账号登录。'), error);
    }
  };

  const handleSubscribe = async () => {
    if (!live) {
      blockDemoWrite();
      return;
    }
    try {
      const result = await mutations.startCheckout.mutateAsync();
      const safeUrl = validatedExternalUrl(result.url);
      if (safeUrl === null) {
        toastError(t('支付链接无效，请稍后重试。'), null);
        return;
      }
      setPollUntilMs(Date.now() + ACTIVE_POLL_WINDOW_MS);
      setOpen(false);
      openExternalTab(safeUrl);
    } catch (error) {
      toastError(t('无法打开订阅结账页面。'), error);
    }
  };

  const handleBillingPortal = async () => {
    if (!live) {
      blockDemoWrite();
      return;
    }
    try {
      const result = await mutations.openBillingPortal.mutateAsync();
      const safeUrl = validatedExternalUrl(result.url);
      if (safeUrl === null) {
        toastError(t('账单门户链接无效，请稍后重试。'), null);
        return;
      }
      setOpen(false);
      openExternalTab(safeUrl);
    } catch (error) {
      toastError(t('无法打开订阅与发票管理页。'), error);
    }
  };

  const handleOpenCloudWorkspace = async () => {
    if (workspaceUrl === null) return;
    if (hostBridge === null || onRemoteHost) {
      setOpen(false);
      openExternalTab(workspaceUrl);
      return;
    }
    setSwitchingHost(true);
    try {
      const next = await addAndSwitchRemoteHost(hostBridge, {
        url: workspaceUrl,
        name: 'Cairn Cloud',
      });
      if (next !== null) setHostStatus(next);
      setOpen(false);
    } catch {
      setOpen(false);
      openExternalTab(workspaceUrl);
    } finally {
      setSwitchingHost(false);
    }
  };

  const handleSwitchHost = async (id: string) => {
    if (hostBridge === null) return;
    setSwitchingHost(true);
    try {
      const next = await hostBridge.switch(id);
      if (next !== null) setHostStatus(next);
      setOpen(false);
    } catch (error) {
      toastError(t('切换主机失败，请重试。'), error);
    } finally {
      setSwitchingHost(false);
    }
  };

  const handleSignOut = async () => {
    if (!live) {
      blockDemoWrite();
      return;
    }
    try {
      await mutations.disconnect.mutateAsync();
      setPollUntilMs(0);
      setOpen(false);
      toastSuccess(t('已退出 Cairn 账号'));
    } catch (error) {
      toastError(t('退出账号失败，请重试。'), error);
    }
  };

  const offerCloudSignIn = !live || cloud?.configured === true;
  const offerBillingPortal = linked && (cloud.subscribed || cloud.hasBillingCustomer);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            data-testid="sidebar-account"
            className="h-8 max-w-full min-w-0 justify-start gap-2 rounded-md px-2 font-normal text-foreground hover:bg-sidebar-hover"
          />
        }
      >
        <SeededAvatar
          className={ACCOUNT_AVATAR_CLS}
          name={displayName}
          src={avatarSrc}
          fallback="/avatar-user.png"
        />
        <span className="truncate text-ui">{displayName}</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        data-testid="sidebar-account-popover"
        className="w-64 p-2"
      >
        <SidebarAccountPanel
          displayName={displayName}
          avatarSrc={avatarSrc}
          cloud={cloud}
          linked={linked}
          offerCloudSignIn={offerCloudSignIn}
          offerBillingPortal={offerBillingPortal}
          workspaceUrl={workspaceUrl}
          onRemoteHost={onRemoteHost}
          desktopHostAvailable={hostBridge !== null}
          hosts={hosts}
          connectPending={mutations.startConnect.isPending}
          checkoutPending={mutations.startCheckout.isPending}
          portalPending={mutations.openBillingPortal.isPending}
          switchingHost={switchingHost}
          disconnectPending={mutations.disconnect.isPending}
          onSignIn={() => void handleSignIn()}
          onAccountSettings={navigateSettingsAccount}
          onSubscribe={() => void handleSubscribe()}
          onBillingPortal={() => void handleBillingPortal()}
          onOpenWorkspace={() => void handleOpenCloudWorkspace()}
          onSwitchHost={(id) => void handleSwitchHost(id)}
          onSignOut={() => void handleSignOut()}
        />
      </PopoverContent>
    </Popover>
  );
}
