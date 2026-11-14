import { classifyStepFailure } from '@cairn/shared';
import type { StepPassState } from './step-pass-events.js';

export type StepPassRetry =
  | { kind: 'network'; delayMs: number }
  | { kind: 'compat'; failureText: string }
  | { kind: 'images'; failureText: string }
  | { kind: 'finish' };

export interface StepPassRetryInput {
  pass: number;
  state: Readonly<
    Pick<StepPassState, 'lastError' | 'lastModelError' | 'sawProgress' | 'quotaTrip' | 'retryStorm'>
  >;
  watchdogTripped: boolean;
  stopPending: boolean;
  networkRetries: number;
  networkRetryDelays: readonly number[];
}

export function planStepPassRetry(input: StepPassRetryInput): StepPassRetry {
  const { state } = input;
  const failureText = state.lastModelError ?? state.lastError;
  if (failureText === null) return { kind: 'finish' };
  const failure = classifyStepFailure(failureText);
  if (
    failure === 'network' &&
    state.lastError !== null &&
    !input.stopPending &&
    input.networkRetries < input.networkRetryDelays.length
  ) {
    return { kind: 'network', delayMs: input.networkRetryDelays[input.networkRetries] ?? 0 };
  }
  if (failure === 'model_unavailable') return { kind: 'finish' };
  const modelErrorAfterTrip =
    state.lastModelError !== null && (input.watchdogTripped || state.retryStorm);
  if (
    input.pass === 0 &&
    !state.sawProgress &&
    state.quotaTrip === null &&
    (state.lastError !== null || modelErrorAfterTrip)
  ) {
    return { kind: 'compat', failureText };
  }
  return { kind: 'images', failureText };
}
