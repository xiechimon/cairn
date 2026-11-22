import { NOTIFICATION_BANNER_COPY } from '@cairn/shared';
import { Bell } from 'lucide-react';
import { useCallback, useState } from 'react';
import { NoticeBanner } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { syncDevicePush } from '../pwa/push-device.js';
import { safeLocalStorage } from '../safe-storage.js';
import { notificationsOn, readNotificationsChoice } from './notify-pref.js';

export type NotificationPermissionState = NotificationPermission | 'unsupported';

function readPermission(): NotificationPermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function useNotificationPermission(fixtureState: NotificationPermissionState | null): {
  permission: NotificationPermissionState;
  request: () => Promise<NotificationPermissionState>;
} {
  const [permission, setPermission] = useState<NotificationPermissionState>(
    () => fixtureState ?? readPermission(),
  );
  const request = useCallback(async (): Promise<NotificationPermissionState> => {
    if (typeof Notification === 'undefined') return 'unsupported';
    let next: NotificationPermissionState = 'denied';
    try {
      next = await Promise.resolve(Notification.requestPermission());
    } catch {}
    setPermission(next);
    return next;
  }, []);
  return { permission, request };
}

export function useNotificationBanner(
  fixtureFlag: boolean,
  live: boolean,
  teamId: string | undefined,
): { visible: boolean; enable: () => void } {
  const { permission, request } = useNotificationPermission(
    live ? null : fixtureFlag ? 'default' : 'granted',
  );
  const enable = () => {
    void request().then((next) => {
      if (next !== 'granted' || !live || teamId === undefined) return;
      const on = notificationsOn(readNotificationsChoice(safeLocalStorage()), next);
      return syncDevicePush(teamId, on);
    });
  };
  return { visible: permission === 'default', enable };
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
