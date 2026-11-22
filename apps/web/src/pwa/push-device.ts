import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api/client.js';
import {
  currentNotificationsChoice,
  migrateLegacyNotifications,
  NOTIFICATIONS_KEY,
  setNotificationsChoice,
} from '../board/notify-pref.js';
import { desktopNotify } from '../desktop-shell.js';
import { safeLocalStorage } from '../safe-storage.js';

type DeviceState =
  | { kind: 'off'; offerBanner: boolean }
  | {
      kind: 'pending';
      checked: boolean | null;
      target: boolean;
      offerBanner: boolean;
      interactive: boolean;
    }
  | { kind: 'on' }
  | { kind: 'failed'; checked: boolean | null; target: boolean }
  | { kind: 'denied' }
  | { kind: 'unsupported'; nativeEnabled: boolean | null };

const DEVICE_LOOKUP_MS = 2000;
const INITIAL_STATE: DeviceState = {
  kind: 'pending',
  checked: null,
  target: false,
  offerBanner: false,
  interactive: false,
};
let state: DeviceState = INITIAL_STATE;
let deviceQueue = Promise.resolve();
let permissionRequest: Promise<NotificationPermission> | null = null;
let revision = 0;
let running = false;
const listeners = new Set<() => void>();

function publish(next: DeviceState): void {
  state = next;
  for (const listener of listeners) listener();
}

function browserPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function browserPushAvailable(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

function subscribeState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotificationsState(): DeviceState {
  return useSyncExternalStore(subscribeState, () => state);
}

export function notificationsChecked(device: DeviceState): boolean | null {
  switch (device.kind) {
    case 'on':
      return true;
    case 'off':
    case 'denied':
      return false;
    case 'pending':
    case 'failed':
      return device.checked;
    case 'unsupported':
      return null;
  }
}

export function canDeliverNotifications(native: boolean): boolean {
  if (currentNotificationsChoice() === false) return false;
  return native
    ? state.kind === 'unsupported' && state.nativeEnabled === true
    : notificationsChecked(state) === true && browserPermission() === 'granted';
}

function requestPermission(): Promise<NotificationPermission> | undefined {
  if (browserPermission() !== 'default') return undefined;
  permissionRequest ??= (async () => await Notification.requestPermission())().finally(() => {
    permissionRequest = null;
  });
  return permissionRequest;
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(`${base64.replace(/-/g, '+').replace(/_/g, '/')}${padding}`);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function observeDevice<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Push device lookup timed out')),
          DEVICE_LOOKUP_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function removeBrowserSubscription(subscription: PushSubscription, pushManager: PushManager) {
  if (await subscription.unsubscribe()) return;
  const remaining = await observeDevice(() => pushManager.getSubscription());
  if (remaining !== null) throw new Error('Browser push subscription was not removed');
}

function reconcileDevice(teamId: string, request?: { on: boolean }): void {
  const native = desktopNotify() !== null;
  const hasPush = browserPushAvailable();
  const permission = browserPermission();
  if (!native && (!hasPush || permission === 'unsupported')) {
    publish({ kind: 'unsupported', nativeEnabled: null });
    return;
  }
  const attempt = ++revision;
  const current = () => attempt === revision;
  const target =
    !native &&
    (request?.on ?? (currentNotificationsChoice() !== false && permission === 'granted'));
  const offerBanner =
    !native && (state.kind === 'off' || state.kind === 'pending') && state.offerBanner;
  const pending: Extract<DeviceState, { kind: 'pending' }> = {
    kind: 'pending',
    checked: native ? null : permission === 'denied' ? false : notificationsChecked(state),
    target,
    offerBanner: target && (offerBanner || (state.kind === 'failed' && state.target)),
    interactive: request !== undefined && !native && permission !== 'denied',
  };
  publish(pending);
  running = true;
  const prompt = target && request !== undefined ? requestPermission() : undefined;
  let checked: boolean | null = null;
  let enabling = target;
  const confirm = (value: boolean) => {
    checked = value;
    if (current() && !native && pending.checked !== value) publish({ ...pending, checked: value });
  };

  const sync = async (): Promise<DeviceState | undefined> => {
    if (!current()) return;
    const device = hasPush
      ? await observeDevice(async () => {
          const { pushManager } = await navigator.serviceWorker.ready;
          return { pushManager, subscription: await pushManager.getSubscription() };
        })
      : null;
    if (!current()) return;
    const subscription = device?.subscription ?? null;
    migrateLegacyNotifications(safeLocalStorage(), !native && subscription !== null);
    const latestPermission = browserPermission();
    enabling = !native && currentNotificationsChoice() !== false && latestPermission === 'granted';
    const path = `/api/teams/${teamId}/push/subscriptions`;
    if (!enabling || device === null) {
      if (subscription !== null && device !== null) {
        await api.del(path, { endpoint: subscription.endpoint });
        confirm(false);
        await removeBrowserSubscription(subscription, device.pushManager);
      }
      if (native)
        return { kind: 'unsupported', nativeEnabled: currentNotificationsChoice() !== false };
      if (latestPermission === 'denied') return { kind: 'denied' };
      return { kind: 'off', offerBanner: latestPermission === 'default' };
    }
    let next = subscription;
    if (next === null) {
      confirm(false);
      const { publicKey } = await api.get<{ publicKey: string }>(`/api/teams/${teamId}/push/key`);
      if (!current()) return;
      next = await device.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    if (!current()) return;
    const json = next.toJSON();
    checked = null;
    try {
      await api.post(path, {
        endpoint: next.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        ...(json.expirationTime != null ? { expirationTime: json.expirationTime } : {}),
      });
    } catch (error) {
      if (subscription === null) {
        await removeBrowserSubscription(next, device.pushManager).then(
          () => confirm(false),
          () => {},
        );
      }
      throw error;
    }
    return { kind: 'on' };
  };
  void (async () => {
    try {
      if (prompt !== undefined) await prompt;
      if (!current()) return;
      const operation = deviceQueue.then(() =>
        navigator.locks === undefined ? sync() : navigator.locks.request(NOTIFICATIONS_KEY, sync),
      );
      deviceQueue = operation.then(
        () => {},
        () => {},
      );
      const result = await operation;
      if (!current() || result === undefined) return;
      if (
        result.kind === 'on' &&
        (browserPermission() !== 'granted' || currentNotificationsChoice() === false)
      ) {
        reconcileDevice(teamId);
      } else {
        publish(result);
      }
    } catch {
      if (current())
        publish({ kind: 'failed', checked: native ? null : checked, target: enabling });
    } finally {
      if (current()) running = false;
    }
  })();
}

export function setNotifications(teamId: string | undefined, on: boolean): void {
  if (teamId === undefined) return;
  setNotificationsChoice(on);
  reconcileDevice(teamId, { on });
}

export function retryNotifications(teamId: string | undefined): void {
  if (state.kind !== 'failed' || teamId === undefined) return;
  reconcileDevice(teamId, { on: state.target });
}

export function useNotificationsSync(
  teamId: string | undefined,
  live: boolean,
  loadingTeams: boolean,
): void {
  useEffect(() => {
    if (!live) return;
    if (teamId === undefined) {
      const native = desktopNotify() !== null;
      const permission = browserPermission();
      if (!native && (!browserPushAvailable() || permission === 'unsupported')) {
        publish({ kind: 'unsupported', nativeEnabled: null });
      } else if (!native && permission === 'denied') {
        publish({ kind: 'denied' });
      } else if (loadingTeams) {
        publish(INITIAL_STATE);
      } else {
        publish({
          kind: 'failed',
          checked: null,
          target: !native && currentNotificationsChoice() !== false,
        });
      }
      return;
    }
    let lastPermission = browserPermission();
    let watched: PermissionStatus | undefined;
    let disposed = false;
    const sync = () => reconcileDevice(teamId);
    const refresh = () => {
      if (!running) sync();
    };
    const permissionChanged = () => {
      const permission = browserPermission();
      if (permission === lastPermission) return;
      lastPermission = permission;
      if (!(running && permission === 'granted' && state.kind === 'pending' && state.target))
        sync();
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === NOTIFICATIONS_KEY || event.key === null) sync();
    };
    if (desktopNotify() === null) {
      void navigator.permissions
        ?.query({ name: 'notifications' })
        .then((result) => {
          if (disposed) return;
          watched = result;
          watched.addEventListener('change', permissionChanged);
        })
        .catch(() => {});
      window.addEventListener('focus', permissionChanged);
      document.addEventListener('visibilitychange', permissionChanged);
    }
    navigator.serviceWorker?.addEventListener('controllerchange', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('storage', storageChanged);
    sync();
    return () => {
      disposed = true;
      revision++;
      running = false;
      watched?.removeEventListener('change', permissionChanged);
      window.removeEventListener('focus', permissionChanged);
      document.removeEventListener('visibilitychange', permissionChanged);
      navigator.serviceWorker?.removeEventListener('controllerchange', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('storage', storageChanged);
      publish(INITIAL_STATE);
    };
  }, [teamId, live, loadingTeams]);
}
