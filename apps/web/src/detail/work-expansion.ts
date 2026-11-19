import type { TranscriptItem } from '../fixtures/records.js';

export function shouldExpandLastWork(workItems: readonly TranscriptItem[]): boolean {
  const last = workItems.at(-1);
  if (last?.kind !== 'work') return false;
  const lastCall = last.steps.findLast((step) => step.kind === 'call');
  return lastCall?.kind === 'call' && lastCall.error;
}
