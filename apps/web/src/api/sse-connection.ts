export const SSE_SILENCE_WATCHDOG_MS = 20_000;

export const SSE_BIZ_SILENCE_BASE_MS = 20_000;

export const SSE_BIZ_SILENCE_MAX_MS = 300_000;

export interface StreamGuards {
  inFlight: () => boolean;
  reconcile: () => void | Promise<void>;
  onTransportLost?: () => void;
  onReconnecting?: (reconnecting: boolean) => void;
}

interface StreamAttachment {
  establish: () => void;
  acknowledge: (
    isCurrent: () => boolean,
    recover: (signal: AbortSignal) => Promise<void>,
  ) => boolean;
  replace: () => void;
}

export function connect(
  path: string | (() => Promise<string>),
  onEvent: (ev: Record<string, unknown>, attachment: StreamAttachment) => void,
  guards: StreamGuards,
): () => void {
  let es: EventSource | null = null;
  let disposed = false;
  let everEstablished = false;
  let reconnecting = false;
  let needsRecovery = false;
  let recovery: AbortController | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let bizTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1_000;

  const setReconnecting = (value: boolean) => {
    if (reconnecting === value || disposed) return;
    reconnecting = value;
    guards.onReconnecting?.(value);
  };

  const scheduleRetry = () => {
    if (disposed || retryTimer !== undefined) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      open();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  };

  function open(): void {
    if (disposed) return;
    if (typeof path === 'string') attach(path);
    else
      void path().then(attach, () => {
        needsRecovery = true;
        scheduleRetry();
      });
  }

  function attach(url: string): void {
    if (disposed) return;
    const source = new EventSource(url);
    es = source;
    let established = false;
    let acknowledged = false;
    let bizWindow = SSE_BIZ_SILENCE_BASE_MS;
    let lastFrameId = 0;

    const replace = (backoff: boolean, transportLost: boolean) => {
      if (es !== source) return;
      es = null;
      recovery?.abort();
      recovery = undefined;
      clearTimeout(watchdog);
      clearTimeout(bizTimer);
      source.close();
      guards.onTransportLost?.();
      needsRecovery = true;
      if (everEstablished && transportLost) setReconnecting(true);
      if (backoff) scheduleRetry();
      else open();
    };
    const armWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => replace(false, true), SSE_SILENCE_WATCHDOG_MS);
    };
    const armBusinessTimer = () => {
      clearTimeout(bizTimer);
      bizTimer = setTimeout(() => {
        if (es !== source || source.readyState !== 1) return;
        if (guards.inFlight()) {
          void guards.reconcile();
          bizWindow = Math.min(bizWindow * 2, SSE_BIZ_SILENCE_MAX_MS);
        }
        armBusinessTimer();
      }, bizWindow);
    };
    const attachment: StreamAttachment = {
      establish() {
        if (es !== source) return;
        everEstablished = true;
        established = true;
        bizWindow = SSE_BIZ_SILENCE_BASE_MS;
        armBusinessTimer();
      },
      acknowledge(isCurrent, recover) {
        if (es !== source) return false;
        established = true;
        acknowledged = true;
        retryDelay = 1_000;
        bizWindow = SSE_BIZ_SILENCE_BASE_MS;
        armBusinessTimer();
        if (!needsRecovery) return false;
        recovery?.abort();
        const attempt = new AbortController();
        recovery = attempt;
        const finish = () => {
          if (recovery !== attempt) return;
          recovery = undefined;
          if (es !== source || !isCurrent()) return;
          needsRecovery = false;
          setReconnecting(false);
        };
        void recover(attempt.signal).then(finish, finish);
        return true;
      },
      replace: () => replace(typeof path === 'function', false),
    };

    armWatchdog();
    source.onerror = () => replace(typeof path === 'function', true);
    source.onopen = () => {
      if (es === source) armWatchdog();
    };
    source.onmessage = (e) => {
      if (es !== source || source.readyState !== 1) return;
      armWatchdog();
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const ev = parsed as Record<string, unknown>;
      const frameId = Number(e.lastEventId);
      if (Number.isSafeInteger(frameId) && frameId > 0) {
        if (frameId <= lastFrameId) return;
        if (lastFrameId > 0 && frameId > lastFrameId + 1) {
          if (!acknowledged) needsRecovery = true;
          if (established) {
            bizWindow = SSE_BIZ_SILENCE_BASE_MS;
            armBusinessTimer();
            void guards.reconcile();
          }
        }
        lastFrameId = frameId;
      }
      if (acknowledged && ev.type !== 'ping') {
        bizWindow = SSE_BIZ_SILENCE_BASE_MS;
        armBusinessTimer();
      }
      onEvent(ev, attachment);
    };
  }

  open();

  return () => {
    disposed = true;
    recovery?.abort();
    recovery = undefined;
    clearTimeout(watchdog);
    clearTimeout(bizTimer);
    clearTimeout(retryTimer);
    const source = es;
    es = null;
    source?.close();
  };
}
