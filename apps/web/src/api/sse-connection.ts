export const SSE_SILENCE_WATCHDOG_MS = 20_000;

export const SSE_BIZ_SILENCE_BASE_MS = 20_000;

export const SSE_BIZ_SILENCE_MAX_MS = 300_000;

export interface StreamGuards {
  inFlight: () => boolean;
  reconcile: () => void | Promise<void>;
}

export interface StreamConnectionOptions {
  onConnectionChange?: (connected: boolean) => void;
  onOnlineHint?: (retry: () => void) => () => void;
}

export function connect(
  path: string | (() => Promise<string>),
  onEvent: (ev: Record<string, unknown>) => void,
  onResync: () => void,
  guards: StreamGuards,
  options?: StreamConnectionOptions,
): () => void {
  let es: EventSource | null = null;
  let openedOnce = false;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let bizTimer: ReturnType<typeof setTimeout> | null = null;
  let bizWindow = SSE_BIZ_SILENCE_BASE_MS;
  let lastSeq = 0;
  let retryDelay = 1_000;

  const scheduleRetry = (): void => {
    if (disposed || retryTimer !== null) return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, 30_000);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!disposed) open();
    }, delay);
  };

  const retryNow = (): void => {
    if (disposed || retryTimer === null) return;
    clearTimeout(retryTimer);
    retryTimer = null;
    retryDelay = 1_000;
    open();
  };

  const armWatchdog = (): void => {
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      watchdog = null;
      if (disposed || es === null || es.readyState !== EventSource.OPEN) return;
      es.close();
      es = null;
      options?.onConnectionChange?.(false);
      open();
    }, SSE_SILENCE_WATCHDOG_MS);
  };

  const armBizTimer = (): void => {
    if (bizTimer !== null) clearTimeout(bizTimer);
    bizTimer = setTimeout(() => {
      bizTimer = null;
      if (disposed || es === null || es.readyState !== EventSource.OPEN) return;
      if (guards.inFlight()) {
        guards.reconcile();
        bizWindow = Math.min(bizWindow * 2, SSE_BIZ_SILENCE_MAX_MS);
      }
      armBizTimer();
    }, bizWindow);
  };

  const noteBusiness = (): void => {
    bizWindow = SSE_BIZ_SILENCE_BASE_MS;
    armBizTimer();
  };

  function open(): void {
    if (disposed) return;
    const resolved = typeof path === 'function' ? path() : path;
    if (typeof resolved !== 'string') {
      void resolved.then(
        (url) => {
          if (disposed) return;
          attach(url);
        },
        () => {
          if (disposed) return;
          options?.onConnectionChange?.(false);
          scheduleRetry();
        },
      );
      return;
    }
    attach(resolved);
  }

  function attach(url: string): void {
    if (disposed) return;
    es?.close();
    const current = new EventSource(url);
    es = current;
    current.onerror = () => {
      if (disposed || es !== current) return;
      es = null;
      current.close();
      options?.onConnectionChange?.(false);
      if (typeof path === 'function') scheduleRetry();
      else open();
    };
    current.onopen = () => {
      if (disposed || es !== current) return;
      retryDelay = 1_000;
      options?.onConnectionChange?.(true);
      if (openedOnce) onResync();
      openedOnce = true;
      lastSeq = 0;
      bizWindow = SSE_BIZ_SILENCE_BASE_MS;
      armWatchdog();
      armBizTimer();
    };
    current.onmessage = (e) => {
      if (disposed || es !== current) return;
      armWatchdog();
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(e.data as string) as Record<string, unknown>;
      } catch {
        return;
      }
      const seq = ev.seq;
      if (typeof seq === 'number') {
        if (lastSeq > 0 && seq > lastSeq + 1) {
          bizWindow = SSE_BIZ_SILENCE_BASE_MS;
          armBizTimer();
          guards.reconcile();
        }
        lastSeq = seq;
      }
      if (ev.type !== 'ping') noteBusiness();
      onEvent(ev);
    };
  }

  const stopOnlineHint = options?.onOnlineHint?.(retryNow);
  open();

  return () => {
    disposed = true;
    stopOnlineHint?.();
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (watchdog !== null) clearTimeout(watchdog);
    if (bizTimer !== null) clearTimeout(bizTimer);
    es?.close();
    es = null;
  };
}
