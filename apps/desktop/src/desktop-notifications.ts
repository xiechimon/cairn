import {
  type DesktopNotifyDialog,
  type DesktopNotifyPayload,
  desktopNotificationOptions,
} from '@cairn/shared';

export interface DesktopNotificationHandle {
  on(event: string, listener: (...args: unknown[]) => void): void;
  show(): void;
  close(): void;
}

export interface DesktopHistoryNotification {
  id: string;
  tag?: string;
  close(): void;
}

export interface DesktopNotificationControllerDeps {
  isSupported: () => boolean;
  createNotification: (
    options: ReturnType<typeof desktopNotificationOptions>,
  ) => DesktopNotificationHandle;
  getHistory?: () => Promise<DesktopHistoryNotification[]>;
  appFocus: () => void;
  hasMainWindow: () => boolean;
  isMainWindowLoading: () => boolean;
  openWindowAt: (href: string) => void;
  focusAndSend: (href: string) => void;
  onDialogFallback?: (dialog: DesktopNotifyDialog) => void;
  onDeliveryFailed?: (deliveryId: string, error?: string) => void;
}

const MAX_SEEN_DELIVERY_IDS = 500;

export function createDesktopNotificationController(deps: DesktopNotificationControllerDeps) {
  const seenDeliveryIds = new Set<string>();
  const activeByTag = new Map<string, DesktopNotificationHandle>();
  let pendingNavigateHref: string | null = null;

  function rememberDeliveryId(deliveryId: string): boolean {
    if (seenDeliveryIds.has(deliveryId)) return false;
    seenDeliveryIds.add(deliveryId);
    if (seenDeliveryIds.size > MAX_SEEN_DELIVERY_IDS) {
      const oldest = seenDeliveryIds.values().next().value;
      if (oldest !== undefined) seenDeliveryIds.delete(oldest);
    }
    return true;
  }

  function navigateTo(href: string): void {
    deps.appFocus();
    if (!deps.hasMainWindow()) {
      pendingNavigateHref = null;
      deps.openWindowAt(href);
      return;
    }
    if (deps.isMainWindowLoading()) {
      pendingNavigateHref = href;
      return;
    }
    pendingNavigateHref = null;
    deps.focusAndSend(href);
  }

  function show(payload: DesktopNotifyPayload): void {
    if (payload.deliveryId !== undefined && !rememberDeliveryId(payload.deliveryId)) {
      return;
    }
    if (!deps.isSupported()) {
      if (payload.dialog !== undefined) deps.onDialogFallback?.(payload.dialog);
      if (payload.deliveryId !== undefined) {
        deps.onDeliveryFailed?.(payload.deliveryId, 'unsupported');
      }
      return;
    }
    const previous = activeByTag.get(payload.tag);
    if (previous !== undefined) {
      activeByTag.delete(payload.tag);
      previous.close();
    }
    const instance = deps.createNotification(desktopNotificationOptions(payload));
    activeByTag.set(payload.tag, instance);
    instance.on('click', () => {
      navigateTo(payload.href);
    });
    instance.on('failed', (_ev, error) => {
      if (activeByTag.get(payload.tag) === instance) activeByTag.delete(payload.tag);
      if (payload.dialog !== undefined) deps.onDialogFallback?.(payload.dialog);
      if (payload.deliveryId !== undefined) {
        deps.onDeliveryFailed?.(payload.deliveryId, typeof error === 'string' ? error : undefined);
      }
    });
    instance.on('close', () => {
      if (activeByTag.get(payload.tag) === instance) activeByTag.delete(payload.tag);
    });
    instance.show();
  }

  async function dismiss(tag: string): Promise<void> {
    const active = activeByTag.get(tag);
    if (active !== undefined) {
      activeByTag.delete(tag);
      active.close();
    }
    if (deps.getHistory === undefined) return;
    try {
      const history = await deps.getHistory();
      for (const item of history) {
        if (item.id === tag || item.tag === tag) item.close();
      }
    } catch (error) {
      console.debug('cairn: recoverable operation failed', error);
    }
  }

  function flushPendingNavigate(): void {
    if (pendingNavigateHref === null) return;
    const href = pendingNavigateHref;
    pendingNavigateHref = null;
    deps.appFocus();
    deps.focusAndSend(href);
  }

  return { show, dismiss, flushPendingNavigate };
}
