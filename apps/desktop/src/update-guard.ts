export const GUARD_HEALTH_WINDOW_MS = 60_000;
export const GUARD_HEALTHY_AFTER_MS = 30_000;
export const GUARD_MAX_ROLLBACKS = 2;
export const GUARD_PROBE_FAILURES = 3;

export type GuardPhase = 'armed' | 'healthy' | 'rollback';

export interface GuardState {
  phase: GuardPhase;
  armedAt: number;
  healthySince: number | null;
  rollbacks: number;
  failures: number;
}

export type GuardEvent = 'health-ok' | 'health-failed' | 'server-exit' | 'tick';

export type GuardAction = 'none' | 'rollback' | 'confirm';

export interface GuardStep {
  state: GuardState;
  action: GuardAction;
}

export function armGuard(rollbacks: number, at: number): GuardState {
  return { phase: 'armed', armedAt: at, healthySince: null, rollbacks, failures: 0 };
}

export function guardStep(state: GuardState, event: { event: GuardEvent; at: number }): GuardStep {
  if (state.phase !== 'armed') return { state, action: 'none' };
  const { at } = event;
  const healthySince = state.healthySince;
  const heldLongEnough = healthySince !== null && at - healthySince >= GUARD_HEALTHY_AFTER_MS;
  switch (event.event) {
    case 'health-ok':
      if (heldLongEnough) {
        return { state: { ...state, phase: 'healthy' }, action: 'confirm' };
      }
      return { state: { ...state, healthySince: healthySince ?? at, failures: 0 }, action: 'none' };
    case 'health-failed': {
      if (heldLongEnough) return { state: { ...state, phase: 'healthy' }, action: 'confirm' };
      const failures = state.failures + 1;
      return failures >= GUARD_PROBE_FAILURES
        ? rollbackOrGiveUp({ ...state, failures })
        : { state: { ...state, failures }, action: 'none' };
    }
    case 'server-exit':
      return heldLongEnough
        ? { state: { ...state, phase: 'healthy' }, action: 'confirm' }
        : rollbackOrGiveUp(state);
    case 'tick':
      if (heldLongEnough) return { state: { ...state, phase: 'healthy' }, action: 'confirm' };
      return healthySince === null && at - state.armedAt >= GUARD_HEALTH_WINDOW_MS
        ? rollbackOrGiveUp(state)
        : { state, action: 'none' };
    default:
      return { state, action: 'none' };
  }
}

function rollbackOrGiveUp(state: GuardState): GuardStep {
  if (state.rollbacks >= GUARD_MAX_ROLLBACKS) return { state, action: 'none' };
  return {
    state: { ...state, phase: 'rollback', rollbacks: state.rollbacks + 1 },
    action: 'rollback',
  };
}
