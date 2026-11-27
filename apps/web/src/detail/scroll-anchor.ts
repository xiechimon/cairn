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

const PROLOGUE_KINDS = new Set<TranscriptItem['kind']>(['run', 'chief', 'scheduled']);

export function opensAtTopOf(transcript: readonly TranscriptItem[], hasEarlier: boolean): boolean {
  if (hasEarlier) return false;
  let firstUser = -1;
  for (let i = 0; i < transcript.length; i += 1) {
    if (transcript[i]?.kind !== 'user') continue;
    if (firstUser !== -1) return false;
    firstUser = i;
  }
  if (firstUser === -1) return false;
  for (let i = 0; i < firstUser; i += 1) {
    const item = transcript[i];
    if (item === undefined || !PROLOGUE_KINDS.has(item.kind)) return false;
  }
  return true;
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
