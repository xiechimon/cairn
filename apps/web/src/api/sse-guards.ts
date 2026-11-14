import {
  type ChiefThread,
  type ConversationMessagesResponse,
  isChiefConversationId,
} from '@cairn/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { isInFlightPhase } from '../phase.js';
import { invalidateConverged } from './invalidate.js';
import type { StreamGuards } from './sse-connection.js';

export const STREAM_QUERY_KEYS: readonly (readonly string[])[] = [
  ['todos'],
  ['todo'],
  ['tasks'],
  ['schedules'],
  ['build'],
  ['steps'],
  ['notifications'],
  ['chiefThreads'],
  ['chief'],
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
      const data = query.state.data;
      if (head === 'chiefThreads' && Array.isArray(data))
        return data.some(
          (thread: ChiefThread) =>
            thread.activeRun != null || thread.pending?.some((input) => input.state === 'queued'),
        );
      if (
        head === 'messages' &&
        typeof query.queryKey[1] === 'string' &&
        isChiefConversationId(query.queryKey[1]) &&
        query.queryKey[2] === 'pages'
      )
        return (
          (data as InfiniteData<ConversationMessagesResponse> | undefined)?.pages[0]?.activeRun !=
          null
        );
      if (head !== 'todos' && head !== 'todo') return false;
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
    reconcile: async () => {
      await Promise.all(STREAM_QUERY_KEYS.map((queryKey) => invalidateConverged(qc, { queryKey })));
    },
  };
}
