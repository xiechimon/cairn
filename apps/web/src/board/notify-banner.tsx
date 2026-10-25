import { NOTIFICATION_BANNER_COPY } from '@cairn/shared';
import { useCallback, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

function Bell() {
  return (
    <svg
      aria-hidden="true"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

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
    <section
      className="board-notify-banner flex h-16 items-center rounded-2xl border-0 bg-(--secondary) px-4 [box-shadow:var(--edge-ring),var(--card-shadow)]"
      aria-label={t(NOTIFICATION_BANNER_COPY.title)}
    >
      <span className="flex size-7 flex-none items-center justify-center rounded-full bg-(--notify-icon-bg) text-(--card-button)">
        <Bell />
      </span>
      <div className="ml-3.5 min-w-0">
        <div className="text-sm leading-5 font-medium text-foreground">
          {t(NOTIFICATION_BANNER_COPY.title)}
        </div>
        <div className="text-xs leading-4 text-muted-foreground">
          {t(NOTIFICATION_BANNER_COPY.body)}
        </div>
      </div>
      <Button
        size="sm"
        className="ml-auto flex-none px-3 text-[13px] font-normal"
        onClick={onEnable}
      >
        {t(NOTIFICATION_BANNER_COPY.action)}
      </Button>
    </section>
  );
}
