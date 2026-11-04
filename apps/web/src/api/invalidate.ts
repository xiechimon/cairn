import type { QueryClient, QueryFilters } from '@tanstack/react-query';

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
