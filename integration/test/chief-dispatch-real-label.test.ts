import { describe, expect, test } from 'vitest';
import { type Labeler, labelDispatchCases } from '../eval/chief-dispatch-real/label.mts';
import type { ExportedDispatchCase } from '../eval/chief-dispatch-real/types.mts';

function baseCase(overrides: Partial<ExportedDispatchCase> = {}): ExportedDispatchCase {
  return {
    caseId: 'lab-1',
    prompt: 'Add a dark mode toggle to the settings page',
    projectsSnapshot: [
      {
        id: 'p1',
        name: 'cairn',
        description: 'xiechimon/cairn',
        agents: [
          {
            id: 'a-front',
            key: 'frontend',
            displayName: 'Frontend',
            description: 'Web UI',
          },
          {
            id: 'a-code',
            key: 'code',
            displayName: 'Backend',
            description: 'Server code',
          },
        ],
      },
    ],
    dispatchedTo: { agentId: 'a-code', displayName: 'Backend', key: 'code' },
    outcome: 'reassigned',
    ...overrides,
  };
}

function labeler(vendor: string, answer: string): Labeler {
  return {
    vendor,
    async label() {
      return answer;
    },
  };
}

describe('chief-dispatch-real label', () => {
  test('agreeing labels keep the case', async () => {
    const kept = await labelDispatchCases(
      [baseCase()],
      [labeler('glm', 'frontend'), labeler('deepseek', 'frontend')],
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.expect).toEqual({ kind: 'dispatch', agent: 'frontend' });
    expect(kept[0]?.prompt).toContain('dark mode');
  });

  test('disagreeing labels or any unclear drop it', async () => {
    const disagree = await labelDispatchCases(
      [baseCase({ caseId: 'd1' })],
      [labeler('glm', 'frontend'), labeler('deepseek', 'code')],
    );
    expect(disagree).toHaveLength(0);

    const unclear = await labelDispatchCases(
      [baseCase({ caseId: 'd2' })],
      [labeler('glm', 'frontend'), labeler('deepseek', 'unclear')],
    );
    expect(unclear).toHaveLength(0);

    const bothUnclear = await labelDispatchCases(
      [baseCase({ caseId: 'd3' })],
      [labeler('glm', 'unclear'), labeler('deepseek', 'unclear')],
    );
    expect(bothUnclear).toHaveLength(0);
  });

  test('two labelers from the same vendor are refused', async () => {
    await expect(
      labelDispatchCases([baseCase()], [labeler('glm', 'frontend'), labeler('glm', 'frontend')]),
    ).rejects.toThrow(/different vendors|same vendor/i);
  });
});
