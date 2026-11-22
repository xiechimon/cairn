import { NOTIFICATION_BANNER_COPY } from '@cairn/shared';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { NoticeBanner } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { setNotifications, useNotificationsState } from '../pwa/push-device.js';

export function useNotificationBanner(
  fixtureFlag: boolean,
  live: boolean,
  teamId: string | undefined,
) {
  const device = useNotificationsState();
  const [fixtureEnabled, setFixtureEnabled] = useState(false);
  const pending = live && device.kind === 'pending';
  const failed = live && device.kind === 'failed' && device.target && teamId !== undefined;
  const visible = live
    ? ((device.kind === 'off' || pending) && device.offerBanner) || failed
    : fixtureFlag && !fixtureEnabled;
  const enable = () => {
    if (live) setNotifications(teamId, true);
    else setFixtureEnabled(true);
  };
  return { visible, enable, pending, failed };
}

export function NotificationBanner({
  onEnable,
  pending = false,
  failed = false,
}: {
  onEnable: () => void;
  pending?: boolean;
  failed?: boolean;
}) {
  const { t } = useI18n();
  return (
    <NoticeBanner
      aria-label={t(NOTIFICATION_BANNER_COPY.title)}
      tone="info"
      icon={Bell}
      title={t(NOTIFICATION_BANNER_COPY.title)}
      body={
        pending
          ? t('正在更新推送通知…')
          : failed
            ? t('未能开启推送，请重试')
            : t(NOTIFICATION_BANNER_COPY.body)
      }
      actions={
        <Button size="sm" className="px-3" onClick={onEnable} disabled={pending}>
          {failed ? t('重试') : t(NOTIFICATION_BANNER_COPY.action)}
        </Button>
      }
    />
  );
}
