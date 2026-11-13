const RELOADED_AT_KEY = 'cairn.staleBuildReloadAt';
const RELOAD_GUARD_MS = 30_000;

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
    if (storage === null) return;
    const last = Number(storage.getItem(RELOADED_AT_KEY) ?? 0);
    if (now() - last < RELOAD_GUARD_MS) return;
    event.preventDefault();
    storage.setItem(RELOADED_AT_KEY, String(now()));
    reload();
  });
}
