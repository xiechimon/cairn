import type { HarnessEvalDispatchPort } from './harness-eval-coordinator.js';

export const DEFAULT_HARNESS_EVAL_ATTEMPT_TIMEOUT_MS = 60 * 60 * 1000;

export const productionHarnessEvalDispatch: HarnessEvalDispatchPort = async () => {};

export function productionHarnessEvalConfig(over?: {
  dispatch?: HarnessEvalDispatchPort;
  now?: () => number;
  attemptTimeoutMs?: number;
  dispatchAuthorized?: boolean;
}): {
  dispatch: HarnessEvalDispatchPort;
  attemptTimeoutMs: number;
  now?: () => number;
  dispatchAuthorized: boolean;
} {
  return {
    dispatch: over?.dispatch ?? productionHarnessEvalDispatch,
    attemptTimeoutMs: over?.attemptTimeoutMs ?? DEFAULT_HARNESS_EVAL_ATTEMPT_TIMEOUT_MS,
    ...(over?.now !== undefined ? { now: over.now } : {}),
    dispatchAuthorized: over?.dispatchAuthorized ?? true,
  };
}
