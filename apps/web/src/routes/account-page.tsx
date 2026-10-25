import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useSession } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useNotificationPermission } from '../board/notify-banner.js';
import { type NotifyPref, persistNotifyPref, readNotifyPref } from '../board/notify-pref.js';
import { ProfileHeader } from '../components/profile-card.js';
import {
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsRow,
  SettingsSegmented,
} from '../components/settings-list.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { Switch } from '../components/ui/switch.js';
import { toastError } from '../components/ui/toaster.js';
import {
  applyDensity,
  DENSITY_EVENT,
  type Density,
  readDomDensity,
  readStoredDensity,
} from '../density.js';
import { USER_NAME } from '../fixtures/fixtures.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { LOCALE_NAMES, LOCALES } from '../i18n/locale.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { safeLocalStorage } from '../safe-storage.js';

export function AccountPage() {
  const { locale, setLocale, t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const sessionQ = useSession(live);
  const mutations = useApiMutations(teamId);
  const [fixtureName, setFixtureName] = useState<string | null>(null);
  const userName = live ? (sessionQ.data?.displayName ?? USER_NAME) : (fixtureName ?? USER_NAME);
  const commitName = (next: string) => {
    if (!live) {
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
  const [density, setDensity] = useState<Density>(() => readStoredDensity(safeLocalStorage()));
  const selectDensity = (next: Density) => {
    applyDensity(next);
    setDensity(next);
  };
  useEffect(() => {
    const onDensity = (e: Event) => {
      const detail = (e as CustomEvent<Density>).detail;
      if (detail === 'comfortable' || detail === 'compact') setDensity(detail);
    };
    window.addEventListener(DENSITY_EVENT, onDensity);
    setDensity(readDomDensity());
    return () => window.removeEventListener(DENSITY_EVENT, onDensity);
  }, []);
  const { permission, request } = useNotificationPermission(
    live ? null : (fixture.ui?.notificationPermission ?? 'granted'),
  );
  const notifyOn = notifyPref === null ? permission === 'granted' : notifyPref === 'on';
  const notifyBlocked = notifyOn && permission === 'denied';
  return (
    <PageShell route="account" fixture={fixture} selected="none" title={t('帐号')}>
      <div className="flex flex-col gap-6">
        <ProfileHeader
          className="account-header"
          avatarClassName="account-avatar"
          avatar={
            <SeededAvatar
              className="size-14"
              name={userName}
              src={sessionQ.data?.avatarUrl ?? null}
              fallback="/avatar-user.png"
            />
          }
          name={userName}
          sub={t('头像与名称')}
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
            label={t('密度')}
            hint={t('紧凑会缩小字号与行距')}
            className="account-density-row"
          >
            <SettingsSegmented
              label={t('密度')}
              value={density}
              onChange={selectDensity}
              options={[
                {
                  value: 'comfortable',
                  label: t('舒适'),
                  testId: 'account-density-comfortable',
                },
                { value: 'compact', label: t('紧凑'), testId: 'account-density-compact' },
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label={t('推送通知')}
            hint={
              notifyBlocked
                ? t('浏览器已拒绝通知权限，需到站点设置重新允许')
                : t('任务需要你处理时，在系统通知中心提醒')
            }
            hintClassName={notifyBlocked ? 'account-notify-blocked' : undefined}
          >
            <Switch
              aria-label={t('推送通知')}
              checked={notifyOn}
              onCheckedChange={(checked) => {
                const next: NotifyPref = checked ? 'on' : 'off';
                setNotifyPref(next);
                persistNotifyPref(next, safeLocalStorage());
                if (checked && permission !== 'granted') request();
              }}
            />
          </SettingsRow>
        </SettingsCard>
      </div>
    </PageShell>
  );
}
