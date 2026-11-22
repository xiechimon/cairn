import { Monitor, Moon, Sun } from 'lucide-react';
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
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
  notificationsChecked,
  retryNotifications,
  setNotifications,
  useNotificationsState,
} from '../pwa/push-device.js';
import { safeLocalStorage } from '../safe-storage.js';
import { applyTheme, readStoredTheme, type ThemePreference } from '../theme.js';

export function AccountPage() {
  const { locale, setLocale, t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId, user, teamsQuery } = useLiveData();
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
  const device = useNotificationsState();
  const native = desktopNotify() !== null;
  const notifyHintId = useId();
  const fixturePermission = fixture.ui?.notificationPermission ?? 'granted';
  const [fixtureNotificationsOn, setFixtureNotificationsOn] = useState<boolean | null>(null);
  const notifyBlocked = live ? device.kind === 'denied' : fixturePermission === 'denied';
  const pending = live && device.kind === 'pending';
  const failed = live && device.kind === 'failed';
  const unsupported = live && device.kind === 'unsupported';
  const nativeEnabled = unsupported ? device.nativeEnabled : null;
  const checked = live
    ? notificationsChecked(device)
    : !notifyBlocked && (fixtureNotificationsOn ?? fixturePermission === 'granted');
  const notifyDescription = native
    ? t('任务需要你处理时，在系统通知中心提醒')
    : t('需要你处理时提醒，不急的邮件定时汇总');
  const notifyStatus = notifyBlocked
    ? t('浏览器已拒绝通知权限，需到站点设置重新允许')
    : pending
      ? t('正在更新推送通知…')
      : failed
        ? device.target
          ? t('未能开启推送，请重试')
          : t('未能关闭推送，请重试')
        : unsupported
          ? native
            ? t('无法确认系统通知权限，请在系统设置中管理')
            : t('此浏览器不支持推送通知')
          : null;
  const [theme, setTheme] = useState<ThemePreference>(() => readStoredTheme(safeLocalStorage()));
  const changeNotifications = (next: boolean) => {
    if (!live) {
      if (!notifyBlocked && !blockDemoWrite()) setFixtureNotificationsOn(next);
      return;
    }
    setNotifications(teamId, device.kind === 'pending' ? !device.target : next);
  };
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
              <span id={notifyHintId}>
                {(!unsupported || native) && <span className="block">{notifyDescription}</span>}
                {notifyStatus !== null && (
                  <span role="status" className="block">
                    {notifyStatus}
                  </span>
                )}
              </span>
            }
            hintClassName={notifyBlocked ? 'account-notify-blocked' : undefined}
          >
            {failed && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (teamId === undefined) void teamsQuery?.refetch();
                  else retryNotifications(teamId);
                }}
              >
                {t('重试')}
              </Button>
            )}
            {nativeEnabled !== null && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNotifications(teamId, !nativeEnabled)}
              >
                {nativeEnabled ? t('暂停应用提醒') : t('恢复应用提醒')}
              </Button>
            )}
            {checked !== null && (
              <ToggleSwitch
                aria-label={t('推送通知')}
                aria-describedby={notifyHintId}
                aria-busy={pending || undefined}
                checked={checked}
                disabled={notifyBlocked || (pending && !device.interactive)}
                onCheckedChange={changeNotifications}
              />
            )}
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
      </div>
    </PageShell>
  );
}
