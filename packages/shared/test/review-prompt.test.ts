import { describe, expect, test } from 'vitest';
import { reviewVerdictSchema } from '../src/index.js';

describe('ADR 0026 review questions', () => {
  test('review output retains both answers and rejects non-boolean answers', () => {
    const verdict = {
      conclusion: 'Reviewed',
      findings: [],
      gateLoosening: true,
      evalRulerChange: false,
    };
    expect(reviewVerdictSchema.parse(verdict)).toEqual(verdict);
    expect(reviewVerdictSchema.safeParse({ ...verdict, gateLoosening: 'false' }).success).toBe(
      false,
    );
    expect(reviewVerdictSchema.safeParse({ ...verdict, evalRulerChange: null }).success).toBe(
      false,
    );
  });
});

describe('scope instead of size (D68)', () => {
  test('a verdict that still carries a size answer parses without it', () => {
    const parsed = reviewVerdictSchema.parse({
      conclusion: 'Reviewed',
      findings: [],
      sizeAssessment: 'accepted',
    });
    expect(parsed).toEqual({ conclusion: 'Reviewed', findings: [] });
  });
});
