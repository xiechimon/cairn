import { isSameOriginUrl } from './remote-auth.js';

const PROBE_BACKOFF_MS = [2_000, 3_000, 5_000, 8_000, 15_000] as const;

export interface OfflineRecoveryOptions {
  origin: string;
  initialUrl: string;
  isRemote: boolean;
  probe: () => Promise<boolean>;
  showOffline: () => void;
  loadUrl: (url: string) => void;
  reload: () => void;
}

export interface OfflineRecoveryController {
  isShowingOfflinePage: () => boolean;
  hasLoadedApp: () => boolean;
  targetUrl: () => string;
  markLoaded: (url: string) => void;
  handleMainFrameFailure: (failedUrl: string) => void;
  retryNow: () => Promise<boolean>;
  requestSafeReload: () => Promise<boolean>;
  nudge: () => Promise<boolean>;
  dispose: () => void;
}

export function createOfflineRecovery(opts: OfflineRecoveryOptions): OfflineRecoveryController {
  let loaded = false;
  let offline = false;
  let disposed = false;
  let currentTargetUrl = isSameOriginUrl(opts.initialUrl, opts.origin)
    ? opts.initialUrl
    : opts.origin;
  let backoffIndex = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<boolean> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleProbe = (): void => {
    clearTimer();
    if (disposed || !offline) return;
    const delay = PROBE_BACKOFF_MS[Math.min(backoffIndex, PROBE_BACKOFF_MS.length - 1)] ?? 15_000;
    backoffIndex = Math.min(backoffIndex + 1, PROBE_BACKOFF_MS.length - 1);
    timer = setTimeout(() => {
      timer = null;
      void runProbe(false);
    }, delay);
    timer.unref?.();
  };

  const runProbe = async (manual: boolean): Promise<boolean> => {
    if (disposed) return false;
    if (manual) clearTimer();
    if (inFlight !== null) return inFlight;
    const task = (async () => {
      let ok = false;
      try {
        ok = await opts.probe();
      } catch {
        ok = false;
      }
      if (disposed) return false;
      if (ok) {
        clearTimer();
        offline = false;
        backoffIndex = 0;
        opts.loadUrl(currentTargetUrl);
        return true;
      }
      if (offline) scheduleProbe();
      return false;
    })();
    inFlight = task;
    try {
      return await task;
    } finally {
      if (inFlight === task) inFlight = null;
    }
  };

  return {
    isShowingOfflinePage: () => offline,
    hasLoadedApp: () => loaded,
    targetUrl: () => currentTargetUrl,
    markLoaded: (url: string) => {
      if (!isSameOriginUrl(url, opts.origin)) return;
      currentTargetUrl = url;
      loaded = true;
      offline = false;
      backoffIndex = 0;
      clearTimer();
    },
    handleMainFrameFailure: (failedUrl: string) => {
      if (disposed) return;
      if (isSameOriginUrl(failedUrl, opts.origin)) {
        currentTargetUrl = failedUrl;
      }
      const alreadyOffline = offline;
      offline = true;
      if (!alreadyOffline) {
        backoffIndex = 0;
        opts.showOffline();
      }
      scheduleProbe();
    },
    retryNow: () => {
      if (!offline && !opts.isRemote) {
        opts.loadUrl(currentTargetUrl);
        return Promise.resolve(true);
      }
      backoffIndex = 0;
      return runProbe(true);
    },
    requestSafeReload: async () => {
      if (disposed) return false;
      if (!opts.isRemote || !loaded || offline) {
        if (!offline) {
          opts.reload();
          return true;
        }
        return runProbe(true);
      }
      let ok = false;
      try {
        ok = await opts.probe();
      } catch {
        ok = false;
      }
      if (!ok || disposed || offline) return false;
      opts.reload();
      return true;
    },
    nudge: () => {
      if (!offline || disposed) return Promise.resolve(false);
      backoffIndex = 0;
      return runProbe(true);
    },
    dispose: () => {
      disposed = true;
      clearTimer();
    },
  };
}
