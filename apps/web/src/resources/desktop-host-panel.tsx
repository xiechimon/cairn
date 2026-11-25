import { type FormEvent, useEffect, useState } from 'react';
import { useServerVersion } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { formatServerVersion } from '../board/remote-update-bar.js';
import { SettingsPanel } from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { type DesktopHostStatus, desktopHost } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import { hostRemoveConfirmCopy, hostSwitchConfirmCopy } from './desktop-host-confirm.js';
import { addAndSwitchRemoteHost, parseRemoteHostOrigin } from './remote-host.js';

export function DesktopHostPanel() {
  const { t } = useI18n();
  const { live } = useLiveData();
  const bridge = desktopHost();
  const [status, setStatus] = useState<DesktopHostStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [switching, setSwitching] = useState<{ id: string; label: string } | null>(null);
  const [removing, setRemoving] = useState<{
    id: string;
    label: string;
    isActive: boolean;
  } | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const serverVersion = useServerVersion(live);

  useEffect(() => {
    if (bridge === null) return;
    void bridge.status().then((next) => {
      if (next !== null) setStatus(next);
    });
  }, [bridge]);

  if (bridge === null || status === null) return null;

  const isLocalActive = status.activeId === 'local';
  const switchCopy = switching === null ? null : hostSwitchConfirmCopy(switching.label, t);
  const removeCopy =
    removing === null ? null : hostRemoveConfirmCopy(removing.label, removing.isActive, t);

  const toggleResident = async (checked: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await bridge.setResident(checked);
      if (next !== null) setStatus(next);
    } catch (error) {
      toastError(t('更新常驻主机设置失败，请重试。'), error);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRemote = async () => {
    if (busy) return;
    const parsed = parseRemoteHostOrigin(url);
    if (parsed === null) {
      toastError(t('请输入以 http:// 或 https:// 开头的完整主机地址。'), null);
      return;
    }
    setBusy(true);
    try {
      const next = await bridge.addRemote({
        name: name.trim() === '' ? parsed.defaultName : name.trim(),
        url: parsed.origin,
      });
      if (next !== null) {
        setStatus(next);
        setName('');
        setUrl('');
        setAdding(false);
      }
    } catch (error) {
      toastError(t('添加远程主机失败，请检查地址后重试。'), error);
    } finally {
      setBusy(false);
    }
  };

  const handleConnectRemote = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (parseRemoteHostOrigin(url) === null) {
      toastError(t('请输入以 http:// 或 https:// 开头的完整主机地址。'), null);
      return;
    }
    setBusy(true);
    try {
      await addAndSwitchRemoteHost(bridge, { url, name });
    } catch (error) {
      toastError(t('连接远程主机失败，请检查地址后重试。'), error);
      setBusy(false);
    }
  };

  const handleSwitch = async (id: string) => {
    if (busy || id === status.activeId) return;
    setBusy(true);
    try {
      await bridge.switch(id);
    } catch (error) {
      toastError(t('切换主机失败，请重试。'), error);
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await bridge.removeRemote(id);
      if (next !== null) setStatus(next);
    } catch (error) {
      toastError(t('移除远程主机失败，请重试。'), error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPanel
      header={
        <div className="flex w-full items-center justify-between gap-3">
          <h2 className="m-0 text-card-title font-semibold text-foreground">
            {t('主机连接与常驻')}
          </h2>
          {isLocalActive && !adding && (
            <Button
              variant="ghost"
              size="sm"
              className="pointer-coarse:h-11"
              data-testid="desktop-host-add-toggle"
              onClick={() => setAdding(true)}
            >
              {t('连接远程主机')}
            </Button>
          )}
        </div>
      }
    >
      <div data-testid="desktop-host-panel" className="flex min-w-0 flex-col">
        {live && !serverVersion.isPending && (
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <span className="text-ui font-medium text-foreground">{t('当前主机版本')}</span>
            <span
              className="text-meta text-content-secondary tabular-nums"
              data-testid="host-server-version"
            >
              {formatServerVersion(
                serverVersion.data?.version ?? null,
                serverVersion.data?.commit ?? null,
                t,
              )}
            </span>
          </div>
        )}
        {status.residentSupported && (
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">{t('本机常驻主机')}</span>
              <span className="text-meta text-content-secondary">
                {t('退出应用后保持服务在线，随应用自动更新')}
              </span>
            </div>
            <ToggleSwitch
              checked={status.residentInstalled}
              disabled={busy}
              aria-label={t('本机常驻主机')}
              data-testid="desktop-resident-switch"
              onCheckedChange={(checked) => void toggleResident(checked)}
            />
          </div>
        )}
        {status.connections.map((conn) => {
          const active = conn.id === status.activeId;
          const canSwitchTo = !active && (isLocalActive || conn.kind === 'local');
          return (
            <div
              key={conn.id}
              data-testid="desktop-host-row"
              className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-ui font-medium text-foreground">
                  <span className="truncate">{conn.kind === 'local' ? t('本机') : conn.name}</span>
                  {active && (
                    <Badge variant="outline" className="flex-none font-normal">
                      {t('当前')}
                    </Badge>
                  )}
                </div>
                {conn.url !== null && (
                  <span className="truncate text-meta text-content-secondary">{conn.url}</span>
                )}
              </div>
              <div className="flex flex-none items-center gap-2">
                {canSwitchTo && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    className="pointer-coarse:h-11"
                    onClick={() =>
                      setSwitching({
                        id: conn.id,
                        label: conn.kind === 'local' ? t('本机') : conn.name,
                      })
                    }
                  >
                    {t('切换')}
                  </Button>
                )}
                {isLocalActive && conn.kind === 'remote' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    className="pointer-coarse:h-11"
                    onClick={() => setRemoving({ id: conn.id, label: conn.name, isActive: active })}
                  >
                    {t('移除')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {isLocalActive && adding && (
          <form
            onSubmit={(e) => void handleConnectRemote(e)}
            className="flex flex-col gap-2 border-t border-border px-4 py-3"
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('主机地址，例如 https://studio-mac.tail4c2a.ts.net')}
              aria-label={t('主机地址')}
              disabled={busy}
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('主机名称（可选），例如 Mac mini')}
              aria-label={t('主机名称')}
              disabled={busy}
            />
            <p className="m-0 text-meta text-content-secondary">
              {t('连接并登录后，这台电脑会自动注册为该主机的执行机。')}
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="pointer-coarse:h-11"
                disabled={busy}
                onClick={() => setAdding(false)}
              >
                {t('取消')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="pointer-coarse:h-11"
                disabled={busy}
                onClick={() => void handleSaveRemote()}
              >
                {t('保存')}
              </Button>
              <Button type="submit" size="sm" className="pointer-coarse:h-11" disabled={busy}>
                {busy ? t('正在连接…') : t('连接并重启')}
              </Button>
            </div>
          </form>
        )}
      </div>
      <AlertDialogShell
        open={switchCopy !== null}
        title={switchCopy?.title ?? ''}
        ariaLabel={t('切换主机')}
        onClose={() => {
          if (!busy) setSwitching(null);
        }}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={switchCopy?.confirmLabel ?? t('切换并重启')}
            confirmDisabled={busy}
            onCancel={() => {
              if (!busy) setSwitching(null);
            }}
            onConfirm={() => {
              if (switching === null) return;
              const target = switching.id;
              setSwitching(null);
              void handleSwitch(target);
            }}
          />
        }
      >
        <p className="m-0 text-ui text-content-secondary">{switchCopy?.summary ?? ''}</p>
      </AlertDialogShell>
      <AlertDialogShell
        open={removeCopy !== null}
        title={removeCopy?.title ?? ''}
        ariaLabel={t('移除 {name}', { name: removing?.label ?? '' })}
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={removeCopy?.confirmLabel ?? t('移除')}
            confirmDisabled={busy}
            onCancel={() => {
              if (!busy) setRemoving(null);
            }}
            onConfirm={() => {
              if (removing === null) return;
              const target = removing.id;
              setRemoving(null);
              void handleRemove(target);
            }}
          />
        }
      >
        <p className="m-0 text-ui text-content-secondary">{removeCopy?.summary ?? ''}</p>
      </AlertDialogShell>
    </SettingsPanel>
  );
}
