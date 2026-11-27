import type { StepFailureCode, StepFailureDetail } from '@cairn/shared';

export class SessionNotResumableError extends Error {
  constructor(sessionId: string, detail?: string) {
    super(
      `session ${sessionId} not found on this machine (continue session impossible)` +
        (detail !== undefined ? `: ${detail}` : ''),
    );
    this.name = 'SessionNotResumableError';
  }
}

export class StepFailureError extends Error {
  readonly failureCode: StepFailureCode;
  readonly failureDetail?: StepFailureDetail;

  constructor(message: string, failureCode: StepFailureCode, failureDetail?: StepFailureDetail) {
    super(message);
    this.name = 'StepFailureError';
    this.failureCode = failureCode;
    if (failureDetail !== undefined) this.failureDetail = failureDetail;
  }
}

export function stepFailureOf(
  error: unknown,
): { failureCode: StepFailureCode; failureDetail?: StepFailureDetail } | null {
  if (!(error instanceof StepFailureError)) return null;
  return error.failureDetail !== undefined
    ? { failureCode: error.failureCode, failureDetail: error.failureDetail }
    : { failureCode: error.failureCode };
}
