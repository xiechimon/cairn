import { describe, expect, it } from 'vitest';
import {
  classifyReviewChoice,
  resolveReviewDefault,
  type ReviewCandidate,
} from '../src/detail/review-default.js';

function candidate(id: string, provider: string | null): ReviewCandidate {
  return { id, name: id, model: 'm1', provider };
}

const FOUR = [
  candidate('r-y', 'vendor-b'),
  candidate('r-x', 'vendor-a'),
  candidate('agent-b', 'vendor-b'),
  candidate('agent-a', 'vendor-a'),
];

describe('classifyReviewChoice', () => {
  it('different vendors → cross-vendor', () => {
    expect(classifyReviewChoice(candidate('r', 'vendor-b'), 'vendor-a')).toBe('cross-vendor');
  });

  it('same vendor → same-vendor', () => {
    expect(classifyReviewChoice(candidate('r', 'vendor-a'), 'vendor-a')).toBe('same-vendor');
  });

  it('candidate without a configured provider → not misjudged as cross-vendor', () => {
    expect(classifyReviewChoice(candidate('r', null), 'vendor-a')).toBe('undetermined');
  });

  it('no baseline on the output side (provider unknown) → claims no cross-vendor', () => {
    expect(classifyReviewChoice(candidate('r', 'vendor-a'), null)).toBe('undetermined');
  });
});

describe('resolveReviewDefault', () => {
  it('S1 execution side and planning side differ in vendor → defaults to the execution side as baseline, not the planning side', () => {

    const out = resolveReviewDefault({
      candidates: FOUR,
      assignment: { build: { agentId: 'agent-b' }, plan: { agentId: 'agent-a' } },
    });
    expect(out.producerProvider).toBe('vendor-b');
    expect(out.independence).toBe('cross-vendor');
    expect(out.defaultAgentId).toBe('agent-a');
  });

  it('S2 execution side unassigned, planning side assigned → falls back to the planning side as the comparison baseline', () => {
    const out = resolveReviewDefault({
      candidates: FOUR,
      assignment: { build: null, plan: { agentId: 'agent-a' } },
    });
    expect(out.producerProvider).toBe('vendor-a');
    expect(out.independence).toBe('cross-vendor');
    expect(out.defaultAgentId).toBe('agent-b');
  });

  it('S3 both sides unassigned → default value determined, and claims no independence', () => {
    const first = resolveReviewDefault({ candidates: FOUR, assignment: null });
    expect(first.producerProvider).toBeNull();
    expect(first.independence).toBe('undetermined');
    expect(first.defaultAgentId).toBe('agent-a');

    const second = resolveReviewDefault({
      candidates: FOUR,
      assignment: { build: null, plan: null },
    });
    expect(second.defaultAgentId).toBe(first.defaultAgentId);
    expect(second.independence).toBe('undetermined');
  });

  it('S4 all Agents in the team share one vendor → judged same-source, default value still determined', () => {
    const same = [
      candidate('agent-a', 'vendor-a'),
      candidate('agent-b', 'vendor-a'),
      candidate('r-x', 'vendor-a'),
    ];
    const out = resolveReviewDefault({
      candidates: same,
      assignment: { build: { agentId: 'agent-b' }, plan: null },
    });
    expect(out.independence).toBe('same-vendor');
    expect(out.defaultAgentId).toBe('agent-a');
  });

  it('S5 multiple cross-vendor candidates → default stable, independent of input order', () => {
    const assignment = { build: { agentId: 'agent-b' }, plan: null };
    const forward = resolveReviewDefault({ candidates: FOUR, assignment });
    const reversed = resolveReviewDefault({ candidates: [...FOUR].reverse(), assignment });
    const again = resolveReviewDefault({ candidates: FOUR, assignment });
    expect(forward.defaultAgentId).toBe('agent-a');
    expect(reversed.defaultAgentId).toBe(forward.defaultAgentId);
    expect(again.defaultAgentId).toBe(forward.defaultAgentId);
  });

  it('S5b all candidates cross-vendor (no output-same-vendor row) → still takes the first in stable order', () => {
    const out = resolveReviewDefault({
      candidates: [
        candidate('r-z', 'vendor-c'),
        candidate('r-a', 'vendor-c'),
        candidate('producer', 'vendor-a'),
      ],
      assignment: { build: { agentId: 'producer' }, plan: null },
    });
    expect(out.independence).toBe('cross-vendor');
    expect(out.defaultAgentId).toBe('r-a');
  });

  it('S6a candidates without a configured provider do not enter the cross-vendor set, but remain selectable determined defaults', () => {
    const out = resolveReviewDefault({
      candidates: [candidate('agent-a', 'vendor-a'), candidate('r-null', null)],
      assignment: { build: { agentId: 'agent-a' }, plan: null },
    });

    expect(out.defaultAgentId).toBe('agent-a');
    expect(out.independence).toBe('same-vendor');
  });

  it('S6b the presence of cross-vendor candidates does not jitter because of unconfigured rows', () => {
    const out = resolveReviewDefault({
      candidates: [
        candidate('agent-a', 'vendor-a'),
        candidate('r-null', null),
        candidate('r-b', 'vendor-b'),
      ],
      assignment: { build: { agentId: 'agent-a' }, plan: null },
    });
    expect(out.defaultAgentId).toBe('r-b');
    expect(out.independence).toBe('cross-vendor');
  });

  it('S7 empty candidate set → no default', () => {
    const out = resolveReviewDefault({
      candidates: [],
      assignment: { build: { agentId: 'agent-a' }, plan: null },
    });
    expect(out.defaultAgentId).toBeNull();
    expect(out.independence).toBe('undetermined');
  });

  it('S8 the agent the output slot points at is outside the candidate set → no baseline, no independence claimed', () => {
    const out = resolveReviewDefault({
      candidates: FOUR,
      assignment: { build: { agentId: 'agent-gone' }, plan: null },
    });
    expect(out.producerProvider).toBeNull();
    expect(out.independence).toBe('undetermined');
    expect(out.defaultAgentId).toBe('agent-a');
  });
});