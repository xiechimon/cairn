import { safeLocalStorage } from '../safe-storage.js';

export const NOTIFICATIONS_KEY = 'cairn.notifications';
const LEGACY_IN_APP_KEY = 'cairn.notifyEnabled';

type NotificationsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let pageChoice: boolean | null = null;

export function readNotificationsChoice(storage: Pick<Storage, 'getItem'> | null): boolean | null {
  try {
    const value = storage?.getItem(NOTIFICATIONS_KEY) ?? storage?.getItem(LEGACY_IN_APP_KEY);
    if (value === '1') return true;
    if (value === '0') return false;
  } catch {}
  return null;
}

export function persistNotificationsChoice(
  on: boolean,
  storage: Pick<Storage, 'setItem'> | null,
): void {
  if (storage === null) throw new Error('Notification preferences are not writable');
  storage.setItem(NOTIFICATIONS_KEY, on ? '1' : '0');
}

export function currentNotificationsChoice(): boolean | null {
  return pageChoice ?? readNotificationsChoice(safeLocalStorage());
}

export function setNotificationsChoice(on: boolean): void {
  try {
    persistNotificationsChoice(on, safeLocalStorage());
    pageChoice = null;
  } catch {
    pageChoice = on;
  }
}

export function notificationsOn(
  choice: boolean | null,
  permission: NotificationPermission | 'unsupported',
): boolean {
  return choice !== false && permission === 'granted';
}

export function migrateLegacyNotifications(
  storage: NotificationsStorage | null,
  deviceSubscribed: boolean,
): void {
  if (storage === null) return;
  try {
    const legacy = storage.getItem(LEGACY_IN_APP_KEY);
    if (storage.getItem(NOTIFICATIONS_KEY) === null) {
      if (legacy === '1' || deviceSubscribed) storage.setItem(NOTIFICATIONS_KEY, '1');
      else if (legacy === '0') storage.setItem(NOTIFICATIONS_KEY, '0');
    }
    storage.removeItem(LEGACY_IN_APP_KEY);
  } catch {}
}
