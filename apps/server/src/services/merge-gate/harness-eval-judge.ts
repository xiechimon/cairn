import {
  CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER,
  type HarnessRegressionResult,
  harnessRegressionResultSchema,
  type MergeReadiness,
} from '@cairn/shared/merge-gate';
import { computePatchDigest } from './digest.js';
import {
  type HarnessEvalCoordinatorPort,
  type HarnessEvalNeed,
  type PrepareHarnessEvalResult,
  prepareHarnessEvalRouting,
} from './harness-eval-route.js';
import { touchesHarness } from './paths.js';
import { type GateInputs, mergeReadiness } from './readiness.js';

export type JudgeHarnessEvalInput = {
  inputs: GateInputs;
  coordinator: HarnessEvalCoordinatorPort;
  repo: string;
  pr: number;
  dispatchAuthorized: boolean;
  now?: number;
};

export type JudgeHarnessEvalResult = {
  readiness: MergeReadiness;
  routed: PrepareHarnessEvalResult;
  need: HarnessEvalNeed | null;
  inputs: GateInputs;
};

function parseHarnessResult(text: string | null | undefined): HarnessRegressionResult | null {
  if (text == null || text === '') return null;
  try {
    const raw: unknown = JSON.parse(text);
    const parsed = harnessRegressionResultSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function harnessNeedFromInputs(inputs: GateInputs): {
  need: HarnessEvalNeed | null;
  patchDigest: string | null;
} {
  const compare =
    inputs.compare === 'unreadable' || inputs.compare === 'malformed' ? null : inputs.compare;
  if (compare === null || !touchesHarness(compare.files)) {
    return { need: null, patchDigest: null };
  }
  const digest = computePatchDigest(compare.files).patchDigest;
  if (digest === null) return { need: null, patchDigest: null };
  const parsed = parseHarnessResult(inputs.harnessEvalText);
  if (parsed !== null && parsed.patchDigest === digest) {
    if (parsed.decision_ok < CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER) {
      return { need: null, patchDigest: digest };
    }
    return { need: null, patchDigest: digest };
  }
  if (parsed === null) return { need: 'missing', patchDigest: digest };
  return { need: 'stale', patchDigest: digest };
}

export async function judgeMergeReadinessWithHarnessEval(
  input: JudgeHarnessEvalInput,
): Promise<JudgeHarnessEvalResult> {
  const { need, patchDigest } = harnessNeedFromInputs(input.inputs);
  if (patchDigest === null) {
    const readiness = mergeReadiness(input.inputs);
    return {
      readiness,
      routed: { attempt: null, created: false, dispatched: false },
      need: null,
      inputs: input.inputs,
    };
  }
  const routed = await prepareHarnessEvalRouting({
    coordinator: input.coordinator,
    repo: input.repo,
    pr: input.pr,
    patchDigest,
    need,
    dispatchAuthorized: input.dispatchAuthorized,
  });
  const now = input.now;
  const judged: GateInputs = {
    ...input.inputs,
    harnessEval: {
      attempt: routed.attempt,
      now,
    },
  };
  return {
    readiness: mergeReadiness(judged),
    routed,
    need,
    inputs: judged,
  };
}
