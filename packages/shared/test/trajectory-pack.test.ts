import { describe, expect, test } from 'vitest';
import {
  FAILURE_WHERE,
  FAILURE_WHY,
  type TrajectoryPack,
  trajectoryPackSchema,
} from '../src/index.js';

const pack = {
  buildId: 'build-1',
  input: {
    spec: 'Implement the task',
    sourceRef: null,
    baseSha: 'a'.repeat(40),
    persona: null,
    agentId: 'agent-1',
    model: 'provider/model',
    skillInjection: null,
    blockerHandoff: null,
    harnessHash: 'harness-v1',
  },
  process: {
    steps: [
      {
        stepId: 'step-1',
        kind: 'build',
        transcript: [
          {
            role: 'assistant',
            content: [
              { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'pwd' } },
            ],
            stopReason: 'toolUse',
            usage: { input: 12, output: 3 },
            providerData: { cached: true },
          },
        ],
        checkpointCommit: null,
      },
    ],
    plans: [{ id: 'plan-1', buildId: 'build-1', version: 1, createdAt: 1, content: 'Plan v1' }],
    token_usage: [],
  },
  judgments: {
    plan: [
      { action: 'revision', reason: 'Add verification' },
      { action: 'confirm', reason: null },
    ],
    diff: [
      { action: 'revision', reason: 'Tighten the diff' },
      { action: 'restart', reason: 'Fix failure' },
      { action: 'approve', reason: null },
    ],
    gate_verdict: [],
    ciFixRounds: 0,
  },
  outcome: null,
  attribution: null,
} satisfies TrajectoryPack;

describe('trajectoryPackSchema', () => {
  test('preserves a build and transcript tool, stop reason and token facts', () => {
    expect(trajectoryPackSchema.parse(pack)).toEqual(pack);
  });

  test('accepts delayed and partially known outcomes', () => {
    for (const outcome of [
      null,
      { merged: true, revertedWithin7d: null, fixedByLaterPr: null, costTotal: 0.12 },
      { merged: false, revertedWithin7d: false, fixedByLaterPr: true, costTotal: 0 },
    ]) {
      expect(trajectoryPackSchema.parse({ ...pack, outcome }).outcome).toEqual(outcome);
    }
  });

  test('accepts known input facts and empty process history', () => {
    const input = {
      ...pack.input,
      sourceRef: 'github:owner/repo#1',
      persona: 'code_reviewer',
      skillInjection: { hits: [] },
      blockerHandoff: null,
    } satisfies TrajectoryPack['input'];
    const process = { steps: [], plans: [], token_usage: [] };
    expect(trajectoryPackSchema.parse({ ...pack, input, process })).toEqual({
      ...pack,
      input,
      process,
    });
  });

  test('requires nullable outcome and step fields rather than silently defaulting them', () => {
    const outcome = { merged: null, revertedWithin7d: null, fixedByLaterPr: null, costTotal: null };
    expect(trajectoryPackSchema.parse({ ...pack, outcome }).outcome).toEqual(outcome);
    for (const key of Object.keys(outcome)) {
      const missing = { ...outcome } as Record<string, unknown>;
      delete missing[key];
      expect(trajectoryPackSchema.safeParse({ ...pack, outcome: missing }).success).toBe(false);
    }
    const step = pack.process.steps[0];
    for (const key of Object.keys(step ?? {})) {
      const missing = { ...step } as Record<string, unknown>;
      delete missing[key];
      expect(
        trajectoryPackSchema.safeParse({ ...pack, process: { ...pack.process, steps: [missing] } })
          .success,
      ).toBe(false);
    }
  });

  test('requires every declared field even when nullable', () => {
    const parsed = trajectoryPackSchema.parse(pack);
    for (const key of Object.keys(parsed).filter((key) => key !== 'attribution')) {
      const missing = { ...parsed } as Record<string, unknown>;
      delete missing[key];
      expect(trajectoryPackSchema.safeParse(missing).success, key).toBe(false);
    }
    for (const section of ['input', 'process', 'judgments'] as const) {
      for (const key of Object.keys(parsed[section])) {
        const missing = { ...parsed[section] } as Record<string, unknown>;
        delete missing[key];
        expect(
          trajectoryPackSchema.safeParse({ ...parsed, [section]: missing }).success,
          `${section}.${key}`,
        ).toBe(false);
      }
    }
  });

  test('rejects invalid judgments and counts', () => {
    for (const ciFixRounds of [-1, 0.5, '1', null]) {
      expect(
        trajectoryPackSchema.safeParse({ ...pack, judgments: { ...pack.judgments, ciFixRounds } })
          .success,
      ).toBe(false);
    }
    expect(
      trajectoryPackSchema.safeParse({
        ...pack,
        judgments: { ...pack.judgments, plan: [{ action: 'approve', reason: null }] },
      }).success,
    ).toBe(false);
    expect(
      trajectoryPackSchema.safeParse({
        ...pack,
        outcome: { merged: true, revertedWithin7d: null, fixedByLaterPr: null, costTotal: -1 },
      }).success,
    ).toBe(false);
  });

  describe('attribution', () => {
    const attribution = {
      where: 'runtime',
      why: 'premature_finish',
      evidence: [{ stepId: 'step-1', messageIndex: 0 }],
      labeler: 'provider/stronger-model',
      labeledAt: 1_700_000_000_000,
    };

    test('packs written before the field existed parse with attribution null', () => {
      const { attribution: _omitted, ...legacy } = pack;
      expect(trajectoryPackSchema.parse(legacy).attribution).toBeNull();
      expect(trajectoryPackSchema.parse({ ...pack, attribution: null }).attribution).toBeNull();
    });

    test('keeps a full label and accepts human as labeler', () => {
      expect(trajectoryPackSchema.parse({ ...pack, attribution }).attribution).toEqual(attribution);
      const human = { ...attribution, labeler: 'human', evidence: [] };
      expect(trajectoryPackSchema.parse({ ...pack, attribution: human }).attribution).toEqual(
        human,
      );
    });

    test('exposes the fixed vocabularies', () => {
      expect(FAILURE_WHERE).toEqual([
        'prompt',
        'knowledge',
        'runtime',
        'config',
        'infra',
        'unknown',
      ]);
      expect(FAILURE_WHY).toEqual([
        'premature_finish',
        'thinking_runaway',
        'wrong_tool',
        'ignored_instruction',
        'context_missing',
        'ci_misread',
        'other',
      ]);
    });

    test('rejects values outside the vocabularies and incomplete labels', () => {
      const bad: unknown[] = [
        { ...attribution, where: 'harness' },
        { ...attribution, why: 'laziness' },
        { ...attribution, where: null },
        { ...attribution, labeler: '' },
        { ...attribution, labeledAt: 1.5 },
        { ...attribution, evidence: [{ stepId: 'step-1', messageIndex: -1 }] },
        { ...attribution, evidence: [{ messageIndex: 0 }] },
      ];
      for (const value of bad)
        expect(trajectoryPackSchema.safeParse({ ...pack, attribution: value }).success).toBe(false);
      for (const key of Object.keys(attribution)) {
        const missing = { ...attribution } as Record<string, unknown>;
        delete missing[key];
        expect(trajectoryPackSchema.safeParse({ ...pack, attribution: missing }).success, key).toBe(
          false,
        );
      }
    });
  });
});
