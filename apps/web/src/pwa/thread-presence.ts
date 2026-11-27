import { DESKTOP_TRAY_PATH, type DesktopPresenceState } from '@cairn/shared';
import { useEffect } from 'react';
import { api } from '../api/client.js';
import { readNotifyPref } from '../board/notify-pref.js';
import { desktopPresence } from '../desktop-shell.js';
import { safeLocalStorage } from '../safe-storage.js';

const browserTabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const presenceWrites = new Map<string, Promise<unknown>>();

let cachedDesktopClientId: string | null = null;
let clientPresenceSeq = 0;

function nextClientSeq(bridge: { nextSeq?: () => number } | null): number {
  const sharedSeq = bridge?.nextSeq?.();
  if (typeof sharedSeq === 'number' && Number.isFinite(sharedSeq) && sharedSeq >= 0) {
    return sharedSeq;
  }
  clientPresenceSeq += 1;
  return clientPresenceSeq;
}
let currentActiveThreadId: string | null = null;
let lastWebActivityMs = Date.now();
const activeThreadListeners = new Set<() => void>();

function notifyActiveThreadListeners(): void {
  for (const listener of activeThreadListeners) listener();
}

export async function resolveCurrentClientId(): Promise<string> {
  const bridge = desktopPresence();
  if (bridge !== null) {
    try {
      const state = await bridge.state();
      if (state?.clientId !== undefined && state.clientId !== '') {
        cachedDesktopClientId = state.clientId;
        return state.clientId;
      }
    } catch (error) {
      console.debug('cairn: recoverable operation failed', error);
    }
    if (cachedDesktopClientId !== null) return cachedDesktopClientId;
  }
  return browserTabId;
}

export function startThreadPresence(
  teamId: string,
  todoId: string,
  tabId: string = browserTabId,
): () => void {
  const path = `/api/teams/${encodeURIComponent(teamId)}/presence`;
  const key = JSON.stringify([teamId, todoId, tabId]);
  let present = false;
  const send = (visible: boolean) => {
    const pending = (presenceWrites.get(key) ?? Promise.resolve())
      .then(() => (visible ? api.post(path, { todoId, tabId }) : api.del(path, { todoId, tabId })))
      .catch((error) => {
        console.debug('cairn: recoverable operation failed', error);
      });
    presenceWrites.set(key, pending);
    void pending.then(() => {
      if (presenceWrites.get(key) === pending) presenceWrites.delete(key);
    });
  };
  const heartbeat = () => {
    const visible = document.visibilityState === 'visible';
    if (!visible && !present) return;
    present = visible;
    send(visible);
  };
  heartbeat();
  const timer = setInterval(heartbeat, 30_000);
  document.addEventListener('visibilitychange', heartbeat);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', heartbeat);
    if (present) {
      present = false;
      send(false);
    }
  };
}

export function useThreadPresence(
  teamId: string | null | undefined,
  todoId: string | undefined,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || teamId == null || todoId === undefined) return;
    const prev = currentActiveThreadId;
    currentActiveThreadId = todoId;
    notifyActiveThreadListeners();
    return () => {
      if (currentActiveThreadId === todoId) {
        currentActiveThreadId = prev === todoId ? null : prev;
        notifyActiveThreadListeners();
      }
    };
  }, [teamId, todoId, enabled]);
}

function webHasNotificationPermission(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export function useClientPresence(teamId: string | undefined, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || teamId === undefined) return;
    const isTray = typeof window !== 'undefined' && window.location.pathname === DESKTOP_TRAY_PATH;
    const path = `/api/teams/${encodeURIComponent(teamId)}/presence`;
    const bridge = desktopPresence();
    let active = true;
    let latestDesktop: (DesktopPresenceState & { clientId?: string }) | null = null;
    let lastPostedClientId: string | null = null;

    const buildPayload = () => {
      const notifyEnabled = readNotifyPref(safeLocalStorage()) !== 'off';
      if (bridge !== null) {
        if (latestDesktop === null) return null;
        if (isTray && latestDesktop.mainWindowOpen !== false) return null;
        const clientId = latestDesktop.clientId ?? cachedDesktopClientId ?? browserTabId;
        const focused =
          !isTray &&
          (latestDesktop.windowFocused ??
            (document.visibilityState === 'visible' &&
              (typeof document.hasFocus !== 'function' || document.hasFocus())));
        return {
          clientId,
          kind: 'desktop' as const,
          focused,
          activeThreadId: focused ? currentActiveThreadId : null,
          screenLocked: latestDesktop.screenLocked ?? false,
          systemIdleSec: latestDesktop.systemIdleSec ?? 0,
          canNotify: notifyEnabled,
        };
      }
      const focused =
        document.visibilityState === 'visible' &&
        (typeof document.hasFocus !== 'function' || document.hasFocus());
      return {
        clientId: cachedDesktopClientId ?? browserTabId,
        kind: 'web' as const,
        focused,
        activeThreadId: focused ? currentActiveThreadId : null,
        screenLocked: false,
        systemIdleSec: Math.floor(Math.max(0, Date.now() - lastWebActivityMs) / 1000),
        canNotify: notifyEnabled && webHasNotificationPermission(),
      };
    };

    const sendPresence = () => {
      if (!active) return;
      const payload = buildPayload();
      if (payload === null) return;
      const seq = nextClientSeq(bridge);
      lastPostedClientId = payload.clientId;
      void api
        .post(path, { ...payload, seq })
        .catch((error) => console.debug('cairn: recoverable operation failed', error));
    };

    const refreshDesktopAndSend = () => {
      if (bridge === null) {
        sendPresence();
        return;
      }
      void bridge
        .state()
        .then((next) => {
          if (!active || next === null) return;
          latestDesktop = next;
          if (next.clientId !== undefined && next.clientId !== '') {
            cachedDesktopClientId = next.clientId;
          }
          sendPresence();
        })
        .catch((error) => {
          console.debug('cairn: recoverable operation failed', error);
        });
    };

    const sendDelete = (keepalive = false) => {
      if (lastPostedClientId === null) return;
      const clientId = lastPostedClientId;
      lastPostedClientId = null;
      const seq = nextClientSeq(bridge);
      if (keepalive && typeof fetch === 'function') {
        void fetch(path, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId, seq }),
          keepalive: true,
        }).catch((error) => {
          console.debug('cairn: recoverable operation failed', error);
        });
        return;
      }
      void api
        .del(path, { clientId, seq })
        .catch((error) => console.debug('cairn: recoverable operation failed', error));
    };

    const markActivity = () => {
      lastWebActivityMs = Date.now();
    };
    const onFocus = () => {
      markActivity();
      sendPresence();
    };
    const onPageHide = () => sendDelete(true);

    markActivity();
    if (bridge !== null) refreshDesktopAndSend();
    else sendPresence();
    const timer = setInterval(refreshDesktopAndSend, 30_000);
    activeThreadListeners.add(sendPresence);
    document.addEventListener('visibilitychange', sendPresence);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', sendPresence);
    window.addEventListener('storage', sendPresence);
    window.addEventListener('pointerdown', markActivity, true);
    window.addEventListener('input', markActivity, true);
    window.addEventListener('wheel', markActivity, { capture: true, passive: true });
    window.addEventListener('pagehide', onPageHide);

    const unsubDesktop =
      bridge?.subscribe((next) => {
        if (!active) return;
        latestDesktop = next;
        if (next.clientId !== undefined && next.clientId !== '') {
          cachedDesktopClientId = next.clientId;
        }
        sendPresence();
      }) ?? (() => {});

    return () => {
      active = false;
      clearInterval(timer);
      unsubDesktop();
      activeThreadListeners.delete(sendPresence);
      document.removeEventListener('visibilitychange', sendPresence);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', sendPresence);
      window.removeEventListener('storage', sendPresence);
      window.removeEventListener('pointerdown', markActivity, true);
      window.removeEventListener('input', markActivity, true);
      window.removeEventListener('wheel', markActivity, { capture: true });
      window.removeEventListener('pagehide', onPageHide);
      sendDelete(false);
    };
  }, [teamId, enabled]);
}
