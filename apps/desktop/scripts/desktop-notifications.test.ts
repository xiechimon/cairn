import * as shared from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';

const exposed: Record<string, unknown> = {};
const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
const sent: Array<{ channel: string; payload: unknown }> = [];
const invoked: Array<{ channel: string; args: unknown[] }> = [];
let syncSeq = 0;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => {
      exposed[key] = api;
    },
  },
  ipcRenderer: {
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload });
    },
    sendSync: (channel: string) => {
      if (channel === 'desktop-presence:seq') {
        syncSeq += 1;
        return syncSeq;
      }
      return null;
    },
    invoke: async (channel: string, ...args: unknown[]) => {
      invoked.push({ channel, args });
      return null;
    },
    on: (channel: string, fn: (...args: unknown[]) => void) => {
      const list = listeners.get(channel) ?? [];
      list.push(fn);
      listeners.set(channel, list);
    },
    removeListener: () => {},
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  sent.length = 0;
  invoked.length = 0;
  listeners.clear();
  syncSeq = 0;
  for (const key of Object.keys(exposed)) delete exposed[key];
});

describe('desktop notification & presence bridge', () => {
  test('preload exposes notify.dismiss and presence state/subscribe bridges', async () => {
    vi.stubGlobal('window', {
      addEventListener: () => {},
      dispatchEvent: () => {},
    });
    vi.stubGlobal('document', {
      readyState: 'complete',
      documentElement: { dataset: {} },
      querySelector: () => null,
      body: null,
    });
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    await import('../src/preload.js');
    const bridge = exposed.cairnDesktop as {
      notify?: { show?: unknown; dismiss?: unknown };
      presence?: { state?: unknown; subscribe?: unknown; nextSeq?: () => number };
    };
    expect(typeof bridge?.notify?.dismiss).toBe('function');
    expect(typeof bridge?.presence?.state).toBe('function');
    expect(typeof bridge?.presence?.subscribe).toBe('function');
    expect(bridge?.presence?.nextSeq?.()).toBe(1);
    expect(bridge?.presence?.nextSeq?.()).toBe(2);
    expect(typeof (shared as Record<string, unknown>).isDesktopDismissTag).toBe('function');
  });

  test('controller dedupes by deliveryId, dismisses active/history banners, and opens closed mainWindow directly to href', async () => {
    const mod = (await import('../src/desktop-notifications.js')) as {
      createDesktopNotificationController: (deps: {
        isSupported: () => boolean;
        createNotification: (opts: { title: string; body: string; silent: boolean }) => {
          on: (ev: string, cb: (...args: unknown[]) => void) => void;
          show: () => void;
          close: () => void;
        };
        getHistory?: () => Promise<Array<{ id: string; close: () => void }>>;
        appFocus: () => void;
        hasMainWindow: () => boolean;
        isMainWindowLoading: () => boolean;
        openWindowAt: (href: string) => void;
        focusAndSend: (href: string) => void;
        onDialogFallback?: (dialog: { title: string; detail: string }) => void;
        onDeliveryFailed?: (deliveryId: string) => void;
      }) => {
        show: (payload: {
          title: string;
          body: string;
          href: string;
          tag: string;
          deliveryId?: string;
        }) => void;
        dismiss: (tag: string) => Promise<void>;
        flushPendingNavigate: () => void;
      };
    };

    const instances: Array<{
      opts: { title: string; body: string; silent: boolean };
      handlers: Record<string, (...args: unknown[]) => void>;
      shown: boolean;
      closed: boolean;
    }> = [];
    const openedAt: string[] = [];
    const sentHref: string[] = [];
    let mainOpen = false;
    let loading = false;
    const historyClose = vi.fn();

    const controller = mod.createDesktopNotificationController({
      isSupported: () => true,
      createNotification: (opts) => {
        const inst = {
          opts,
          handlers: {} as Record<string, (...args: unknown[]) => void>,
          shown: false,
          closed: false,
        };
        instances.push(inst);
        return {
          on: (ev, cb) => {
            inst.handlers[ev] = cb;
          },
          show: () => {
            inst.shown = true;
          },
          close: () => {
            inst.closed = true;
          },
        };
      },
      getHistory: async () => [{ id: 'user:stale-tag', close: historyClose }],
      appFocus: () => {},
      hasMainWindow: () => mainOpen,
      isMainWindowLoading: () => loading,
      openWindowAt: (href) => {
        openedAt.push(href);
        mainOpen = true;
      },
      focusAndSend: (href) => {
        sentHref.push(href);
      },
    });

    // Two renderers sending the same deliveryId produce only 1 OS notification.
    controller.show({
      title: 'Morning',
      body: 'All green',
      href: '/app?chief=chief-1',
      tag: 'user:chief-1',
      deliveryId: 'deliv-1',
    });
    controller.show({
      title: 'Morning',
      body: 'All green',
      href: '/app?chief=chief-1',
      tag: 'user:chief-1',
      deliveryId: 'deliv-1',
    });
    expect(instances).toHaveLength(1);
    expect(instances[0]?.shown).toBe(true);

    // Clicking while mainWindow === null opens directly with initial href (no lost IPC).
    instances[0]?.handlers.click?.();
    expect(openedAt).toEqual(['/app?chief=chief-1']);

    // Clicking while mainWindow is loading queues until flushPendingNavigate().
    loading = true;
    controller.show({
      title: 'Task',
      body: 'Ready',
      href: '/app/todo/t-1',
      tag: 'user:t-1',
      deliveryId: 'deliv-2',
    });
    instances[1]?.handlers.click?.();
    expect(sentHref).toEqual([]);
    loading = false;
    controller.flushPendingNavigate();
    expect(sentHref).toEqual(['/app/todo/t-1']);

    // Dismissing active banner calls close(), and dismissing stale tag checks history.
    await controller.dismiss('user:t-1');
    expect(instances[1]?.closed).toBe(true);
    await controller.dismiss('user:stale-tag');
    expect(historyClose).toHaveBeenCalledTimes(1);
  });
});
