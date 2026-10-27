import type { ReviewVerdict, VerifyVerdict } from '@cairn/shared';
import { type CompareFile, checkPlanContract, EVIDENCE_PREFIX } from '@cairn/shared/merge-gate';
import { computePatchDigest } from './digest.js';
import { type GateVerdictView, isFullSha } from './readiness.js';

export interface BindGateVerdictInput {
  kind: GateVerdictView['kind'];
  perspective: string | null;
  expectedHeadSha: string;
  reportedHeadSha: string | null;
  stepFailed: boolean;
  extracted: boolean;
  reviewVerdict?: ReviewVerdict;
  verifyVerdict?: VerifyVerdict;
  planContent?: string | null;
  planRequired?: boolean;
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
  const reported = reportedFull;
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
  const payload =
    input.kind === 'verify'
      ? verifyVerdictFacts(
          input.verifyVerdict,
          verificationItemsForPlan(input.planContent ?? null, input.planRequired ?? false),
        )
      : reviewVerdictFacts(input.reviewVerdict);
  const extracted = input.extracted && payload.extracted;
  const blocked = input.blocked || payload.blocked;
  const outcome: GateVerdictView['outcome'] = input.stepFailed
    ? 'step_failed'
    : !extracted
      ? 'extraction_failed'
      : blocked
        ? 'block'
        : input.kind !== 'verify' && reported === null
          ? 'unbound'
          : 'pass';
  return {
    kind: input.kind,
    perspective: input.kind === 'verify' ? null : input.perspective,
    outcome,
    expectedHeadSha: input.expectedHeadSha,
    headSha: reported,
    patchDigest: aligned && files !== null ? computePatchDigest(files).patchDigest : null,
  };
}

export function reviewVerdictFacts(verdict: ReviewVerdict | undefined): {
  extracted: boolean;
  blocked: boolean;
} {
  return {
    extracted:
      verdict !== undefined &&
      typeof verdict.gateLoosening === 'boolean' &&
      typeof verdict.evalRulerChange === 'boolean',
    blocked:
      verdict !== undefined &&
      (verdict.gateLoosening === true ||
        verdict.evalRulerChange === true ||
        verdict.findings.some((finding) => finding.severity === 'blocking')),
  };
}

export function verifyVerdictFacts(
  verdict: VerifyVerdict | undefined,
  items: readonly string[] | null,
): { extracted: boolean; blocked: boolean } {
  const numbered = verdict?.evidence.some((entry) => entry.item !== undefined) ?? false;
  const covered = new Set(verdict?.evidence.map((entry) => entry.item));
  return {
    extracted: verdict !== undefined && items !== null,
    blocked:
      verdict !== undefined &&
      (!verdict.passed || (numbered && (items ?? []).some((_, index) => !covered.has(index + 1)))),
  };
}

export function verificationItemsForPlan(
  content: string | null,
  required: boolean,
): string[] | null {
  if (content === null) return required ? null : [];
  const parsed = checkPlanContract(content);
  return parsed.ok ? parsed.items : null;
}
