import { describe, expect, test } from 'vitest';
import {
  FAILURE_REPLAY_BANK_RELATIVE,
  FAILURE_REPLAY_EVENTS,
  failureReplayBankCaseSchema,
  failureReplayCandidateSchema,
} from '../src/failure-replay-candidate.js';

describe('failureReplayCandidateSchema', () => {
  test('accepts a pending plan-rejection candidate', () => {
    const candidate = failureReplayCandidateSchema.parse({
      id: 'fr-plan-rejection-build-1',
      event: 'plan-rejection',
      buildId: 'build-1',
      baseSha: 'abc123',
      prompt: { spec: 'Add export', baseSha: 'abc123' },
      feedback: 'Plan skipped the redaction step',
      draftAssertions: ['must cover secret redaction before export'],
      status: 'pending',
      createdAt: 1,
    });
    expect(candidate.event).toBe('plan-rejection');
    expect(candidate.status).toBe('pending');
  });

  test('rejects an empty assertion list', () => {
    expect(() =>
      failureReplayCandidateSchema.parse({
        id: 'fr-x',
        event: 'review-blocking',
        buildId: 'build-1',
        baseSha: 'abc',
        prompt: { spec: 'x', baseSha: 'abc' },
        feedback: 'blocking',
        draftAssertions: [],
        status: 'pending',
        createdAt: 1,
      }),
    ).toThrow();
  });

  test('names the three failure-replay events', () => {
    expect([...FAILURE_REPLAY_EVENTS]).toEqual([
      'plan-rejection',
      'review-blocking',
      'post-merge-revert',
    ]);
  });
});

describe('failureReplayBankCaseSchema', () => {
  test('accepts a confirmed bank case under the protected eval path', () => {
    const bankCase = failureReplayBankCaseSchema.parse({
      id: 'fr-post-merge-revert-build-9',
      event: 'post-merge-revert',
      sourceBuildId: 'build-9',
      prompt: { spec: 'Ship feature', baseSha: 'def456' },
      assertions: ['must not regress the reverted behavior'],
      confirmedAt: 2,
    });
    expect(FAILURE_REPLAY_BANK_RELATIVE).toBe('integration/eval/failure-replay');
    expect(bankCase.sourceBuildId).toBe('build-9');
  });
});
