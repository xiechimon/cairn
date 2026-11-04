import { describe, expect, test } from 'vitest';
import { runtimeGatePasses, stepRuntimeFor } from '../src/services/dispatch-eligibility.js';

describe('Gemini dispatch eligibility', () => {
  test('routes Gemini independently and preserves the unknown-provider fallback', () => {
    expect(stepRuntimeFor('gemini')).toBe('gemini');
    expect(stepRuntimeFor('unknown-provider')).toBe('pi');
    expect(stepRuntimeFor('claude-code')).toBe('claude-code');
  });

  test('requires explicit Gemini opt-in before a machine can claim the step', () => {
    expect(runtimeGatePasses({ enabledRuntimes: ['pi', 'claude-code'] }, 'gemini')).toBe(false);
    expect(runtimeGatePasses({ enabledRuntimes: ['gemini'] }, 'gemini')).toBe(true);
  });
});
