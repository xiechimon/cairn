import { canBoardDrop, type Phase } from '@cairn/shared';

export const PHASE_TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  todo: ['queued', 'confirm', 'closed'],
  queued: ['planning', 'building', 'needs_input', 'failed', 'closed'],
  planning: ['confirm', 'needs_input', 'failed', 'closed'],
  confirm: ['building', 'planning', 'failed', 'queued', 'closed'],
  building: ['review', 'needs_input', 'failed', 'done', 'closed'],
  needs_input: ['building', 'planning', 'queued', 'failed', 'done', 'closed'],
  review: ['done', 'failed', 'queued', 'planning', 'closed'],
  done: ['queued'],
  failed: ['queued', 'closed', 'review'],
  stopped: ['queued', 'done', 'closed'],
  closed: ['todo'],
};

const STOP_SETTLED_PHASES: readonly Phase[] = ['todo', 'done', 'stopped', 'closed'];

const STOP_RETURN_PHASES: readonly Phase[] = ['confirm', 'review', 'done', 'failed', 'stopped'];

export function canStopTransitionPhase(from: Phase, to: Phase): boolean {
  return !STOP_SETTLED_PHASES.includes(from) && STOP_RETURN_PHASES.includes(to);
}

export function stopReturnPhase(lastDoneKind: string | null, prevPhase: Phase | null): Phase {
  if (lastDoneKind === 'plan') return 'confirm';
  if (lastDoneKind !== null) return 'review';
  if (prevPhase !== null && STOP_RETURN_PHASES.includes(prevPhase)) return prevPhase;
  return 'stopped';
}

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

export function assertPhaseTransition(from: Phase, to: Phase, cause?: 'stop'): void {
  const allowed =
    canTransitionPhase(from, to) || (cause === 'stop' && canStopTransitionPhase(from, to));
  if (!allowed) throw new PhaseTransitionError(from, to);
}
