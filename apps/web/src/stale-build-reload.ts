const RELOADED_AT_KEY = 'cairn.staleBuildReloadAt';
const RELOAD_GUARD_MS = 30_000;
const DEFAULT_IDLE_MS = 15_000;
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'compositionstart',
  'input',
] as const;

type TimerHandle = ReturnType<typeof setTimeout>;

function guardedReload(
  storage: Storage | null,
  reload: () => void,
  now: () => number,
  prepareReload?: () => void,
): boolean {
  if (storage === null) return false;
  const last = Number(storage.getItem(RELOADED_AT_KEY) ?? 0);
  if (now() - last < RELOAD_GUARD_MS) return false;
  storage.setItem(RELOADED_AT_KEY, String(now()));
  prepareReload?.();
  reload();
  return true;
}

export function reloadOnStaleBuild({
  target,
  storage,
  reload,
  prepareReload,
  isServerReachable,
  now,
}: {
  target: EventTarget;
  storage: Storage | null;
  reload: () => void;
  prepareReload?: () => void;
  isServerReachable?: () => Promise<boolean>;
  now: () => number;
}): void {
  let probing = false;
  target.addEventListener('vite:preloadError', (event) => {
    if (isServerReachable === undefined) {
      if (guardedReload(storage, reload, now, prepareReload)) event.preventDefault();
      return;
    }
    if (storage === null) return;
    const last = Number(storage.getItem(RELOADED_AT_KEY) ?? 0);
    if (now() - last < RELOAD_GUARD_MS || probing) return;
    probing = true;
    void isServerReachable()
      .then(
        (reachable) => {
          if (reachable) guardedReload(storage, reload, now, prepareReload);
        },
        () => {},
      )
      .finally(() => {
        probing = false;
      });
  });
}

const MODULE_SCRIPT_TAG = /<script\b[^>]*>/gi;

export function entryScriptOf(html: string): string | null {
  for (const [tag] of html.matchAll(MODULE_SCRIPT_TAG)) {
    if (!/\btype="module"/i.test(tag)) continue;
    const src = /\bsrc="(\/assets\/[^"]+\.js)"/i.exec(tag)?.[1];
    if (src !== undefined) return src;
  }
  return null;
}

export function reloadOnNewDeploy({
  target,
  windowTarget,
  activityTarget,
  currentEntry,
  latestEntry,
  visible,
  busy,
  reload,
  prepareReload,
  storage,
  now,
  every,
  subscribeNavigation,
  shouldSkipNavigationReload,
  idleMs = DEFAULT_IDLE_MS,
  setTimer = (run, ms) => globalThis.setTimeout(run, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
}: {
  target: EventTarget;
  windowTarget?: EventTarget;
  activityTarget?: EventTarget;
  currentEntry: string;
  latestEntry: () => Promise<string | null>;
  visible: () => boolean;
  busy: () => boolean;
  reload: () => void;
  prepareReload?: () => void;
  storage: Storage | null;
  now: () => number;
  every: (run: () => void) => (() => void) | undefined;
  subscribeNavigation?: (onNavigate: () => void) => () => void;
  shouldSkipNavigationReload?: () => boolean;
  idleMs?: number;
  setTimer?: (run: () => void, ms: number) => TimerHandle;
  clearTimer?: (id: TimerHandle) => void;
}): () => void {
  let pendingNewBuild = false;
  let idleTimer: TimerHandle | null = null;
  let navTimer: TimerHandle | null = null;
  let disposed = false;
  let verifying = false;

  const clearIdleTimer = () => {
    if (idleTimer === null) return;
    clearTimer(idleTimer);
    idleTimer = null;
  };

  const trySilentReload = async (verifiedReachable = false): Promise<boolean> => {
    if (disposed || !pendingNewBuild || busy()) return false;
    if (!verifiedReachable) {
      if (storage === null) return false;
      const last = Number(storage.getItem(RELOADED_AT_KEY) ?? 0);
      if (now() - last < RELOAD_GUARD_MS || verifying) return false;
      verifying = true;
      try {
        const latest = await latestEntry().catch(() => null);
        if (disposed || latest === null || latest === currentEntry || busy()) return false;
      } finally {
        verifying = false;
      }
    }
    return guardedReload(storage, reload, now, prepareReload);
  };

  const armIdleTimer = (reset: boolean) => {
    if (disposed || !pendingNewBuild) return;
    if (idleTimer !== null) {
      if (!reset) return;
      clearTimer(idleTimer);
      idleTimer = null;
    }
    idleTimer = setTimer(() => {
      idleTimer = null;
      void trySilentReload(false);
    }, idleMs);
  };

  const check = async (unseenOnReturn: boolean) => {
    const latest = await latestEntry().catch(() => null);
    if (disposed || latest === null || latest === currentEntry) return;
    pendingNewBuild = true;
    if (unseenOnReturn || !visible()) {
      await trySilentReload(true);
      return;
    }
    armIdleTimer(false);
  };

  const onVisibilityChange = () => {
    if (visible()) void check(true);
    else void trySilentReload(false);
  };

  const onBlur = () => {
    void trySilentReload(false);
  };

  const onActivity = () => {
    if (pendingNewBuild) armIdleTimer(true);
  };

  target.addEventListener('visibilitychange', onVisibilityChange);
  windowTarget?.addEventListener('blur', onBlur);
  if (activityTarget !== undefined) {
    for (const eventName of ACTIVITY_EVENTS) {
      activityTarget.addEventListener(eventName, onActivity);
    }
  }
  const unsubscribeNav = subscribeNavigation?.(() => {
    if (disposed) return;
    if (navTimer !== null) clearTimer(navTimer);
    navTimer = setTimer(() => {
      navTimer = null;
      if (shouldSkipNavigationReload?.()) return;
      void trySilentReload(false);
    }, 0);
  });
  const stopEvery = every(() => {
    if (!disposed) void check(false);
  });

  return () => {
    disposed = true;
    clearIdleTimer();
    if (navTimer !== null) {
      clearTimer(navTimer);
      navTimer = null;
    }
    target.removeEventListener('visibilitychange', onVisibilityChange);
    windowTarget?.removeEventListener('blur', onBlur);
    if (activityTarget !== undefined) {
      for (const eventName of ACTIVITY_EVENTS) {
        activityTarget.removeEventListener(eventName, onActivity);
      }
    }
    unsubscribeNav?.();
    if (typeof stopEvery === 'function') stopEvery();
  };
}
