import { describe, expect, it } from 'vitest';
import {
  antigravitySubscriptionModelSchema,
  machineAntigravityModelProbeBodySchema,
  machineAntigravityModelProbeResultSchema,
} from '../src/index.js';

const probeResult = (model: Record<string, unknown>) => ({
  status: 'ok',
  models: [model],
});

describe('Antigravity API key model probe wire', () => {
  it('carries the group a model was reported under', () => {
    const result = probeResult({ id: 'claude-paid', name: 'Claude Paid', group: 'External' });
    expect(machineAntigravityModelProbeResultSchema.parse(result)).toEqual(result);
    expect(
      machineAntigravityModelProbeBodySchema.parse({
        phase: 'result',
        connectionId: 'connection',
        result,
      }),
    ).toMatchObject({ result });
  });

  it('keeps the group optional so an ungrouped catalog is still valid', () => {
    const result = probeResult({ id: 'gemini-paid', name: 'Gemini Paid' });
    expect(machineAntigravityModelProbeResultSchema.parse(result)).toEqual(result);
  });

  it.each([
    ['an empty group', { id: 'm', name: 'M', group: '' }],
    ['a group longer than a pool label', { id: 'm', name: 'M', group: 'G'.repeat(65) }],
    ['an unknown field', { id: 'm', name: 'M', pool: 'External' }],
  ])('rejects %s', (_label, model) => {
    expect(machineAntigravityModelProbeResultSchema.safeParse(probeResult(model)).success).toBe(
      false,
    );
  });

  it('does not widen the stored model shape', () => {
    expect(
      antigravitySubscriptionModelSchema.safeParse({ id: 'm', name: 'M', group: 'External' })
        .success,
    ).toBe(false);
  });
});
