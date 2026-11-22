import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useNotificationPermission } from '../board/notify-banner.js';
import {
  notificationsOn,
  persistNotificationsChoice,
  readNotificationsChoice,
} from '../board/notify-pref.js';
import { ProfileHeader } from '../components/profile-card.js';
import {
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
} from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
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
import { resolveScenario } from '../fixtures/scenario.js';
import { LOCALE_NAMES, LOCALES } from '../i18n/locale.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { syncDevicePush } from '../pwa/push-device.js';
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
  const [notifyChoice, setNotifyChoice] = useState<boolean | null>(() =>
    readNotificationsChoice(safeLocalStorage()),
  );
  const { permission, request } = useNotificationPermission(
    live ? null : (fixture.ui?.notificationPermission ?? 'granted'),
  );
  const notifyOn = notificationsOn(notifyChoice, permission);
  const notifyBlocked = notifyOn && permission === 'denied';
  const [theme, setTheme] = useState<ThemePreference>(() => readStoredTheme(safeLocalStorage()));
  const setNotifications = (checked: boolean) => {
    setNotifyChoice(checked);
    persistNotificationsChoice(checked, safeLocalStorage());
    void (async () => {
      const granted = checked && (permission === 'granted' || (await request()) === 'granted');
      if (!live || teamId === undefined || (checked && !granted)) return;
      await syncDevicePush(teamId, checked);
    })().catch((error: unknown) => toastError(t('保存失败，请重试。'), error));
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
              notifyBlocked
                ? t('浏览器已拒绝通知权限，需到站点设置重新允许')
                : t('任务需要你处理时提醒你，应用关着或锁屏时也能收到')
            }
            hintClassName={notifyBlocked ? 'account-notify-blocked' : undefined}
          >
            <ToggleSwitch
              aria-label={t('推送通知')}
              checked={notifyOn}
              onCheckedChange={setNotifications}
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
      </div>
    </PageShell>
  );
}
