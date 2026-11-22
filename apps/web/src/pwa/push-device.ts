import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api/client.js';
import {
  currentNotificationsChoice,
  migrateLegacyNotifications,
  NOTIFICATIONS_KEY,
  notificationsOn,
  setNotificationsChoice,
} from '../board/notify-pref.js';
import { desktopNotify } from '../desktop-shell.js';
import { safeLocalStorage } from '../safe-storage.js';

type Permission = NotificationPermission | 'unsupported';

const NOTIFICATIONS_CHANGE = 'cairn:notifications-change';
const DEVICE_LOOKUP_MS = 2000;
let deviceQueue = Promise.resolve();
let permissionRequest: Promise<Permission> | null = null;
let revision = 0;

function readPermission(): Permission {
  if (desktopNotify() !== null) return 'granted';
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function browserPushAvailable(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

export function pushDeviceSupported(): boolean {
  return browserPushAvailable() && desktopNotify() === null && typeof Notification !== 'undefined';
}

function announceChange(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGE));
}

function watchPermission(change: () => void): () => void {
  let status: PermissionStatus | undefined;
  let cancelled = false;
  window.addEventListener('focus', change);
  document.addEventListener('visibilitychange', change);
  void navigator.permissions
    ?.query({ name: 'notifications' })
    .then((result) => {
      if (cancelled) return;
      status = result;
      status.addEventListener('change', change);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    status?.removeEventListener('change', change);
    window.removeEventListener('focus', change);
    document.removeEventListener('visibilitychange', change);
  };
}

function subscribeNotifications(change: () => void): () => void {
  const stop = watchPermission(change);
  window.addEventListener(NOTIFICATIONS_CHANGE, change);
  window.addEventListener('storage', change);
  return () => {
    stop();
    window.removeEventListener(NOTIFICATIONS_CHANGE, change);
    window.removeEventListener('storage', change);
  };
}

export function useNotificationsPermission(): Permission {
  return useSyncExternalStore(subscribeNotifications, readPermission);
}

export function useNotificationsChecked(): boolean {
  return useSyncExternalStore(subscribeNotifications, () => {
    const choice = currentNotificationsChoice();
    const permission = readPermission();
    return (
      notificationsOn(choice, permission) ||
      (choice === true && permission === 'default' && permissionRequest !== null)
    );
  });
}

function requestPermission(): Promise<Permission> {
  const permission = readPermission();
  if (permission !== 'default') return Promise.resolve(permission);
  permissionRequest ??= (async () => {
    try {
      return await Notification.requestPermission();
    } catch {
      return 'denied';
    }
  })().finally(() => {
    permissionRequest = null;
    announceChange();
  });
  return permissionRequest;
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(`${base64.replace(/-/g, '+').replace(/_/g, '/')}${padding}`);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function deviceRegistration() {
  if (!browserPushAvailable()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready.then(async ({ pushManager }) => ({
        pushManager,
        subscription: await pushManager.getSubscription(),
      })),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Push service worker not ready')),
          DEVICE_LOOKUP_MS,
        );
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function currentDeviceSubscription(): Promise<PushSubscription | null> {
  return (await deviceRegistration())?.subscription ?? null;
}

function reconcileDevice(teamId: string, migrate: boolean): Promise<void> {
  const sync = async () => {
    const device = await deviceRegistration();
    if (device === undefined) return;
    const subscription = device?.subscription ?? null;
    if (migrate) {
      migrateLegacyNotifications(safeLocalStorage(), subscription !== null);
      announceChange();
    }
    if (device === null) return;
    const on = notificationsOn(currentNotificationsChoice(), readPermission());
    if (!on && subscription !== null) {
      await api.del(`/api/teams/${teamId}/push/subscriptions`, { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    } else if (on && subscription === null && pushDeviceSupported()) {
      const { publicKey } = await api.get<{ publicKey: string }>(`/api/teams/${teamId}/push/key`);
      const created = await device.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      try {
        const json = created.toJSON();
        await api.post(`/api/teams/${teamId}/push/subscriptions`, {
          endpoint: created.endpoint,
          keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
          ...(json.expirationTime != null ? { expirationTime: json.expirationTime } : {}),
        });
      } catch (error) {
        await created.unsubscribe().catch(() => {});
        throw error;
      }
    }
  };
  const operation = deviceQueue.then(() =>
    navigator.locks === undefined ? sync() : navigator.locks.request(NOTIFICATIONS_KEY, sync),
  );
  deviceQueue = operation.catch(() => {});
  return operation;
}

export async function setNotifications(teamId: string | undefined, on: boolean): Promise<boolean> {
  const requestRevision = ++revision;
  setNotificationsChoice(on);
  const permission = on ? requestPermission() : null;
  announceChange();
  if (permission !== null && (await permission) !== 'granted') return false;
  if (requestRevision !== revision || currentNotificationsChoice() !== on) return false;
  try {
    if (teamId !== undefined) await reconcileDevice(teamId, false);
    return on && currentNotificationsChoice() === true;
  } catch (error) {
    if (requestRevision === revision && currentNotificationsChoice() === on) {
      setNotificationsChoice(!on);
      announceChange();
      throw error;
    }
    return false;
  }
}

export function useNotificationsSync(teamId: string | undefined, live: boolean): void {
  useEffect(() => {
    if (!live || teamId === undefined) return;
    const sync = () => void reconcileDevice(teamId, true).catch(() => {});
    const onStorage = (event: StorageEvent) => {
      if (event.key === NOTIFICATIONS_KEY || event.key === null) sync();
    };
    const stop = watchPermission(sync);
    navigator.serviceWorker?.addEventListener('controllerchange', sync);
    window.addEventListener('storage', onStorage);
    sync();
    return () => {
      stop();
      navigator.serviceWorker?.removeEventListener('controllerchange', sync);
      window.removeEventListener('storage', onStorage);
    };
  }, [teamId, live]);
}
