import { type CompareFile, EVIDENCE_PREFIX } from '@cairn/shared/merge-gate';
import { computePatchDigest } from './digest.js';
import { type GateVerdictView, isFullSha } from './readiness.js';

export interface BindGateVerdictInput {
  kind: GateVerdictView['kind'];
  perspective: string | null;
  expectedHeadSha: string;
  reportedHeadSha: string | null;
  stepFailed: boolean;
  extracted: boolean;
  blocked: boolean;
  compareFiles?: readonly CompareFile[] | null;
  pathsAfterExpected?: readonly string[] | null;
  evidenceDir?: string | null;
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
  const reportedFull =
    input.reportedHeadSha !== null && isFullSha(input.reportedHeadSha)
      ? input.reportedHeadSha
      : null;
  const reported = reportedFull ?? (input.kind !== 'verify' ? input.expectedHeadSha : null);
  const rawDir = input.evidenceDir ?? null;
  const segment =
    rawDir?.startsWith(EVIDENCE_PREFIX) && rawDir.endsWith('/')
      ? rawDir.slice(EVIDENCE_PREFIX.length, -1)
      : null;
  const dir =
    segment !== null &&
    segment !== '' &&
    segment !== '.' &&
    segment !== '..' &&
    !segment.includes('/') &&
    !segment.includes('\\')
      ? rawDir
      : null;
  const paths = input.pathsAfterExpected ?? null;
  let evidenceOnly = false;
  if (
    input.kind === 'verify' &&
    reported !== null &&
    reported !== input.expectedHeadSha &&
    dir !== null &&
    paths !== null &&
    paths.length > 0
  ) {
    evidenceOnly = true;
    for (const path of paths) {
      const rest = path.startsWith(dir) ? path.slice(dir.length) : '';
      if (
        rest === '' ||
        rest.split('/').some((part) => part === '' || part === '.' || part === '..')
      ) {
        evidenceOnly = false;
        break;
      }
    }
  }
  const aligned = reported === input.expectedHeadSha || evidenceOnly;
  const files = input.compareFiles ?? null;
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
    patchDigest: aligned && files !== null ? computePatchDigest(files).patchDigest : null,
  };
}
