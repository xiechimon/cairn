import { NOTIFICATION_BANNER_COPY } from '@cairn/shared';
import { Bell } from 'lucide-react';
import { useCallback, useState } from 'react';
import { NoticeBanner } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

export type NotificationPermissionState = NotificationPermission | 'unsupported';

function readPermission(): NotificationPermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function useNotificationPermission(fixtureState: NotificationPermissionState | null): {
  permission: NotificationPermissionState;
  request: () => void;
} {
  const [permission, setPermission] = useState<NotificationPermissionState>(
    () => fixtureState ?? readPermission(),
  );
  const request = useCallback(() => {
    if (typeof Notification === 'undefined') return;
    try {
      void Promise.resolve(Notification.requestPermission()).then(
        (next) => setPermission(next),
        () => setPermission('denied'),
      );
    } catch {
      setPermission('denied');
    }
  }, []);
  return { permission, request };
}

export function useNotificationBanner(
  fixtureFlag: boolean,
  live: boolean,
): { visible: boolean; enable: () => void } {
  const { permission, request } = useNotificationPermission(
    live ? null : fixtureFlag ? 'default' : 'granted',
  );
  return { visible: permission === 'default', enable: request };
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
