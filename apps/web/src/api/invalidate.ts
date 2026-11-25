import type { Query, QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query';
import { authSnapshot, subscribeAuth } from './auth.js';
import {
  type QueryEffect,
  type StreamQueryEvent,
  streamEventQueryEffect,
} from './sse-team-events.js';

export const STREAM_REFRESH_QUIET_MS = 250;

const deferredRefreshes = new WeakMap<Query, { stop: () => void; dequeued: Promise<void> }>();
const pendingRefreshes = new WeakMap<Query, number>();
const refreshWaiters = new Set<() => void>();
const withoutCancellation = { cancelRefetch: false };

function deferRefresh(qc: QueryClient, query: Query): void {
  deferredRefreshes.get(query)?.stop();
  let notifyDequeued!: () => void;
  const dequeued = new Promise<void>((resolve) => {
    notifyDequeued = resolve;
  });
  let quiet = false;
  const flush = () => {
    if (!quiet || query.state.fetchStatus !== 'idle') return;
    stop();
    void qc.refetchQueries(
      { type: 'active', predicate: (entry) => entry === query },
      withoutCancellation,
    );
  };
  const timer = setTimeout(() => {
    quiet = true;
    flush();
  }, STREAM_REFRESH_QUIET_MS);
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.query !== query) return;
    if (event.type === 'removed') stop();
    else if (
      event.type === 'updated' &&
      query.state.fetchStatus === 'idle' &&
      event.action.type !== 'invalidate'
    ) {
      query.invalidate();
      if (quiet)
        queueMicrotask(() => {
          if (deferredRefreshes.get(query)?.stop === stop) flush();
        });
    }
  });
  const stop = () => {
    clearTimeout(timer);
    unsubscribe();
    deferredRefreshes.delete(query);
    notifyDequeued();
  };
  deferredRefreshes.set(query, { stop, dequeued });
  query.invalidate();
}

export function refreshQueries(
  qc: QueryClient,
  filters?: QueryFilters,
  patch?: () => void,
): Promise<void> {
  const cache = qc.getQueryCache();
  const matches = cache.findAll(filters);
  const interrupted = new Set(matches.filter((query) => query.state.fetchStatus !== 'idle'));
  for (const query of matches) {
    pendingRefreshes.set(query, (pendingRefreshes.get(query) ?? 0) + 1);
    deferredRefreshes.get(query)?.stop();
  }
  const release = () => {
    for (const query of matches) {
      const remaining = (pendingRefreshes.get(query) ?? 1) - 1;
      if (remaining <= 0) pendingRefreshes.delete(query);
      else pendingRefreshes.set(query, remaining);
    }
    for (const notify of refreshWaiters) notify();
  };
  void qc.cancelQueries({ predicate: (query) => interrupted.has(query) });
  const committing = [...interrupted].filter((query) => query.state.fetchStatus !== 'idle');
  const refresh = () => {
    try {
      patch?.();
      void qc.invalidateQueries({ ...filters, refetchType: 'none' });
      const active = qc.refetchQueries({ ...filters, type: 'active' }, withoutCancellation);
      const unobserved = [...interrupted]
        .filter(
          (query) =>
            (!query.isActive() || query.isStatic()) && cache.get(query.queryHash) === query,
        )
        .map((query) => {
          const read = query.fetch(undefined, withoutCancellation).catch((error) => {
            console.debug('cairn: recoverable operation failed', error);
          });
          return query.state.fetchStatus === 'paused' ? undefined : read;
        });
      return Promise.all([active, ...unobserved]).then(() => {});
    } finally {
      release();
    }
  };
  return committing.length === 0
    ? refresh()
    : Promise.allSettled(committing.map((query) => query.promise)).then(refresh, () => {
        release();
      });
}

export function invalidateEventQueries(
  qc: QueryClient,
  event: StreamQueryEvent,
  patch?: () => void,
): Promise<void> {
  const effects = new Map<Query, QueryEffect>();
  for (const query of qc.getQueryCache().getAll()) {
    const effect = streamEventQueryEffect(event, query.queryKey, query.state.data);
    effects.set(query, effect);
    if (effect === 'stale') deferRefresh(qc, query);
  }
  return refreshQueries(
    qc,
    {
      predicate: (query) =>
        (effects.get(query) ?? streamEventQueryEffect(event, query.queryKey, query.state.data)) ===
        'cancel',
    },
    patch,
  );
}

export function recoverQueries(qc: QueryClient, signal: AbortSignal): Promise<void> {
  const cache = qc.getQueryCache();
  const required = new Set<Query>();
  for (const query of cache.getAll()) {
    if ((query.isActive() && !query.isStatic()) || query.state.fetchStatus !== 'idle') {
      required.add(query);
    }
  }
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const watchedDeferred = new WeakSet<Promise<void>>();
    let scheduled = false;
    let finished = false;
    let started = false;
    const check = () => {
      scheduled = false;
      if (finished || !started) return;
      for (const query of required) {
        if (cache.get(query.queryHash) !== query) continue;
        if (pendingRefreshes.has(query)) return;
        const dequeued = deferredRefreshes.get(query)?.dequeued;
        if (dequeued !== undefined) {
          if (!watchedDeferred.has(dequeued)) {
            watchedDeferred.add(dequeued);
            void dequeued.then(scheduleCheck);
          }
          return;
        }
        if (query.state.fetchStatus === 'fetching') return;
      }
      finish();
    };
    const scheduleCheck = () => {
      if (finished || scheduled) return;
      scheduled = true;
      queueMicrotask(check);
    };
    const unsubscribe = cache.subscribe((event) => {
      if (required.has(event.query)) scheduleCheck();
    });
    refreshWaiters.add(scheduleCheck);
    const finish = () => {
      if (finished) return;
      finished = true;
      unsubscribe();
      refreshWaiters.delete(scheduleCheck);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    signal.addEventListener('abort', finish, { once: true });
    const kickoff = invalidateEventQueries(qc, { type: 'reconnect' });
    started = true;
    scheduleCheck();
    void kickoff.then(scheduleCheck, finish);
  });
}

export function patchQueryData<T>(
  qc: QueryClient,
  key: QueryKey,
  update: (data: T | undefined) => T | undefined,
): void | Promise<void> {
  const filters = { queryKey: key, exact: true };
  const query = qc.getQueryCache().find(filters);
  const patch = () => {
    const previous = query?.state;
    const current = qc.getQueryData<T>(key);
    const next = update(current);
    if (next === undefined || next === current) return;
    qc.setQueryData<T>(key, next, { updatedAt: previous?.dataUpdatedAt ?? 0 });
    if (previous?.isInvalidated) query?.invalidate();
  };
  if (query !== undefined && query.state.fetchStatus !== 'idle')
    return refreshQueries(qc, filters, patch);
  patch();
}

export function refreshQueriesOnGateClose(qc: QueryClient): () => void {
  let open = authSnapshot().gateOpen;
  return subscribeAuth(() => {
    const wasOpen = open;
    open = authSnapshot().gateOpen;
    if (wasOpen && !open) void refreshQueries(qc, { type: 'active' });
  });
}
