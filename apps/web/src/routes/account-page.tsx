import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useNotificationPermission } from '../board/notify-banner.js';
import { type NotifyPref, persistNotifyPref, readNotifyPref } from '../board/notify-pref.js';
import { ProfileHeader } from '../components/profile-card.js';
import {
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
} from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { desktopNotify } from '../desktop-shell.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { LOCALE_NAMES, LOCALES } from '../i18n/locale.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import {
  currentDeviceSubscription,
  ensureNotificationPermission,
  pushDeviceSupported,
  subscribeDevicePush,
  unsubscribeDevicePush,
} from '../pwa/push-device.js';
import { BackupSettingsSection } from '../resources/backup-settings-section.js';
import { safeLocalStorage } from '../safe-storage.js';
import { applyTheme, readStoredTheme, type ThemePreference } from '../theme.js';

export function AccountPage() {
  const { locale, setLocale, t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId, user } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [fixtureName, setFixtureName] = useState<string | null>(null);
  const userName = live ? user.displayName : (fixtureName ?? user.displayName);
  const commitName = (next: string) => {
    if (!live) {
      if (blockDemoWrite()) return;
      setFixtureName(next);
      return;
    }
    mutations.patchUser.mutate(
      { displayName: next },
      { onError: (error) => toastError(t('保存失败，请重试。'), error) },
    );
  };
  const [notifyPref, setNotifyPref] = useState<NotifyPref | null>(() =>
    readNotifyPref(safeLocalStorage()),
  );
  const { permission, request } = useNotificationPermission(
    live ? null : (fixture.ui?.notificationPermission ?? 'granted'),
  );
  const [askedPermission, setAskedPermission] = useState<NotificationPermission | null>(null);
  const notifyPermission = askedPermission ?? permission;
  const desktopShell = desktopNotify() !== null;
  const notifyPrefOn =
    notifyPref === null ? desktopShell || notifyPermission === 'granted' : notifyPref === 'on';
  const notifyBlocked = !desktopShell && notifyPrefOn && notifyPermission === 'denied';
  const devicePushLive = live && teamId !== undefined && !desktopShell && pushDeviceSupported();
  const [theme, setTheme] = useState<ThemePreference>(() => readStoredTheme(safeLocalStorage()));
  const [deviceSubscribed, setDeviceSubscribed] = useState<boolean | null>(null);
  const deviceActual = useRef<boolean | null>(null);
  const deviceWanted = useRef<boolean | null>(null);
  const deviceSyncing = useRef(false);
  useEffect(() => {
    if (!devicePushLive) return;
    let cancelled = false;
    void currentDeviceSubscription().then((sub) => {
      if (cancelled || deviceWanted.current !== null) return;
      deviceActual.current = sub !== null;
      setDeviceSubscribed(sub !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [devicePushLive]);
  const syncDevice = async (team: string) => {
    if (deviceSyncing.current) return;
    deviceSyncing.current = true;
    while (deviceWanted.current !== null && deviceWanted.current !== deviceActual.current) {
      const want = deviceWanted.current;
      try {
        if (want) {
          const granted = await ensureNotificationPermission();
          setAskedPermission(granted);
          if (granted !== 'granted') {
            deviceWanted.current = deviceActual.current;
            setDeviceSubscribed(deviceActual.current ?? false);
            break;
          }
          await subscribeDevicePush(team);
        } else {
          await unsubscribeDevicePush(team);
        }
        deviceActual.current = want;
      } catch (error) {
        const kept = deviceActual.current ?? !want;
        deviceWanted.current = kept;
        setDeviceSubscribed(kept);
        toastError(t('保存失败，请重试。'), error);
        break;
      }
    }
    deviceSyncing.current = false;
  };
  const wantDevice = (subscribed: boolean) => {
    if (teamId === undefined) return;
    deviceWanted.current = subscribed;
    setDeviceSubscribed(subscribed);
    void syncDevice(teamId);
  };
  const notifyOn = notifyPrefOn || (devicePushLive && deviceSubscribed === true);
  const offerLockScreen =
    devicePushLive && notifyPrefOn && deviceSubscribed === false && notifyPermission !== 'denied';
  return (
    <PageShell route="account" fixture={fixture} selected="none" title={t('账号')}>
      <div className="flex flex-col gap-6">
        <ProfileHeader
          className="account-header px-0"
          avatarClassName="account-avatar"
          avatar={
            <SeededAvatar
              className="size-14"
              name={userName}
              src={user.avatarUrl}
              fallback="/avatar-user.png"
            />
          }
          name={userName}
          onRename={commitName}
        />
        <SettingsCard className="account-card">
          <SettingsRow label={t('语言')}>
            <Select
              value={locale}
              defaultOpen={fixture.ui?.langDropdownOpen === true}
              onValueChange={(next) => {
                if (next !== null) setLocale(next);
              }}
            >
              <SelectTrigger aria-label={t('语言')} className={SETTINGS_SELECT_TRIGGER_CLS}>
                <SelectValue>{LOCALE_NAMES[locale]}</SelectValue>
              </SelectTrigger>
              <SelectContent aria-label={t('语言')} align="end" alignItemWithTrigger={false}>
                {LOCALES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {LOCALE_NAMES[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            label={t('推送通知')}
            hint={
              notifyBlocked ? (
                t('浏览器已拒绝通知权限，需到站点设置重新允许')
              ) : desktopShell ? (
                t('任务需要你处理时，在系统通知中心提醒')
              ) : (
                <>
                  <span className="block">{t('需要你处理时提醒，不急的邮件定时汇总')}</span>
                  {offerLockScreen && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 text-foreground pointer-coarse:h-11 pointer-coarse:px-4"
                      onClick={() => wantDevice(true)}
                    >
                      {t('开启锁屏推送')}
                    </Button>
                  )}
                </>
              )
            }
            hintClassName={notifyBlocked ? 'account-notify-blocked' : undefined}
          >
            <ToggleSwitch
              aria-label={t('推送通知')}
              checked={notifyOn}
              onCheckedChange={(checked) => {
                const next: NotifyPref = checked ? 'on' : 'off';
                setNotifyPref(next);
                persistNotifyPref(next, safeLocalStorage());
                if (devicePushLive) {
                  wantDevice(checked);
                  return;
                }
                if (checked && permission !== 'granted') void request();
              }}
            />
          </SettingsRow>
        </SettingsCard>
        <SettingsSection title={t('外观')} testId="account-appearance">
          <SettingsCard>
            <SettingsRow label={t('颜色主题')}>
              <SettingsSegmented
                label={t('颜色主题')}
                value={theme}
                className="h-7 pointer-coarse:h-12 [&_[data-segmented=option]]:size-6 [&_[data-segmented=option]]:px-0 pointer-coarse:[&_[data-segmented=option]]:size-11"
                onChange={(next) => {
                  applyTheme(next);
                  setTheme(next);
                }}
                options={[
                  { value: 'system', icon: <Monitor />, ariaLabel: t('跟随系统') },
                  { value: 'light', icon: <Sun />, ariaLabel: t('浅色') },
                  { value: 'dark', icon: <Moon />, ariaLabel: t('深色') },
                ]}
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
        <BackupSettingsSection />
      </div>
    </PageShell>
  );
}
