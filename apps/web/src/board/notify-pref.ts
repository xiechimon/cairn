export const NOTIFICATIONS_KEY = 'cairn.notifications';
const LEGACY_IN_APP_KEY = 'cairn.notifyEnabled';

type NotificationsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readNotificationsChoice(storage: Pick<Storage, 'getItem'> | null): boolean | null {
  let value: string | null = null;
  try {
    value = storage?.getItem(NOTIFICATIONS_KEY) ?? null;
  } catch {
    return null;
  }
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

export function persistNotificationsChoice(
  on: boolean,
  storage: Pick<Storage, 'setItem'> | null,
): void {
  try {
    storage?.setItem(NOTIFICATIONS_KEY, on ? '1' : '0');
  } catch {}
}

export function notificationsOn(
  choice: boolean | null,
  permission: NotificationPermission | 'unsupported',
): boolean {
  return choice ?? permission === 'granted';
}

export function migrateLegacyNotifications(
  storage: NotificationsStorage | null,
  deviceSubscribed: boolean,
): void {
  if (storage === null) return;
  try {
    const legacy = storage.getItem(LEGACY_IN_APP_KEY);
    if (storage.getItem(NOTIFICATIONS_KEY) === null) {
      if (legacy === '1' || deviceSubscribed) persistNotificationsChoice(true, storage);
      else if (legacy === '0') persistNotificationsChoice(false, storage);
    }
    storage.removeItem(LEGACY_IN_APP_KEY);
  } catch {}
}
