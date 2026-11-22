import { useEffect } from 'react';
import { api } from '../api/client.js';
import {
  migrateLegacyNotifications,
  notificationsOn,
  persistNotificationsChoice,
  readNotificationsChoice,
} from '../board/notify-pref.js';
import { desktopNotify } from '../desktop-shell.js';
import { safeLocalStorage } from '../safe-storage.js';

export function pushDeviceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    desktopNotify() === null &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Promise.resolve(Notification.requestPermission());
  } catch {
    return 'denied';
  }
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(`${base64.replace(/-/g, '+').replace(/_/g, '/')}${padding}`);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function currentDeviceSubscription(): Promise<PushSubscription | null> {
  if (!pushDeviceSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function subscribeDevicePush(teamId: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.get<{ publicKey: string }>(`/api/teams/${teamId}/push/key`);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = subscription.toJSON();
  await api.post(`/api/teams/${teamId}/push/subscriptions`, {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    ...(json.expirationTime != null ? { expirationTime: json.expirationTime } : {}),
  });
}

export async function unsubscribeDevicePush(teamId: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription === null) return;
  await api.del(`/api/teams/${teamId}/push/subscriptions`, {
    endpoint: subscription.endpoint,
  });
  await subscription.unsubscribe();
}

export async function syncDevicePush(teamId: string, on: boolean): Promise<void> {
  if (!pushDeviceSupported()) return;
  const subscription = await currentDeviceSubscription();
  if (on && subscription === null && Notification.permission === 'granted') {
    await subscribeDevicePush(teamId);
  } else if (!on && subscription !== null) {
    await unsubscribeDevicePush(teamId);
  }
}

export async function turnOnNotifications(teamId: string): Promise<NotificationPermission> {
  persistNotificationsChoice(true, safeLocalStorage());
  const permission = await ensureNotificationPermission();
  if (permission === 'granted') await syncDevicePush(teamId, true);
  return permission;
}

export function useNotificationsSync(teamId: string | undefined, live: boolean): void {
  useEffect(() => {
    if (!live || teamId === undefined) return;
    void (async () => {
      const storage = safeLocalStorage();
      const subscription = await currentDeviceSubscription();
      migrateLegacyNotifications(storage, subscription !== null);
      const permission =
        typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
      await syncDevicePush(teamId, notificationsOn(readNotificationsChoice(storage), permission));
    })().catch(() => {});
  }, [teamId, live]);
}
