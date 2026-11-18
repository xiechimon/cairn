import { describe, expect, test } from 'vitest';
import { runtimeGatePasses, stepRuntimeFor } from '../src/services/dispatch-eligibility.js';

describe('Gemini dispatch eligibility', () => {
  test('routes Gemini independently and preserves the unknown-provider fallback', () => {
    expect(stepRuntimeFor('gemini')).toBe('gemini');
    expect(stepRuntimeFor('unknown-provider')).toBe('pi');
    expect(stepRuntimeFor('claude-code')).toBe('claude-code');
  });

  test('any machine can claim a Gemini step because its permission requests pass the command gate', () => {
    const machine = {
      claudeCodeReport: { installed: true },
      capabilities: { executor: 'orb' as const },
    };
    expect(runtimeGatePasses(machine, 'gemini')).toBe(true);
    expect(runtimeGatePasses(machine, 'claude-code')).toBe(true);
  });
});
