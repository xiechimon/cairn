// Account route (issue #70): avatar and name above one settings card with
// 语言 / 密度 / 推送通知. 删除 / 退出登录 (#148), 邮箱 (XMON-107) and the avatar
// swap button (#306) are gone: a single-user self-host has no account face for
// them. The name is inline-editable and lands PATCH /api/user/me (#1031).
//
// 推送通知 (#1031) is a stored preference (cairn.notifyEnabled, read by the
// sse.ts desktop-notification gate) layered over Notification.permission:
// until the user picks, it follows the permission; a non-granted "on" also
// drives the #114 requestPermission() path, and on + denied explains the block
// in place of the sub-line. Fixture mode freezes the permission per scenario
// and defaults to granted (headless chromium reports the real API 'denied').

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
  // M5 live：名称 = GET /api/user/me（seed 单用户 displayName，02 §2.1）。
  // 邮箱行已删（XMON-107 用户裁决）：无邮箱账位面，占位无信息量。
  const { live, teamId } = useLiveData();
  const sessionQ = useSession(live);
  const mutations = useApiMutations(teamId);
  // #1031 改名：live 落 PATCH /api/user/me（既有资料更新通道，成功后 session
  // 读面失效重取回显）；fixture 面本地态覆写（scenario 无后端，改名只回显）。
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
  // #1031 推送通知开关 = 用户偏好档（本地持久化）× 浏览器权限，两层分离：
  //  · 偏好档（cairn.notifyEnabled）：显示态主源。null（未表态）时跟随权限
  //    ——granted 显示开、其余显示关；一旦点过就以偏好为准，不再被权限推导。
  //  · 权限（Notification.permission）：只决定「真弹与否」（sse.ts 闸门）与
  //    非 granted 态点开时驱动一次 requestPermission（#114 banner 同一路径）。
  // 这样 granted 态点「关」落地为偏好 off（sse 停弹），denied 态点「开」落地
  // 为偏好 on + 拦截解释——两侧点击都有可解释结果，不再是单向空操作。
  // fixture 面权限由 scenario 冻结（可表达 granted/denied/default 三态，不再
  // 硬编 granted）；无 scenario 位时缺省 granted 保 r7 13 基线行的开态。
  const [notifyPref, setNotifyPref] = useState<NotifyPref | null>(() =>
    readNotifyPref(safeLocalStorage()),
  );
  const [density, setDensity] = useState<Density>(() => readStoredDensity(safeLocalStorage()));
  const selectDensity = (next: Density) => {
    applyDensity(next);
    setDensity(next);
  };
  // Keep segment face in sync with user-menu (Bugbot #1366 desync).
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
  // 开着但权限被拒 = 显示开而实际不弹，必须给出解释（不能裸奔成新的假可供性）。
  const notifyBlocked = notifyOn && permission === 'denied';
  return (
    <PageShell route="account" fixture={fixture} selected="team" title={t('帐号')}>
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
