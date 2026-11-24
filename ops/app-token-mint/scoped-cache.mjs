const CAPACITY = 256;
const SWEEP_INTERVAL_MS = 60_000;

export function createScopedTokenCache({
  reuseUntil,
  now = () => Date.now(),
  onInsert,
  onRemove,
}) {
  const entries = new Map();
  const pending = new Map();
  let timer;

  function remove(key, value) {
    entries.delete(key);
    onRemove?.(value);
    if (entries.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function sweep() {
    const time = now();
    for (const [key, value] of entries) {
      if (time >= reuseUntil(value)) remove(key, value);
    }
  }

  function insert(key, value) {
    if (now() >= reuseUntil(value)) return;
    if (entries.size === CAPACITY) {
      sweep();
      if (entries.size === CAPACITY) {
        const [oldest, entry] = entries.entries().next().value;
        remove(oldest, entry);
      }
    }
    entries.set(key, value);
    onInsert?.(value);
    timer ??= setInterval(sweep, SWEEP_INTERVAL_MS).unref();
  }

  return function scopedToken(key, force, load) {
    const running = pending.get(key);
    if (running !== undefined && (!force || running.forced)) return running.loading;

    const cached = entries.get(key);
    if (cached !== undefined) {
      if (!force && now() < reuseUntil(cached)) {
        entries.delete(key);
        entries.set(key, cached);
        return Promise.resolve(cached);
      }
      remove(key, cached);
    }

    const loading = Promise.resolve()
      .then(load)
      .then((value) => {
        if (pending.get(key)?.loading === loading) insert(key, value);
        return value;
      })
      .finally(() => {
        if (pending.get(key)?.loading === loading) pending.delete(key);
      });
    pending.set(key, { loading, forced: force });
    return loading;
  };
}
