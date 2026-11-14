export const SSE_SILENCE_WATCHDOG_MS = 20_000;

export const SSE_BIZ_SILENCE_BASE_MS = 20_000;

export const SSE_BIZ_SILENCE_MAX_MS = 300_000;

export interface StreamGuards {
  inFlight: () => boolean;
  reconcile: () => void | Promise<void>;
}

export function connect(
  path: string | (() => Promise<string>),
  onEvent: (ev: Record<string, unknown>) => void,
  onResync: () => void,
  guards: StreamGuards,
): () => void {
  let es: EventSource | null = null;
  let openedOnce = false;
  let disposed = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let bizTimer: ReturnType<typeof setTimeout> | null = null;
  let bizWindow = SSE_BIZ_SILENCE_BASE_MS;
  let lastSeq = 0;
  let retryDelay = 1_000;

  const scheduleRetry = (): void => {
    if (disposed) return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, 30_000);
    setTimeout(() => {
      if (!disposed) open();
    }, delay);
  };

  const armWatchdog = (): void => {
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      watchdog = null;
      if (disposed || es === null || es.readyState !== EventSource.OPEN) return;
      es.close();
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
        () => scheduleRetry(),
      );
      return;
    }
    attach(resolved);
  }

  function attach(url: string): void {
    if (disposed) return;
    es?.close();
    es = new EventSource(url);
    es.onerror = () => {
      es?.close();
      if (typeof path === 'function') scheduleRetry();
      else open();
    };
    es.onopen = () => {
      retryDelay = 1_000;
      if (openedOnce) onResync();
      openedOnce = true;
      lastSeq = 0;
      bizWindow = SSE_BIZ_SILENCE_BASE_MS;
      armWatchdog();
      armBizTimer();
    };
    es.onmessage = (e) => {
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
  open();

  return () => {
    disposed = true;
    if (watchdog !== null) clearTimeout(watchdog);
    if (bizTimer !== null) clearTimeout(bizTimer);
    es?.close();
  };
}
