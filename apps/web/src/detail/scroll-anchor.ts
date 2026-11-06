import type { TranscriptItem } from '../fixtures/records.js';

export type OpeningAnchor = 'end' | 'last-user';

export function openingAnchor(
  running: boolean,
  transcript: readonly TranscriptItem[],
): OpeningAnchor | null {
  if (transcript.length === 0) return null;
  if (running) return 'end';
  return transcript.some((item) => item.kind === 'user') ? 'last-user' : 'end';
}

interface TranscriptQueryState {
  live: boolean;
  todoPending: boolean;
  buildId: string | null;
  buildPending: boolean;
  stepsPending: boolean;
  messagesPending: boolean;
}

export function isTranscriptSettled(state: TranscriptQueryState): boolean {
  if (!state.live) return true;
  if (state.todoPending) return false;
  if (state.buildId === null) return true;
  return !state.buildPending && !state.stepsPending && !state.messagesPending;
}
