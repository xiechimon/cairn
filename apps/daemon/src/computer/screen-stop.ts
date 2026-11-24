import type { ComputerImage } from '@cairn/shared';

export type ScreenOutcome =
  | { kind: 'done'; text: string; images: ComputerImage[] }
  | { kind: 'error'; message: string; delivery: 'not_delivered' | 'unknown' };

export class ScreenStop extends Error {
  constructor(
    readonly outcome: Extract<ScreenOutcome, { kind: 'error' }>,
    readonly code?: string,
  ) {
    super(outcome.message);
  }
}

export function refuseScreen(message: string): ScreenStop {
  return new ScreenStop({ kind: 'error', message, delivery: 'not_delivered' });
}
