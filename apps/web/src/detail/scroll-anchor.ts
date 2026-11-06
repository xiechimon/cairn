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
