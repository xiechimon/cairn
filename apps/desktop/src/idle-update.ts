export const LOCKED_FOR_MS = 60_000;
export const NO_INPUT_FOR_MS = 15 * 60_000;
export const AWAY_FROM_CAIRN_MS = 10 * 60_000;
export const STEP_WAIT_CAP_MS = 24 * 60 * 60_000;

export interface IdleSample {
  now: number;
  ready: boolean;
  guardSettled: boolean;
  locked: boolean;
  inputIdleMs: number;
  cairnFocused: boolean;
  turnInFlight: boolean;
  dialogOpen: boolean;
  stepsInFlight: number;
}

export type IdleTrigger = 'locked' | 'no-input' | 'away';
export type IdleHold = 'not-ready' | 'guard' | 'turn' | 'dialog' | 'steps' | 'in-use';
export type IdleVerdict = { apply: true; trigger: IdleTrigger } | { apply: false; hold: IdleHold };

export interface IdleWatch {
  sample(sample: IdleSample): IdleVerdict;
  cairnUsed(at: number): void;
}

export function createIdleWatch(): IdleWatch {
  let lockedSince: number | null = null;
  let awaySince: number | null = null;
  let stepsSince: number | null = null;
  const triggerOf = (sample: IdleSample): IdleTrigger | null => {
    if (lockedSince !== null && sample.now - lockedSince >= LOCKED_FOR_MS) return 'locked';
    if (sample.inputIdleMs >= NO_INPUT_FOR_MS) return 'no-input';
    if (awaySince !== null && sample.now - awaySince >= AWAY_FROM_CAIRN_MS) return 'away';
    return null;
  };
  return {
    sample(sample) {
      lockedSince = sample.locked ? (lockedSince ?? sample.now) : null;
      awaySince = sample.cairnFocused ? null : (awaySince ?? sample.now);
      stepsSince = sample.stepsInFlight > 0 ? (stepsSince ?? sample.now) : null;
      if (!sample.ready) return { apply: false, hold: 'not-ready' };
      if (!sample.guardSettled) return { apply: false, hold: 'guard' };
      if (sample.turnInFlight) return { apply: false, hold: 'turn' };
      if (sample.dialogOpen) return { apply: false, hold: 'dialog' };
      const trigger = triggerOf(sample);
      if (trigger === null) return { apply: false, hold: 'in-use' };
      if (stepsSince !== null) {
        const waitedOut = sample.now - stepsSince >= STEP_WAIT_CAP_MS;
        if (!(waitedOut && trigger === 'locked')) return { apply: false, hold: 'steps' };
      }
      return { apply: true, trigger };
    },
    cairnUsed(at) {
      if (awaySince !== null) awaySince = at;
    },
  };
}
