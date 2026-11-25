import { NOTIFICATION_BANNER_COPY } from '@cairn/shared';
import { Bell } from 'lucide-react';
import { useCallback, useState } from 'react';
import { NoticeBanner } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { desktopNotify } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import { safeLocalStorage } from '../safe-storage.js';
import { persistNotifyPref, readNotifyPref } from './notify-pref.js';

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
  const request = useCallback(() => {
    if (typeof Notification === 'undefined')
      return Promise.resolve<NotificationPermissionState>('unsupported');
    try {
      return Promise.resolve(Notification.requestPermission()).then(
        (next) => {
          setPermission(next);
          return next;
        },
        () => {
          setPermission('denied');
          return 'denied' as const;
        },
      );
    } catch {
      setPermission('denied');
      return Promise.resolve<NotificationPermissionState>('denied');
    }
  }, []);
  return { permission, request };
}

export function useNotificationBanner(
  fixtureFlag: boolean,
  live: boolean,
): { visible: boolean; enable: () => void; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(() => readNotifyPref(safeLocalStorage()) === 'off');
  const { permission, request } = useNotificationPermission(
    live ? null : fixtureFlag ? 'default' : 'granted',
  );
  return {
    visible: !dismissed && desktopNotify() === null && permission === 'default',
    enable: () => void request(),
    dismiss: () => {
      persistNotifyPref('off', safeLocalStorage());
      setDismissed(true);
    },
  };
}

export function NotificationBanner({
  onEnable,
  onDismiss,
}: {
  onEnable: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  return (
    <NoticeBanner
      aria-label={t(NOTIFICATION_BANNER_COPY.title)}
      tone="info"
      icon={Bell}
      title={t(NOTIFICATION_BANNER_COPY.title)}
      body={t(NOTIFICATION_BANNER_COPY.body)}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="px-3" onClick={onEnable}>
            {t(NOTIFICATION_BANNER_COPY.action)}
          </Button>
          {onDismiss !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              className="px-3 text-content-secondary"
              onClick={onDismiss}
            >
              {t('以后再说')}
            </Button>
          )}
        </div>
      }
    />
  );
}
