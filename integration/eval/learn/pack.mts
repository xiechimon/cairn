import type { TrajectoryPack } from '@cairn/shared';
import type { LearnCase } from './grade.mts';

export function buildLearnPack(
  input: LearnCase,
  round1: { text: string; model: string; agentId: string; buildId: string },
): TrajectoryPack {
  const stepId = `step-${round1.buildId}`;
  return {
    buildId: round1.buildId,
    input: {
      spec: input.round1,
      sourceRef: null,
      baseSha: '0'.repeat(40),
      persona: null,
      agentId: round1.agentId,
      model: round1.model,
      skillInjection: null,
      blockerHandoff: null,
      harnessHash: 'learn',
    },
    process: {
      steps: [
        {
          stepId,
          kind: 'plan',
          transcript: [
            { role: 'user', content: input.round1 },
            { role: 'assistant', content: round1.text },
            { role: 'user', content: input.correction },
          ],
          checkpointCommit: null,
        },
      ],
      plans: [
        {
          id: `plan-${round1.buildId}`,
          buildId: round1.buildId,
          version: 1,
          createdAt: 1,
          content: round1.text,
        },
      ],
      token_usage: [],
    },
    judgments: {
      plan: [{ action: 'revision', reason: input.correction }],
      diff: [],
      gate_verdict: [],
      ciFixRounds: 0,
    },
    outcome: null,
    attribution: null,
  };
}
