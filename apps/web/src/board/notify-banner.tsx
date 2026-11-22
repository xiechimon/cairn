import { NOTIFICATION_BANNER_COPY } from '@cairn/shared';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { NoticeBanner } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { setNotifications, useNotificationsPermission } from '../pwa/push-device.js';

export function useNotificationBanner(
  fixtureFlag: boolean,
  live: boolean,
  teamId: string | undefined,
): { visible: boolean; enable: () => void } {
  const { t } = useI18n();
  const permission = useNotificationsPermission();
  const [fixtureEnabled, setFixtureEnabled] = useState(false);
  const enable = () => {
    if (!live) {
      setFixtureEnabled(true);
      return;
    }
    void setNotifications(teamId, true).catch((error: unknown) =>
      toastError(t('保存失败，请重试。'), error),
    );
  };
  return { visible: live ? permission === 'default' : fixtureFlag && !fixtureEnabled, enable };
}

export function NotificationBanner({ onEnable }: { onEnable: () => void }) {
  const { t } = useI18n();
  return (
    <NoticeBanner
      aria-label={t(NOTIFICATION_BANNER_COPY.title)}
      tone="info"
      icon={Bell}
      title={t(NOTIFICATION_BANNER_COPY.title)}
      body={t(NOTIFICATION_BANNER_COPY.body)}
      actions={
        <Button size="sm" className="px-3" onClick={onEnable}>
          {t(NOTIFICATION_BANNER_COPY.action)}
        </Button>
      }
    />
  );
}
