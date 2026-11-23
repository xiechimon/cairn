import type { QueryClient, QueryFilters } from '@tanstack/react-query';
import { authSnapshot, subscribeAuth } from './auth.js';

export function invalidateConverged(qc: QueryClient, filters?: QueryFilters): Promise<void> {
  const initialInFlight = qc
    .getQueryCache()
    .findAll(filters)
    .filter((q) => q.state.fetchStatus !== 'idle' && q.state.data === undefined);
  return qc.invalidateQueries(filters).then(() => {
    for (const q of initialInFlight) {
      if (q.state.fetchStatus !== 'idle') continue;
      void qc.invalidateQueries({ queryKey: q.queryKey });
    }
  });
}

export function refreshQueriesOnGateClose(qc: QueryClient): () => void {
  let open = authSnapshot().gateOpen;
  return subscribeAuth(() => {
    const wasOpen = open;
    open = authSnapshot().gateOpen;
    if (wasOpen && !open) void invalidateConverged(qc, { type: 'active' });
  });
}
