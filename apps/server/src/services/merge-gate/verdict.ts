import { type GateVerdictView, isFullSha } from './readiness.js';

export interface BindGateVerdictInput {
  kind: GateVerdictView['kind'];
  perspective: string | null;
  expectedHeadSha: string;
  reportedHeadSha: string | null;
  stepFailed: boolean;
  extracted: boolean;
  blocked: boolean;
}

export interface BoundGateVerdict {
  kind: GateVerdictView['kind'];
  perspective: string | null;
  outcome: GateVerdictView['outcome'];
  expectedHeadSha: string;
  headSha: string | null;
  patchDigest: string | null;
}

export function bindGateVerdict(input: BindGateVerdictInput): BoundGateVerdict | null {
  if (!isFullSha(input.expectedHeadSha)) return null;
  const reported =
    input.reportedHeadSha !== null && isFullSha(input.reportedHeadSha)
      ? input.reportedHeadSha
      : null;
  const outcome: GateVerdictView['outcome'] = input.stepFailed
    ? 'step_failed'
    : input.extracted
      ? input.blocked
        ? 'block'
        : 'pass'
      : 'extraction_failed';
  return {
    kind: input.kind,
    perspective: input.kind === 'verify' ? null : input.perspective,
    outcome,
    expectedHeadSha: input.expectedHeadSha,
    headSha: reported,
    patchDigest: null,
  };
}
