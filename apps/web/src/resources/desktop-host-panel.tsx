import { type FormEvent, useEffect, useState } from 'react';
import { SettingsPanel } from '../components/settings-list.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Switch } from '../components/ui/switch.js';
import { toastError } from '../components/ui/toaster.js';
import { type DesktopHostStatus, desktopHost } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';

export function DesktopHostPanel() {
  const { t } = useI18n();
  const bridge = desktopHost();
  const [status, setStatus] = useState<DesktopHostStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (bridge === null) return;
    void bridge.status().then((next) => {
      if (next !== null) setStatus(next);
    });
  }, [bridge]);

  if (bridge === null || status === null) return null;

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

  const handleAddRemote = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || name.trim() === '' || url.trim() === '') return;
    setBusy(true);
    try {
      const next = await bridge.addRemote({ name: name.trim(), url: url.trim() });
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
          {!adding && (
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
        {status.residentSupported && (
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">{t('本机常驻主机')}</span>
              <span className="text-meta text-content-secondary">
                {t('退出应用后保持服务在线，随应用自动更新')}
              </span>
            </div>
            <Switch
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
                {!active && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    className="pointer-coarse:h-11"
                    onClick={() => void handleSwitch(conn.id)}
                  >
                    {t('切换')}
                  </Button>
                )}
                {conn.kind === 'remote' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    className="pointer-coarse:h-11"
                    onClick={() => void handleRemove(conn.id)}
                  >
                    {t('移除')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {adding && (
          <form
            onSubmit={(e) => void handleAddRemote(e)}
            className="flex flex-col gap-2 border-t border-border px-4 py-3"
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('主机名称，例如 Mac mini')}
              aria-label={t('主机名称')}
              disabled={busy}
            />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('主机地址，例如 http://mac-mini.ts.net:8787')}
              aria-label={t('主机地址')}
              disabled={busy}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="pointer-coarse:h-11"
                onClick={() => setAdding(false)}
              >
                {t('取消')}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="pointer-coarse:h-11"
                disabled={busy || name.trim() === '' || url.trim() === ''}
              >
                {t('保存')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </SettingsPanel>
  );
}
