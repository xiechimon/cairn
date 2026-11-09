import type { TranscriptItem } from '../fixtures/records.js';

export function shouldExpandLastWork(workItems: readonly TranscriptItem[]): boolean {
  const last = workItems.at(-1);
  return (
    last?.kind === 'work' &&
    last.steps.some((step) => step.kind !== 'call' || step.action !== 'setup')
  );
}
