const RELOADED_AT_KEY = 'cairn.staleBuildReloadAt';
const RELOAD_GUARD_MS = 30_000;

function guardedReload(storage: Storage | null, reload: () => void, now: () => number): boolean {
  if (storage === null) return false;
  const last = Number(storage.getItem(RELOADED_AT_KEY) ?? 0);
  if (now() - last < RELOAD_GUARD_MS) return false;
  storage.setItem(RELOADED_AT_KEY, String(now()));
  reload();
  return true;
}

export function reloadOnStaleBuild({
  target,
  storage,
  reload,
  now,
}: {
  target: EventTarget;
  storage: Storage | null;
  reload: () => void;
  now: () => number;
}): void {
  target.addEventListener('vite:preloadError', (event) => {
    if (guardedReload(storage, reload, now)) event.preventDefault();
  });
}

const MODULE_SCRIPT_TAG = /<script\b[^>]*>/g;

export function entryScriptOf(html: string): string | null {
  for (const [tag] of html.matchAll(MODULE_SCRIPT_TAG)) {
    if (!/\btype="module"/.test(tag)) continue;
    const src = /\bsrc="(\/assets\/[^"]+\.js)"/.exec(tag)?.[1];
    if (src !== undefined) return src;
  }
  return null;
}

export function reloadOnNewDeploy({
  target,
  currentEntry,
  latestEntry,
  visible,
  busy,
  reload,
  storage,
  now,
  every,
  offerReload,
}: {
  target: EventTarget;
  currentEntry: string;
  latestEntry: () => Promise<string | null>;
  visible: () => boolean;
  busy: () => boolean;
  reload: () => void;
  storage: Storage | null;
  now: () => number;
  every: (run: () => void) => void;
  offerReload: () => void;
}): void {
  const check = async (shown: boolean) => {
    const latest = await latestEntry().catch(() => null);
    if (latest === null || latest === currentEntry) return;
    const unseen = shown || !visible();
    if (unseen && !busy() && guardedReload(storage, reload, now)) return;
    offerReload();
  };
  target.addEventListener('visibilitychange', () => {
    if (visible()) void check(true);
  });
  every(() => void check(false));
}
