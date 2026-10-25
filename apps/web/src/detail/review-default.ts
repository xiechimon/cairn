import type { Assignment } from '@cairn/shared';

export interface ReviewCandidate {
  id: string;
  name: string;
  model: string;
  provider: string | null;
}

export type ReviewIndependence = 'cross-vendor' | 'same-vendor' | 'undetermined';

export interface ReviewDefault {
  defaultAgentId: string | null;
  producerProvider: string | null;
  independence: ReviewIndependence;
}

function producerAgentIdOf(assignment: Assignment | null): string | null {
  return assignment?.build?.agentId ?? assignment?.plan?.agentId ?? null;
}

export function classifyReviewChoice(
  candidate: ReviewCandidate,
  producerProvider: string | null,
): ReviewIndependence {
  if (producerProvider == null || candidate.provider == null) return 'undetermined';
  return candidate.provider === producerProvider ? 'same-vendor' : 'cross-vendor';
}

function stableFirst(rows: readonly ReviewCandidate[]): ReviewCandidate | null {
  let best: ReviewCandidate | null = null;
  for (const row of rows) {
    if (best === null || row.id < best.id) best = row;
  }
  return best;
}

export function resolveReviewDefault(input: {
  candidates: readonly ReviewCandidate[];
  assignment: Assignment | null;
}): ReviewDefault {
  const { candidates, assignment } = input;
  const producerAgentId = producerAgentIdOf(assignment);
  const producerProvider =
    producerAgentId === null
      ? null
      : (candidates.find((row) => row.id === producerAgentId)?.provider ?? null);

  const reviewSlotAgentId = assignment?.review?.agentId ?? null;
  const reviewSlotHit =
    reviewSlotAgentId !== null
      ? (candidates.find((row) => row.id === reviewSlotAgentId) ?? null)
      : null;
  if (reviewSlotHit !== null) {
    return {
      defaultAgentId: reviewSlotHit.id,
      producerProvider,
      independence: classifyReviewChoice(reviewSlotHit, producerProvider),
    };
  }

  const crossVendor = candidates.filter(
    (row) => classifyReviewChoice(row, producerProvider) === 'cross-vendor',
  );
  const picked = stableFirst(crossVendor.length > 0 ? crossVendor : candidates);
  if (picked === null) {
    return { defaultAgentId: null, producerProvider, independence: 'undetermined' };
  }
  return {
    defaultAgentId: picked.id,
    producerProvider,
    independence: classifyReviewChoice(picked, producerProvider),
  };
}
