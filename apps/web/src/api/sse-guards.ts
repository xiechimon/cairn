import type { QueryClient } from '@tanstack/react-query';
import { isInFlightPhase } from '../phase.js';
import { invalidateConverged } from './invalidate.js';
import type { StreamGuards } from './sse-connection.js';

export const STREAM_QUERY_KEYS: readonly (readonly string[])[] = [
  ['todos'],
  ['todo'],
  ['schedules'],
  ['build'],
  ['steps'],
  ['notifications'],
  ['chiefThreads'],
  ['machines'],
  ['branchSync'],
  ['messages'],
  ['plans'],
  ['changes'],
];

export function hasInFlightWork(qc: QueryClient): boolean {
  return qc
    .getQueryCache()
    .getAll()
    .some((query) => {
      const head = query.queryKey[0];
      if (head !== 'todos' && head !== 'todo') return false;
      const data = query.state.data;
      if (Array.isArray(data)) return data.some(isInFlightRow);
      return isInFlightRow(data);
    });
}

function isInFlightRow(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false;
  const phase = (row as { phase?: unknown }).phase;
  return typeof phase === 'string' && isInFlightPhase(phase);
}

export function streamGuards(qc: QueryClient): StreamGuards {
  return {
    inFlight: () => hasInFlightWork(qc),
    reconcile: () => {
      for (const queryKey of STREAM_QUERY_KEYS) void invalidateConverged(qc, { queryKey });
    },
  };
}
