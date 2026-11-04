import { canBoardDrop, type Phase } from '@cairn/shared';

export const PHASE_TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  todo: ['queued', 'confirm', 'closed'],
  queued: ['planning', 'building', 'failed', 'closed'],
  planning: ['confirm', 'failed', 'closed'],
  confirm: ['building', 'planning', 'failed', 'queued', 'closed'],
  building: ['review', 'failed', 'done', 'closed'],
  review: ['done', 'failed', 'queued', 'planning', 'closed'],
  done: ['queued'],
  failed: ['queued', 'closed', 'review'],
  closed: ['todo'],
};

export function canTransitionPhase(from: Phase, to: Phase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

export function canManualMovePhase(from: Phase, to: Phase): boolean {
  return canBoardDrop(from, to);
}

export class PhaseTransitionError extends Error {
  constructor(
    readonly from: Phase,
    readonly to: Phase,
  ) {
    super(`illegal phase transition: ${from} -> ${to}`);
    this.name = 'PhaseTransitionError';
  }
}

export function assertPhaseTransition(from: Phase, to: Phase): void {
  if (!canTransitionPhase(from, to)) throw new PhaseTransitionError(from, to);
}
